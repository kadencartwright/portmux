import { Effect } from "effect"
import { describe, expect, it } from "vitest"
import { ProcessRunnerLive } from "../src/process.js"

describe("process runner", () => {
  it("settles after escalating a timed-out process that ignores SIGTERM", async () => {
    const startedAt = Date.now()
    const command = ProcessRunnerLive.run(
      process.execPath,
      ["-e", "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"],
      25,
    )

    await expect(Effect.runPromise(command)).rejects.toThrow("timed out")
    expect(Date.now() - startedAt).toBeLessThan(2_000)
  })
})
