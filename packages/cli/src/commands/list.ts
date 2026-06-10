import type { ContainerState } from "@arcadia/types";
import {
  getContainerState,
  listAgentNames,
  readAgentConfig,
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

export async function lsCommand(): Promise<void> {
  const names = await listAgentNames();

  if (names.length === 0) {
    console.log("No agents yet. Create one with: arcadia create <name>");
    return;
  }

  const rows = await Promise.all(
    names.map(async (name) => {
      const state = await getContainerState(name);
      return { name, state: formatState(state) };
    })
  );

  const nameWidth = Math.max(...rows.map((r) => r.name.length), 4);

  for (const row of rows) {
    console.log(`${row.name.padEnd(nameWidth + 2)}${row.state}`);
  }
}

export async function inspectCommand(name: string): Promise<void> {
  const config = await readAgentConfig(name);
  const state = await getContainerState(name);

  console.log(`Name:      ${config.name}`);
  console.log(`State:     ${formatState(state)}`);
  console.log(`Template:  ${config.template}`);
  console.log(`Image:     ${config.image}`);
  console.log(`Model:     ${config.model}`);
  console.log(`Created:   ${config.createdAt}`);
  console.log(`Skills:    ${config.skills.join(", ") || "(none)"}`);
  console.log(`Packages:  ${config.packages.join(", ") || "(none)"}`);
}
