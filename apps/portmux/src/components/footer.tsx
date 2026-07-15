import { theme } from "../theme.js"

interface FooterProps {
  readonly busy: boolean
  readonly notice: string
  readonly keys: string
}

export const Footer = ({ busy, notice, keys }: FooterProps) => (
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
    <text content={keys} style={{ fg: theme.muted }} />
    <text content={busy ? "Working…" : notice} style={{ fg: busy ? theme.warning : theme.accent }} />
  </box>
)
