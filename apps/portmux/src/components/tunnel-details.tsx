import type { TunnelView } from "@portmux/core"
import { theme } from "../theme.js"

interface TunnelDetailsProps {
  readonly tunnel: TunnelView | undefined
  readonly height: number
}

const managedDetails = (tunnel: Extract<TunnelView, { source: "managed" }>): ReadonlyArray<string> => [
  `SSH target    ${tunnel.sshTarget}`,
  `Local URL     http://${tunnel.bindHost}:${tunnel.localPort}`,
  `Remote        ${tunnel.remoteHost}:${tunnel.remotePort}`,
  `Desired       ${tunnel.desired}`,
  `Process       ${tunnel.pid ?? "—"}`,
  `Identity      ${tunnel.identityFile ?? "SSH config / agent"}`,
]

const externalDetails = (tunnel: Extract<TunnelView, { source: "external" }>): ReadonlyArray<string> => [
  `Process       ${tunnel.pid}`,
  `Forward       ${tunnel.forwardSpecs.join(" · ")}`,
  "Ownership     started outside Portmux",
  `Control       ${tunnel.canStop ? "verified Linux process" : "observe only on this platform"}`,
]

export const TunnelDetails = ({ tunnel, height }: TunnelDetailsProps) => (
  <box
    title=" Details "
    style={{
      border: true,
      borderColor: theme.border,
      flexDirection: "column",
      height,
      minWidth: 34,
      padding: 1,
    }}
  >
    {tunnel ? (
      <>
        <text content={tunnel.name} style={{ fg: theme.accent, marginBottom: 1 }} />
        {(tunnel.source === "managed" ? managedDetails(tunnel) : externalDetails(tunnel)).map((line) => (
          <text key={line} content={line} style={{ fg: theme.text, marginBottom: 1 }} />
        ))}
      </>
    ) : (
      <text content="Select a forward to see details" style={{ fg: theme.muted }} />
    )}
  </box>
)
