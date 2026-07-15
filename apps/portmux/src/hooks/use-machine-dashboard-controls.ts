import { useKeyboard } from "@opentui/react"
import type { MachineConfig, RemoteListener } from "@portmux/core"
import { useCallback, useMemo, useState } from "react"
import { tunnelForListener } from "../components/listener-list.js"
import type { ListenerSelection } from "./use-listener-selection.js"
import type { MachineActions, MachineScanStatus } from "./use-machines.js"
import type { TunnelActions } from "./use-tunnels.js"

export type FocusedPane = "machines" | "listeners"

interface DashboardControlOptions {
  readonly machines: MachineActions
  readonly tunnels: TunnelActions
  readonly selectedMachine: MachineConfig | undefined
  readonly selectedMachineIndex: number
  readonly listenerSelection: ListenerSelection
  readonly scanStatus: MachineScanStatus
  readonly onSelectMachine: (id: string) => void
  readonly onAddMachine: () => void
  readonly onShowForwards: () => void
  readonly onExit: () => void
}

interface ListenerActions {
  readonly toggle: (listener: RemoteListener) => void
  readonly open: (listener: RemoteListener) => void
}

const useListenerActions = (
  machines: MachineActions,
  tunnels: TunnelActions,
  machine: MachineConfig | undefined,
  scanStatus: MachineScanStatus,
): ListenerActions => {
  const toggle = useCallback(
    (listener: RemoteListener) => {
      if (!machine || machines.busy || tunnels.busy) {
        return
      }
      const tunnel = tunnelForListener(tunnels.dashboard.managed, machine.id, listener)
      if (scanStatus === "offline" && tunnel?.status !== "running") {
        return
      }
      if (tunnel) {
        void tunnels.toggle(tunnel)
        return
      }
      void machines.forward(machine.id, listener)
    },
    [machine, machines, scanStatus, tunnels],
  )

  const open = useCallback(
    (listener: RemoteListener) => {
      if (!machine || machines.busy || tunnels.busy) {
        return
      }
      const tunnel = tunnelForListener(tunnels.dashboard.managed, machine.id, listener)
      if (tunnel?.status === "running") {
        void tunnels.open(tunnel.id)
      }
    },
    [machine, machines.busy, tunnels],
  )
  return { toggle, open }
}

const moveSelection = (current: number, amount: number, count: number): number => {
  if (count === 0) {
    return 0
  }
  return (current + amount + count) % count
}

interface NavigationControls {
  readonly focusedPane: FocusedPane
  readonly handle: (name: string) => boolean
  readonly focusListeners: () => void
}

const useNavigation = (
  machines: MachineActions,
  selectedMachineIndex: number,
  listenerSelection: ListenerSelection,
  onSelectMachine: (id: string) => void,
): NavigationControls => {
  const [focusedPane, setFocusedPane] = useState<FocusedPane>("machines")
  const selectMachineBy = useCallback(
    (amount: number) => {
      const next = moveSelection(Math.max(0, selectedMachineIndex), amount, machines.machines.length)
      const machine = machines.machines[next]
      if (machine) {
        onSelectMachine(machine.id)
        listenerSelection.reset()
      }
    },
    [listenerSelection, machines.machines, onSelectMachine, selectedMachineIndex],
  )
  const focusHandlers = useMemo<Readonly<Record<string, () => void>>>(
    () => ({
      tab: () => setFocusedPane((current) => (current === "machines" ? "listeners" : "machines")),
      left: () => setFocusedPane("machines"),
      right: () => setFocusedPane("listeners"),
    }),
    [],
  )
  const handle = useCallback(
    (name: string): boolean => {
      const focus = focusHandlers[name]
      if (focus) {
        focus()
        return true
      }
      const amount = { up: -1, k: -1, down: 1, j: 1 }[name]
      if (amount === undefined) {
        return false
      }
      if (focusedPane === "machines") {
        selectMachineBy(amount)
      } else {
        listenerSelection.moveBy(amount)
      }
      return true
    },
    [focusHandlers, focusedPane, listenerSelection, selectMachineBy],
  )
  return { focusedPane, handle, focusListeners: () => setFocusedPane("listeners") }
}

