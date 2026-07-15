import { mkdtemp, rm } from "node:fs/promises"
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

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })))
})

describe("persistent tunnel state", () => {
  it("starts empty when no state file exists", async () => {
    const paths = await makePaths()
    await expect(Effect.runPromise(loadState(paths))).resolves.toEqual(emptyState())
  })

  it("round-trips a tunnel through the state file", async () => {
    const paths = await makePaths()
    const tunnel = makeTunnelConfig({
      name: "docs",
      sshTarget: "devbox",
      bindHost: "127.0.0.1",
      localPort: 4321,
      remoteHost: "127.0.0.1",
      remotePort: 4321,
    })

    await Effect.runPromise(saveState(paths, { version: 1, tunnels: [tunnel] }))

    const state = await Effect.runPromise(loadState(paths))
    expect(state.tunnels[0]).toEqual(tunnel)
  })
})
