import type { ContainerState } from "@arcadia/types";
import {
  agentExists,
  getContainerState,
  listAgentNames,
  readAgentConfig,
  resolveTemplateName,
  resolveAgentIdentity,
} from "@arcadia/core";

function formatState(state: ContainerState): string {
  switch (state) {
    case "online":
      return "online";
    case "idle":
    case "stopped":
      return "idle";
    default:
      return "missing";
  }
}

export async function listCommand(): Promise<void> {
  const names = await listAgentNames();

  if (names.length === 0) {
    console.log("No agents yet. Create one with: arcadia create <name>");
    return;
  }

  const rows: { name: string; state: string }[] = [];

  for (const name of names) {
    const state = await getContainerState(name);
    rows.push({ name, state: formatState(state) });
  }

  const nameWidth = Math.max(...rows.map((r) => r.name.length), 4);

  for (const row of rows) {
    console.log(`${row.name.padEnd(nameWidth + 2)}${row.state}`);
  }
}

export async function inspectCommand(name: string): Promise<void> {
  if (!(await agentExists(name))) {
    throw new Error(`Agent not found: ${name}`);
  }

  const state = await getContainerState(name);
  const config = await readAgentConfig(name);
  const templateName = resolveTemplateName(config);
  const identity =
    config.identity ??
    resolveAgentIdentity({
      name: templateName,
      source: config.template,
      model: config.model,
      skills: [],
      packages: [],
      secrets: { required: [] },
    });

  console.log(`Name:      ${config.name}`);
  console.log(`State:     ${formatState(state)}`);
  console.log(`Identity:  ${identity.name}`);
  console.log(`Mood:      ${identity.mood}`);
  console.log(`Template:  ${config.template}`);
  console.log(`Image:     ${config.image}`);
  console.log(`Model:     ${config.model}`);
  console.log(`Created:   ${config.createdAt}`);
  console.log(`Skills:    ${config.skills.join(", ") || "(none)"}`);
  console.log(`Packages:  ${config.packages.join(", ") || "(none)"}`);
  if (identity.properties.length > 0) {
    console.log("Traits:");
    for (const property of identity.properties) {
      console.log(`  - ${property}`);
    }
  }
}
