import { spawn } from "node:child_process"
import { Context, Effect, Layer } from "effect"
import { discoverExternalTunnels, stopExternalTunnel as stopExternalProcess } from "./discovery.js"
import { PortmuxError } from "./errors.js"
import { findAvailableLocalPort } from "./local-port.js"
import type {
  Dashboard,
  ExternalTunnel,
  MachineConfig,
  MachineDraft,
  RemoteListener,
  RemotePortForwardDraft,
  TunnelConfig,
  TunnelDraft,
} from "./model.js"
import { controlSocketPath, getPortmuxPaths, type PortmuxPaths } from "./paths.js"
import { type ProcessRunner, ProcessRunnerLive } from "./process.js"
import { scanRemoteListeners } from "./remote-ports.js"
import { checkTunnel, startTunnelProcess, stopTunnelProcess } from "./ssh.js"
import {
  loadState,
  machineIdentityKey,
  makeMachineConfig,
  makeTunnelConfig,
  replaceTunnel,
  saveState,
} from "./state.js"
import { validateDraft, validateMachine } from "./validation.js"

export interface TunnelManagerService {
  readonly snapshot: Effect.Effect<Dashboard, PortmuxError>
  readonly reconcile: Effect.Effect<void, PortmuxError>
  readonly create: (draft: TunnelDraft) => Effect.Effect<TunnelConfig, PortmuxError>
  readonly start: (id: string) => Effect.Effect<void, PortmuxError>
  readonly stop: (id: string) => Effect.Effect<void, PortmuxError>
  readonly remove: (id: string) => Effect.Effect<void, PortmuxError>
  readonly stopExternal: (tunnel: ExternalTunnel) => Effect.Effect<void, PortmuxError>
  readonly openInBrowser: (id: string) => Effect.Effect<void, PortmuxError>
  readonly listMachines: Effect.Effect<ReadonlyArray<MachineConfig>, PortmuxError>
  readonly addMachine: (draft: MachineDraft) => Effect.Effect<MachineConfig, PortmuxError>
  readonly removeMachine: (id: string) => Effect.Effect<void, PortmuxError>
  readonly scanPorts: (machineId: string) => Effect.Effect<ReadonlyArray<RemoteListener>, PortmuxError>
  readonly forwardPort: (draft: RemotePortForwardDraft) => Effect.Effect<TunnelConfig, PortmuxError>
}

export class TunnelManager extends Context.Tag("@portmux/core/TunnelManager")<
  TunnelManager,
  TunnelManagerService
>() {}

const findTunnel = (
  tunnels: ReadonlyArray<TunnelConfig>,
  id: string,
): Effect.Effect<TunnelConfig, PortmuxError> => {
  const tunnel = tunnels.find((candidate) => candidate.id === id)
  return tunnel
    ? Effect.succeed(tunnel)
    : Effect.fail(new PortmuxError({ message: `Tunnel ${id} no longer exists` }))
}

const findMachine = (
  machines: ReadonlyArray<MachineConfig>,
  id: string,
): Effect.Effect<MachineConfig, PortmuxError> => {
  const machine = machines.find((candidate) => candidate.id === id)
  return machine
    ? Effect.succeed(machine)
    : Effect.fail(new PortmuxError({ message: `Machine ${id} no longer exists` }))
}

const setDesired = (
  paths: PortmuxPaths,
  id: string,
  desired: "running" | "stopped",
): Effect.Effect<TunnelConfig, PortmuxError> =>
  Effect.gen(function* () {
    const state = yield* loadState(paths)
    const current = yield* findTunnel(state.tunnels, id)
    const updated: TunnelConfig = {
      ...current,
      desired,
      updatedAt: new Date().toISOString(),
    }
    yield* saveState(
      paths,
      replaceTunnel(state, id, () => updated),
    )
    return updated
  })

