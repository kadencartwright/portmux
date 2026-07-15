import {
  createManagedTunnel,
  type Dashboard,
  type ExternalTunnel,
  getDashboard,
  openManagedTunnel,
  reconcileTunnels,
  removeManagedTunnel,
  runTunnelManager,
  startManagedTunnel,
  stopDiscoveredTunnel,
  stopManagedTunnel,
  type TunnelDraft,
  type TunnelView,
} from "@portmux/core"
import { useCallback, useEffect, useState } from "react"

const emptyDashboard: Dashboard = { managed: [], external: [], tunnels: [] }

const messageOf = (cause: unknown): string => (cause instanceof Error ? cause.message : String(cause))

export interface TunnelActions {
  readonly dashboard: Dashboard
  readonly busy: boolean
  readonly notice: string
  readonly noticeAt: number
  readonly refresh: () => Promise<void>
  readonly create: (draft: TunnelDraft) => Promise<boolean>
  readonly toggle: (tunnel: TunnelView) => Promise<void>
  readonly remove: (id: string) => Promise<void>
  readonly stopExternal: (tunnel: ExternalTunnel) => Promise<void>
  readonly open: (id: string) => Promise<void>
}

export const useTunnels = (): TunnelActions => {
  const [dashboard, setDashboard] = useState<Dashboard>(emptyDashboard)
  const [busy, setBusy] = useState(true)
  const [notice, setNoticeState] = useState(() => ({
    message: "Hydrating SSH forwards…",
    updatedAt: Date.now(),
  }))
  const setNotice = useCallback((message: string) => setNoticeState({ message, updatedAt: Date.now() }), [])

  const refresh = useCallback(async () => {
    try {
      setDashboard(await runTunnelManager(getDashboard))
    } catch (cause) {
      setNotice(messageOf(cause))
    }
  }, [setNotice])

  const act = useCallback(
    async (action: () => Promise<unknown>, success: string): Promise<boolean> => {
      setBusy(true)
      try {
        await action()
        setNotice(success)
        await refresh()
        return true
      } catch (cause) {
        setNotice(messageOf(cause))
        await refresh()
        return false
      } finally {
        setBusy(false)
      }
    },
    [refresh, setNotice],
  )

  useEffect(() => {
    let active = true
    const hydrate = async () => {
      try {
        await runTunnelManager(reconcileTunnels)
      } catch (cause) {
        if (active) {
          setNotice(messageOf(cause))
        }
      }
      if (active) {
        await refresh()
        setBusy(false)
      }
    }
    void hydrate()
    const timer = setInterval(() => {
      if (active) {
        void refresh()
      }
    }, 3_000)
    return () => {
      active = false
      clearInterval(timer)
    }
  }, [refresh, setNotice])

  const create = useCallback(
    (draft: TunnelDraft) =>
      act(() => runTunnelManager(createManagedTunnel(draft)), `Started ${draft.name.trim()}`),
    [act],
  )

  const toggle = useCallback(
    async (tunnel: TunnelView) => {
      if (tunnel.source !== "managed") {
        return
      }
      if (tunnel.status === "running") {
        await act(() => runTunnelManager(stopManagedTunnel(tunnel.id)), `Stopped ${tunnel.name}`)
        return
      }
      await act(() => runTunnelManager(startManagedTunnel(tunnel.id)), `Started ${tunnel.name}`)
    },
    [act],
  )

  return {
    dashboard,
    busy,
    notice: notice.message,
    noticeAt: notice.updatedAt,
    refresh,
    create,
    toggle,
    remove: async (id) => {
      await act(() => runTunnelManager(removeManagedTunnel(id)), "Forward removed")
    },
    stopExternal: async (tunnel) => {
      await act(() => runTunnelManager(stopDiscoveredTunnel(tunnel)), `Stopped pid ${tunnel.pid}`)
    },
    open: async (id) => {
      await act(() => runTunnelManager(openManagedTunnel(id)), "Opened local URL")
    },
  }
}
