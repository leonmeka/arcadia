import { spawnSync } from "node:child_process";
import { rm } from "node:fs/promises";
import {
  agentDir,
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

export async function enterCommand(name: string): Promise<void> {
  await ensureDocker();

  if (!(await agentExists(name))) {
    throw new Error(`Agent not found: ${name}`);
  }

  const state = await getContainerState(name);
  if (state === "missing") {
    throw new Error(
      `Agent container missing: ${name}. Try recreating the agent.`
    );
  }

  if (state !== "online") {
    await startContainer(name);
  }

  await syncAgentScripts(name);

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

export async function stopCommand(name: string): Promise<void> {
  await ensureDocker();

  if (!(await agentExists(name))) {
    throw new Error(`Agent not found: ${name}`);
  }

  await stopContainer(name);
  console.log(`Stopped ${name}`);
}

export async function rmCommand(name: string): Promise<void> {
  await ensureDocker();

  if (!(await agentExists(name))) {
    throw new Error(`Agent not found: ${name}`);
  }

  await removeContainer(name);
  await rm(agentDir(name), { recursive: true, force: true });
  console.log(`Removed ${name}`);
}
