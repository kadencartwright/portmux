import { useListenerSelection } from "../hooks/use-listener-selection.js"
import { useMachineDashboardControls } from "../hooks/use-machine-dashboard-controls.js"
import { type MachineActions, scanFor } from "../hooks/use-machines.js"
import type { TunnelActions } from "../hooks/use-tunnels.js"
import { Confirmation } from "./confirmation.js"
import { ListenerList } from "./listener-list.js"
import { MachineList } from "./machine-list.js"

interface MachineDashboardProps {
  readonly machines: MachineActions
  readonly tunnels: TunnelActions
  readonly selectedMachineId: string | undefined
  readonly onSelectMachine: (id: string) => void
  readonly onAddMachine: () => void
  readonly onShowForwards: () => void
  readonly onExit: () => void
  readonly width: number
  readonly height: number
}

export const MachineDashboard = ({
  machines,
  tunnels,
  selectedMachineId,
  onSelectMachine,
  onAddMachine,
  onShowForwards,
  onExit,
  width,
  height,
}: MachineDashboardProps) => {
  const selectedMachine = machines.machines.find((machine) => machine.id === selectedMachineId)
  const selectedMachineIndex = machines.machines.findIndex((machine) => machine.id === selectedMachineId)
  const scan = scanFor(machines.scans, selectedMachineId)
  const listenerSelection = useListenerSelection(scan, selectedMachine, tunnels.dashboard.managed)
  const controls = useMachineDashboardControls({
    machines,
    tunnels,
    selectedMachine,
    selectedMachineIndex,
    listenerSelection,
    scanStatus: scan.status,
    onSelectMachine,
    onAddMachine,
    onShowForwards,
    onExit,
  })
  const wide = width >= 72
  const panelHeight = wide ? height : Math.max(6, Math.floor(height / 2))

  return (
    <>
      <box style={{ flexDirection: wide ? "row" : "column", flexGrow: 1 }}>
        <MachineList
          machines={machines.machines}
          scans={machines.scans}
          selectedId={selectedMachineId}
          focused={controls.focusedPane === "machines"}
          height={panelHeight}
        />
        <ListenerList
          machine={selectedMachine}
          scan={listenerSelection.displayScan}
          tunnels={tunnels.dashboard.managed}
          selectedIndex={listenerSelection.selectedIndex}
          focused={controls.focusedPane === "listeners"}
          height={panelHeight}
        />
      </box>
      {controls.confirmingRemoval && selectedMachine ? (
        <Confirmation
          title="Remove favorite machine?"
          message={`${selectedMachine.name} · existing forwards are kept`}
        />
      ) : null}
    </>
  )
}
