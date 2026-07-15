import { Data } from "effect"

export class PortmuxError extends Data.TaggedError("PortmuxError")<{
  readonly message: string
  readonly cause?: unknown
}> {}

export const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)
