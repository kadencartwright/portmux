import { createServer } from "node:net"
import { Effect } from "effect"
import { PortmuxError } from "./errors.js"

const reservePort = (port: number): Promise<number | undefined> =>
  new Promise((resolve) => {
    const server = createServer()
    server.unref()
    server.once("error", () => resolve(undefined))
    server.listen({ host: "127.0.0.1", port, exclusive: true }, () => {
      const address = server.address()
      const selected = address && typeof address === "object" ? address.port : undefined
      server.close(() => resolve(selected))
    })
  })

const selectPort = async (preferred: number): Promise<number> => {
  const preferredResult = await reservePort(preferred)
  if (preferredResult) {
    return preferredResult
  }
  const ephemeral = await reservePort(0)
  if (!ephemeral) {
    throw new Error("the operating system did not provide a local port")
  }
  return ephemeral
}

export const findAvailableLocalPort = (preferred: number): Effect.Effect<number, PortmuxError> =>
  Effect.tryPromise({
    try: () => selectPort(preferred),
    catch: (cause) => new PortmuxError({ message: "Could not reserve a local loopback port", cause }),
  })
