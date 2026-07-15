import { useTerminalDimensions } from "@opentui/react"
import { Confirmation } from "./components/confirmation.js"
import { CreateForm } from "./components/create-form.js"
import { Footer } from "./components/footer.js"
import { Header } from "./components/header.js"
import { TunnelDetails } from "./components/tunnel-details.js"
import { TunnelList } from "./components/tunnel-list.js"
import { type ConfirmationState, useDashboardControls } from "./hooks/use-dashboard-controls.js"
import { useTunnels } from "./hooks/use-tunnels.js"
import { theme } from "./theme.js"

interface AppProps {
  readonly onExit: () => void
}

const confirmationCopy = (confirmation: ConfirmationState | undefined) => {
  if (!confirmation) {
    return undefined
  }
  if (confirmation.kind === "delete") {
    return { title: "Delete managed forward?", message: confirmation.tunnel.name }
  }
  return {
    title: "Stop externally started SSH process?",
    message: `pid ${confirmation.tunnel.pid} · ${confirmation.tunnel.forwardSpecs.join(" · ")}`,
  }
}

export const App = ({ onExit }: AppProps) => {
  const { width, height } = useTerminalDimensions()
  const actions = useTunnels()
  const controls = useDashboardControls(actions, onExit)
  const running = actions.dashboard.managed.filter((tunnel) => tunnel.status === "running").length
  const wide = width >= 90
  const availableHeight = Math.max(8, height - 6)
  const panelHeight = wide ? availableHeight : Math.max(6, Math.floor(availableHeight / 2))

  const confirmation = confirmationCopy(controls.confirmation)

  return (
    <box
      style={{
        width: "100%",
        height: "100%",
        flexDirection: "column",
        backgroundColor: theme.background,
      }}
    >
      <Header
        running={running}
        total={actions.dashboard.managed.length}
        external={actions.dashboard.external.length}
      />
      {controls.creating ? (
        <CreateForm
          busy={actions.busy}
          notice={actions.notice}
          onCancel={controls.closeCreate}
          onCreate={actions.create}
        />
      ) : (
        <box style={{ flexDirection: wide ? "row" : "column", flexGrow: 1 }}>
          <TunnelList
            tunnels={actions.dashboard.tunnels}
            selectedIndex={controls.selectedIndex}
            height={panelHeight}
          />
          <TunnelDetails tunnel={controls.selected} height={panelHeight} />
        </box>
      )}
      <Footer busy={actions.busy} notice={actions.notice} />
      {confirmation ? <Confirmation {...confirmation} /> : null}
    </box>
  )
}
