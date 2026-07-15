import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect } from "effect"
import { describe, expect, it } from "vitest"
import { acquireInstanceLock } from "../src/lock.js"
import type { PortmuxPaths } from "../src/paths.js"

describe("instance lock", () => {
  it("allows only one Portmux process to own the state at a time", async () => {
    const directory = await mkdtemp(join(tmpdir(), "portmux-lock-"))
    const paths: PortmuxPaths = {
      stateDirectory: directory,
      stateFile: join(directory, "tunnels.json"),
      runtimeDirectory: join(directory, "run"),
    }
    const first = await Effect.runPromise(acquireInstanceLock(paths))
    try {
      await expect(Effect.runPromise(acquireInstanceLock(paths))).rejects.toThrow("already running")
    } finally {
      await Effect.runPromise(first.release)
    }

    const next = await Effect.runPromise(acquireInstanceLock(paths))
    await Effect.runPromise(next.release)
    await rm(directory, { recursive: true })
  })
})
