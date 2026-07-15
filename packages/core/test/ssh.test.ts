import { describe, expect, it } from "vitest"
import type { TunnelConfig } from "../src/model.js"
import type { PortmuxPaths } from "../src/paths.js"
import { buildStartArguments, formatLocalForward } from "../src/ssh.js"

const paths: PortmuxPaths = {
  stateDirectory: "/tmp/portmux-test",
  stateFile: "/tmp/portmux-test/tunnels.json",
  runtimeDirectory: "/tmp/portmux-test/run",
}

const tunnel = (overrides: Partial<TunnelConfig> = {}): TunnelConfig => ({
  id: "abc-123",
  name: "web",
  sshTarget: "devbox",
  bindHost: "127.0.0.1",
  localPort: 3000,
  remoteHost: "127.0.0.1",
  remotePort: 3000,
  machineId: null,
  restoreOnLaunch: true,
  desired: "running",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...overrides,
})

describe("OpenSSH arguments", () => {
  it("formats IPv6 endpoints safely", () => {
    expect(formatLocalForward(tunnel({ bindHost: "::1", remoteHost: "fd00::2" }))).toBe(
      "[::1]:3000:[fd00::2]:3000",
    )
  })

  it("uses an argv array and keeps the target after the option terminator", () => {
    const args = buildStartArguments(paths, tunnel({ sshTarget: "devbox; touch /tmp/nope" }))

    expect(args.at(-2)).toBe("--")
    expect(args.at(-1)).toBe("devbox; touch /tmp/nope")
    expect(args).toContain("BatchMode=yes")
    expect(args).toContain("ExitOnForwardFailure=yes")
  })
})
