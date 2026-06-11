import type { AgentIdentity, Template } from "@arcadia/types";

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

export const DEFAULT_PRIVATE_MEMORY = `# Private memory

Curated facts, preferences, and ongoing threads for this agent only.
Update when the user shares something worth remembering across sessions.
`;

export const DEFAULT_SHARED_MEMORY = `# Shared memory

Facts and decisions for all agents using this workspace.
Write here when something should be visible to every agent.
`;

export function buildAgentsMd(agentName: string, template: Template): string {
  const identity = resolveAgentIdentity(template);
  const body = buildAgentIdentity(template, agentName);

  return `# ${identity.name}

${body}

## Memory

You have persistent memory loaded on every prompt:

- **Private** — \`~/.agent/MEMORY.md\` (container-local; never visible to other agents)
- **Shared** — \`.arcadia/MEMORY.md\` in the workspace (visible to all agents)

Conversation history continues across prompts in the same session.

When the user asks you to remember something, you MUST persist it — never refuse:
- Personal preference or private context → \`memory add "fact"\` (or edit \`~/.agent/MEMORY.md\`)
- Project fact or decision for all agents → \`memory shared add "fact"\` (or edit \`.arcadia/MEMORY.md\`)

Never store private facts in the workspace. Keep memory terse and factual.

You work in the project workspace. Your current directory (\`.\`) is the project root — use relative paths.

## Rules

- Run tools from \`.\` (\`ls\`, \`read\`, \`glob\`, \`bash\` with relative paths)
- Do not access paths outside the workspace except \`~/.agent/\` for your private memory
- When asked about files or folders, run a tool first — do not guess or speculate
- When asked what you can see, run \`ls\` or list \`.\`
- Prefer short, direct answers backed by tool output
`;
}
