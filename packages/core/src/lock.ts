import type { FileHandle } from "node:fs/promises"
import { open, readFile, rm } from "node:fs/promises"
import { join } from "node:path"
import { Effect } from "effect"
import { errorMessage, PortmuxError } from "./errors.js"
import { getPortmuxPaths, type PortmuxPaths } from "./paths.js"
import { ensurePrivateDirectory } from "./private-directory.js"

export interface InstanceLock {
  readonly release: Effect.Effect<void, PortmuxError>
}

const isAlreadyExists = (cause: unknown): boolean =>
  cause instanceof Error && "code" in cause && cause.code === "EEXIST"

const isRunning = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch (cause) {
    return cause instanceof Error && "code" in cause && cause.code === "EPERM"
  }
}

const currentLockPid = async (lockFile: string): Promise<number | undefined> => {
  try {
    const pid = Number.parseInt(await readFile(lockFile, "utf8"), 10)
    return Number.isSafeInteger(pid) && pid > 0 ? pid : undefined
  } catch {
    return undefined
  }
}

const writeLock = async (lockFile: string): Promise<FileHandle> => {
  const handle = await open(lockFile, "wx", 0o600)
  await handle.writeFile(`${process.pid}\n`, "utf8")
  await handle.sync()
  return handle
}

const acquireLockFile = async (paths: PortmuxPaths): Promise<readonly [FileHandle, string]> => {
  await ensurePrivateDirectory(paths.runtimeDirectory)
  const lockFile = join(paths.runtimeDirectory, "app.lock")
  try {
    return [await writeLock(lockFile), lockFile]
  } catch (cause) {
    if (!isAlreadyExists(cause)) {
      throw cause
    }
    const pid = await currentLockPid(lockFile)
    if (pid && isRunning(pid)) {
      throw new Error(`Portmux is already running as pid ${pid}`)
    }
    await rm(lockFile, { force: true })
    return [await writeLock(lockFile), lockFile]
  }
}

const releaseLock = (handle: FileHandle, lockFile: string): Effect.Effect<void, PortmuxError> =>
  Effect.tryPromise({
    try: async () => {
      await handle.close()
      await rm(lockFile, { force: true })
    },
    catch: (cause) =>
      new PortmuxError({ message: `Could not release Portmux lock: ${errorMessage(cause)}`, cause }),
  })

export const acquireInstanceLock = (
  paths: PortmuxPaths = getPortmuxPaths(),
): Effect.Effect<InstanceLock, PortmuxError> =>
  Effect.tryPromise({
    try: () => acquireLockFile(paths),
    catch: (cause) =>
      new PortmuxError({ message: `Could not acquire Portmux lock: ${errorMessage(cause)}`, cause }),
  }).pipe(Effect.map(([handle, lockFile]) => ({ release: releaseLock(handle, lockFile) })))
