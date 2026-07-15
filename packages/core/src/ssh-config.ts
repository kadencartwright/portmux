import { glob, readFile, realpath, stat } from "node:fs/promises"
import { homedir, hostname, userInfo } from "node:os"
import { isAbsolute, join, resolve } from "node:path"
import { Effect } from "effect"
import { errorMessage, PortmuxError } from "./errors.js"

export interface SshConfigHost {
  readonly alias: string
  readonly source: string
}

export interface SshConfigDiscoveryOptions {
  readonly configFile?: string
  readonly homeDirectory?: string
  readonly environment?: Readonly<Record<string, string | undefined>>
}

interface Directive {
  readonly keyword: string
  readonly values: ReadonlyArray<string>
}

interface DiscoveryContext {
  readonly homeDirectory: string
  readonly environment: Readonly<Record<string, string | undefined>>
  readonly aliases: Array<SshConfigHost>
  readonly seenAliases: Set<string>
  readonly seenFiles: Set<string>
  filesRead: number
}

type IncludeScope = "all" | "conditional"

const MAX_DEPTH = 16
const MAX_FILES = 256
const MAX_FILE_BYTES = 1024 * 1024
const MAX_HOSTS = 500
const targetDependentToken = /%(?:C|h|j|n|p|r)/u
const unresolvedToken = /%(?:[A-Za-z]|%)/u
const literalPercentMarker = "\u0000"

const tokenize = (line: string): ReadonlyArray<string> => {
  const tokens: Array<string> = []
  let current = ""
  let quoted = false
  let escaped = false

  const flush = () => {
    if (current.length > 0) {
      tokens.push(current)
      current = ""
    }
  }

  for (const character of line) {
    if (escaped) {
      current += character
      escaped = false
      continue
    }
    if (character === "\\") {
      escaped = true
      continue
    }
    if (character === '"') {
      quoted = !quoted
      continue
    }
    if (!quoted && character === "#") {
      break
    }
    if (!quoted && /\s/u.test(character)) {
      flush()
      continue
    }
    current += character
  }

  if (escaped) {
    current += "\\"
  }
  flush()
  return tokens
}

const parseDirective = (line: string): Directive | undefined => {
  const [head, ...tail] = tokenize(line)
  if (!head) {
    return undefined
  }
  const equalsIndex = head.indexOf("=")
  if (equalsIndex >= 0) {
    const inlineValue = head.slice(equalsIndex + 1)
    return {
      keyword: head.slice(0, equalsIndex).toLowerCase(),
      values: inlineValue ? [inlineValue, ...tail] : tail,
    }
  }
  const [firstValue, ...remainingValues] = tail
  const values = firstValue?.startsWith("=")
    ? [firstValue.slice(1), ...remainingValues].filter(Boolean)
    : tail
  return { keyword: head.toLowerCase(), values }
}

const hasUnsafeAliasCharacter = (value: string): boolean =>
  [...value].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0
    return /\s/u.test(character) || codePoint < 32 || codePoint === 127 || "*?,".includes(character)
  })

const isConcreteAlias = (value: string): boolean =>
  value.length > 0 &&
  value.length <= 255 &&
  !value.startsWith("-") &&
  !value.startsWith("!") &&
  !hasUnsafeAliasCharacter(value)

const addAliases = (context: DiscoveryContext, values: ReadonlyArray<string>, source: string): void => {
  for (const alias of values) {
    const key = alias.toLowerCase()
    if (!isConcreteAlias(alias) || context.seenAliases.has(key)) {
      continue
    }
    context.seenAliases.add(key)
    context.aliases.push({ alias, source })
    if (context.aliases.length >= MAX_HOSTS) {
      return
    }
  }
}

const expandEnvironment = (
  value: string,
  environment: Readonly<Record<string, string | undefined>>,
): string | undefined => {
  let missing = false
  const expanded = value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/gu, (_match, name: string) => {
    const replacement = environment[name]
    if (replacement === undefined) {
      missing = true
      return ""
    }
    return replacement
  })
  return missing ? undefined : expanded
}

const expandIncludeValue = (value: string, context: DiscoveryContext): string | undefined => {
  const environmentExpanded = expandEnvironment(value, context.environment)
  if (!environmentExpanded) {
    return undefined
  }

  const local = userInfo()
  const escaped = environmentExpanded.replaceAll("%%", literalPercentMarker)
  if (targetDependentToken.test(escaped)) {
    return undefined
  }
  const tokenExpanded = escaped.replace(/%[diuLl]/gu, (token) => {
    switch (token) {
      case "%d":
        return context.homeDirectory
      case "%i":
        return String(local.uid)
      case "%u":
        return local.username
      default:
        return hostname()
    }
  })
  if (unresolvedToken.test(tokenExpanded)) {
    return undefined
  }
  const expanded = tokenExpanded.replaceAll(literalPercentMarker, "%")
  if (expanded === "~") {
    return context.homeDirectory
  }
  if (expanded.startsWith("~/")) {
    return join(context.homeDirectory, expanded.slice(2))
  }
  if (expanded.startsWith("~")) {
    return undefined
  }
  return isAbsolute(expanded) ? resolve(expanded) : resolve(context.homeDirectory, ".ssh", expanded)
}

