import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect } from "effect"
import { afterEach, describe, expect, it } from "vitest"
import { emptyState } from "../src/model.js"
import type { PortmuxPaths } from "../src/paths.js"
import { loadState, makeTunnelConfig, saveState } from "../src/state.js"

const temporaryDirectories: Array<string> = []

const makePaths = async (): Promise<PortmuxPaths> => {
  const directory = await mkdtemp(join(tmpdir(), "portmux-state-"))
  temporaryDirectories.push(directory)
  return {
    stateDirectory: directory,
    stateFile: join(directory, "tunnels.json"),
    runtimeDirectory: join(directory, "run"),
  }
}

const legacyTunnel = (
  id: string,
  overrides: Readonly<Record<string, unknown>> = {},
): Readonly<Record<string, unknown>> => ({
  id,
  name: `forward-${id}`,
  sshTarget: "devbox",
  bindHost: "127.0.0.1",
  localPort: 3_000,
  remoteHost: "127.0.0.1",
  remotePort: 3_000,
  desired: "running",
  createdAt: "2026-01-02T00:00:00.000Z",
  updatedAt: "2026-01-03T00:00:00.000Z",
  ...overrides,
})

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })))
})

describe("persistent tunnel state", () => {
  it("starts empty when no state file exists", async () => {
    const paths = await makePaths()
    await expect(Effect.runPromise(loadState(paths))).resolves.toEqual(emptyState())
  })

  it("round-trips v2 machines and tunnels through the state file", async () => {
    const paths = await makePaths()
    const tunnel = makeTunnelConfig({
      name: "docs",
      sshTarget: "devbox",
      bindHost: "127.0.0.1",
      localPort: 4_321,
      remoteHost: "127.0.0.1",
      remotePort: 4_321,
    })

    await Effect.runPromise(saveState(paths, { version: 2, machines: [], tunnels: [tunnel] }))

    const state = await Effect.runPromise(loadState(paths))
    expect(state.tunnels[0]).toEqual(tunnel)
  })

  it("deterministically migrates v1 tunnels and deduplicates machines by target and identity", async () => {
    const paths = await makePaths()
    const legacy = {
      version: 1,
      tunnels: [
        legacyTunnel("older", {
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-02T00:00:00.000Z",
        }),
        legacyTunnel("newer", {
          localPort: 5_173,
          remotePort: 5_173,
          createdAt: "2026-01-04T00:00:00.000Z",
          updatedAt: "2026-01-05T00:00:00.000Z",
        }),
        legacyTunnel("identity", {
          identityFile: "~/.ssh/work",
          localPort: 8_080,
          remotePort: 8_080,
        }),
      ],
    }
    await writeFile(paths.stateFile, JSON.stringify(legacy), { mode: 0o600 })

    const first = await Effect.runPromise(loadState(paths))
    const second = await Effect.runPromise(loadState(paths))

    expect(first).toEqual(second)
    expect(first.version).toBe(2)
    expect(first.machines).toHaveLength(2)
    expect(first.tunnels.map((tunnel) => tunnel.id)).toEqual(["older", "newer", "identity"])
    expect(first.tunnels.every((tunnel) => tunnel.restoreOnLaunch)).toBe(true)

    const defaultMachine = first.machines.find((machine) => machine.identityFile === undefined)
    const identityMachine = first.machines.find((machine) => machine.identityFile === "~/.ssh/work")
    expect(defaultMachine).toMatchObject({
      name: "devbox",
      sshTarget: "devbox",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-05T00:00:00.000Z",
    })
    expect(identityMachine).toMatchObject({ sshTarget: "devbox", identityFile: "~/.ssh/work" })
    expect(first.tunnels.slice(0, 2).map((tunnel) => tunnel.machineId)).toEqual([
      defaultMachine?.id,
      defaultMachine?.id,
    ])
    expect(first.tunnels[2]?.machineId).toBe(identityMachine?.id)
  })

  it("preserves the exact v1 file in a private backup before the first v2 write", async () => {
    const paths = await makePaths()
    const legacyContents = `${JSON.stringify({ version: 1, tunnels: [legacyTunnel("web")] }, null, 2)}\n`
    await writeFile(paths.stateFile, legacyContents, { mode: 0o644 })

    const migrated = await Effect.runPromise(loadState(paths))
    await Effect.runPromise(saveState(paths, migrated))

    const backupFile = `${paths.stateFile}.v1.bak`
    await expect(readFile(backupFile, "utf8")).resolves.toBe(legacyContents)
    expect((await stat(backupFile)).mode & 0o777).toBe(0o600)
    expect(JSON.parse(await readFile(paths.stateFile, "utf8"))).toMatchObject({ version: 2 })
  })
})
