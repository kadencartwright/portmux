import { spawn } from "node:child_process"
import { Effect } from "effect"
import { errorMessage, PortmuxError } from "./errors.js"

export interface ProcessResult {
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
  readonly truncated?: boolean
}

export interface ProcessRunner {
  readonly run: (
    executable: string,
    args: ReadonlyArray<string>,
    timeoutMilliseconds?: number,
  ) => Effect.Effect<ProcessResult, PortmuxError>
}

const MAX_OUTPUT_BYTES = 256 * 1024

const appendOutput = (current: Buffer, chunk: Buffer): Buffer => {
  const combined = Buffer.concat([current, chunk])
  return combined.length > MAX_OUTPUT_BYTES ? combined.subarray(combined.length - MAX_OUTPUT_BYTES) : combined
}

const execute = (
  executable: string,
  args: ReadonlyArray<string>,
  timeoutMilliseconds: number,
): Promise<ProcessResult> =>
  new Promise((resolve, reject) => {
    const child = spawn(executable, [...args], {
      env: process.env,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    })
    let stdout: Buffer = Buffer.alloc(0)
    let stderr: Buffer = Buffer.alloc(0)
    let outputTruncated = false
    let stdoutBytes = 0
    let stderrBytes = 0
    let timedOut = false
    let settled = false
    let killTimeout: ReturnType<typeof setTimeout> | undefined

    const timeout = setTimeout(() => {
      timedOut = true
      child.kill("SIGTERM")
      killTimeout = setTimeout(() => {
        child.kill("SIGKILL")
        rejectOnce(new Error(`${executable} timed out after ${timeoutMilliseconds}ms`))
      }, 1_000)
    }, timeoutMilliseconds)

    const cleanUp = () => {
      clearTimeout(timeout)
      if (killTimeout) {
        clearTimeout(killTimeout)
      }
    }

    const rejectOnce = (cause: unknown) => {
      if (settled) {
        return
      }
      settled = true
      cleanUp()
      reject(cause)
    }

    const resolveOnce = (result: ProcessResult) => {
      if (settled) {
        return
      }
      settled = true
      cleanUp()
      resolve(result)
    }

    child.stdout.on("data", (chunk: Buffer) => {
      stdoutBytes += chunk.length
      outputTruncated ||= stdoutBytes > MAX_OUTPUT_BYTES
      stdout = appendOutput(stdout, chunk)
    })
    child.stderr.on("data", (chunk: Buffer) => {
      stderrBytes += chunk.length
      outputTruncated ||= stderrBytes > MAX_OUTPUT_BYTES
      stderr = appendOutput(stderr, chunk)
    })
    child.once("error", rejectOnce)
    child.once("close", (code) => {
      if (timedOut) {
        rejectOnce(new Error(`${executable} timed out after ${timeoutMilliseconds}ms`))
        return
      }
      resolveOnce({
        exitCode: code ?? 1,
        stdout: stdout.toString("utf8"),
        stderr: stderr.toString("utf8"),
        truncated: outputTruncated,
      })
    })
  })

export const ProcessRunnerLive: ProcessRunner = {
  run: (executable, args, timeoutMilliseconds = 12_000) =>
    Effect.tryPromise({
      try: () => execute(executable, args, timeoutMilliseconds),
      catch: (cause) =>
        new PortmuxError({
          message: `Unable to run ${executable}: ${errorMessage(cause)}`,
          cause,
        }),
    }),
}
