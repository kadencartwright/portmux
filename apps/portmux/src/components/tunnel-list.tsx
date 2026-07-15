import type { TunnelView } from "@portmux/core"
import { theme } from "../theme.js"

interface TunnelListProps {
  readonly tunnels: ReadonlyArray<TunnelView>
  readonly selectedIndex: number
  readonly height: number
}

const status = (tunnel: TunnelView): string => {
  if (tunnel.source === "external") {
    return "◆ external"
  }
  return tunnel.status === "running" ? "● running" : "○ stopped"
}

const destination = (tunnel: TunnelView): string => {
  if (tunnel.source === "external") {
    return tunnel.forwardSpecs.join(" · ")
  }
  return `${tunnel.bindHost}:${tunnel.localPort} → ${tunnel.remoteHost}:${tunnel.remotePort}`
}

const statusColor = (tunnel: TunnelView): string => {
  if (tunnel.source === "external") {
    return theme.warning
  }
  return tunnel.status === "running" ? theme.success : theme.muted
}

export const TunnelList = ({ tunnels, selectedIndex, height }: TunnelListProps) => (
  <box
    title=" Forwards "
    style={{
      border: true,
      borderColor: theme.border,
      flexDirection: "column",
      height,
      minWidth: 36,
      flexGrow: 1,
      flexShrink: 1,
      flexBasis: 0,
      overflow: "hidden",
      padding: 1,
    }}
  >
    {tunnels.length === 0 ? (
      <box style={{ flexGrow: 1, alignItems: "center", justifyContent: "center" }}>
        <text content="No forwards yet — press n to create one" style={{ fg: theme.muted }} />
      </box>
    ) : (
      tunnels.map((tunnel, index) => {
        const selected = index === selectedIndex
        return (
          <box
            key={tunnel.id}
            style={{
              height: 3,
              flexDirection: "column",
              paddingLeft: 1,
              paddingRight: 1,
              marginBottom: 1,
              backgroundColor: selected ? theme.panelSelected : theme.background,
            }}
          >
            <box style={{ flexDirection: "row", justifyContent: "space-between" }}>
              <text content={`${selected ? "›" : " "} ${tunnel.name}`} style={{ fg: theme.text }} />
              <text content={status(tunnel)} style={{ fg: statusColor(tunnel) }} />
            </box>
            <text content={`  ${destination(tunnel)}`} style={{ fg: theme.muted }} />
          </box>
        )
      })
    )}
  </box>
)
