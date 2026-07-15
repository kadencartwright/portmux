import { useKeyboard } from "@opentui/react"
import type { ExternalTunnel, ManagedTunnel, TunnelView } from "@portmux/core"
import { useCallback, useEffect, useState } from "react"
import type { TunnelActions } from "./use-tunnels.js"

export type ConfirmationState =
  | { readonly kind: "delete"; readonly tunnel: ManagedTunnel }
  | { readonly kind: "stop-external"; readonly tunnel: ExternalTunnel }

interface DashboardControls {
  readonly selectedIndex: number
  readonly selected: TunnelView | undefined
  readonly creating: boolean
  readonly confirmation: ConfirmationState | undefined
  readonly closeCreate: () => void
}

const moveSelection = (current: number, amount: number, count: number): number => {
  if (count === 0) {
    return 0
  }
  return (current + amount + count) % count
}

type SelectedAction =
  | { readonly kind: "toggle"; readonly tunnel: TunnelView }
  | { readonly kind: "open"; readonly tunnel: ManagedTunnel }
  | { readonly kind: "delete"; readonly tunnel: ManagedTunnel }
  | { readonly kind: "stop-external"; readonly tunnel: ExternalTunnel }

const toggleKeys = new Set(["enter", "return", "s"])

const selectedActionFor = (name: string, tunnel: TunnelView): SelectedAction | undefined => {
  if (toggleKeys.has(name)) {
    return { kind: "toggle", tunnel }
  }
  if (name === "o" && tunnel.source === "managed" && tunnel.status === "running") {
    return { kind: "open", tunnel }
  }
  if (name === "d" && tunnel.source === "managed") {
    return { kind: "delete", tunnel }
  }
  if (name === "x" && tunnel.source === "external" && tunnel.canStop) {
    return { kind: "stop-external", tunnel }
  }
  return undefined
}

export const useDashboardControls = (actions: TunnelActions, onExit: () => void): DashboardControls => {
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [creating, setCreating] = useState(false)
  const [confirmation, setConfirmation] = useState<ConfirmationState>()
  const selected = actions.dashboard.tunnels[selectedIndex]

  useEffect(() => {
    const lastIndex = Math.max(0, actions.dashboard.tunnels.length - 1)
    setSelectedIndex((current) => Math.min(current, lastIndex))
  }, [actions.dashboard.tunnels.length])

  const confirm = useCallback(async () => {
    if (!confirmation) {
      return
    }
    setConfirmation(undefined)
    if (confirmation.kind === "delete") {
      await actions.remove(confirmation.tunnel.id)
      return
    }
    await actions.stopExternal(confirmation.tunnel)
  }, [actions, confirmation])

  const handleConfirmationKey = useCallback(
    (name: string) => {
      if (name === "y") {
        void confirm()
      }
      if (name === "n" || name === "escape") {
        setConfirmation(undefined)
      }
    },
    [confirm],
  )

  const handleSelectedAction = useCallback(
    (name: string, tunnel: TunnelView) => {
      const action = selectedActionFor(name, tunnel)
      switch (action?.kind) {
        case "toggle":
          void actions.toggle(action.tunnel)
          break
        case "open":
          void actions.open(action.tunnel.id)
          break
        case "delete":
          setConfirmation({ kind: "delete", tunnel: action.tunnel })
          break
        case "stop-external":
          setConfirmation({ kind: "stop-external", tunnel: action.tunnel })
          break
      }
    },
    [actions],
  )

  const handleListKey = useCallback(
    (name: string) => {
      if (name === "q") {
        onExit()
        return
      }
      if (name === "n") {
        setCreating(true)
        return
      }
      if (name === "r") {
        void actions.refresh()
        return
      }
      if (name === "up" || name === "k") {
        setSelectedIndex((current) => moveSelection(current, -1, actions.dashboard.tunnels.length))
        return
      }
      if (name === "down" || name === "j") {
        setSelectedIndex((current) => moveSelection(current, 1, actions.dashboard.tunnels.length))
        return
      }
      if (selected && !actions.busy) {
        handleSelectedAction(name, selected)
      }
    },
    [actions, handleSelectedAction, onExit, selected],
  )

  useKeyboard((key) => {
    if (creating) {
      return
    }
    if (confirmation) {
      handleConfirmationKey(key.name)
      return
    }
    handleListKey(key.name)
  })

  return {
    selectedIndex,
    selected,
    creating,
    confirmation,
    closeCreate: () => setCreating(false),
  }
}
