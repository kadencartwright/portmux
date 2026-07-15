import { useKeyboard } from "@opentui/react"
import type { TunnelDraft } from "@portmux/core"
import { useCallback, useState } from "react"
import { theme } from "../theme.js"

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
  readonly notice: string
  readonly onCancel: () => void
  readonly onCreate: (draft: TunnelDraft) => Promise<boolean>
}

interface InputFieldProps {
  readonly label: string
  readonly placeholder: string
  readonly focused: boolean
  readonly onInput: (value: string) => void
  readonly onSubmit: () => void
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

const InputField = ({ label, placeholder, focused, onInput, onSubmit }: InputFieldProps) => (
  <box
    title={` ${label} `}
    style={{
      border: true,
      borderColor: focused ? theme.accent : theme.border,
      height: 3,
      flexGrow: 1,
      paddingLeft: 1,
      paddingRight: 1,
    }}
  >
    <input
      placeholder={placeholder}
      focused={focused}
      onInput={onInput}
      onSubmit={onSubmit}
      style={{ textColor: theme.text, focusedBackgroundColor: theme.panel }}
    />
  </box>
)

const toDraft = (values: FormValues): TunnelDraft => ({
  name: values.name,
  sshTarget: values.sshTarget,
  bindHost: "127.0.0.1",
  localPort: Number.parseInt(values.localPort, 10),
  remoteHost: values.remoteHost || "127.0.0.1",
  remotePort: Number.parseInt(values.remotePort, 10),
  ...(values.identityFile.trim() ? { identityFile: values.identityFile } : {}),
})

export const CreateForm = ({ busy, notice, onCancel, onCreate }: CreateFormProps) => {
  const [values, setValues] = useState<FormValues>(initialValues)
  const [focusedIndex, setFocusedIndex] = useState(0)

  const update = useCallback((field: Field, value: string) => {
    setValues((current) => ({ ...current, [field]: value }))
  }, [])

  const advance = useCallback(() => {
    setFocusedIndex((current) => (current + 1) % fields.length)
  }, [])

  const submit = useCallback(async () => {
    if (busy) {
      return
    }
    const created = await onCreate(toDraft(values))
    if (created) {
      onCancel()
    }
  }, [busy, onCancel, onCreate, values])

  useKeyboard((key) => {
    if (key.name === "escape") {
      onCancel()
      return
    }
    if (key.name === "tab") {
      setFocusedIndex((current) =>
        key.shift ? (current - 1 + fields.length) % fields.length : (current + 1) % fields.length,
      )
    }
  })

  const onFieldSubmit = (index: number) => {
    if (index === fields.length - 1) {
      void submit()
      return
    }
    advance()
  }

  const fieldProps = (field: Field, index: number, label: string, placeholder: string) => ({
    label,
    placeholder,
    focused: focusedIndex === index,
    onInput: (value: string) => update(field, value),
    onSubmit: () => onFieldSubmit(index),
  })

  return (
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
        content="Binds locally to 127.0.0.1 · use an SSH config alias or user@host"
        style={{ fg: theme.muted }}
      />
      <box style={{ width: "100%", height: 3, flexDirection: "row", gap: 1 }}>
        <InputField {...fieldProps("name", 0, "Name", "docs server")} />
        <InputField {...fieldProps("sshTarget", 1, "SSH target", "devbox or user@host")} />
      </box>
      <box style={{ width: "100%", height: 3, flexDirection: "row", gap: 1 }}>
        <InputField {...fieldProps("localPort", 2, "Local port", "3000")} />
        <InputField {...fieldProps("remoteHost", 3, "Remote host", "127.0.0.1")} />
      </box>
      <box style={{ width: "100%", height: 3, flexDirection: "row", gap: 1 }}>
        <InputField {...fieldProps("remotePort", 4, "Remote port", "3000")} />
        <InputField {...fieldProps("identityFile", 5, "Identity file (optional)", "~/.ssh/id_ed25519")} />
      </box>
      <text
        content={busy ? "Starting SSH control master…" : notice}
        style={{ fg: busy ? theme.warning : theme.muted }}
      />
      <text
        content="Tab next · Shift+Tab previous · Enter advance/create · Esc cancel"
        style={{ fg: theme.muted }}
      />
    </box>
  )
}
