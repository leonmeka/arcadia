# Arcadia

A runtime for persistent AI agents.

## Install

```bash
npm install -g arcadia
```

Requires [Docker](https://www.docker.com/) and Node.js 20+.

## Quick start

```bash
arcadia create agent

arcadia enter agent
```

Inside the agent machine:

```bash
ask "Research AI coding startups"
status
journal
timeline
```

## Commands

### Arcadia CLI

| Command | Description |
|---------|-------------|
| `arcadia create <name>` | Create a persistent agent |
| `arcadia create <name> --from owner/repo/path` | Create from a Git template |
| `arcadia ls` | List agents |
| `arcadia enter <name>` | Enter an agent machine |
| `arcadia inspect <name>` | Show agent details |
| `arcadia stop <name>` | Stop an agent |
| `arcadia rm <name>` | Remove an agent |

### Agent commands (inside machine)

| Command | Description |
|---------|-------------|
| `ask "prompt"` | Send a task to the agent |
| `status` | Show agent status |
| `journal` | View or append to journal |
| `timeline` | View recent activity |

## Concepts

- **Agent** — A persistent AI resident with its own machine, memory, and home directory
- **Template** — A Git-hosted blueprint for creating agents
- **Workspace** — Shared filesystem at `/workspace` visible to every agent
- **Engine** — [OpenCode](https://opencode.ai) (MIT, 75+ providers). Agents run `opencode serve` locally; `ask` delegates to `opencode run`.

## Storage

Arcadia stores state on the filesystem:

```text
~/.arcadia/
  agents/
  config.yaml
```

Secrets are stored in platform-native secure storage (macOS Keychain, Linux Secret Service, Windows Credential Manager).

## Development

```bash
pnpm install
pnpm build           # builds all packages in dependency order

pnpm dev ls          # run the CLI from source
pnpm dev create researcher
pnpm dev enter researcher
```

## License

MIT
