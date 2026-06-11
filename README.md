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

arcadia summon agent
```

Inside the agent machine, type naturally; shell commands and prompts are routed automatically. While the agent works, you'll see live feedback for every step, tool call, and response:

```bash
ls
git status
What files do you have access to?
status
timeline
memory
```

Prefix with `!` to force a shell command (`!help`) or `:` to force a prompt (`: ls -la`).

## Commands

### Arcadia CLI

| Command | Description |
|---------|-------------|
| `arcadia create <name>` | Create a persistent agent |
| `arcadia create <name> --from owner/repo/path` | Create from a Git template |
| `arcadia list` | List agents |
| `arcadia summon <name>` | Summon an agent |
| `arcadia inspect <name>` | Show agent details |
| `arcadia rest <name>` | Put an agent to rest |
| `arcadia kill <name>` | Kill an agent |

### Agent commands (inside machine)

| Input | Description |
|-------|-------------|
| natural language | Sent to the agent via OpenCode |
| shell commands (`ls`, `git`, …) | Run normally |
| `status` | Show agent status |
| `memory` | View or update curated memory (`memory shared` for workspace) |
| `timeline` | View recent activity log |
| `!cmd` | Force shell command |
| `: text` | Force agent prompt |

## Concepts

- **Agent** — A persistent AI resident with its own machine, memory, and home directory
- **Template** — A Git-hosted blueprint for creating agents
- **Workspace** — Shared project files at `~/workspace` inside each agent machine
- **Engine** — [OpenCode](https://opencode.ai) (MIT, 75+ providers). The agent shell routes natural language to OpenCode; everything else runs as normal shell commands.

### Inside an agent machine

```text
/home/<agent>/
  workspace/     project files (shared across agents via Docker volume)
  .agent/        MEMORY.md, session, activity log
  .config/       engine config
```

Your shell is jailed to `~/workspace`. Private memory lives in `~/.agent/MEMORY.md` (container-local, not shared with other agents). Shared memory lives in `workspace/.arcadia/MEMORY.md`. Both are loaded on every prompt. Conversation history continues via OpenCode session continuity.

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

pnpm dev list        # run the CLI from source
pnpm dev create researcher
pnpm dev summon researcher
```

## License

MIT
