import { createHash } from "node:crypto"
import { readFile, readlink, stat } from "node:fs/promises"
import { basename } from "node:path"
import { Effect } from "effect"
import { PortmuxError } from "./errors.js"
import type { ExternalTunnel } from "./model.js"
import type { ProcessRunner } from "./process.js"

interface ProcessLine {
  readonly pid: number
  readonly executable: string
  readonly command: string
}

const OPTIONS_WITH_VALUE = new Set([
  "B",
  "b",
  "c",
  "D",
  "E",
  "e",
  "F",
  "I",
  "i",
  "J",
  "L",
  "l",
  "m",
  "O",
  "o",
  "P",
  "p",
  "Q",
  "R",
  "S",
  "W",
  "w",
])

const FORWARD_OPTIONS = new Set(["D", "L", "R"])

const tokenizeCommand = (command: string): ReadonlyArray<string> => {
  const tokens: Array<string> = []
  const pattern = /"((?:\\.|[^"])*)"|'([^']*)'|(\S+)/gu
  for (const match of command.matchAll(pattern)) {
    tokens.push(match[1] ?? match[2] ?? match[3] ?? "")
  }
  return tokens
}

const optionValue = (
  argv: ReadonlyArray<string>,
  index: number,
  token: string,
  offset: number,
): readonly [string | undefined, number] => {
  const attached = token.slice(offset + 1)
  if (attached) {
    return [attached, index]
  }
  return [argv[index + 1], index + 1]
}

export const extractForwardSpecsFromArgv = (argv: ReadonlyArray<string>): ReadonlyArray<string> => {
  const forwards: Array<string> = []
  let index = 1
  while (index < argv.length) {
    const token = argv[index]
    if (!token || token === "--" || !token.startsWith("-") || token === "-") {
      break
    }
    let offset = 1
    while (offset < token.length) {
      const option = token[offset]
      if (!option || !OPTIONS_WITH_VALUE.has(option)) {
        offset += 1
        continue
      }
      const [value, nextIndex] = optionValue(argv, index, token, offset)
      if (FORWARD_OPTIONS.has(option) && value) {
        forwards.push(`-${option} ${value}`)
      }
      index = nextIndex
      break
    }
    index += 1
  }
  return forwards
}

export const extractForwardSpecs = (command: string): ReadonlyArray<string> =>
  extractForwardSpecsFromArgv(tokenizeCommand(command))

const parseProcessLine = (line: string): ProcessLine | undefined => {
  const match = /^\s*(\d+)\s+(\S+)\s+(.+)$/u.exec(line)
  if (!match?.[1] || !match[2] || !match[3]) {
    return undefined
  }
  return {
    pid: Number.parseInt(match[1], 10),
    executable: match[2],
    command: match[3],
  }
}

const fingerprint = (argv: ReadonlyArray<string>): string =>
  createHash("sha256").update(argv.join("\0")).digest("hex")

const makeExternalTunnel = (
  pid: number,
  argv: ReadonlyArray<string>,
  canStop: boolean,
  processIdentity?: string,
): ExternalTunnel | undefined => {
  const forwardSpecs = extractForwardSpecsFromArgv(argv)
  if (forwardSpecs.length === 0) {
    return undefined
  }
  return {
    id: `external:${pid}`,
    source: "external",
    name: `External SSH · pid ${pid}`,
    status: "external",
    pid,
    forwardSpecs,
    fingerprint: fingerprint(argv),
    canStop,
    ...(processIdentity ? { processIdentity } : {}),
  }
}

const toObservedExternal = (line: ProcessLine): ExternalTunnel | undefined => {
  if (basename(line.executable) !== "ssh") {
    return undefined
  }
  return makeExternalTunnel(line.pid, tokenizeCommand(line.command), false)
}

const parseProcessLines = (output: string): ReadonlyArray<ProcessLine> =>
  output
    .split("\n")
    .map(parseProcessLine)
    .filter((line): line is ProcessLine => Boolean(line))

export const parseProcessList = (
  output: string,
  managedControlPaths: ReadonlyArray<string> = [],
): ReadonlyArray<ExternalTunnel> =>
  parseProcessLines(output)
    .filter((line) => !managedControlPaths.some((path) => line.command.includes(path)))
    .map(toObservedExternal)
    .filter((tunnel): tunnel is ExternalTunnel => Boolean(tunnel))

