import { useTerminalDimensions } from "@opentui/react"
import { useEffect, useState } from "react"
import { Confirmation } from "./components/confirmation.js"
import { CreateForm } from "./components/create-form.js"
import { Footer } from "./components/footer.js"
import { Header } from "./components/header.js"
import { MachineDashboard } from "./components/machine-dashboard.js"
import { MachineForm } from "./components/machine-form.js"
import { TunnelDetails } from "./components/tunnel-details.js"
import { TunnelList } from "./components/tunnel-list.js"
import {
  type ConfirmationState,
  type DashboardControls,
  useDashboardControls,
} from "./hooks/use-dashboard-controls.js"
import { type MachineActions, useMachines } from "./hooks/use-machines.js"
import { type TunnelActions, useTunnels } from "./hooks/use-tunnels.js"
import { theme } from "./theme.js"

interface AppProps {
  readonly onExit: () => void
}

type Screen = "machines" | "machine-form" | "forwards"

const machineKeys =
  "↑↓/jk select · Tab/←→ pane · Enter forward/stop · a add · d remove · r scan · v forwards · o open · q quit"
const forwardKeys =
  "↑↓/jk select · n manual · Enter/s start/stop · o open · d delete · x stop external · r refresh · v back · q quit"
const machineFormKeys = "Tab next · SSH target ↓ aliases · Enter advance/save · Esc cancel"
const forwardFormKeys = "Tab next · SSH target ↓ aliases · Enter advance/create · Esc cancel"

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

interface ForwardContentProps {
  readonly actions: TunnelActions
  readonly controls: DashboardControls
  readonly wide: boolean
  readonly panelHeight: number
}

const ForwardContent = ({ actions, controls, wide, panelHeight }: ForwardContentProps) => {
  if (controls.creating) {
    return <CreateForm busy={actions.busy} onCancel={controls.closeCreate} onCreate={actions.create} />
  }
  return (
    <box style={{ flexDirection: wide ? "row" : "column", flexGrow: 1, overflow: "hidden" }}>
      <TunnelList
        tunnels={actions.dashboard.tunnels}
        selectedIndex={controls.selectedIndex}
        height={panelHeight}
      />
      <TunnelDetails tunnel={controls.selected} height={panelHeight} />
    </box>
  )
}

interface AppContentProps {
  readonly screen: Screen
  readonly machines: MachineActions
  readonly tunnels: TunnelActions
  readonly controls: DashboardControls
  readonly selectedMachineId: string | undefined
  readonly onSelectMachine: (id: string) => void
  readonly onScreen: (screen: Screen) => void
  readonly onExit: () => void
  readonly width: number
  readonly availableHeight: number
  readonly panelHeight: number
  readonly wide: boolean
}

const AppContent = ({
  screen,
  machines,
  tunnels,
  controls,
  selectedMachineId,
  onSelectMachine,
  onScreen,
  onExit,
  width,
  availableHeight,
  panelHeight,
  wide,
}: AppContentProps) => {
  if (screen === "machine-form") {
    return (
      <MachineForm
        busy={machines.busy}
        onCancel={() => onScreen("machines")}
        onCreate={async (draft) => {
          const machine = await machines.add(draft)
          if (!machine) {
            return false
          }
          onSelectMachine(machine.id)
          return true
        }}
      />
    )
  }
  if (screen === "forwards") {
    return <ForwardContent actions={tunnels} controls={controls} wide={wide} panelHeight={panelHeight} />
  }
  return (
    <MachineDashboard
      machines={machines}
      tunnels={tunnels}
      selectedMachineId={selectedMachineId}
      onSelectMachine={onSelectMachine}
      onAddMachine={() => onScreen("machine-form")}
      onShowForwards={() => onScreen("forwards")}
      onExit={onExit}
      width={width}
      height={availableHeight}
    />
  )
}

const sectionFor = (screen: Screen): string => {
  switch (screen) {
    case "machine-form":
      return "add machine"
    case "forwards":
      return "forwards"
    default:
      return "machines"
  }
}