const snapshot = (paths: PortmuxPaths, runner: ProcessRunner): Effect.Effect<Dashboard, PortmuxError> =>
  Effect.gen(function* () {
    const state = yield* loadState(paths)
    const managed = yield* Effect.forEach(state.tunnels, (tunnel) => checkTunnel(runner, paths, tunnel), {
      concurrency: 4,
    })
    const controlPaths = state.tunnels.map((tunnel) => controlSocketPath(paths, tunnel.id))
    const external = yield* discoverExternalTunnels(runner, controlPaths).pipe(
      Effect.catchAll(() => Effect.succeed([])),
    )
    return { managed, external, tunnels: [...managed, ...external] }
  })

const reconcile = (paths: PortmuxPaths, runner: ProcessRunner): Effect.Effect<void, PortmuxError> =>
  Effect.gen(function* () {
    const dashboard = yield* snapshot(paths, runner)
    const missing = dashboard.managed.filter(
      (tunnel) => tunnel.restoreOnLaunch && tunnel.desired === "running" && tunnel.status === "stopped",
    )
    const failures = yield* Effect.forEach(
      missing,
      (tunnel) =>
        startTunnelProcess(runner, paths, tunnel).pipe(
          Effect.as(undefined),
          Effect.catchAll((error) => Effect.succeed(error)),
        ),
      { concurrency: 2 },
    )
    const errors = failures.filter((error): error is PortmuxError => Boolean(error))
    if (errors.length > 0) {
      return yield* Effect.fail(
        new PortmuxError({
          message: `Could not restore ${errors.length} forward${errors.length === 1 ? "" : "s"}: ${errors
            .map((error) => error.message)
            .join("; ")}`,
        }),
      )
    }
  })

const listMachines = (paths: PortmuxPaths): Effect.Effect<ReadonlyArray<MachineConfig>, PortmuxError> =>
  Effect.map(loadState(paths), (state) => state.machines)

const addMachine = (paths: PortmuxPaths, draft: MachineDraft): Effect.Effect<MachineConfig, PortmuxError> =>
  Effect.gen(function* () {
    const validDraft = yield* validateMachine(draft)
    const state = yield* loadState(paths)
    const key = machineIdentityKey(validDraft.sshTarget, validDraft.identityFile)
    const existing = state.machines.find(
      (machine) => machineIdentityKey(machine.sshTarget, machine.identityFile) === key,
    )
    if (existing) {
      return yield* Effect.fail(
        new PortmuxError({ message: `${existing.name} already uses that SSH target and identity` }),
      )
    }
    const machine = makeMachineConfig(validDraft)
    yield* saveState(paths, { ...state, machines: [...state.machines, machine] })
    return machine
  })

const removeMachine = (paths: PortmuxPaths, id: string): Effect.Effect<void, PortmuxError> =>
  Effect.gen(function* () {
    const state = yield* loadState(paths)
    yield* findMachine(state.machines, id)
    yield* saveState(paths, {
      ...state,
      machines: state.machines.filter((machine) => machine.id !== id),
      tunnels: state.tunnels.map((tunnel) =>
        tunnel.machineId === id ? { ...tunnel, machineId: null } : tunnel,
      ),
    })
  })

const scanPortsForMachine = (
  paths: PortmuxPaths,
  runner: ProcessRunner,
  machineId: string,
): Effect.Effect<ReadonlyArray<RemoteListener>, PortmuxError> =>
  Effect.gen(function* () {
    const state = yield* loadState(paths)
    const machine = yield* findMachine(state.machines, machineId)
    return yield* scanRemoteListeners(runner, paths, machine)
  })

const matchingTunnel = (
  tunnels: ReadonlyArray<TunnelConfig>,
  draft: RemotePortForwardDraft,
): TunnelConfig | undefined =>
  tunnels.find(
    (tunnel) =>
      tunnel.machineId === draft.machineId &&
      tunnel.remoteHost === draft.listener.forwardHost &&
      tunnel.remotePort === draft.listener.port,
  )