const readProcArgv = async (pid: number): Promise<ReadonlyArray<string>> => {
  const contents = await readFile(`/proc/${pid}/cmdline`)
  return contents.toString("utf8").split("\0").filter(Boolean)
}

const procStartTime = async (pid: number): Promise<string> => {
  const contents = await readFile(`/proc/${pid}/stat`, "utf8")
  const closingParenthesis = contents.lastIndexOf(")")
  const fields = contents
    .slice(closingParenthesis + 2)
    .trim()
    .split(/\s+/u)
  const startTime = fields[19]
  if (!startTime) {
    throw new Error(`Could not read start time for pid ${pid}`)
  }
  return startTime
}

const readLinuxExternal = async (
  pid: number,
  managedControlPaths: ReadonlyArray<string> = [],
): Promise<ExternalTunnel | undefined> => {
  try {
    const processStats = await stat(`/proc/${pid}`)
    if (process.getuid && processStats.uid !== process.getuid()) {
      return undefined
    }
    const [executable, argv, startTime] = await Promise.all([
      readlink(`/proc/${pid}/exe`),
      readProcArgv(pid),
      procStartTime(pid),
    ])
    if (basename(executable) !== "ssh" || managedControlPaths.some((path) => argv.includes(path))) {
      return undefined
    }
    return makeExternalTunnel(pid, argv, true, `${executable}:${startTime}`)
  } catch {
    return undefined
  }
}

const discoverLinuxTunnels = async (
  lines: ReadonlyArray<ProcessLine>,
  managedControlPaths: ReadonlyArray<string>,
): Promise<ReadonlyArray<ExternalTunnel>> => {
  const candidates = lines.filter((line) => basename(line.executable) === "ssh")
  const tunnels = await Promise.all(
    candidates.map((line) => readLinuxExternal(line.pid, managedControlPaths)),
  )
  return tunnels.filter((tunnel): tunnel is ExternalTunnel => Boolean(tunnel))
}

export const discoverExternalTunnels = (
  runner: ProcessRunner,
  managedControlPaths: ReadonlyArray<string>,
): Effect.Effect<ReadonlyArray<ExternalTunnel>, PortmuxError> =>
  Effect.gen(function* () {
    const result = yield* runner.run("ps", ["-x", "-ww", "-o", "pid=,comm=,args="], 5_000)
    if (result.exitCode !== 0) {
      return yield* Effect.fail(
        new PortmuxError({ message: `Could not inspect SSH processes: ${result.stderr}` }),
      )
    }
    if (process.platform !== "linux") {
      return parseProcessList(result.stdout, managedControlPaths)
    }
    return yield* Effect.tryPromise({
      try: () => discoverLinuxTunnels(parseProcessLines(result.stdout), managedControlPaths),
      catch: (cause) => new PortmuxError({ message: "Could not inspect Linux SSH processes", cause }),
    })
  })

export const stopExternalTunnel = (
  _runner: ProcessRunner,
  tunnel: ExternalTunnel,
): Effect.Effect<void, PortmuxError> =>
  Effect.gen(function* () {
    if (process.platform !== "linux" || !tunnel.canStop || !tunnel.processIdentity) {
      return yield* Effect.fail(
        new PortmuxError({ message: "This external process can only be observed on this platform" }),
      )
    }
    const current = yield* Effect.tryPromise({
      try: () => readLinuxExternal(tunnel.pid),
      catch: (cause) => new PortmuxError({ message: `Could not verify pid ${tunnel.pid}`, cause }),
    })
    if (!current) {
      return
    }
    if (current.fingerprint !== tunnel.fingerprint || current.processIdentity !== tunnel.processIdentity) {
      return yield* Effect.fail(
        new PortmuxError({ message: "The process changed since discovery; refusing to signal it" }),
      )
    }
    yield* Effect.try({
      try: () => process.kill(tunnel.pid, "SIGTERM"),
      catch: (cause) => new PortmuxError({ message: `Could not stop pid ${tunnel.pid}`, cause }),
    })
  })
