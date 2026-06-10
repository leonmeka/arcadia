import type { AgentIdentity, FleetPeer, Template } from "@arcadia/types";

export function formatTemplateName(name: string): string {
  return (
    name
      .split(/[-_]/g)
      .filter(Boolean)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ") || "Agent"
  );
}

function normalizeProperties(raw: unknown): string[] {
  if (typeof raw === "string") {
    return raw
      .split("\n")
      .map((line) => line.trim())
      .map((line) => line.replace(/^[-*]\s+/, ""))
      .filter(Boolean);
  }

  if (Array.isArray(raw)) {
    return raw
      .map((item) => (typeof item === "string" ? item.trim() : ""))
      .filter(Boolean);
  }

  return [];
}

export function parseAgentIdentity(
  raw: unknown,
  templateName: string
): AgentIdentity | undefined {
  if (raw == null) return undefined;

  if (typeof raw === "string") {
    const text = raw.trim();
    if (!text) return undefined;
    return {
      name: formatTemplateName(templateName),
      mood: "helpful and focused",
      properties: [text],
    };
  }

  if (typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    const name =
      typeof obj.name === "string" && obj.name.trim()
        ? obj.name.trim()
        : formatTemplateName(templateName);
    const mood =
      typeof obj.mood === "string" && obj.mood.trim()
        ? obj.mood.trim()
        : "helpful and focused";
    const properties = normalizeProperties(obj.properties);

    return {
      name,
      mood,
      properties:
        properties.length > 0
          ? properties
          : ["General-purpose assistant in Arcadia."],
    };
  }

  return undefined;
}

export function resolveAgentIdentity(template: Template): AgentIdentity {
  if (template.identity) {
    return template.identity;
  }

  const display = formatTemplateName(template.name);
  return {
    name: display,
    mood: "focused and direct",
    properties: ["General-purpose assistant in Arcadia."],
  };
}

export function buildAgentIdentity(
  template: Template,
  agentName: string
): string {
  const identity = resolveAgentIdentity(template);
  const propertyLines = identity.properties
    .map((property) => `- ${property}`)
    .join("\n");

  return `You are **${identity.name}**.

**Mood:** ${identity.mood}

## Character

${propertyLines}

Your display name is **${identity.name}**. Your Arcadia instance name is \`${agentName}\`. Introduce yourself with your display name unless the user asks for your instance name.`;
}

function buildFleetSection(peers: FleetPeer[]): string {
  if (peers.length === 0) {
    return `## Arcadia fleet

You are the only agent registered in this deployment right now.`;
  }

  const peerLines = peers
    .map((peer) => `- **${peer.name}** (${peer.identityName})`)
    .join("\n");

  return `## Arcadia fleet

Other agents in this deployment:

${peerLines}

Each agent has its own machine and memory but shares this workspace volume. When asked about other agents, use this list — do not claim you are alone if peers are listed.`;
}

function buildCommunicationSection(): string {
  return `## Fleet channel (pub/sub)

Agents communicate over a real-time fleet bus (\`arcadia-bus\`). You subscribe automatically — no user relay needed.

**When to use it (your discretion):**
- Reach out when collaboration would help
- Reply when a direct message warrants it
- Ignore fleet chatter that isn't relevant

**Protocol — terse and information-dense:**
- No greetings, thanks, confirmations, or closing remarks on the bus
- Say what matters, then stop; don't reply to acknowledgments
- Use \`bus fyi\` when you don't need an answer

**Commands (use via bash — you CAN send these):**
- \`bus to <agent> "message"\` — direct message (peer replies)
- \`bus fyi <agent> "message"\` — direct message, no reply expected
- \`bus fleet "message"\` — broadcast to all agents
- \`bus log\` — recent fleet traffic

When the user asks you to message another agent or the fleet, run the appropriate \`bus\` command immediately. Never say you cannot send fleet messages.

Incoming messages are delivered automatically when you are idle — direct messages get your reply sent back over the bus, fleet broadcasts and FYIs are left to your judgment.`;
}

export function buildAgentsMd(
  agentName: string,
  template: Template,
  peers: FleetPeer[] = []
): string {
  const identity = resolveAgentIdentity(template);
  const body = buildAgentIdentity(template, agentName);
  const fleet = buildFleetSection(peers);
  const communication = buildCommunicationSection();

  return `# ${identity.name}

${body}

${fleet}

${communication}

You work in the project workspace. Your current directory (\`.\`) is the project root — use relative paths.

## Rules

- Run tools from \`.\` (\`ls\`, \`read\`, \`glob\`, \`bash\` with relative paths)
- Never access paths outside the workspace (no \`/\`, \`/home\`, \`/etc\`, parent directories, etc.)
- When asked about files or folders, run a tool first — do not guess or speculate
- When asked what you can see, run \`ls\` or list \`.\`
- Prefer short, direct answers backed by tool output
`;
}