const startRemotePortForward = (
  paths: PortmuxPaths,
  runner: ProcessRunner,
  draft: RemotePortForwardDraft,
): Effect.Effect<TunnelConfig, PortmuxError> =>
  Effect.gen(function* () {
    const state = yield* loadState(paths)
    const machine = yield* findMachine(state.machines, draft.machineId)
    const existing = matchingTunnel(state.tunnels, draft)
    if (existing) {
      yield* startTunnel(paths, runner, existing.id)
      const updated = yield* loadState(paths)
      return yield* findTunnel(updated.tunnels, existing.id)
    }
    const localPort = draft.localPort ?? (yield* findAvailableLocalPort(draft.listener.port))
    return yield* createTunnel(paths, runner, {
      name: `${machine.name}:${draft.listener.port}`,
      sshTarget: machine.sshTarget,
      bindHost: "127.0.0.1",
      localPort,
      remoteHost: draft.listener.forwardHost,
      remotePort: draft.listener.port,
      ...(machine.identityFile ? { identityFile: machine.identityFile } : {}),
      machineId: machine.id,
      restoreOnLaunch: false,
    })
  })

const createTunnel = (
  paths: PortmuxPaths,
  runner: ProcessRunner,
  draft: TunnelDraft,
): Effect.Effect<TunnelConfig, PortmuxError> =>
  Effect.gen(function* () {
    const validDraft = yield* validateDraft(draft)
    const tunnel = makeTunnelConfig(validDraft)
    const state = yield* loadState(paths)
    yield* startTunnelProcess(runner, paths, tunnel)
    yield* saveState(paths, { ...state, tunnels: [...state.tunnels, tunnel] }).pipe(
      Effect.catchAll((error) =>
        Effect.gen(function* () {
          yield* stopTunnelProcess(runner, paths, tunnel).pipe(Effect.catchAll(() => Effect.void))
          return yield* Effect.fail(error)
        }),
      ),
    )
    return tunnel
  })

const startTunnel = (
  paths: PortmuxPaths,
  runner: ProcessRunner,
  id: string,
): Effect.Effect<void, PortmuxError> =>
  Effect.gen(function* () {
    const tunnel = yield* setDesired(paths, id, "running")
    yield* startTunnelProcess(runner, paths, tunnel)
  })

const stopTunnel = (
  paths: PortmuxPaths,
  runner: ProcessRunner,
  id: string,
): Effect.Effect<void, PortmuxError> =>
  Effect.gen(function* () {
    const tunnel = yield* setDesired(paths, id, "stopped")
    yield* stopTunnelProcess(runner, paths, tunnel)
  })

const removeTunnel = (
  paths: PortmuxPaths,
  runner: ProcessRunner,
  id: string,
): Effect.Effect<void, PortmuxError> =>
  Effect.gen(function* () {
    const state = yield* loadState(paths)
    const tunnel = yield* findTunnel(state.tunnels, id)
    yield* stopTunnelProcess(runner, paths, tunnel)
    yield* saveState(paths, {
      ...state,
      tunnels: state.tunnels.filter((candidate) => candidate.id !== id),
    })
  })

const browserHost = (bindHost: string): string => {
  if (bindHost === "0.0.0.0" || bindHost === "::") {
    return "127.0.0.1"
  }
  return bindHost.includes(":") ? `[${bindHost}]` : bindHost
}

const browserCommand = (url: string): readonly [string, ReadonlyArray<string>] => {
  if (process.platform === "darwin") {
    return ["open", [url]]
  }
  if (process.platform === "win32") {
    return ["cmd.exe", ["/d", "/s", "/c", "start", "", url]]
  }
  return ["xdg-open", [url]]
}

