import { describe, expect, it } from "vitest"
import { extractForwardSpecs, parseProcessList } from "../src/discovery.js"

describe("SSH process discovery", () => {
  it("finds local, remote, and dynamic forwards", () => {
    expect(extractForwardSpecs("ssh -N -L 3000:localhost:3000 -R9000:localhost:9 -D 1080 box")).toEqual([
      "-L 3000:localhost:3000",
      "-R 9000:localhost:9",
      "-D 1080",
    ])
  })

  it("does not interpret a remote command as an SSH forwarding option", () => {
    expect(extractForwardSpecs("ssh devbox sh -c 'echo -L 3000:localhost:3000'")).toEqual([])
  })

  it("ignores regular SSH sessions and owned control masters", () => {
    const output = [
      " 101 ssh ssh server.example.com",
      " 202 ssh ssh -N -L 3000:localhost:3000 server.example.com",
      " 303 ssh ssh -N -S /tmp/owned.sock -L 4000:localhost:4000 other",
      " 404 node node app.js -L not-an-ssh-forward",
    ].join("\n")

    const result = parseProcessList(output, ["/tmp/owned.sock"])

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ pid: 202, forwardSpecs: ["-L 3000:localhost:3000"] })
  })
})
