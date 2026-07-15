import type { ReactNode } from "react"
import { SshHostPicker } from "./ssh-host-picker.js"
import { type SshAliasFormOptions, useSshAliasForm } from "./use-ssh-alias-form.js"

interface SshAliasFormProps<Field extends string, Values extends Record<Field, string>>
  extends SshAliasFormOptions<Field, Values> {
  readonly render: (state: ReturnType<typeof useSshAliasForm<Field, Values>>) => ReactNode
}

export const SshAliasForm = <Field extends string, Values extends Record<Field, string>>(
  props: SshAliasFormProps<Field, Values>,
) => {
  const state = useSshAliasForm(props)
  if (state.choosingHost) {
    return <SshHostPicker hosts={state.sshConfig.hosts} onSelect={state.selectHost} />
  }
  return props.render(state)
}
