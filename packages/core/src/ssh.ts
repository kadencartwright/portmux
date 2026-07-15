import { rm } from "node:fs/promises"
import { Effect } from "effect"
import { PortmuxError } from "./errors.js"
import type { ManagedTunnel, TunnelConfig } from "./model.js"
import { controlSocketPath, type PortmuxPaths } from "./paths.js"
import { ensurePrivateDirectory } from "./private-directory.js"
import type { ProcessRunner } from "./process.js"
import { resolveIdentityFile } from "./validation.js"

const formatHost = (host: string): string =>
  host.includes(":") && !(host.startsWith("[") && host.endsWith("]")) ? `[${host}]` : host

export const formatLocalForward = (tunnel: TunnelConfig): string =>
  `${formatHost(tunnel.bindHost)}:${tunnel.localPort}:${formatHost(tunnel.remoteHost)}:${tunnel.remotePort}`

export const buildStartArguments = (paths: PortmuxPaths, tunnel: TunnelConfig): ReadonlyArray<string> => {
  const args = [
    "-fNTn",
    "-M",
    "-S",
    controlSocketPath(paths, tunnel.id),
    "-o",
    "ControlMaster=yes",
    "-o",
    "ControlPersist=yes",
    "-o",
    "BatchMode=yes",
    "-o",
    "ExitOnForwardFailure=yes",
    "-o",
    "ServerAliveInterval=15",
    "-o",
    "ServerAliveCountMax=3",
    "-o",
    "ForwardAgent=no",
    "-o",
    "ForwardX11=no",
    "-o",
    "PermitLocalCommand=no",
    "-o",
    "ConnectTimeout=10",
    "-L",
    formatLocalForward(tunnel),
  ]
  if (tunnel.identityFile) {
    args.push("-i", resolveIdentityFile(tunnel.identityFile))
  }
  args.push("--", tunnel.sshTarget)
  return args
}

const controlArguments = (
  paths: PortmuxPaths,
  tunnel: TunnelConfig,
  operation: "check" | "exit",
): ReadonlyArray<string> => [
  "-S",
  controlSocketPath(paths, tunnel.id),
  "-O",
  operation,
  "--",
  tunnel.sshTarget,
]

const parseMasterPid = (output: string): number | undefined => {
  const match = /Master running \(pid=(\d+)\)/u.exec(output)
  if (!match?.[1]) {
    return undefined
  }
  const pid = Number.parseInt(match[1], 10)
  return Number.isSafeInteger(pid) ? pid : undefined
}

export const checkTunnel = (
  runner: ProcessRunner,
  paths: PortmuxPaths,
  tunnel: TunnelConfig,
): Effect.Effect<ManagedTunnel, PortmuxError> =>
  runner.run("ssh", controlArguments(paths, tunnel, "check"), 3_000).pipe(
    Effect.map((result) => {
      const output = `${result.stdout}\n${result.stderr}`
      const pid = parseMasterPid(output)
      const base = { ...tunnel, source: "managed" as const }
      if (result.exitCode !== 0) {
        return { ...base, status: "stopped" as const }
      }
      return {
        ...base,
        status: "running" as const,
        ...(pid ? { pid } : {}),
      }
    }),
  )

const commandFailure = (action: string, tunnel: TunnelConfig, stderr: string): PortmuxError =>
  new PortmuxError({
    message: `${action} ${tunnel.name} failed: ${stderr.trim() || "ssh exited unsuccessfully"}`,
  })

export const startTunnelProcess = (
  runner: ProcessRunner,
  paths: PortmuxPaths,
  tunnel: TunnelConfig,
): Effect.Effect<void, PortmuxError> =>
  Effect.gen(function* () {
    yield* Effect.tryPromise({
      try: () => ensurePrivateDirectory(paths.runtimeDirectory),
      catch: (cause) => new PortmuxError({ message: `Could not create ${paths.runtimeDirectory}`, cause }),
    })
    const current = yield* checkTunnel(runner, paths, tunnel)
    if (current.status === "running") {
      return
    }
    yield* Effect.tryPromise({
      try: () => rm(controlSocketPath(paths, tunnel.id), { force: true }),
      catch: (cause) => new PortmuxError({ message: "Could not remove stale SSH socket", cause }),
    })
    const result = yield* runner.run("ssh", buildStartArguments(paths, tunnel), 15_000)
    if (result.exitCode !== 0) {
      return yield* Effect.fail(commandFailure("Starting", tunnel, result.stderr))
    }
  })

export const stopTunnelProcess = (
  runner: ProcessRunner,
  paths: PortmuxPaths,
  tunnel: TunnelConfig,
): Effect.Effect<void, PortmuxError> =>
  Effect.gen(function* () {
    const current = yield* checkTunnel(runner, paths, tunnel)
    if (current.status === "running") {
      const result = yield* runner.run("ssh", controlArguments(paths, tunnel, "exit"), 5_000)
      if (result.exitCode !== 0) {
        return yield* Effect.fail(commandFailure("Stopping", tunnel, result.stderr))
      }
    }
    yield* Effect.tryPromise({
      try: () => rm(controlSocketPath(paths, tunnel.id), { force: true }),
      catch: (cause) => new PortmuxError({ message: "Could not remove SSH socket", cause }),
    })
  })
