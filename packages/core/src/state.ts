import { createHash, randomUUID } from "node:crypto"
import { chmod, readFile, rename, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { Effect, Schema } from "effect"
import { errorMessage, PortmuxError } from "./errors.js"
import {
  emptyState,
  type LegacyStoredState,
  LegacyStoredStateSchema,
  type MachineConfig,
  type MachineDraft,
  type StoredState,
  StoredStateSchema,
  type TunnelConfig,
  type TunnelDraft,
} from "./model.js"
import type { PortmuxPaths } from "./paths.js"
import { ensurePrivateDirectory } from "./private-directory.js"

const decodeCurrentState = Schema.decodeUnknownSync(StoredStateSchema)
const decodeLegacyState = Schema.decodeUnknownSync(LegacyStoredStateSchema)

export const machineIdentityKey = (sshTarget: string, identityFile?: string): string =>
  `${sshTarget.trim()}\u0000${identityFile?.trim() ?? ""}`

const legacyMachineId = (key: string): string =>
  `legacy-${createHash("sha256").update(key).digest("hex").slice(0, 24)}`

const migrateLegacyState = (legacy: LegacyStoredState): StoredState => {
  const machines = new Map<string, MachineConfig>()
  for (const tunnel of legacy.tunnels) {
    const key = machineIdentityKey(tunnel.sshTarget, tunnel.identityFile)
    const current = machines.get(key)
    if (current) {
      machines.set(key, {
        ...current,
        createdAt: current.createdAt < tunnel.createdAt ? current.createdAt : tunnel.createdAt,
        updatedAt: current.updatedAt > tunnel.updatedAt ? current.updatedAt : tunnel.updatedAt,
      })
      continue
    }
    machines.set(key, {
      id: legacyMachineId(key),
      name: tunnel.sshTarget,
      sshTarget: tunnel.sshTarget,
      ...(tunnel.identityFile ? { identityFile: tunnel.identityFile } : {}),
      createdAt: tunnel.createdAt,
      updatedAt: tunnel.updatedAt,
    })
  }
  return {
    version: 2,
    machines: [...machines.values()],
    tunnels: legacy.tunnels.map((tunnel) => ({
      ...tunnel,
      machineId: legacyMachineId(machineIdentityKey(tunnel.sshTarget, tunnel.identityFile)),
      restoreOnLaunch: true,
    })),
  }
}

const decodeState = (input: unknown): StoredState => {
  if (input && typeof input === "object" && "version" in input && input.version === 1) {
    return migrateLegacyState(decodeLegacyState(input))
  }
  return decodeCurrentState(input)
}

const assertUniqueTunnelIds = (state: StoredState): StoredState => {
  const ids = new Set(state.tunnels.map((tunnel) => tunnel.id))
  if (ids.size !== state.tunnels.length) {
    throw new Error("Tunnel state contains duplicate IDs")
  }
  return state
}

const assertValidMachines = (state: StoredState): StoredState => {
  const machineIds = new Set(state.machines.map((machine) => machine.id))
  if (machineIds.size !== state.machines.length) {
    throw new Error("Machine state contains duplicate IDs")
  }
  const dangling = state.tunnels.find(
    (tunnel) => tunnel.machineId !== null && !machineIds.has(tunnel.machineId),
  )
  if (dangling) {
    throw new Error(`Tunnel ${dangling.id} refers to a missing machine`)
  }
  return state
}

const assertValidState = (state: StoredState): StoredState =>
  assertValidMachines(assertUniqueTunnelIds(state))

const isMissingFile = (cause: unknown): boolean =>
  cause instanceof Error && "code" in cause && cause.code === "ENOENT"

const readState = async (paths: PortmuxPaths): Promise<StoredState> => {
  try {
    const contents = await readFile(paths.stateFile, "utf8")
    return assertValidState(decodeState(JSON.parse(contents)))
  } catch (cause) {
    if (isMissingFile(cause)) {
      return emptyState()
    }
    throw cause
  }
}

export const loadState = (paths: PortmuxPaths): Effect.Effect<StoredState, PortmuxError> =>
  Effect.tryPromise({
    try: () => readState(paths),
    catch: (cause) =>
      new PortmuxError({
        message: `Could not read ${paths.stateFile}: ${errorMessage(cause)}`,
        cause,
      }),
  })

const writeState = async (paths: PortmuxPaths, state: StoredState): Promise<void> => {
  await ensurePrivateDirectory(dirname(paths.stateFile))
  await backUpLegacyState(paths)
  const temporaryFile = join(paths.stateDirectory, `.tunnels-${randomUUID()}.tmp`)
  await writeFile(temporaryFile, `${JSON.stringify(assertValidState(state), null, 2)}\n`, { mode: 0o600 })
  await chmod(temporaryFile, 0o600)
  await rename(temporaryFile, paths.stateFile)
}

const isExistingFile = (cause: unknown): boolean =>
  cause instanceof Error && "code" in cause && cause.code === "EEXIST"

const backUpLegacyState = async (paths: PortmuxPaths): Promise<void> => {
  let contents: string
  try {
    contents = await readFile(paths.stateFile, "utf8")
  } catch (cause) {
    if (isMissingFile(cause)) {
      return
    }
    throw cause
  }
  const parsed = JSON.parse(contents) as { readonly version?: unknown }
  if (parsed.version !== 1) {
    return
  }
  try {
    const backup = `${paths.stateFile}.v1.bak`
    await writeFile(backup, contents, { flag: "wx", mode: 0o600 })
    await chmod(backup, 0o600)
  } catch (cause) {
    if (!isExistingFile(cause)) {
      throw cause
    }
  }
}

export const saveState = (paths: PortmuxPaths, state: StoredState): Effect.Effect<void, PortmuxError> =>
  Effect.tryPromise({
    try: () => writeState(paths, state),
    catch: (cause) =>
      new PortmuxError({
        message: `Could not save ${paths.stateFile}: ${errorMessage(cause)}`,
        cause,
      }),
  })

export const makeTunnelConfig = (draft: TunnelDraft): TunnelConfig => {
  const now = new Date().toISOString()
  const identityFile = draft.identityFile?.trim()
  return {
    id: randomUUID(),
    name: draft.name.trim(),
    sshTarget: draft.sshTarget.trim(),
    bindHost: draft.bindHost.trim(),
    localPort: draft.localPort,
    remoteHost: draft.remoteHost.trim(),
    remotePort: draft.remotePort,
    ...(identityFile ? { identityFile } : {}),
    machineId: draft.machineId ?? null,
    restoreOnLaunch: draft.restoreOnLaunch ?? true,
    desired: "running",
    createdAt: now,
    updatedAt: now,
  }
}

export const makeMachineConfig = (draft: MachineDraft): MachineConfig => {
  const now = new Date().toISOString()
  const identityFile = draft.identityFile?.trim()
  return {
    id: randomUUID(),
    name: draft.name.trim(),
    sshTarget: draft.sshTarget.trim(),
    ...(identityFile ? { identityFile } : {}),
    createdAt: now,
    updatedAt: now,
  }
}

export const replaceTunnel = (
  state: StoredState,
  id: string,
  update: (tunnel: TunnelConfig) => TunnelConfig,
): StoredState => ({
  ...state,
  tunnels: state.tunnels.map((tunnel) => (tunnel.id === id ? update(tunnel) : tunnel)),
})
