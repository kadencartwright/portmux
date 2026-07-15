import { useKeyboard } from "@opentui/react"
import { useCallback, useState } from "react"
import { useSshConfigHosts } from "../hooks/use-ssh-config-hosts.js"

export interface SshAliasFormOptions<Field extends string, Values extends Record<Field, string>> {
  readonly busy: boolean
  readonly fields: ReadonlyArray<Field>
  readonly initialValues: Values
  readonly sshTargetField: Field
  readonly onCancel: () => void
  readonly onSubmit: (values: Values) => Promise<boolean>
  readonly withSelectedHost: (values: Values, alias: string) => Values
}

const isEnterKey = (name: string): boolean =>
  name === "enter" || name === "return" || name === "linefeed" || name === "kpenter"

export const useSshAliasForm = <Field extends string, Values extends Record<Field, string>>({
  busy,
  fields,
  initialValues,
  sshTargetField,
  onCancel,
  onSubmit,
  withSelectedHost,
}: SshAliasFormOptions<Field, Values>) => {
  const [values, setValues] = useState<Values>(initialValues)
  const [focusedIndex, setFocusedIndex] = useState(0)
  const [choosingHost, setChoosingHost] = useState(false)
  const sshConfig = useSshConfigHosts()
  const sshTargetIndex = fields.indexOf(sshTargetField)

  const update = useCallback((field: Field, value: string) => {
    setValues((current) => ({ ...current, [field]: value }))
  }, [])

  const submit = useCallback(async () => {
    if (busy) {
      return
    }
    const created = await onSubmit(values)
    if (created) {
      onCancel()
    }
  }, [busy, onCancel, onSubmit, values])

  const selectHost = useCallback(
    (alias: string) => {
      setValues((current) => withSelectedHost(current, alias))
      setChoosingHost(false)
      setFocusedIndex(sshTargetIndex + 1)
    },
    [sshTargetIndex, withSelectedHost],
  )

  useKeyboard((key) => {
    if (choosingHost) {
      if (key.name === "escape") {
        key.preventDefault()
        setChoosingHost(false)
        setFocusedIndex(sshTargetIndex)
      }
      return
    }
    if (key.name === "escape") {
      onCancel()
      return
    }
    const targetFocused = focusedIndex === sshTargetIndex
    const enterOnEmptyTarget = isEnterKey(key.name) && values[sshTargetField].length === 0
    if (targetFocused && sshConfig.hosts.length > 0 && (key.name === "down" || enterOnEmptyTarget)) {
      key.preventDefault()
      setChoosingHost(true)
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
    setFocusedIndex(index + 1)
  }

  const fieldProps = (field: Field, index: number, label: string, placeholder: string) => ({
    label,
    placeholder,
    value: values[field],
    focused: focusedIndex === index,
    onInput: (value: string) => update(field, value),
    onSubmit: () => onFieldSubmit(index),
  })

  return {
    choosingHost,
    fieldProps,
    selectHost,
    sshConfig,
  }
}
