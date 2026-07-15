# Portmux

Portmux is a small terminal UI for creating and managing persistent SSH local port forwards. It is built with
[Effect](https://effect.website/), [OpenTUI](https://opentui.com/), PNPM, and Turborepo.

It is aimed at the common “a dev server is running on a remote box; let me open it locally” workflow:

```text
http://127.0.0.1:3000  →  devbox  →  127.0.0.1:3000
```

## What it does

- Creates local SSH forwards from a short form.
- Starts each forward as an OpenSSH control master in the background.
- Persists definitions and desired state across Portmux restarts.
- Rehydrates live status through OpenSSH control sockets when the TUI opens.
- Reconciles a desired-but-missing forward when Portmux opens again.
- Opens a running forward in the default browser.
- Discovers `ssh -L`, `ssh -R`, and `ssh -D` processes started outside Portmux.
- On Linux, can stop a discovered process after re-verifying its executable, start identity, exact argv, PID,
  and command fingerprint. Other platforms show discovered forwards as observe-only.

Portmux does not need its own daemon. OpenSSH already has the right primitive: `ControlMaster` plus
`ControlPersist`. Closing the TUI leaves the SSH master alive, while `ssh -O check` and `ssh -O exit` provide
safe lifecycle control later.

## Requirements

- macOS or Linux (managed forwards also work on Windows; external-process discovery currently requires `ps`)
- [Bun](https://bun.sh/) 1.3 or newer — OpenTUI's native renderer uses Bun
- [PNPM](https://pnpm.io/) 10 or newer
- OpenSSH's `ssh` client
- Key- or agent-based authentication that works non-interactively

Portmux intentionally uses `BatchMode=yes`. It never stores passwords or passphrases and does not weaken SSH
host-key checking. Make sure `ssh your-host` works with your SSH agent, an identity file, or `~/.ssh/config`
before creating a forward.

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

The form accepts an SSH config alias such as `devbox` or a destination such as `kaden@example.com`. New
forwards bind to `127.0.0.1` so a development server is not accidentally exposed to the local network. The
remote destination defaults to `127.0.0.1` because it is interpreted on the remote machine.

## Keys

| Key | Action |
| --- | --- |
| `↑` / `↓`, `j` / `k` | Select a forward |
| `n` | Create a managed local forward |
| `Enter` or `s` | Start or stop the selected managed forward |
| `o` | Open the selected running forward in a browser |
| `d` | Stop and delete a managed forward |
| `x` | Stop a verified external SSH forwarding process on Linux, with confirmation |
| `r` | Refresh status and process discovery |
| `q` | Close Portmux without closing managed forwards |

## Persistence and safety

Definitions are stored in:

```text
${XDG_STATE_HOME:-~/.local/state}/portmux/tunnels.json
```

Control sockets live under `$XDG_RUNTIME_DIR/portmux`, or a short user-specific directory under the system temp
directory when `XDG_RUNTIME_DIR` is unavailable. Set `PORTMUX_HOME` to put both under a custom directory; this is
also useful for isolated tests.

SSH is invoked with an argument array, never a shell string. Host names, ports, and identity paths are validated;
the identity path is the only authentication metadata persisted. Managed forwards disable agent forwarding, X11
forwarding, and local commands. SSH config aliases and proxy settings still work normally.

External process discovery is intentionally conservative. Portmux does not persist or replay a command it did
not create. Linux discovery reads the same-user process's exact `/proc` argv, ignores anything after the SSH
destination, and verifies the OpenSSH executable plus process start identity. Before sending `SIGTERM`, it reads
everything again and requires it to match the item confirmed in the UI. If anything changed, Portmux refuses to
signal it. Lossy `ps` discovery on other platforms is display-only.

Only one Portmux TUI can own the state directory at a time. A private, stale-aware instance lock prevents two
open applications from overwriting the state file or racing on a control socket.

## Development

This is a PNPM workspace with an OpenTUI application and an Effect-based core package:

```text
apps/portmux       OpenTUI React interface and Bun entry point
packages/core      schemas, state store, SSH lifecycle, and discovery
```

Useful commands:

```bash
pnpm dev            # watch and run the TUI
pnpm build          # Turbo build
pnpm test           # Vitest suite
pnpm typecheck      # TypeScript across all workspaces
pnpm lint           # Biome checks
pnpm fallow         # dead code, duplication, and health analysis
pnpm gitleaks       # full working-tree secret scan
pnpm check          # lint + typecheck + tests
```

Biome's `noExcessiveCognitiveComplexity` rule is an error with a maximum of 15. Fallow uses the same cognitive
complexity ceiling and gates new findings. [Lefthook](https://lefthook.dev/) installs a pre-commit hook during
`pnpm install`; the hook runs Biome on staged files, a Fallow audit of the change, and Gitleaks on staged content.

Install [Gitleaks](https://github.com/gitleaks/gitleaks) before committing:

```bash
brew install gitleaks               # macOS / Homebrew Linux
# or install the release binary for your platform
```

## Current scope

Portmux creates local (`-L`) forwards because that is the direct dev-server use case. It detects external local,
remote, and dynamic forwards, but it does not try to reconstruct or restart commands created elsewhere. A
forward uses non-interactive authentication and one isolated SSH master; network loss is visible on the next
refresh and a desired tunnel is retried when Portmux is opened again.

## License

[MIT](./LICENSE)