const keysFor = (screen: Screen): string => {
  switch (screen) {
    case "machine-form":
      return machineFormKeys
    case "forwards":
      return forwardKeys
    default:
      return machineKeys
  }
}

const machineSummary = (machineCount: number, running: number): string =>
  `${machineCount} favorite${machineCount === 1 ? "" : "s"} · ${running} local forward${running === 1 ? "" : "s"}`

interface AppPresentation {
  readonly section: string
  readonly summary: string
  readonly busy: boolean
  readonly notice: string
  readonly keys: string
}

const appPresentation = (
  screen: Screen,
  controls: DashboardControls,
  machines: MachineActions,
  tunnels: TunnelActions,
  running: number,
): AppPresentation => {
  if (screen === "forwards") {
    return {
      section: sectionFor(screen),
      summary: `${running}/${tunnels.dashboard.managed.length} managed running · ${tunnels.dashboard.external.length} discovered`,
      busy: tunnels.busy,
      notice: tunnels.notice,
      keys: controls.creating ? forwardFormKeys : forwardKeys,
    }
  }
  const notice = machines.noticeAt >= tunnels.noticeAt ? machines.notice : tunnels.notice
  return {
    section: sectionFor(screen),
    summary: machineSummary(machines.machines.length, running),
    busy: machines.busy || tunnels.busy,
    notice,
    keys: keysFor(screen),
  }
}

const useEnsureMachineSelection = (
  machines: ReadonlyArray<{ readonly id: string }>,
  selectedId: string | undefined,
  setSelectedId: (id: string | undefined) => void,
): void => {
  useEffect(() => {
    if (machines.length === 0) {
      setSelectedId(undefined)
      return
    }
    if (!machines.some((machine) => machine.id === selectedId)) {
      setSelectedId(machines[0]?.id)
    }
  }, [machines, selectedId, setSelectedId])
}

interface ConfirmationOverlayProps {
  readonly screen: Screen
  readonly confirmation: ConfirmationState | undefined
}

const ConfirmationOverlay = ({ screen, confirmation }: ConfirmationOverlayProps) => {
  const copy = confirmationCopy(confirmation)
  return screen === "forwards" && copy ? <Confirmation {...copy} /> : null
}

export const App = ({ onExit }: AppProps) => {
  const { width, height } = useTerminalDimensions()
  const [screen, setScreen] = useState<Screen>("machines")
  const [selectedMachineId, setSelectedMachineId] = useState<string>()
  const tunnelActions = useTunnels()
  const machineActions = useMachines(selectedMachineId, tunnelActions.refresh)
  useEnsureMachineSelection(machineActions.machines, selectedMachineId, setSelectedMachineId)
  const controls = useDashboardControls(tunnelActions, onExit, {
    enabled: screen === "forwards",
    onBack: () => setScreen("machines"),
  })
  const running = tunnelActions.dashboard.managed.filter((tunnel) => tunnel.status === "running").length
  const wide = width >= 72
  const availableHeight = Math.max(8, height - 6)
  const panelHeight = wide ? availableHeight : Math.max(6, Math.floor(availableHeight / 2))
  const presentation = appPresentation(screen, controls, machineActions, tunnelActions, running)

  return (
    <box
      style={{
        width: "100%",
        height: "100%",
        flexDirection: "column",
        backgroundColor: theme.background,
      }}
    >
      <Header section={presentation.section} summary={presentation.summary} />
      <AppContent
        screen={screen}
        machines={machineActions}
        tunnels={tunnelActions}
        controls={controls}
        selectedMachineId={selectedMachineId}
        onSelectMachine={setSelectedMachineId}
        onScreen={setScreen}
        onExit={onExit}
        width={width}
        availableHeight={availableHeight}
        panelHeight={panelHeight}
        wide={wide}
      />
      <Footer busy={presentation.busy} notice={presentation.notice} keys={presentation.keys} />
      <ConfirmationOverlay screen={screen} confirmation={controls.confirmation} />
    </box>
  )
}