const launchBrowser = (tunnel: TunnelConfig): Effect.Effect<void, PortmuxError> =>
  Effect.tryPromise({
    try: () =>
      new Promise<void>((resolve, reject) => {
        const url = `http://${browserHost(tunnel.bindHost)}:${tunnel.localPort}`
        const [executable, args] = browserCommand(url)
        const child = spawn(executable, [...args], { detached: true, shell: false, stdio: "ignore" })
        child.once("spawn", () => {
          child.unref()
          resolve()
        })
        child.once("error", reject)
      }),
    catch: (cause) => new PortmuxError({ message: "Could not open a browser", cause }),
  })

export const makeTunnelManager = (
  paths: PortmuxPaths = getPortmuxPaths(),
  runner: ProcessRunner = ProcessRunnerLive,
): TunnelManagerService => {
  const mutationLock = Effect.unsafeMakeSemaphore(1)
  const serialized = mutationLock.withPermits(1)
  return {
    snapshot: snapshot(paths, runner),
    reconcile: serialized(reconcile(paths, runner)),
    create: (draft) => serialized(createTunnel(paths, runner, draft)),
    start: (id) => serialized(startTunnel(paths, runner, id)),
    stop: (id) => serialized(stopTunnel(paths, runner, id)),
    remove: (id) => serialized(removeTunnel(paths, runner, id)),
    stopExternal: (tunnel) => stopExternalProcess(runner, tunnel),
    openInBrowser: (id) =>
      Effect.gen(function* () {
        const state = yield* loadState(paths)
        const tunnel = yield* findTunnel(state.tunnels, id)
        yield* launchBrowser(tunnel)
      }),
    listMachines: listMachines(paths),
    addMachine: (draft) => serialized(addMachine(paths, draft)),
    removeMachine: (id) => serialized(removeMachine(paths, id)),
    scanPorts: (machineId) => scanPortsForMachine(paths, runner, machineId),
    forwardPort: (draft) => serialized(startRemotePortForward(paths, runner, draft)),
  }
}

export const TunnelManagerLive = Layer.succeed(TunnelManager, makeTunnelManager())

export const getDashboard = Effect.flatMap(TunnelManager, (manager) => manager.snapshot)
export const reconcileTunnels = Effect.flatMap(TunnelManager, (manager) => manager.reconcile)

export const createManagedTunnel = (draft: TunnelDraft) =>
  Effect.flatMap(TunnelManager, (manager) => manager.create(draft))

export const startManagedTunnel = (id: string) =>
  Effect.flatMap(TunnelManager, (manager) => manager.start(id))

export const stopManagedTunnel = (id: string) => Effect.flatMap(TunnelManager, (manager) => manager.stop(id))

export const removeManagedTunnel = (id: string) =>
  Effect.flatMap(TunnelManager, (manager) => manager.remove(id))

export const stopDiscoveredTunnel = (tunnel: ExternalTunnel) =>
  Effect.flatMap(TunnelManager, (manager) => manager.stopExternal(tunnel))

export const openManagedTunnel = (id: string) =>
  Effect.flatMap(TunnelManager, (manager) => manager.openInBrowser(id))

export const getSavedMachines = Effect.flatMap(TunnelManager, (manager) => manager.listMachines)

export const addSavedMachine = (draft: MachineDraft) =>
  Effect.flatMap(TunnelManager, (manager) => manager.addMachine(draft))

export const removeSavedMachine = (id: string) =>
  Effect.flatMap(TunnelManager, (manager) => manager.removeMachine(id))

export const scanMachinePorts = (id: string) =>
  Effect.flatMap(TunnelManager, (manager) => manager.scanPorts(id))

export const forwardRemotePort = (draft: RemotePortForwardDraft) =>
  Effect.flatMap(TunnelManager, (manager) => manager.forwardPort(draft))

export const runTunnelManager = <A, E>(program: Effect.Effect<A, E, TunnelManager>): Promise<A> =>
  Effect.runPromise(program.pipe(Effect.provide(TunnelManagerLive)))
