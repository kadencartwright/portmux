import { isIP } from "node:net"
import { Effect } from "effect"
import { PortmuxError } from "./errors.js"
import type { MachineConfig, RemoteListener } from "./model.js"
import { machineControlSocketPath, type PortmuxPaths } from "./paths.js"
import { ensurePrivateDirectoryEffect } from "./private-directory.js"
import type { ProcessRunner } from "./process.js"
import { resolveIdentityFile } from "./validation.js"

const SS4_MARKER = "PORTMUX_SS4_V1"
const SS6_MARKER = "PORTMUX_SS6_V1"
const LSOF4_MARKER = "PORTMUX_LSOF4_V1"
const LSOF6_MARKER = "PORTMUX_LSOF6_V1"
const NETSTAT_MARKER = "PORTMUX_NETSTAT_V1"
const UNSUPPORTED_MARKER = "PORTMUX_UNSUPPORTED_V1"
const MAX_LISTENERS = 2_000

export const REMOTE_LISTENER_COMMAND = [
  "export LC_ALL=C",
  "if command -v ss >/dev/null 2>&1; then",
  `  printf '${SS4_MARKER}\\n'`,
  "  ss -4 -H -ltnp 2>/dev/null || ss -4 -H -ltn 2>/dev/null || :",
  `  printf '${SS6_MARKER}\\n'`,
  "  ss -6 -H -ltnp 2>/dev/null || ss -6 -H -ltn 2>/dev/null || :",
  "elif command -v lsof >/dev/null 2>&1; then",
  `  printf '${LSOF4_MARKER}\\n'`,
  "  lsof -nP -a -i4TCP -sTCP:LISTEN -Fpcn 2>/dev/null || :",
  `  printf '${LSOF6_MARKER}\\n'`,
  "  lsof -nP -a -i6TCP -sTCP:LISTEN -Fpcn 2>/dev/null || :",
  "elif command -v netstat >/dev/null 2>&1; then",
  `  printf '${NETSTAT_MARKER}\\n'`,
  "  netstat -an 2>/dev/null || :",
  "else",
  `  printf '${UNSUPPORTED_MARKER}\\n'`,
  "  exit 127",
  "fi",
].join("\n")

export const buildRemoteScanArguments = (
  paths: PortmuxPaths,
  machine: MachineConfig,
): ReadonlyArray<string> => {
  const args = [
    "-Tn",
    "-S",
    machineControlSocketPath(paths, machine.id),
    "-o",
    "ControlMaster=auto",
    "-o",
    "ControlPersist=60",
    "-o",
    "BatchMode=yes",
    "-o",
    "ConnectionAttempts=1",
    "-o",
    "ConnectTimeout=6",
    "-o",
    "ServerAliveInterval=5",
    "-o",
    "ServerAliveCountMax=1",
    "-o",
    "ClearAllForwardings=yes",
    "-o",
    "ForwardAgent=no",
    "-o",
    "ForwardX11=no",
    "-o",
    "PermitLocalCommand=no",
    "-o",
    "RemoteCommand=none",
  ]
  if (machine.identityFile) {
    args.push("-i", resolveIdentityFile(machine.identityFile))
  }
  args.push("--", machine.sshTarget, REMOTE_LISTENER_COMMAND)
  return args
}

interface ParsedEndpoint {
  readonly family: 4 | 6
  readonly address: string
  readonly port: number
}

const safeZone = (value: string): boolean => /^[A-Za-z0-9_.-]+$/u.test(value)

const normalizeAddress = (
  value: string,
  familyHint?: 4 | 6,
): { family: 4 | 6; address: string } | undefined => {
  if (value === "*") {
    return { family: familyHint ?? 4, address: "*" }
  }
  const [address, zone, ...remaining] = value.split("%")
  if (!address || remaining.length > 0) {
    return undefined
  }
  const family = isIP(address)
  if (family !== 4 && family !== 6) {
    return undefined
  }
  if (familyHint && family !== familyHint) {
    return undefined
  }
  if (family === 4 || !zone) {
    return { family, address }
  }
  return safeZone(zone) ? { family, address: `${address}%${zone}` } : undefined
}

