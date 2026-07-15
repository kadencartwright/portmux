# Portmux

Portmux is a terminal UI for the “an agent just started a dev server on a remote machine” workflow. Save the
machines you use often, select one, and Portmux shows its listening TCP ports. Press Enter on a listener to make
it available on local loopback.

```text
remote devbox                         your machine

node listening on 0.0.0.0:3000  ->  http://127.0.0.1:3000
vite listening on 127.0.0.1:5173 ->  http://127.0.0.1:5173
```

It is built with [Effect](https://effect.website/), [OpenTUI](https://opentui.com/), PNPM, and Turborepo.

## How it works

The default screen is a two-pane browser:

- **Machines** contains the SSH destinations you want to keep handy.
- **Remote listeners** contains the selected machine's active TCP listening ports, with process and PID details
  when the remote operating system makes them available.

Portmux scans the selected machine immediately and refreshes it periodically. It prefers the listener's remote
port for the local port; when that local port is occupied, it asks the operating system for another available
loopback port. Starting a forward binds only to `127.0.0.1`.

Machines are durable. The forwards created from their live listeners are intentionally ad hoc: Portmux does not
automatically recreate one after its SSH master dies. An active forward does keep running when the TUI closes,
and Portmux can detect and manage it after reopening while that SSH master remains alive. This keeps a quick
developer workflow without turning old listener observations into a permanent connection policy.

Press `v` for the secondary forward manager. It shows Portmux-managed forwards and SSH forwarding processes
discovered on the local machine. You can also create a fully specified local forward there when the live
listener browser is not the right fit.

## SSH config aliases

When adding a machine, the SSH target can be a destination such as `kaden@example.com` or an alias from
`~/.ssh/config`. With the target field focused, press `Down` (or press Enter while it is empty) to open the alias
picker.

Portmux stores the selected alias itself. OpenSSH therefore continues to apply the alias's configured `HostName`,
`User`, `Port`, `ProxyJump`, identity files, and other options. Alias discovery follows statically resolvable,
unconditional `Include` directives, including those inside universally matching `Host` blocks or `Match all`.
Wildcard and negated patterns are not presented as concrete machines. Manual target entry always remains
available.

Discovery reads SSH configuration files directly. It does not run `ssh -G`, invoke a shell, or evaluate
`Match exec`. Target-dependent include tokens and other-user `~name` paths are skipped because they cannot be
resolved safely without more context. A missing or unreadable config file does not prevent manual entry.

## Requirements

- macOS or Linux (managed forwards also work on Windows; local process discovery currently requires `ps`)
- [Bun](https://bun.sh/) 1.3 or newer for OpenTUI's native renderer
- Node.js 22 or newer and [PNPM](https://pnpm.io/) 10 or newer for workspace tooling
- OpenSSH's `ssh` client
- Key- or agent-based authentication that works non-interactively
- One of `ss`, `lsof`, or `netstat` on each remote machine for listener discovery

Portmux uses `BatchMode=yes`; it never stores a password or passphrase and does not weaken SSH host-key checking.
Before adding a machine, make sure `ssh your-host` works with your agent, an identity file, or SSH configuration.
Listener discovery does not require `sudo`. Process names and PIDs are best effort and can be absent when the
remote command lacks permission to see them.

## Install and run

```bash
git clone https://github.com/kadencartwright/portmux.git
cd portmux
pnpm install
pnpm build
pnpm portmux
```

To make `portmux` available globally from this checkout:

```bash
pnpm link --global
portmux
```

## Keyboard controls

### Machine and listener browser

| Key | Action |
| --- | --- |
| `Up` / `Down`, `j` / `k` | Move within the focused pane |
| `Tab`, `Left` / `Right` | Move focus between machines and listeners |
| `Enter` | Start or stop the selected listener's ad-hoc local forward |
| `a` | Add a favorite machine |
| `d` | Remove the selected favorite machine after confirmation |
| `r` | Scan the selected machine now |
| `o` | Open the selected running local forward in a browser |
| `v` | Open the secondary forward manager |
| `q` | Close Portmux without closing active forwards |

Removing a favorite machine does not silently stop or delete its existing forwards. They remain available in the
forward manager until you stop or remove them explicitly.

### Forward manager

| Key | Action |
| --- | --- |
| `Up` / `Down`, `j` / `k` | Select a forward |
| `n` | Create a fully specified managed local forward |
| `Enter` or `s` | Start or stop the selected managed forward |
| `o` | Open the selected running forward in a browser |
| `d` | Stop and delete a managed forward |
| `x` | Stop a verified external SSH forwarding process on Linux, with confirmation |
| `r` | Refresh status and local process discovery |
| `v` or `Esc` | Return to machines and listeners |
| `q` | Close Portmux without closing active forwards |

In either add form, `Down` while the SSH target is focused—or Enter on an empty target—opens the SSH alias
picker.

## Persistence and architecture

Portmux does not run a daemon. It relies on OpenSSH control masters for the small amount of background lifetime
it needs:

1. The selected machine is scanned over a short-lived multiplexed SSH connection. Its idle control connection
   may be reused for up to 60 seconds.
2. Each active local forward has its own OpenSSH control master, which outlives the TUI.
3. On startup, Portmux checks its saved control sockets to hydrate live forward status. Ad-hoc forwards that are
   no longer live are shown as stopped and are not restarted automatically.

Favorite machines and forward metadata are stored in:

```text
${XDG_STATE_HOME:-~/.local/state}/portmux/tunnels.json
```

Control sockets live under `$XDG_RUNTIME_DIR/portmux`, or a short user-specific directory under the system temp
directory when `XDG_RUNTIME_DIR` is unavailable. Set `PORTMUX_HOME` to put both locations under a custom
directory; this is also useful for isolated tests.

State written by the original persistent-forward release is migrated to the machine-based schema on load. Its
existing tunnel IDs and settings are retained, and the original version-one JSON receives a private backup on
the first subsequent state write.

Only one Portmux TUI can own a state directory at a time. A private, stale-aware instance lock prevents two open
applications from overwriting the state file or racing on a control socket.

## Discovery and forwarding safety

Remote discovery uses a fixed, read-only command that selects `ss`, then `lsof`, then `netstat`. No machine name,
port, identity path, or other user-supplied value is interpolated into that command. Discovery SSH sessions clear
configured forwards and disable agent forwarding, X11 forwarding, local commands, and remote pseudo-terminals.
Output is bounded and parsed as untrusted data; only numeric IP addresses and valid TCP ports become selectable
listeners.

Wildcard remote listeners are forwarded through the corresponding remote loopback address (`127.0.0.1` or
`::1`) instead of exposing or guessing another interface. Every generated local forward binds to
`127.0.0.1`, so opening a remote dev server does not expose it to the local network.

SSH is always invoked with an argument array, never a shell-built command. Targets, ports, and identity paths are
validated. Managed forwards also disable agent forwarding, X11 forwarding, and local commands while preserving
normal SSH aliases and proxy configuration.

Local external-forward discovery is intentionally conservative. Portmux does not persist or replay a command it
did not create. On Linux it reads a same-user process's exact `/proc` argv and process start identity. Before
sending `SIGTERM`, it rechecks the executable, PID, start identity, exact arguments, and command fingerprint; any
change makes it refuse the signal. Lossy `ps` discovery on other platforms is display-only.

## Development

This is a PNPM workspace orchestrated by Turborepo:

```text
apps/portmux       OpenTUI React interface and Bun entry point
packages/core      Effect services, schemas, state, SSH lifecycle, and discovery
```

Useful commands:

```bash
pnpm dev            # watch and run the TUI
pnpm build          # Turbo build
pnpm test           # Vitest suite
pnpm typecheck      # TypeScript across all workspaces
pnpm lint           # Biome checks
pnpm format         # apply Biome formatting and safe fixes
pnpm fallow         # dead code, duplication, and health analysis
pnpm fallow:audit   # gate new Fallow findings
pnpm gitleaks       # full working-tree secret scan
pnpm check          # lint + typecheck + tests
```

Biome's `noExcessiveCognitiveComplexity` rule is an error with a maximum of 15. Fallow uses the same cognitive
complexity ceiling and gates new findings. [Lefthook](https://lefthook.dev/) is installed during `pnpm install`;
its pre-commit hook runs Biome on staged files, a Fallow audit of the change, and Gitleaks against staged content.

Install [Gitleaks](https://github.com/gitleaks/gitleaks) before committing:

```bash
brew install gitleaks               # macOS / Homebrew Linux
# or install the release binary for your platform
```

## Current scope

Portmux creates local (`ssh -L`) forwards because that is the direct dev-server use case. It lists TCP listeners,
not UDP sockets or outbound connections. It can observe external local, remote, and dynamic SSH forwards, but it
does not reconstruct or restart commands created elsewhere. Remote listener snapshots are advisory: a process
can stop or change between a scan and starting a forward, and Portmux surfaces the resulting SSH error.

## License

[MIT](./LICENSE)
