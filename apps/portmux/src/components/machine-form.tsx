import type { MachineDraft } from "@portmux/core"
import { theme } from "../theme.js"
import { FormInputField } from "./form-input-field.js"
import { SshAliasForm } from "./ssh-alias-form.js"

type Field = "name" | "sshTarget" | "identityFile"

interface FormValues {
  readonly name: string
  readonly sshTarget: string
  readonly identityFile: string
}

interface MachineFormProps {
  readonly busy: boolean
  readonly onCancel: () => void
  readonly onCreate: (draft: MachineDraft) => Promise<boolean>
}

const fields: ReadonlyArray<Field> = ["name", "sshTarget", "identityFile"]

const initialValues: FormValues = { name: "", sshTarget: "", identityFile: "" }

const hostHint = (status: "loading" | "ready" | "failed", count: number): string => {
  if (status === "loading") {
    return "Loading SSH config hosts…"
  }
  if (status === "failed") {
    return "SSH config unavailable · a manual target still works"
  }
  return count > 0
    ? `SSH target ↓ browses ${count} config alias${count === 1 ? "" : "es"}`
    : "No concrete SSH aliases found"
}

const toDraft = (values: FormValues): MachineDraft => ({
  name: values.name,
  sshTarget: values.sshTarget,
  ...(values.identityFile.trim() ? { identityFile: values.identityFile } : {}),
})

const withSelectedHost = (values: FormValues, alias: string): FormValues => ({
  ...values,
  name: values.name.trim() ? values.name : alias,
  sshTarget: alias,
})

export const MachineForm = ({ busy, onCancel, onCreate }: MachineFormProps) => {
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
          title=" Add favorite machine "
          style={{
            border: true,
            borderColor: theme.accent,
            flexDirection: "column",
            flexGrow: 1,
            padding: 1,
            gap: 0,
          }}
        >
          <text
            content="Save the SSH target; listening ports are discovered when you select it."
            style={{ fg: theme.text }}
          />
          <text content={hostHint(sshConfig.status, sshConfig.hosts.length)} style={{ fg: theme.muted }} />
          <FormInputField layout="stack" {...fieldProps("name", 0, "Name", "agent devbox")} />
          <FormInputField
            layout="stack"
            {...fieldProps("sshTarget", 1, "SSH target", "devbox or user@host")}
          />
          <FormInputField
            layout="stack"
            {...fieldProps("identityFile", 2, "Identity file (optional)", "~/.ssh/id_ed25519")}
          />
        </box>
      )}
    />
  )
}
