import { randomUUID } from "node:crypto"
import { chmod, readFile, rename, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { Effect, Schema } from "effect"
import { errorMessage, PortmuxError } from "./errors.js"
import {
  emptyState,
  type StoredState,
  StoredStateSchema,
  type TunnelConfig,
  type TunnelDraft,
} from "./model.js"
import type { PortmuxPaths } from "./paths.js"
import { ensurePrivateDirectory } from "./private-directory.js"

const decodeState = Schema.decodeUnknownSync(StoredStateSchema)

const assertUniqueTunnelIds = (state: StoredState): StoredState => {
  const ids = new Set(state.tunnels.map((tunnel) => tunnel.id))
  if (ids.size !== state.tunnels.length) {
    throw new Error("Tunnel state contains duplicate IDs")
  }
  return state
}

const isMissingFile = (cause: unknown): boolean =>
  cause instanceof Error && "code" in cause && cause.code === "ENOENT"

const readState = async (paths: PortmuxPaths): Promise<StoredState> => {
  try {
    const contents = await readFile(paths.stateFile, "utf8")
    return assertUniqueTunnelIds(decodeState(JSON.parse(contents)))
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
  const temporaryFile = join(paths.stateDirectory, `.tunnels-${randomUUID()}.tmp`)
  await writeFile(temporaryFile, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 })
  await chmod(temporaryFile, 0o600)
  await rename(temporaryFile, paths.stateFile)
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
    desired: "running",
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
