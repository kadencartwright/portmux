import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect } from "effect"
import { afterEach, describe, expect, it } from "vitest"
import { makeTunnelManager } from "../src/manager.js"
import type { RemoteListener, TunnelDraft } from "../src/model.js"
import type { PortmuxPaths } from "../src/paths.js"
import type { ProcessResult, ProcessRunner } from "../src/process.js"
import { loadState, makeMachineConfig, makeTunnelConfig, saveState } from "../src/state.js"

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

const listener: RemoteListener = {
  id: "4:127.0.0.1:5173:42",
  family: 4,
  address: "127.0.0.1",
  forwardHost: "127.0.0.1",
  port: 5_173,
  processName: "vite",
  pid: 42,
}

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

  it("serializes overlapping creates so neither state update is lost", async () => {
    const paths = await makePaths()
    let activeStarts = 0
    let maximumActiveStarts = 0
    const runner: ProcessRunner = {
      run: (_executable, args) => {
        if (args.includes("check")) {
          return Effect.succeed(result(255))
        }
        return Effect.promise(async () => {
          activeStarts += 1
          maximumActiveStarts = Math.max(maximumActiveStarts, activeStarts)
          await new Promise((resolve) => setTimeout(resolve, 20))
          activeStarts -= 1
          return result(0)
        })
      },
    }
    const manager = makeTunnelManager(paths, runner)

    await Promise.all([
      Effect.runPromise(manager.create(draft("first"))),
      Effect.runPromise(manager.create(draft("second"))),
    ])

    const state = await Effect.runPromise(loadState(paths))
    expect(state.tunnels.map((tunnel) => tunnel.name).sort()).toEqual(["first", "second"])
    expect(maximumActiveStarts).toBe(1)
  })

  it("attempts every desired tunnel when reconciliation has failures", async () => {
    const paths = await makePaths()
    const tunnels = [
      makeTunnelConfig(draft("offline")),
      makeTunnelConfig(draft("healthy")),
      makeTunnelConfig({ ...draft("ad-hoc"), restoreOnLaunch: false }),
    ]
    await Effect.runPromise(saveState(paths, { version: 2, machines: [], tunnels }))
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
    expect(attempted).not.toContain("ad-hoc")
  })

  it("persists favorite machines and creates ad-hoc forwards from their listeners", async () => {
    const paths = await makePaths()
    const calls: Array<ReadonlyArray<string>> = []
    const runner = runnerFrom((_executable, args) => {
      calls.push(args)
      return args.includes("check") ? result(255) : result(0)
    })
    const manager = makeTunnelManager(paths, runner)
    const machine = await Effect.runPromise(
      manager.addMachine({ name: "worktree", sshTarget: "devbox", identityFile: "/tmp/test-key" }),
    )

    const tunnel = await Effect.runPromise(
      manager.forwardPort({ machineId: machine.id, listener, localPort: 15_173 }),
    )

    expect(tunnel).toMatchObject({
      name: "worktree:5173",
      sshTarget: "devbox",
      identityFile: "/tmp/test-key",
      bindHost: "127.0.0.1",
      localPort: 15_173,
      remoteHost: "127.0.0.1",
      remotePort: 5_173,
      machineId: machine.id,
      restoreOnLaunch: false,
    })
    expect(calls.some((args) => args.includes("127.0.0.1:15173:127.0.0.1:5173"))).toBe(true)
    await expect(Effect.runPromise(manager.listMachines)).resolves.toEqual([machine])
  })

  it("detaches forwards when a favorite machine is removed", async () => {
    const paths = await makePaths()
    const machine = makeMachineConfig({ name: "devbox", sshTarget: "devbox" })
    const tunnel = makeTunnelConfig({ ...draft(), machineId: machine.id, restoreOnLaunch: false })
    await Effect.runPromise(saveState(paths, { version: 2, machines: [machine], tunnels: [tunnel] }))
    const manager = makeTunnelManager(
      paths,
      runnerFrom(() => result(0)),
    )

    await Effect.runPromise(manager.removeMachine(machine.id))

    const state = await Effect.runPromise(loadState(paths))
    expect(state.machines).toEqual([])
    expect(state.tunnels).toEqual([{ ...tunnel, machineId: null }])
  })

  it("does not invoke SSH for an unknown machine", async () => {
    const paths = await makePaths()
    let calls = 0
    const manager = makeTunnelManager(
      paths,
      runnerFrom(() => {
        calls += 1
        return result(0)
      }),
    )

    await expect(Effect.runPromise(manager.scanPorts("missing"))).rejects.toThrow(
      "Machine missing no longer exists",
    )
    expect(calls).toBe(0)
  })
})
