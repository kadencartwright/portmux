import { useKeyboard } from "@opentui/react"
import type { ExternalTunnel, ManagedTunnel, TunnelView } from "@portmux/core"
import { useCallback, useEffect, useMemo, useState } from "react"
import type { TunnelActions } from "./use-tunnels.js"

export type ConfirmationState =
  | { readonly kind: "delete"; readonly tunnel: ManagedTunnel }
  | { readonly kind: "stop-external"; readonly tunnel: ExternalTunnel }

export interface DashboardControls {
  readonly selectedIndex: number
  readonly selected: TunnelView | undefined
  readonly creating: boolean
  readonly confirmation: ConfirmationState | undefined
  readonly closeCreate: () => void
}

interface DashboardControlOptions {
  readonly enabled: boolean
  readonly onBack: () => void
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

export const useDashboardControls = (
  actions: TunnelActions,
  onExit: () => void,
  options: DashboardControlOptions,
): DashboardControls => {
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

  const moveSelected = useCallback(
    (amount: number) => {
      setSelectedIndex((current) => moveSelection(current, amount, actions.dashboard.tunnels.length))
    },
    [actions.dashboard.tunnels.length],
  )

  const handleUnmappedListKey = useCallback(
    (name: string) => {
      if (!selected || actions.busy) {
        return
      }
      handleSelectedAction(name, selected)
    },
    [actions.busy, handleSelectedAction, selected],
  )

  const listKeyHandlers = useMemo<Readonly<Record<string, (name: string) => void>>>(
    () => ({
      q: onExit,
      v: options.onBack,
      escape: options.onBack,
      n: () => setCreating(true),
      r: () => void actions.refresh(),
      up: () => moveSelected(-1),
      k: () => moveSelected(-1),
      down: () => moveSelected(1),
      j: () => moveSelected(1),
    }),
    [actions, moveSelected, onExit, options.onBack],
  )

  const handleListKey = useCallback(
    (name: string) => {
      const handler = listKeyHandlers[name] ?? handleUnmappedListKey
      handler(name)
    },
    [handleUnmappedListKey, listKeyHandlers],
  )

  useKeyboard((key) => {
    if (!options.enabled) {
      return
    }
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
