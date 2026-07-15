import { theme } from "../theme.js"

interface FooterProps {
  readonly busy: boolean
  readonly notice: string
}

export const Footer = ({ busy, notice }: FooterProps) => (
  <box
    style={{
      height: 3,
      width: "100%",
      flexDirection: "column",
      paddingLeft: 1,
      paddingRight: 1,
      backgroundColor: theme.panel,
    }}
  >
    <text
      content="↑↓/jk select · n new · Enter/s start/stop · o open · d delete · x stop verified external · r refresh · q quit"
      style={{ fg: theme.muted }}
    />
    <text content={busy ? "Working…" : notice} style={{ fg: busy ? theme.warning : theme.accent }} />
  </box>
)
