import { theme } from "../theme.js"

interface HeaderProps {
  readonly section: string
  readonly summary: string
}

export const Header = ({ section, summary }: HeaderProps) => (
  <box
    style={{
      height: 3,
      width: "100%",
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingLeft: 1,
      paddingRight: 1,
      backgroundColor: theme.panel,
    }}
  >
    <text content={`PORTMUX · ${section.toUpperCase()}`} style={{ fg: theme.accent }} />
    <text content={summary} style={{ fg: theme.muted }} />
  </box>
)
