import { chmod, lstat, mkdir } from "node:fs/promises"
import { Effect } from "effect"
import { PortmuxError } from "./errors.js"

export const ensurePrivateDirectory = async (path: string): Promise<void> => {
  await mkdir(path, { recursive: true, mode: 0o700 })
  const stats = await lstat(path)
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new Error(`${path} is not a private directory`)
  }
  if (process.getuid && stats.uid !== process.getuid()) {
    throw new Error(`${path} is owned by another user`)
  }
  await chmod(path, 0o700)
}

export const ensurePrivateDirectoryEffect = (path: string): Effect.Effect<void, PortmuxError> =>
  Effect.tryPromise({
    try: () => ensurePrivateDirectory(path),
    catch: (cause) => new PortmuxError({ message: `Could not create ${path}`, cause }),
  })
