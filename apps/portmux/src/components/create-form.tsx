import type { TunnelDraft } from "@portmux/core"
import { theme } from "../theme.js"
import { FormInputField } from "./form-input-field.js"
import { SshAliasForm } from "./ssh-alias-form.js"

type Field = "name" | "sshTarget" | "localPort" | "remoteHost" | "remotePort" | "identityFile"

interface FormValues {
  readonly name: string
  readonly sshTarget: string
  readonly localPort: string
  readonly remoteHost: string
  readonly remotePort: string
  readonly identityFile: string
}

interface CreateFormProps {
  readonly busy: boolean
  readonly onCancel: () => void
  readonly onCreate: (draft: TunnelDraft) => Promise<boolean>
}

const fields: ReadonlyArray<Field> = [
  "name",
  "sshTarget",
  "localPort",
  "remoteHost",
  "remotePort",
  "identityFile",
]

const initialValues: FormValues = {
  name: "",
  sshTarget: "",
  localPort: "3000",
  remoteHost: "127.0.0.1",
  remotePort: "3000",
  identityFile: "",
}

const hostHint = (status: "loading" | "ready" | "failed", count: number): string => {
  if (status === "loading") {
    return "loading SSH config hosts…"
  }
  if (status === "failed") {
    return "SSH config unavailable · manual target still works"
  }
  return count > 0 ? `SSH target ↓ browses ${count} config aliases` : "no concrete SSH aliases found"
}

const toDraft = (values: FormValues): TunnelDraft => ({
  name: values.name,
  sshTarget: values.sshTarget,
  bindHost: "127.0.0.1",
  localPort: Number.parseInt(values.localPort, 10),
  remoteHost: values.remoteHost || "127.0.0.1",
  remotePort: Number.parseInt(values.remotePort, 10),
  ...(values.identityFile.trim() ? { identityFile: values.identityFile } : {}),
})

const withSelectedHost = (values: FormValues, alias: string): FormValues => ({
  ...values,
  sshTarget: alias,
})

export const CreateForm = ({ busy, onCancel, onCreate }: CreateFormProps) => {
  return (
    <SshAliasForm
      busy={busy}
      fields={fields}
      initialValues={initialValues}
      sshTargetField="sshTarget"
      onCancel={onCancel}
      onSubmit={(values) => onCreate(toDraft(values))}
      withSelectedHost={withSelectedHost}
      render={({ fieldProps, sshConfig }) => (
        <box
          title=" New local forward "
          style={{
            border: true,
            borderColor: theme.accent,
            flexDirection: "column",
            flexGrow: 1,
            padding: 1,
          }}
        >
          <text
            content={`Local-only bind · ${hostHint(sshConfig.status, sshConfig.hosts.length)}`}
            style={{ fg: theme.muted }}
          />
          <box style={{ width: "100%", height: 3, flexDirection: "row", gap: 1 }}>
            <FormInputField layout="row" {...fieldProps("name", 0, "Name", "docs server")} />
            <FormInputField
              layout="row"
              {...fieldProps("sshTarget", 1, "SSH target", "devbox or user@host")}
            />
          </box>
          <box style={{ width: "100%", height: 3, flexDirection: "row", gap: 1 }}>
            <FormInputField layout="row" {...fieldProps("localPort", 2, "Local port", "3000")} />
            <FormInputField layout="row" {...fieldProps("remoteHost", 3, "Remote host", "127.0.0.1")} />
          </box>
          <box style={{ width: "100%", height: 3, flexDirection: "row", gap: 1 }}>
            <FormInputField layout="row" {...fieldProps("remotePort", 4, "Remote port", "3000")} />
            <FormInputField
              layout="row"
              {...fieldProps("identityFile", 5, "Identity file (optional)", "~/.ssh/id_ed25519")}
            />
          </box>
        </box>
      )}
    />
  )
}
