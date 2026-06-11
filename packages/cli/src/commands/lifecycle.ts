import { spawnSync } from "node:child_process";
import {
  agentExists,
  agentHome,
  agentWorkspace,
  containerName,
  ensureDocker,
  getContainerState,
  pruneOrphanedAgent,
  removeContainer,
  startContainer,
  stopContainer,
  syncAgentScripts,
} from "@arcadia/core";

export async function summonCommand(name: string): Promise<void> {
  await ensureDocker();

  if (!(await agentExists(name))) {
    throw new Error(`Agent not found: ${name}`);
  }

  const state = await getContainerState(name);
  if (state === "missing") {
    await pruneOrphanedAgent(name);
    throw new Error(
      `Agent not found: ${name}. Create it again with: arcadia create ${name}`
    );
  }

  if (state !== "online") {
    await startContainer(name);
  }

  await syncAgentScripts(name);

  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("arcadia summon requires an interactive terminal.");
  }

  const home = agentHome(name);
  const workspace = agentWorkspace(name);
  const result = spawnSync(
    "docker",
    [
      "exec",
      "-it",
      "-w",
      workspace,
      "-u",
      name,
      "-e",
      `HOME=${home}`,
      "-e",
      `USER=${name}`,
      containerName(name),
      "/usr/local/bin/arcadia-shell",
    ],
    { stdio: "inherit", env: process.env }
  );

  if (result.error) {
    throw new Error(result.error.message);
  }

  process.exit(result.status ?? 1);
}

export async function restCommand(name: string): Promise<void> {
  await ensureDocker();

  if (!(await agentExists(name))) {
    throw new Error(`Agent not found: ${name}`);
  }

  await stopContainer(name);
  console.log(`${name} is at rest`);
}

export async function killCommand(name: string): Promise<void> {
  await ensureDocker();

  if (!(await agentExists(name))) {
    throw new Error(`Agent not found: ${name}`);
  }

  await removeContainer(name);
  await pruneOrphanedAgent(name);
  console.log(`Killed ${name}`);
}
