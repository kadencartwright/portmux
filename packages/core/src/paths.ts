import { createHash } from "node:crypto"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"

export interface PortmuxPaths {
  readonly stateDirectory: string
  readonly stateFile: string
  readonly runtimeDirectory: string
}

const userId = (): string => {
  const getuid = process.getuid
  return getuid ? String(getuid()) : "user"
}

const defaultStateDirectory = (): string => {
  const xdgStateHome = process.env.XDG_STATE_HOME
  return join(xdgStateHome ?? join(homedir(), ".local", "state"), "portmux")
}

const defaultRuntimeDirectory = (): string => {
  const xdgRuntimeDirectory = process.env.XDG_RUNTIME_DIR
  return xdgRuntimeDirectory ? join(xdgRuntimeDirectory, "portmux") : join(tmpdir(), `portmux-${userId()}`)
}

export const getPortmuxPaths = (): PortmuxPaths => {
  const homeOverride = process.env.PORTMUX_HOME
  const stateDirectory = homeOverride ?? defaultStateDirectory()
  const runtimeDirectory = homeOverride ? join(homeOverride, "run") : defaultRuntimeDirectory()
  return {
    stateDirectory,
    stateFile: join(stateDirectory, "tunnels.json"),
    runtimeDirectory,
  }
}

export const controlSocketPath = (paths: PortmuxPaths, id: string): string =>
  join(paths.runtimeDirectory, `${createHash("sha256").update(id).digest("hex").slice(0, 24)}.sock`)
