import { homedir } from "node:os"
import { resolve } from "node:path"
import { Effect } from "effect"
import { PortmuxError } from "./errors.js"
import type { TunnelDraft } from "./model.js"

const WHITESPACE = /\s/u

const hasControlCharacter = (value: string): boolean =>
  [...value].some((character) => {
    const code = character.codePointAt(0) ?? 0
    return code <= 31 || code === 127
  })

const validatePort = (port: number, label: string): void => {
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`${label} must be an integer from 1 to 65535`)
  }
}

const validateHost = (host: string, label: string): void => {
  if (!host || hasControlCharacter(host) || WHITESPACE.test(host)) {
    throw new Error(`${label} must be a non-empty host without spaces or control characters`)
  }
  if (host.startsWith("-")) {
    throw new Error(`${label} cannot start with a dash`)
  }
}

const validateTunnelDraft = (draft: TunnelDraft): TunnelDraft => {
  if (!draft.name.trim() || hasControlCharacter(draft.name)) {
    throw new Error("Name is required and cannot contain control characters")
  }
  validateHost(draft.sshTarget.trim(), "SSH target")
  validateHost(draft.bindHost.trim(), "Bind host")
  validateHost(draft.remoteHost.trim(), "Remote host")
  validatePort(draft.localPort, "Local port")
  validatePort(draft.remotePort, "Remote port")
  if (draft.identityFile && hasControlCharacter(draft.identityFile)) {
    throw new Error("Identity file cannot contain control characters")
  }
  return draft
}

export const validateDraft = (draft: TunnelDraft): Effect.Effect<TunnelDraft, PortmuxError> =>
  Effect.try({
    try: () => validateTunnelDraft(draft),
    catch: (cause) =>
      new PortmuxError({
        message: cause instanceof Error ? cause.message : "Invalid tunnel",
        cause,
      }),
  })

export const resolveIdentityFile = (path: string): string =>
  path === "~" || path.startsWith("~/") ? resolve(homedir(), path.slice(2)) : resolve(path)
