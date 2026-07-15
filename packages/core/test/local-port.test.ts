import { createServer, type Server } from "node:net"
import { Effect } from "effect"
import { describe, expect, it } from "vitest"
import { findAvailableLocalPort } from "../src/local-port.js"

const listenOnLoopback = async (): Promise<{ readonly port: number; readonly server: Server }> => {
  const server = createServer()
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen({ host: "127.0.0.1", port: 0, exclusive: true }, resolve)
  })
  const address = server.address()
  if (!address || typeof address === "string") {
    throw new Error("test server did not receive a TCP address")
  }
  return { port: address.port, server }
}

const closeServer = (server: Server): Promise<void> =>
  new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()))
  })

describe("local port selection", () => {
  it("chooses an ephemeral loopback port when the preferred port is occupied", async () => {
    const occupied = await listenOnLoopback()
    try {
      const selected = await Effect.runPromise(findAvailableLocalPort(occupied.port))

      expect(selected).not.toBe(occupied.port)
      expect(selected).toBeGreaterThan(0)
      expect(selected).toBeLessThanOrEqual(65_535)
    } finally {
      await closeServer(occupied.server)
    }
  })
})
