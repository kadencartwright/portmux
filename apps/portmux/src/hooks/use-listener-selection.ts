import type { MachineConfig, ManagedTunnel, RemoteListener } from "@portmux/core"
import { useCallback, useEffect, useMemo, useState } from "react"
import { tunnelForListener } from "../components/listener-list.js"
import type { MachineScan } from "./use-machines.js"

const moveSelection = (current: number, amount: number, count: number): number => {
  if (count === 0) {
    return 0
  }
  return (current + amount + count) % count
}

const orderListeners = (
  listeners: ReadonlyArray<RemoteListener>,
  machine: MachineConfig | undefined,
  tunnels: ReadonlyArray<ManagedTunnel>,
): ReadonlyArray<RemoteListener> => {
  if (!machine) {
    return listeners
  }
  return listeners
    .map((listener, index) => ({
      listener,
      index,
      forwarded: Boolean(tunnelForListener(tunnels, machine.id, listener)),
    }))
    .sort((left, right) => Number(right.forwarded) - Number(left.forwarded) || left.index - right.index)
    .map(({ listener }) => listener)
}

export interface ListenerSelection {
  readonly listeners: ReadonlyArray<RemoteListener>
  readonly selected: RemoteListener | undefined
  readonly selectedIndex: number
  readonly displayScan: MachineScan
  readonly moveBy: (amount: number) => void
  readonly reset: () => void
}

export const useListenerSelection = (
  scan: MachineScan,
  machine: MachineConfig | undefined,
  tunnels: ReadonlyArray<ManagedTunnel>,
): ListenerSelection => {
  const [selectedId, setSelectedId] = useState<string>()
  const listeners = useMemo(
    () => orderListeners(scan.listeners, machine, tunnels),
    [machine, scan.listeners, tunnels],
  )
  const selectedIndex = Math.max(
    0,
    listeners.findIndex((listener) => listener.id === selectedId),
  )

  useEffect(() => {
    setSelectedId((current) => {
      if (current && listeners.some((listener) => listener.id === current)) {
        return current
      }
      return listeners[0]?.id
    })
  }, [listeners])

  const moveBy = useCallback(
    (amount: number) => {
      setSelectedId((current) => {
        const currentIndex = Math.max(
          0,
          listeners.findIndex((listener) => listener.id === current),
        )
        return listeners[moveSelection(currentIndex, amount, listeners.length)]?.id
      })
    },
    [listeners],
  )
  const displayScan = useMemo(() => ({ ...scan, listeners }), [listeners, scan])
  const reset = useCallback(() => setSelectedId(undefined), [])

  return {
    listeners,
    selected: listeners[selectedIndex],
    selectedIndex,
    displayScan,
    moveBy,
    reset,
  }
}
