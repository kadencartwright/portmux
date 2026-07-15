import { discoverSshConfigHosts, type SshConfigHost } from "@portmux/core"
import { Effect } from "effect"
import { useEffect, useState } from "react"

interface SshConfigHostsState {
  readonly hosts: ReadonlyArray<SshConfigHost>
  readonly status: "loading" | "ready" | "failed"
}

const initialState: SshConfigHostsState = { hosts: [], status: "loading" }

export const useSshConfigHosts = (): SshConfigHostsState => {
  const [state, setState] = useState<SshConfigHostsState>(initialState)

  useEffect(() => {
    let active = true
    void Effect.runPromise(discoverSshConfigHosts()).then(
      (hosts) => {
        if (active) {
          setState({ hosts, status: "ready" })
        }
      },
      () => {
        if (active) {
          setState({ hosts: [], status: "failed" })
        }
      },
    )
    return () => {
      active = false
    }
  }, [])

  return state
}
