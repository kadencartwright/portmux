import { theme } from "../theme.js"

export interface FormInputFieldProps {
  readonly label: string
  readonly placeholder: string
  readonly value: string
  readonly focused: boolean
  readonly layout: "row" | "stack"
  readonly onInput: (value: string) => void
  readonly onSubmit: () => void
}

export const FormInputField = ({
  label,
  placeholder,
  value,
  focused,
  layout,
  onInput,
  onSubmit,
}: FormInputFieldProps) => (
  <box
    title={` ${label} `}
    style={{
      border: true,
      borderColor: focused ? theme.accent : theme.border,
      height: 3,
      ...(layout === "row" ? { flexGrow: 1 } : { width: "100%" }),
      paddingLeft: 1,
      paddingRight: 1,
    }}
  >
    <input
      placeholder={placeholder}
      value={value}
      focused={focused}
      onInput={onInput}
      onSubmit={onSubmit}
      style={{ textColor: theme.text, focusedBackgroundColor: theme.panel }}
    />
  </box>
)