const splitEndpoint = (value: string): readonly [string, string] | undefined => {
  const bracketed = /^\[(.+)\]:(\d+)$/u.exec(value)
  if (bracketed?.[1] && bracketed[2]) {
    return [bracketed[1], bracketed[2]]
  }
  const colon = /^(.*):(\d+)$/u.exec(value)
  if (colon?.[1] && colon[2]) {
    return [colon[1], colon[2]]
  }
  const dotted = /^(.*)\.(\d+)$/u.exec(value)
  return dotted?.[1] && dotted[2] ? [dotted[1], dotted[2]] : undefined
}

const parseEndpoint = (raw: string, familyHint?: 4 | 6): ParsedEndpoint | undefined => {
  const value = raw.replace(/\s+\(LISTEN\)$/u, "").trim()
  const split = splitEndpoint(value)
  if (!split) {
    return undefined
  }
  const port = Number.parseInt(split[1], 10)
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    return undefined
  }
  const normalized = normalizeAddress(split[0], familyHint)
  return normalized ? { ...normalized, port } : undefined
}

const sanitizeProcessName = (value: string | undefined): string | undefined => {
  if (!value) {
    return undefined
  }
  const clean = [...value]
    .filter((character) => {
      const codePoint = character.codePointAt(0) ?? 0
      return codePoint >= 32 && codePoint !== 127
    })
    .join("")
    .slice(0, 64)
  return clean || undefined
}

const forwardHostFor = (endpoint: ParsedEndpoint): string => {
  if (endpoint.address === "*" || endpoint.address === "0.0.0.0") {
    return endpoint.family === 6 ? "::1" : "127.0.0.1"
  }
  return endpoint.address === "::" ? "::1" : endpoint.address
}

const listenerFrom = (endpoint: ParsedEndpoint, processName?: string, pid?: number): RemoteListener => {
  const safeProcessName = sanitizeProcessName(processName)
  const safePid = pid && Number.isSafeInteger(pid) ? pid : undefined
  return {
    id: `${endpoint.family}:${endpoint.address}:${endpoint.port}:${safePid ?? ""}`,
    ...endpoint,
    forwardHost: forwardHostFor(endpoint),
    ...(safeProcessName ? { processName: safeProcessName } : {}),
    ...(safePid ? { pid: safePid } : {}),
  }
}

const parseSsLine = (line: string, family: 4 | 6): RemoteListener | undefined => {
  const columns = line.trim().split(/\s+/u)
  if (columns[0] !== "LISTEN" || !columns[3]) {
    return undefined
  }
  const endpoint = parseEndpoint(columns[3], family)
  if (!endpoint) {
    return undefined
  }
  const process = /users:\(\(\s*"([^"]{1,128})",pid=(\d+)(?:,|\))/u.exec(line)
  const pid = process?.[2] ? Number.parseInt(process[2], 10) : undefined
  return listenerFrom(endpoint, process?.[1], pid)
}

interface LsofRecord {
  pid?: number
  processName?: string
}

const parseLsofLine = (line: string, family: 4 | 6, record: LsofRecord): RemoteListener | undefined => {
  const prefix = line[0]
  const value = line.slice(1)
  if (prefix === "p") {
    if (/^\d+$/u.test(value)) {
      record.pid = Number.parseInt(value, 10)
    } else {
      delete record.pid
    }
    delete record.processName
    return undefined
  }
  if (prefix === "c") {
    record.processName = value
    return undefined
  }
  const endpoint = prefix === "n" ? parseEndpoint(value, family) : undefined
  return endpoint ? listenerFrom(endpoint, record.processName, record.pid) : undefined
}

const parseNetstatLine = (line: string): RemoteListener | undefined => {
  const columns = line.trim().split(/\s+/u)
  const protocol = columns[0]?.toLowerCase()
  if (!protocol?.startsWith("tcp") || !columns.some((column) => column.toUpperCase() === "LISTEN")) {
    return undefined
  }
  const familyHint = protocol.includes("6") ? 6 : protocol.includes("4") ? 4 : undefined
  const endpoint = columns[3] ? parseEndpoint(columns[3], familyHint) : undefined
  return endpoint ? listenerFrom(endpoint) : undefined
}