interface RemovalControls {
  readonly confirming: boolean
  readonly request: () => void
  readonly handle: (name: string) => void
}

const useRemoval = (
  machines: MachineActions,
  selectedMachine: MachineConfig | undefined,
): RemovalControls => {
  const [confirming, setConfirming] = useState(false)
  const request = useCallback(() => {
    if (selectedMachine && !machines.busy) {
      setConfirming(true)
    }
  }, [machines.busy, selectedMachine])
  const confirm = useCallback(() => {
    if (!selectedMachine) {
      return
    }
    setConfirming(false)
    void machines.remove(selectedMachine.id)
  }, [machines, selectedMachine])
  const handle = useCallback(
    (name: string) => {
      if (name === "y") {
        confirm()
      }
      if (name === "n" || name === "escape") {
        setConfirming(false)
      }
    },
    [confirm],
  )
  return { confirming, request, handle }
}

const useGlobalKeys = (
  machines: MachineActions,
  selectedMachine: MachineConfig | undefined,
  removal: RemovalControls,
  onAddMachine: () => void,
  onShowForwards: () => void,
  onExit: () => void,
): ((name: string) => boolean) => {
  const scan = useCallback(() => {
    if (selectedMachine) {
      void machines.scan(selectedMachine.id)
    }
  }, [machines, selectedMachine])
  const handlers = useMemo<Readonly<Record<string, () => void>>>(
    () => ({ q: onExit, a: onAddMachine, v: onShowForwards, r: scan, d: removal.request }),
    [onAddMachine, onExit, onShowForwards, removal.request, scan],
  )
  return useCallback(
    (name: string) => {
      const handler = handlers[name]
      handler?.()
      return Boolean(handler)
    },
    [handlers],
  )
}

const enterKeys = new Set(["enter", "return", "linefeed", "kpenter"])

const usePaneActions = (
  navigation: NavigationControls,
  listenerSelection: ListenerSelection,
  selectedMachine: MachineConfig | undefined,
  machines: MachineActions,
  listenerActions: ListenerActions,
): ((name: string) => void) => {
  const activate = useCallback(() => {
    if (navigation.focusedPane === "machines") {
      navigation.focusListeners()
      if (selectedMachine) {
        void machines.scan(selectedMachine.id)
      }
      return
    }
    if (listenerSelection.selected) {
      listenerActions.toggle(listenerSelection.selected)
    }
  }, [listenerActions, listenerSelection.selected, machines, navigation, selectedMachine])
  return useCallback(
    (name: string) => {
      if (enterKeys.has(name)) {
        activate()
        return
      }
      if (name === "o" && listenerSelection.selected) {
        listenerActions.open(listenerSelection.selected)
      }
    },
    [activate, listenerActions, listenerSelection.selected],
  )
}

export interface MachineDashboardControls {
  readonly focusedPane: FocusedPane
  readonly confirmingRemoval: boolean
}

export const useMachineDashboardControls = (options: DashboardControlOptions): MachineDashboardControls => {
  const listenerActions = useListenerActions(
    options.machines,
    options.tunnels,
    options.selectedMachine,
    options.scanStatus,
  )
  const navigation = useNavigation(
    options.machines,
    options.selectedMachineIndex,
    options.listenerSelection,
    options.onSelectMachine,
  )
  const removal = useRemoval(options.machines, options.selectedMachine)
  const globalKeys = useGlobalKeys(
    options.machines,
    options.selectedMachine,
    removal,
    options.onAddMachine,
    options.onShowForwards,
    options.onExit,
  )
  const paneActions = usePaneActions(
    navigation,
    options.listenerSelection,
    options.selectedMachine,
    options.machines,
    listenerActions,
  )

  useKeyboard((key) => {
    if (removal.confirming) {
      removal.handle(key.name)
      return
    }
    if (navigation.handle(key.name) || globalKeys(key.name)) {
      return
    }
    paneActions(key.name)
  })
  return { focusedPane: navigation.focusedPane, confirmingRemoval: removal.confirming }
}
