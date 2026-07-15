import type { MachineConfig, ManagedTunnel, RemoteListener } from "@portmux/core"
import type { MachineScan } from "../hooks/use-machines.js"
import { theme } from "../theme.js"
import { listWindowStart } from "./list-window.js"

interface ListenerListProps {
  readonly machine: MachineConfig | undefined
  readonly scan: MachineScan
  readonly tunnels: ReadonlyArray<ManagedTunnel>
  readonly selectedIndex: number
  readonly focused: boolean
  readonly height: number
}

export const tunnelForListener = (
  tunnels: ReadonlyArray<ManagedTunnel>,
  machineId: string,
  listener: RemoteListener,
): ManagedTunnel | undefined =>
  tunnels.find(
    (tunnel) =>
      tunnel.machineId === machineId &&
      tunnel.remotePort === listener.port &&
      tunnel.remoteHost === listener.forwardHost,
  )

const localStatus = (tunnel: ManagedTunnel | undefined, offline: boolean): string => {
  if (tunnel?.status === "running") {
    return `local :${tunnel.localPort}`
  }
  if (offline) {
    return "stale"
  }
  return tunnel ? `stopped · local :${tunnel.localPort}` : "available"
}

const scanLabel = (scan: MachineScan): string => {
  if (scan.status === "scanning") {
    return scan.listeners.length > 0 ? "Refreshing… showing last scan" : "Scanning remote listeners…"
  }
  if (scan.status === "offline") {
    return scan.listeners.length > 0
      ? "Machine offline · showing stale listeners"
      : (scan.error ?? "Machine unavailable")
  }
  if (scan.status === "online" && scan.listeners.length === 0) {
    return "Connected · no listening TCP ports found"
  }
  if (scan.status === "online") {
    return `Connected · ${scan.listeners.length} listening port${scan.listeners.length === 1 ? "" : "s"}`
  }
  return "Select a machine to discover its listening TCP ports"
}

interface ListenerRowProps {
  readonly listener: RemoteListener
  readonly tunnel: ManagedTunnel | undefined
  readonly selected: boolean
  readonly offline: boolean
}

const compact = (value: string, maximum: number): string =>
  value.length > maximum ? `${value.slice(0, maximum - 1)}…` : value

const processLabel = (listener: RemoteListener): string => {
  if (!listener.processName) {
    return "unknown process"
  }
  const name = compact(listener.processName, 16)
  return listener.pid ? `${name} · ${listener.pid}` : name
}

const listenerMarker = (tunnel: ManagedTunnel | undefined, offline: boolean): string => {
  if (tunnel?.status === "running") {
    return "●"
  }
  if (offline) {
    return "!"
  }
  return tunnel ? "○" : " "
}

const ListenerRow = ({ listener, tunnel, selected, offline }: ListenerRowProps) => (
  <box
    style={{
      height: 2,
      flexDirection: "column",
      paddingLeft: 1,
      paddingRight: 1,
      backgroundColor: selected ? theme.panelSelected : theme.background,
    }}
  >
    <text
      content={`${selected ? "›" : " "} ${listenerMarker(tunnel, offline)} :${listener.port}  ${processLabel(listener)}`}
      style={{
        fg: tunnel?.status === "running" ? theme.success : offline ? theme.warning : theme.text,
      }}
    />
    <text
      content={`    ${compact(listener.address, 18)} · IPv${listener.family} · ${localStatus(tunnel, offline)}`}
      style={{ fg: offline ? theme.warning : theme.muted }}
    />
  </box>
)

export const ListenerList = ({
  machine,
  scan,
  tunnels,
  selectedIndex,
  focused,
  height,
}: ListenerListProps) => {
  const capacity = Math.max(1, Math.floor((height - 5) / 2))
  const start = listWindowStart(scan.listeners.length, selectedIndex, capacity)
  const visibleListeners = scan.listeners.slice(start, start + capacity)

  return (
    <box
      title={machine ? ` Listening on ${machine.name} ` : " Remote listeners "}
      style={{
        border: true,
        borderColor: focused ? theme.accent : theme.border,
        flexDirection: "column",
        height,
        minWidth: 40,
        flexGrow: 2,
        padding: 1,
      }}
    >
      {!machine || scan.listeners.length === 0 ? (
        <box style={{ flexGrow: 1, alignItems: "center", justifyContent: "center" }}>
          <text
            content={scanLabel(scan)}
            style={{ fg: scan.status === "offline" ? theme.danger : theme.muted }}
          />
        </box>
      ) : (
        <>
          <text
            content={scanLabel(scan)}
            style={{ fg: scan.status === "offline" ? theme.warning : theme.muted }}
          />
          {visibleListeners.map((listener, offset) => (
            <ListenerRow
              key={listener.id}
              listener={listener}
              tunnel={tunnelForListener(tunnels, machine.id, listener)}
              selected={start + offset === selectedIndex}
              offline={scan.status === "offline"}
            />
          ))}
        </>
      )}
    </box>
  )
}
