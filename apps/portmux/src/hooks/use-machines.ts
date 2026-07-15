import {
  addSavedMachine,
  forwardRemotePort,
  getSavedMachines,
  type MachineConfig,
  type MachineDraft,
  type RemoteListener,
  removeSavedMachine,
  runTunnelManager,
  scanMachinePorts,
} from "@portmux/core"
import { useCallback, useEffect, useRef, useState } from "react"

export type MachineScanStatus = "idle" | "scanning" | "online" | "offline"

export interface MachineScan {
  readonly listeners: ReadonlyArray<RemoteListener>
  readonly status: MachineScanStatus
  readonly error?: string | undefined
  readonly scannedAt?: number
}

export interface MachineActions {
  readonly machines: ReadonlyArray<MachineConfig>
  readonly scans: Readonly<Record<string, MachineScan>>
  readonly busy: boolean
  readonly notice: string
  readonly noticeAt: number
  readonly add: (draft: MachineDraft) => Promise<MachineConfig | undefined>
  readonly remove: (id: string) => Promise<void>
  readonly scan: (id: string) => Promise<void>
  readonly forward: (machineId: string, listener: RemoteListener) => Promise<boolean>
  readonly refresh: () => Promise<void>
}

const idleScan: MachineScan = { listeners: [], status: "idle" }

const messageOf = (cause: unknown): string => (cause instanceof Error ? cause.message : String(cause))

export const scanFor = (
  scans: Readonly<Record<string, MachineScan>>,
  machineId: string | undefined,
): MachineScan => (machineId ? (scans[machineId] ?? idleScan) : idleScan)

export const useMachines = (
  selectedMachineId: string | undefined,
  refreshTunnels: () => Promise<void>,
): MachineActions => {
  const [machines, setMachines] = useState<ReadonlyArray<MachineConfig>>([])
  const [scans, setScans] = useState<Readonly<Record<string, MachineScan>>>({})
  const [busy, setBusy] = useState(true)
  const [notice, setNoticeState] = useState(() => ({
    message: "Loading favorite machines…",
    updatedAt: Date.now(),
  }))
  const setNotice = useCallback((message: string) => setNoticeState({ message, updatedAt: Date.now() }), [])
  const scanning = useRef(new Set<string>())
  const mounted = useRef(true)

  const refresh = useCallback(async () => {
    try {
      const saved = await runTunnelManager(getSavedMachines)
      if (mounted.current) {
        setMachines(saved)
      }
    } catch (cause) {
      if (mounted.current) {
        setNotice(messageOf(cause))
      }
    }
  }, [setNotice])

  const scan = useCallback(
    async (machineId: string) => {
      if (scanning.current.has(machineId)) {
        return
      }
      scanning.current.add(machineId)
      setScans((current) => ({
        ...current,
        [machineId]: { ...(current[machineId] ?? idleScan), status: "scanning", error: undefined },
      }))
      try {
        const listeners = await runTunnelManager(scanMachinePorts(machineId))
        if (mounted.current) {
          setScans((current) => ({
            ...current,
            [machineId]: { listeners, status: "online", scannedAt: Date.now() },
          }))
          setNotice(`${listeners.length} listening port${listeners.length === 1 ? "" : "s"} found`)
        }
      } catch (cause) {
        if (mounted.current) {
          const error = messageOf(cause)
          setScans((current) => ({
            ...current,
            [machineId]: {
              ...(current[machineId] ?? idleScan),
              status: "offline",
              error,
            },
          }))
          setNotice(error)
        }
      } finally {
        scanning.current.delete(machineId)
      }
    },
    [setNotice],
  )

  useEffect(() => {
    mounted.current = true
    void refresh().finally(() => {
      if (mounted.current) {
        setBusy(false)
      }
    })
    return () => {
      mounted.current = false
    }
  }, [refresh])

  useEffect(() => {
    if (!selectedMachineId) {
      return
    }
    void scan(selectedMachineId)
    const timer = setInterval(() => {
      void scan(selectedMachineId)
    }, 5_000)
    return () => clearInterval(timer)
  }, [scan, selectedMachineId])

  const add = useCallback(
    async (draft: MachineDraft): Promise<MachineConfig | undefined> => {
      setBusy(true)
      try {
        const machine = await runTunnelManager(addSavedMachine(draft))
        setNotice(`Saved ${machine.name}`)
        await refresh()
        return machine
      } catch (cause) {
        setNotice(messageOf(cause))
        return undefined
      } finally {
        setBusy(false)
      }
    },
    [refresh, setNotice],
  )

  const remove = useCallback(
    async (id: string) => {
      setBusy(true)
      try {
        await runTunnelManager(removeSavedMachine(id))
        setScans((current) => {
          const { [id]: _removed, ...remaining } = current
          return remaining
        })
        setNotice("Machine removed from favorites")
        await refresh()
      } catch (cause) {
        setNotice(messageOf(cause))
      } finally {
        setBusy(false)
      }
    },
    [refresh, setNotice],
  )

  const forward = useCallback(
    async (machineId: string, listener: RemoteListener): Promise<boolean> => {
      setBusy(true)
      try {
        const tunnel = await runTunnelManager(forwardRemotePort({ machineId, listener }))
        setNotice(`Forwarding remote :${listener.port} on local :${tunnel.localPort}`)
        await refreshTunnels()
        return true
      } catch (cause) {
        setNotice(messageOf(cause))
        await refreshTunnels()
        return false
      } finally {
        setBusy(false)
      }
    },
    [refreshTunnels, setNotice],
  )

  return {
    machines,
    scans,
    busy,
    notice: notice.message,
    noticeAt: notice.updatedAt,
    add,
    remove,
    scan,
    forward,
    refresh,
  }
}
