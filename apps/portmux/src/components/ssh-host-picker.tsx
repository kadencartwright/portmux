import type { SshConfigHost } from "@portmux/core"
import { theme } from "../theme.js"

interface SshHostPickerProps {
  readonly hosts: ReadonlyArray<SshConfigHost>
  readonly onSelect: (alias: string) => void
}

export const SshHostPicker = ({ hosts, onSelect }: SshHostPickerProps) => (
  <box
    title=" SSH config hosts "
    style={{
      border: true,
      borderColor: theme.accent,
      flexDirection: "column",
      flexGrow: 1,
      padding: 1,
    }}
  >
    <text
      content={`${hosts.length} concrete alias${hosts.length === 1 ? "" : "es"} · OpenSSH settings remain attached to the alias`}
      style={{ fg: theme.muted }}
    />
    <select
      focused
      options={hosts.map((host) => ({
        name: host.alias,
        description: host.source,
        value: host.alias,
      }))}
      showDescription={false}
      showScrollIndicator
      wrapSelection
      keyBindings={[{ name: "kpenter", action: "select-current" }]}
      onSelect={(_index, option) => {
        if (typeof option?.value === "string") {
          onSelect(option.value)
        }
      }}
      style={{
        flexGrow: 1,
        width: "100%",
        backgroundColor: theme.background,
        focusedBackgroundColor: theme.background,
        textColor: theme.text,
        focusedTextColor: theme.text,
        selectedBackgroundColor: theme.panel,
        selectedTextColor: theme.accent,
        descriptionColor: theme.muted,
        selectedDescriptionColor: theme.muted,
      }}
    />
    <text content="↑↓/jk choose · Enter use alias · Esc return to manual entry" style={{ fg: theme.muted }} />
  </box>
)
