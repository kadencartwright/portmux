import { Effect } from "effect"
import { describe, expect, it } from "vitest"
import { validateDraft } from "../src/validation.js"

const validDraft = {
  name: "web",
  sshTarget: "devbox",
  bindHost: "127.0.0.1",
  localPort: 3000,
  remoteHost: "127.0.0.1",
  remotePort: 3000,
} as const

describe("tunnel validation", () => {
  it("accepts an SSH config alias", async () => {
    await expect(Effect.runPromise(validateDraft(validDraft))).resolves.toEqual(validDraft)
  })

  it("rejects invalid ports", async () => {
    await expect(Effect.runPromise(validateDraft({ ...validDraft, localPort: 70_000 }))).rejects.toThrow(
      "Local port",
    )
  })

  it("rejects option-like SSH targets", async () => {
    await expect(
      Effect.runPromise(validateDraft({ ...validDraft, sshTarget: "-oProxyCommand=bad" })),
    ).rejects.toThrow("cannot start with a dash")
  })
})
