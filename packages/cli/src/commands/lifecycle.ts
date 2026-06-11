import { spawnSync } from "node:child_process";
import {
  agentExists,
  agentHome,
  agentWorkspace,
  containerName,
  ensureDocker,
  getContainerState,
  removeContainer,
  startContainer,
  stopContainer,
  syncAgentScripts,
} from "@arcadia/core";

async function ensureAgentAwake(name: string): Promise<void> {
  if (!(await agentExists(name))) {
    throw new Error(`Agent not found: ${name}`);
  }

  const state = await getContainerState(name);
  if (state === "missing") {
    throw new Error(
      `Agent not found: ${name}. Create it again with: arcadia create ${name}`
    );
  }

  if (state !== "online") {
    await startContainer(name);
  }

  await syncAgentScripts(name);
}

export async function summonCommand(name: string): Promise<void> {
  await ensureDocker();
  await ensureAgentAwake(name);
  console.log(`${name} is summoned`);
}

export async function enterCommand(name: string): Promise<void> {
  await ensureDocker();
  await ensureAgentAwake(name);

  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("arcadia enter requires an interactive terminal.");
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
  console.log(`Killed ${name}`);
}
