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

arcadia summon agent    # start and sync
arcadia enter agent     # interactive shell
```

Inside the agent (`enter`), input is shell by default. Prefix with `@` to talk to the agent. While it works, you'll see live feedback for every step, tool call, and response:

```bash
ls
git status
@What files do you have access to?
status
timeline
memory
```

## Commands

### Arcadia CLI

| Command | Description |
|---------|-------------|
| `arcadia create <name>` | Create a persistent agent |
| `arcadia create <name> --template <id>` | Create from a built-in template |
| `arcadia list` | List agents |
| `arcadia summon <name>` | Summon an agent (start and sync) |
| `arcadia enter <name>` | Enter an agent (interactive shell) |
| `arcadia inspect <name>` | Show agent details |
| `arcadia rest <name>` | Put an agent to rest |
| `arcadia kill <name>` | Kill an agent |

### Agent commands (inside machine)

| Input | Description |
|-------|-------------|
| shell commands (`ls`, `git`, …) | Run normally (default) |
| `@ text` | Send to the agent via OpenCode |
| `status` | Show agent status |
| `memory` | View or update curated memory (`memory shared` for workspace) |
| `timeline` | View recent activity log |

## Concepts

- **Agent** — A persistent AI resident with its own machine, memory, and home directory
- **Template** — TypeScript blueprint for creating agents, defined in `@arcadia/templates`
- **Workspace** — Shared project files at `~/workspace` inside each agent machine
- **Engine** — [OpenCode](https://opencode.ai) (MIT, 75+ providers). The agent shell routes natural language to OpenCode; everything else runs as normal shell commands.
- **Network** — Agents have full outbound internet (web fetch, search, `curl`, `git`, package installs). The workspace jail applies to filesystem paths only.

### Inside an agent machine

```text
/home/<agent>/
  workspace/     project files (shared across agents via Docker volume)
  .agent/        config.json, MEMORY.md, session, activity log
  .config/       engine config
```

Your shell is jailed to `~/workspace`. Private memory lives in `~/.agent/MEMORY.md` (container-local, not shared with other agents). Shared memory lives in `workspace/.arcadia/MEMORY.md`. Both are loaded on every prompt. Conversation history continues via OpenCode session continuity.

## Storage

Each agent is a Docker container. Agent config lives at `~/.agent/config.json` inside the container. The shared workspace uses the `arcadia-workspace` Docker volume.

API keys are stored in platform-native secure storage (macOS Keychain, Linux Secret Service, Windows Credential Manager) and injected into the container at create time. Agents use [OpenRouter](https://openrouter.ai) — set `OPENROUTER_API_KEY` when prompted. Models must be OpenRouter IDs that support tool calling (validated at create time).

### Templates and models

Built-in templates are one file per template in `packages/templates/src/`. Register new ones in `packages/core/src/templates/registry.ts`. External templates can live in any GitHub repo — point at them with `--template owner/repo`. See `packages/templates/README.md`.

```bash
arcadia create my-agent                              # uses the default template
arcadia create my-agent --model anthropic/claude-sonnet-4
arcadia create my-agent --template default           # explicit built-in template
arcadia create my-agent --template owner/repo        # GitHub template repo
arcadia create my-agent --template owner/repo@main   # specific branch
```

`--model` accepts any [OpenRouter model ID](https://openrouter.ai/models) that supports tools. Chat-only models are rejected because agents need tool calling.

### Permissions

`@` prompts run through OpenCode with the permission policy in `~/.config/opencode/opencode.json` inside the agent. The workspace shell is jailed to `~/workspace`; OpenCode tools follow the configured read/edit/bash rules.

## Development

```bash
pnpm install
pnpm build           # builds all packages in dependency order

pnpm dev list        # run the CLI from source
pnpm dev create researcher
pnpm dev enter researcher
```

## License

MIT
