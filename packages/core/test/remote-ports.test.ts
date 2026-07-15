import { describe, expect, it } from "vitest"
import type { MachineConfig } from "../src/model.js"
import type { PortmuxPaths } from "../src/paths.js"
import {
  buildRemoteScanArguments,
  parseRemoteListeners,
  REMOTE_LISTENER_COMMAND,
} from "../src/remote-ports.js"

const paths: PortmuxPaths = {
  stateDirectory: "/tmp/portmux-test",
  stateFile: "/tmp/portmux-test/tunnels.json",
  runtimeDirectory: "/tmp/portmux-test/run",
}

const machine = (overrides: Partial<MachineConfig> = {}): MachineConfig => ({
  id: "machine-123",
  name: "development",
  sshTarget: "devbox",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...overrides,
})

describe("remote listener parsing", () => {
  it("parses ss IPv4 and IPv6 output with family-safe wildcard forwarding", () => {
    const listeners = parseRemoteListeners(
      [
        "PORTMUX_SS4_V1",
        'LISTEN 0 4096 0.0.0.0:3000 0.0.0.0:* users:(("node",pid=123,fd=18))',
        'LISTEN 0 4096 *:4173 *:* users:(("vite",pid=124,fd=19))',
        "PORTMUX_SS6_V1",
        'LISTEN 0 4096 [::]:5173 [::]:* users:(("bun",pid=125,fd=20))',
        'LISTEN 0 4096 [fe80::1%eth0]:8000 [::]:* users:(("py\u0000thon",pid=126,fd=21))',
      ].join("\n"),
    )

    expect(listeners).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          family: 4,
          address: "0.0.0.0",
          forwardHost: "127.0.0.1",
          port: 3_000,
          processName: "node",
          pid: 123,
        }),
        expect.objectContaining({
          family: 4,
          address: "*",
          forwardHost: "127.0.0.1",
          port: 4_173,
        }),
        expect.objectContaining({
          family: 6,
          address: "::",
          forwardHost: "::1",
          port: 5_173,
        }),
        expect.objectContaining({
          family: 6,
          address: "fe80::1%eth0",
          forwardHost: "fe80::1%eth0",
          port: 8_000,
          processName: "python",
        }),
      ]),
    )
  })

  it("parses lsof field output for both address families", () => {
    const listeners = parseRemoteListeners(
      [
        "PORTMUX_LSOF4_V1",
        "p900",
        "cnode",
        "n*:4173",
        "p901",
        "cpython",
        "n127.0.0.1:8000",
        "PORTMUX_LSOF6_V1",
        "p902",
        "cdeno",
        "n[::1]:4500",
      ].join("\n"),
    )

    expect(listeners).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          family: 4,
          address: "*",
          forwardHost: "127.0.0.1",
          port: 4_173,
          processName: "node",
          pid: 900,
        }),
        expect.objectContaining({ family: 4, address: "127.0.0.1", port: 8_000, pid: 901 }),
        expect.objectContaining({ family: 6, address: "::1", port: 4_500, pid: 902 }),
      ]),
    )
  })

  it("parses Linux and BSD netstat endpoints while ignoring non-listeners", () => {
    const listeners = parseRemoteListeners(
      [
        "PORTMUX_NETSTAT_V1",
        "tcp 0 0 0.0.0.0:8080 0.0.0.0:* LISTEN",
        "tcp6 0 0 [::]:9090 [::]:* LISTEN",
        "tcp4 0 0 127.0.0.1.3001 *.* LISTEN",
        "tcp6 0 0 ::1.5001 *.* LISTEN",
        "tcp 0 0 127.0.0.1:4000 127.0.0.1:5000 ESTABLISHED",
        "udp 0 0 0.0.0.0:5353 0.0.0.0:*",
      ].join("\n"),
    )

    expect(listeners).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ family: 4, address: "0.0.0.0", port: 8_080 }),
        expect.objectContaining({ family: 6, address: "::", port: 9_090 }),
        expect.objectContaining({ family: 4, address: "127.0.0.1", port: 3_001 }),
        expect.objectContaining({ family: 6, address: "::1", port: 5_001 }),
      ]),
    )
    expect(listeners).toHaveLength(4)
  })

  it("rejects unknown backends and an explicitly unsupported remote", () => {
    expect(() => parseRemoteListeners("LISTEN 0 128 127.0.0.1:3000 0.0.0.0:*")).toThrow("unknown format")
    expect(() => parseRemoteListeners("PORTMUX_UNSUPPORTED_V1")).toThrow("no ss, lsof, or netstat")
  })

  it("does not accept hostile addresses, invalid ports, family mismatches, or partial PIDs", () => {
    const listeners = parseRemoteListeners(
      [
        "PORTMUX_SS4_V1",
        "LISTEN 0 128 example.com;touch:3000 0.0.0.0:*",
        "LISTEN 0 128 127.0.0.1:0 0.0.0.0:*",
        "LISTEN 0 128 127.0.0.1:65536 0.0.0.0:*",
        "LISTEN 0 128 [::1]:3100 [::]:*",
        'LISTEN 0 128 127.0.0.1:3200 0.0.0.0:* users:(("node",pid=12oops,fd=1))',
        "PORTMUX_LSOF4_V1",
        "p44oops",
        "cbadpid",
        "n127.0.0.1:3300",
      ].join("\n"),
    )

    expect(listeners.map((listener) => listener.port)).toEqual(expect.arrayContaining([3_200, 3_300]))
    expect(listeners).toHaveLength(2)
    expect(listeners.every((listener) => listener.pid === undefined)).toBe(true)
  })
})

describe("remote listener SSH arguments", () => {
  it("keeps untrusted machine fields in their own argv entries and uses a fixed scan command", () => {
    const hostileTarget = "-oProxyCommand=touch /tmp/portmux-nope"
    const identityFile = "/tmp/id; touch /tmp/portmux-nope"
    const args = buildRemoteScanArguments(
      paths,
      machine({
        id: "machine; rm -rf /",
        name: "$(touch /tmp/portmux-name)",
        sshTarget: hostileTarget,
        identityFile,
      }),
    )

    expect(args.slice(-3)).toEqual(["--", hostileTarget, REMOTE_LISTENER_COMMAND])
    expect(args.filter((argument) => argument === hostileTarget)).toHaveLength(1)
    expect(args.at(args.indexOf("-i") + 1)).toBe(identityFile)
    expect(args).toEqual(
      expect.arrayContaining([
        "ControlMaster=auto",
        "ControlPersist=60",
        "BatchMode=yes",
        "ClearAllForwardings=yes",
        "ForwardAgent=no",
        "ForwardX11=no",
        "PermitLocalCommand=no",
        "RemoteCommand=none",
      ]),
    )
    expect(REMOTE_LISTENER_COMMAND).not.toContain(hostileTarget)
    expect(REMOTE_LISTENER_COMMAND).not.toContain("portmux-name")
  })
})
