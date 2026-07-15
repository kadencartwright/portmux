import type { MachineConfig } from "@portmux/core"
import type { MachineScan } from "../hooks/use-machines.js"
import { theme } from "../theme.js"
import { listWindowStart } from "./list-window.js"

interface MachineListProps {
  readonly machines: ReadonlyArray<MachineConfig>
  readonly scans: Readonly<Record<string, MachineScan>>
  readonly selectedId: string | undefined
  readonly focused: boolean
  readonly height: number
}

const statusLabel = (scan: MachineScan | undefined): string => {
  switch (scan?.status) {
    case "scanning":
      return "↻ scanning"
    case "online":
      return `● ${scan.listeners.length} ports`
    case "offline":
      return scan.listeners.length > 0 ? `! offline · ${scan.listeners.length} stale` : "! offline"
    default:
      return "○ not scanned"
  }
}

const statusColor = (scan: MachineScan | undefined): string => {
  switch (scan?.status) {
    case "online":
      return theme.success
    case "scanning":
      return theme.warning
    case "offline":
      return theme.danger
    default:
      return theme.muted
  }
}

export const MachineList = ({ machines, scans, selectedId, focused, height }: MachineListProps) => {
  const capacity = Math.max(1, Math.floor((height - 4) / 4))
  const selectedIndex = Math.max(
    0,
    machines.findIndex((machine) => machine.id === selectedId),
  )
  const start = listWindowStart(machines.length, selectedIndex, capacity)
  const visibleMachines = machines.slice(start, start + capacity)

  return (
    <box
      title=" Favorite machines "
      style={{
        border: true,
        borderColor: focused ? theme.accent : theme.border,
        flexDirection: "column",
        height,
        minWidth: 28,
        flexGrow: 1,
        padding: 1,
      }}
    >
      {machines.length === 0 ? (
        <box style={{ flexGrow: 1, alignItems: "center", justifyContent: "center" }}>
          <text content="No machines yet — press a to add one" style={{ fg: theme.muted }} />
        </box>
      ) : (
        visibleMachines.map((machine) => {
          const selected = machine.id === selectedId
          return (
            <box
              key={machine.id}
              style={{
                height: 3,
                flexDirection: "column",
                paddingLeft: 1,
                paddingRight: 1,
                marginBottom: 1,
                backgroundColor: selected ? theme.panelSelected : theme.background,
              }}
            >
              <text content={`${selected ? "›" : " "} ${machine.name}`} style={{ fg: theme.text }} />
              <box style={{ flexDirection: "row", justifyContent: "space-between" }}>
                <text content={`  ${machine.sshTarget}`} style={{ fg: theme.muted }} />
                <text
                  content={statusLabel(scans[machine.id])}
                  style={{ fg: statusColor(scans[machine.id]) }}
                />
              </box>
            </box>
          )
        })
      )}
    </box>
  )
}
