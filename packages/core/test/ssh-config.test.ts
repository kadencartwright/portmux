import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { Effect } from "effect"
import { afterEach, describe, expect, it } from "vitest"
import { discoverSshConfigHosts } from "../src/ssh-config.js"

const temporaryDirectories: Array<string> = []

const makeHome = async (): Promise<string> => {
  const home = await mkdtemp(join(tmpdir(), "portmux-ssh-config-"))
  temporaryDirectories.push(home)
  await mkdir(join(home, ".ssh"), { recursive: true })
  return home
}

const writeSshFile = async (home: string, relativePath: string, contents: string): Promise<string> => {
  const file = join(home, ".ssh", relativePath)
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, contents, { mode: 0o600 })
  return file
}

const aliasesFrom = async (
  homeDirectory: string,
  environment: Readonly<Record<string, string | undefined>> = {},
): Promise<ReadonlyArray<string>> => {
  const hosts = await Effect.runPromise(discoverSshConfigHosts({ homeDirectory, environment }))
  return hosts.map((host) => host.alias)
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })))
})

describe("SSH config host discovery", () => {
  it("returns no hosts when the user config is missing", async () => {
    const home = await makeHome()
    await expect(aliasesFrom(home)).resolves.toEqual([])
  })

  it("reports an invalid main config while keeping missing configs optional", async () => {
    const home = await makeHome()
    await expect(
      Effect.runPromise(discoverSshConfigHosts({ configFile: join(home, ".ssh"), homeDirectory: home })),
    ).rejects.toThrow("not a regular file")
  })

  it("finds concrete aliases and rejects patterns or unsafe targets", async () => {
    const home = await makeHome()
    await writeSshFile(
      home,
      "config",
      [
        "\uFEFFHoSt dev staging # common machines",
        "Host=prod",
        "Host =equals-spaced",
        'Host "quoted-host"',
        "Host *.example.com ?box !private -option bad,alias bad\u0001alias",
        "Host DEV",
      ].join("\r\n"),
    )

    await expect(aliasesFrom(home)).resolves.toEqual([
      "dev",
      "staging",
      "prod",
      "equals-spaced",
      "quoted-host",
    ])
  })

  it("expands recursive includes in lexical order", async () => {
    const home = await makeHome()
    const external = await writeSshFile(home, "external.conf", "Host environment-host")
    await writeSshFile(home, "nested.conf", "Host nested")
    await writeSshFile(home, "conf.d/20-second.conf", "Host second")
    await writeSshFile(home, "conf.d/10-first.conf", "Include nested.conf\nHost first")
    await writeSshFile(home, "after-external.conf", "Host after-external")
    await writeSshFile(home, "token.conf", "Host token-home")
    await writeSshFile(home, "%host.conf", "Host percent-literal")
    await writeSshFile(
      home,
      "config",
      [
        `Include =\${EXTERNAL_CONFIG}`,
        "Include =after-external.conf",
        "Host *",
        "Include conf.d/*.conf",
        "Host *",
        "Include %d/.ssh/token.conf %%host.conf",
        `Include \${MISSING_CONFIG}`,
        "Include %h-target-dependent.conf ~other-user/config",
      ].join("\n"),
    )

    await expect(aliasesFrom(home, { EXTERNAL_CONFIG: external })).resolves.toEqual([
      "environment-host",
      "after-external",
      "nested",
      "first",
      "second",
      "token-home",
      "percent-literal",
    ])
  })

  it("only follows includes in an unconditional scope", async () => {
    const home = await makeHome()
    await writeSshFile(home, "conditional.conf", "Host hidden-conditional")
    await writeSshFile(home, "universal.conf", "Host universal")
    await writeSshFile(home, "catch-all.conf", "Host catch-all-include")
    await writeSshFile(home, "negated.conf", "Host hidden-negated")
    await writeSshFile(home, "match.conf", "Host hidden-match")
    await writeSshFile(home, "all.conf", "Host match-all")
    await writeSshFile(
      home,
      "config",
      [
        "Host work",
        "  Include conditional.conf",
        "Host *",
        "  Include universal.conf",
        "Host * fallback",
        "  Include catch-all.conf",
        "Host * !excluded",
        "  Include negated.conf",
        'Match exec "false"',
        "  Include match.conf",
        "Match all",
        "  Include all.conf",
      ].join("\n"),
    )

    await expect(aliasesFrom(home)).resolves.toEqual([
      "work",
      "universal",
      "fallback",
      "catch-all-include",
      "match-all",
    ])
  })

  it("terminates symlink include cycles", async () => {
    const home = await makeHome()
    const config = await writeSshFile(home, "config", "Include cycle.conf\nHost root")
    const cycle = await writeSshFile(home, "cycle-target.conf", "Include config\nHost cycle")
    await symlink(cycle, join(home, ".ssh", "cycle.conf"))

    const hosts = await Effect.runPromise(discoverSshConfigHosts({ configFile: config, homeDirectory: home }))
    expect(hosts.map((host) => host.alias)).toEqual(["cycle", "root"])
  })
})
