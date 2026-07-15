import { theme } from "../theme.js"

interface HeaderProps {
  readonly running: number
  readonly total: number
  readonly external: number
}

export const Header = ({ running, total, external }: HeaderProps) => (
  <box
    style={{
      height: 3,
      width: "100%",
      alignItems: "center",
      justifyContent: "space-between",
      paddingLeft: 1,
      paddingRight: 1,
      backgroundColor: theme.panel,
    }}
  >
    <text content="PORTMUX" style={{ fg: theme.accent }} />
    <text
      content={`${running}/${total} managed running  ·  ${external} discovered`}
      style={{ fg: theme.muted }}
    />
  </box>
)
