import { theme } from "../theme.js"

interface ConfirmationProps {
  readonly title: string
  readonly message: string
}

export const Confirmation = ({ title, message }: ConfirmationProps) => (
  <box
    style={{
      position: "absolute",
      left: "15%",
      top: "35%",
      width: "70%",
      height: 7,
      border: true,
      borderColor: theme.warning,
      backgroundColor: theme.panel,
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      zIndex: 10,
    }}
  >
    <text content={title} style={{ fg: theme.warning, marginBottom: 1 }} />
    <text content={message} style={{ fg: theme.text, marginBottom: 1 }} />
    <text content="y confirm · n / Esc cancel" style={{ fg: theme.muted }} />
  </box>
)