const matchingFiles = async (pattern: string, maximumMatches: number): Promise<ReadonlyArray<string>> => {
  const matches: Array<string> = []
  try {
    for await (const match of glob(pattern, { followSymlinks: false })) {
      matches.push(resolve(match))
      if (matches.length >= maximumMatches) {
        break
      }
    }
  } catch {
    return []
  }
  return matches.sort((left, right) => left.localeCompare(right))
}

const includeScopeAfter = (directive: Directive, current: IncludeScope): IncludeScope => {
  if (directive.keyword === "host") {
    const hasCatchAll = directive.values.includes("*")
    const hasExclusion = directive.values.some((value) => value.startsWith("!"))
    return hasCatchAll && !hasExclusion ? "all" : "conditional"
  }
  if (directive.keyword === "match") {
    return directive.values.length === 1 && directive.values[0]?.toLowerCase() === "all"
      ? "all"
      : "conditional"
  }
  return current
}

const discoveryLimitReached = (context: DiscoveryContext): boolean =>
  context.filesRead >= MAX_FILES || context.aliases.length >= MAX_HOSTS

const errorCode = (cause: unknown): string | undefined => {
  if (!cause || typeof cause !== "object" || !("code" in cause)) {
    return undefined
  }
  return typeof cause.code === "string" ? cause.code : undefined
}

const isMissingPath = (cause: unknown): boolean => {
  const code = errorCode(cause)
  return code === "ENOENT" || code === "ENOTDIR"
}

const loadConfigContents = async (
  file: string,
  context: DiscoveryContext,
  strict: boolean,
): Promise<{ readonly canonical: string; readonly contents: string } | undefined> => {
  try {
    const canonical = await realpath(file)
    const metadata = await stat(canonical)
    if (context.seenFiles.has(canonical)) {
      return undefined
    }
    if (!metadata.isFile()) {
      throw new Error(`${canonical} is not a regular file`)
    }
    if (metadata.size > MAX_FILE_BYTES) {
      throw new Error(`${canonical} is larger than ${MAX_FILE_BYTES} bytes`)
    }
    const contents = await readFile(canonical, "utf8")
    context.seenFiles.add(canonical)
    context.filesRead += 1
    return { canonical, contents }
  } catch (cause) {
    if (strict && !isMissingPath(cause)) {
      throw cause
    }
    return undefined
  }
}

const readConfigFile = async (
  file: string,
  context: DiscoveryContext,
  depth: number,
  inheritedScope: IncludeScope,
  strict = false,
): Promise<void> => {
  if (depth > MAX_DEPTH || discoveryLimitReached(context)) {
    return
  }

  const loaded = await loadConfigContents(file, context, strict)
  if (!loaded) {
    return
  }

  let scope = inheritedScope
  for (const line of loaded.contents.replace(/^\uFEFF/u, "").split(/\r?\n/u)) {
    const directive = parseDirective(line)
    if (!directive) {
      continue
    }
    if (directive.keyword === "host") {
      addAliases(context, directive.values, loaded.canonical)
    }
    if (directive.keyword === "include" && scope === "all") {
      await readIncludes(directive.values, context, depth + 1, scope)
    }
    scope = includeScopeAfter(directive, scope)
    if (discoveryLimitReached(context)) {
      break
    }
  }
}

const readIncludes = async (
  values: ReadonlyArray<string>,
  context: DiscoveryContext,
  depth: number,
  inheritedScope: IncludeScope,
): Promise<void> => {
  for (const value of values) {
    if (discoveryLimitReached(context)) {
      return
    }
    const pattern = expandIncludeValue(value, context)
    if (!pattern) {
      continue
    }
    const remainingFiles = MAX_FILES - context.filesRead
    for (const file of await matchingFiles(pattern, remainingFiles)) {
      if (discoveryLimitReached(context)) {
        return
      }
      await readConfigFile(file, context, depth, inheritedScope)
    }
  }
}

const discover = async (options: SshConfigDiscoveryOptions): Promise<ReadonlyArray<SshConfigHost>> => {
  const homeDirectory = options.homeDirectory ?? homedir()
  const context: DiscoveryContext = {
    homeDirectory,
    environment: options.environment ?? process.env,
    aliases: [],
    seenAliases: new Set(),
    seenFiles: new Set(),
    filesRead: 0,
  }
  const configFile = options.configFile ?? join(homeDirectory, ".ssh", "config")
  await readConfigFile(configFile, context, 0, "all", true)
  return context.aliases
}

export const discoverSshConfigHosts = (
  options: SshConfigDiscoveryOptions = {},
): Effect.Effect<ReadonlyArray<SshConfigHost>, PortmuxError> =>
  Effect.tryPromise({
    try: () => discover(options),
    catch: (cause) =>
      new PortmuxError({
        message: `Could not read SSH config hosts: ${errorMessage(cause)}`,
        cause,
      }),
  })
