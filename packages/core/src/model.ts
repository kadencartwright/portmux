import { Schema } from "effect"

export const DesiredStateSchema = Schema.Literal("running", "stopped")
export type DesiredState = Schema.Schema.Type<typeof DesiredStateSchema>

export const PortSchema = Schema.Number.pipe(Schema.int(), Schema.between(1, 65_535))

const legacyTunnelFields = {
  id: Schema.String,
  name: Schema.String,
  sshTarget: Schema.String,
  bindHost: Schema.String,
  localPort: PortSchema,
  remoteHost: Schema.String,
  remotePort: PortSchema,
  identityFile: Schema.optional(Schema.String),
  desired: DesiredStateSchema,
  createdAt: Schema.String,
  updatedAt: Schema.String,
}

export const LegacyTunnelConfigSchema = Schema.Struct(legacyTunnelFields)
export type LegacyTunnelConfig = Schema.Schema.Type<typeof LegacyTunnelConfigSchema>

export const TunnelConfigSchema = Schema.Struct({
  ...legacyTunnelFields,
  machineId: Schema.NullOr(Schema.String),
  restoreOnLaunch: Schema.Boolean,
})

export type TunnelConfig = Schema.Schema.Type<typeof TunnelConfigSchema>

export const MachineConfigSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  sshTarget: Schema.String,
  identityFile: Schema.optional(Schema.String),
  createdAt: Schema.String,
  updatedAt: Schema.String,
})

export type MachineConfig = Schema.Schema.Type<typeof MachineConfigSchema>

export const LegacyStoredStateSchema = Schema.Struct({
  version: Schema.Literal(1),
  tunnels: Schema.Array(LegacyTunnelConfigSchema),
})

export type LegacyStoredState = Schema.Schema.Type<typeof LegacyStoredStateSchema>

export const StoredStateSchema = Schema.Struct({
  version: Schema.Literal(2),
  machines: Schema.Array(MachineConfigSchema),
  tunnels: Schema.Array(TunnelConfigSchema),
})

export type StoredState = Schema.Schema.Type<typeof StoredStateSchema>

export interface TunnelDraft {
  readonly name: string
  readonly sshTarget: string
  readonly bindHost: string
  readonly localPort: number
  readonly remoteHost: string
  readonly remotePort: number
  readonly identityFile?: string
  readonly machineId?: string | null
  readonly restoreOnLaunch?: boolean
}

export interface MachineDraft {
  readonly name: string
  readonly sshTarget: string
  readonly identityFile?: string
}

export interface RemoteListener {
  readonly id: string
  readonly family: 4 | 6
  readonly address: string
  readonly forwardHost: string
  readonly port: number
  readonly processName?: string
  readonly pid?: number
}

export interface RemotePortForwardDraft {
  readonly machineId: string
  readonly listener: RemoteListener
  readonly localPort?: number
}

export interface ManagedTunnel extends TunnelConfig {
  readonly source: "managed"
  readonly status: "running" | "stopped"
  readonly pid?: number
}

export interface ExternalTunnel {
  readonly id: string
  readonly source: "external"
  readonly name: string
  readonly status: "external"
  readonly pid: number
  readonly forwardSpecs: ReadonlyArray<string>
  readonly fingerprint: string
  readonly canStop: boolean
  readonly processIdentity?: string
}

export type TunnelView = ManagedTunnel | ExternalTunnel

export interface Dashboard {
  readonly managed: ReadonlyArray<ManagedTunnel>
  readonly external: ReadonlyArray<ExternalTunnel>
  readonly tunnels: ReadonlyArray<TunnelView>
}

export const emptyState = (): StoredState => ({ version: 2, machines: [], tunnels: [] })
