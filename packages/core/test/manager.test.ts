import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect } from "effect"
import { afterEach, describe, expect, it } from "vitest"
import { makeTunnelManager } from "../src/manager.js"
import type { TunnelDraft } from "../src/model.js"
import type { PortmuxPaths } from "../src/paths.js"
import type { ProcessResult, ProcessRunner } from "../src/process.js"
import { loadState, makeTunnelConfig, saveState } from "../src/state.js"

const temporaryDirectories: Array<string> = []

const makePaths = async (): Promise<PortmuxPaths> => {
  const directory = await mkdtemp(join(tmpdir(), "portmux-manager-"))
  temporaryDirectories.push(directory)
  return {
    stateDirectory: directory,
    stateFile: join(directory, "tunnels.json"),
    runtimeDirectory: join(directory, "run"),
  }
}

const draft = (name = "web"): TunnelDraft => ({
  name,
  sshTarget: name,
  bindHost: "127.0.0.1",
  localPort: name === "web" ? 3000 : 4000,
  remoteHost: "127.0.0.1",
  remotePort: name === "web" ? 3000 : 4000,
})

const result = (exitCode: number, stderr = ""): ProcessResult => ({ exitCode, stdout: "", stderr })

const runnerFrom = (
  run: (executable: string, args: ReadonlyArray<string>) => ProcessResult,
): ProcessRunner => ({
  run: (executable, args) => Effect.succeed(run(executable, args)),
})

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })))
})

describe("tunnel manager", () => {
  it("does not persist a definition when SSH fails to start", async () => {
    const paths = await makePaths()
    const runner = runnerFrom((_executable, args) =>
      args.includes("check") ? result(255) : result(1, "authentication failed"),
    )
    const manager = makeTunnelManager(paths, runner)

    await expect(Effect.runPromise(manager.create(draft()))).rejects.toThrow("authentication failed")

    const state = await Effect.runPromise(loadState(paths))
    expect(state.tunnels).toEqual([])
  })

  it("attempts every desired tunnel when reconciliation has failures", async () => {
    const paths = await makePaths()
    const tunnels = [makeTunnelConfig(draft("offline")), makeTunnelConfig(draft("healthy"))]
    await Effect.runPromise(saveState(paths, { version: 1, tunnels }))
    const attempted: Array<string> = []
    const runner = runnerFrom((_executable, args) => {
      if (args.includes("check")) {
        return result(255)
      }
      const target = args.at(-1) ?? ""
      attempted.push(target)
      return target === "offline" ? result(1, "offline") : result(0)
    })
    const manager = makeTunnelManager(paths, runner)

    await expect(Effect.runPromise(manager.reconcile)).rejects.toThrow("Could not restore 1 forward")
    expect(attempted).toEqual(expect.arrayContaining(["offline", "healthy"]))
  })
})