const listenerSort = (left: RemoteListener, right: RemoteListener): number => {
  const leftPriority = left.processName ? 0 : left.port >= 1024 ? 1 : 2
  const rightPriority = right.processName ? 0 : right.port >= 1024 ? 1 : 2
  return leftPriority - rightPriority || left.port - right.port || left.address.localeCompare(right.address)
}

type ListenerBackend = "ss" | "lsof" | "netstat"

interface ParserState {
  backend: ListenerBackend | undefined
  family: 4 | 6 | undefined
  readonly lsofRecord: LsofRecord
  recognized: boolean
}

const markerSettings = new Map<string, readonly [ListenerBackend, 4 | 6 | undefined]>([
  [SS4_MARKER, ["ss", 4]],
  [SS6_MARKER, ["ss", 6]],
  [LSOF4_MARKER, ["lsof", 4]],
  [LSOF6_MARKER, ["lsof", 6]],
  [NETSTAT_MARKER, ["netstat", undefined]],
])

const readMarker = (line: string, state: ParserState): boolean => {
  if (line === UNSUPPORTED_MARKER) {
    throw new Error("remote host has no ss, lsof, or netstat command")
  }
  const settings = markerSettings.get(line)
  if (!settings) {
    return false
  }
  state.backend = settings[0]
  state.family = settings[1]
  state.recognized = true
  if (state.backend === "lsof") {
    delete state.lsofRecord.pid
    delete state.lsofRecord.processName
  }
  return true
}

const parseListenerLine = (line: string, state: ParserState): RemoteListener | undefined => {
  if (state.backend === "ss" && state.family) {
    return parseSsLine(line, state.family)
  }
  if (state.backend === "lsof" && state.family) {
    return parseLsofLine(line, state.family, state.lsofRecord)
  }
  return state.backend === "netstat" ? parseNetstatLine(line) : undefined
}

export const parseRemoteListeners = (output: string): ReadonlyArray<RemoteListener> => {
  const listeners = new Map<string, RemoteListener>()
  const state: ParserState = {
    backend: undefined,
    family: undefined,
    lsofRecord: {},
    recognized: false,
  }

  for (const line of output.split(/\r?\n/u)) {
    if (readMarker(line, state)) {
      continue
    }
    const listener = parseListenerLine(line, state)
    if (listener) {
      listeners.set(listener.id, listener)
      if (listeners.size >= MAX_LISTENERS) {
        break
      }
    }
  }
  if (!state.recognized) {
    throw new Error("remote listener command returned an unknown format")
  }
  return [...listeners.values()].sort(listenerSort)
}

const safeErrorOutput = (value: string): string => sanitizeProcessName(value.replace(/\s+/gu, " ")) ?? ""

export const scanRemoteListeners = (
  runner: ProcessRunner,
  paths: PortmuxPaths,
  machine: MachineConfig,
): Effect.Effect<ReadonlyArray<RemoteListener>, PortmuxError> =>
  Effect.gen(function* () {
    yield* ensurePrivateDirectoryEffect(paths.runtimeDirectory)
    const result = yield* runner.run("ssh", buildRemoteScanArguments(paths, machine), 10_000)
    if (result.truncated) {
      return yield* Effect.fail(
        new PortmuxError({ message: `Listener output from ${machine.name} was too large` }),
      )
    }
    if (result.stdout.split(/\r?\n/u).includes(UNSUPPORTED_MARKER)) {
      return yield* Effect.fail(
        new PortmuxError({ message: `${machine.name} has no ss, lsof, or netstat command` }),
      )
    }
    if (result.exitCode !== 0) {
      const reason = safeErrorOutput(result.stderr) || "SSH exited unsuccessfully"
      return yield* Effect.fail(new PortmuxError({ message: `Scanning ${machine.name} failed: ${reason}` }))
    }
    return yield* Effect.try({
      try: () => parseRemoteListeners(result.stdout),
      catch: (cause) =>
        new PortmuxError({
          message: `Could not understand listeners from ${machine.name}: ${
            cause instanceof Error ? cause.message : String(cause)
          }`,
          cause,
        }),
    })
  })
