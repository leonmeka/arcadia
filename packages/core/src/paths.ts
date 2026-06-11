import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export const WORKSPACE_VOLUME = "arcadia-workspace";

export const PACKAGE_ROOT = join(
  dirname(fileURLToPath(import.meta.url)),
  ".."
);
export const AGENT_SCRIPTS_DIR = join(PACKAGE_ROOT, "agent");

export const CONTAINER_LABEL = "arcadia.agent";
export const CONTAINER_PREFIX = "arcadia-";

export const DEFAULT_IMAGE = "debian:bookworm-slim";

export function containerName(name: string): string {
  return `${CONTAINER_PREFIX}${name}`;
}

export function agentHome(name: string): string {
  return `/home/${name}`;
}

export function agentWorkspace(name: string): string {
  return `${agentHome(name)}/workspace`;
}

export function agentAgentDir(name: string): string {
  return `${agentHome(name)}/.agent`;
}

export function agentContainerConfigPath(name: string): string {
  return `${agentAgentDir(name)}/config.yaml`;
}

export function agentAgentsMdPath(name: string): string {
  return `${agentAgentDir(name)}/AGENTS.md`;
}

export function agentMemoryPath(name: string): string {
  return `${agentAgentDir(name)}/MEMORY.md`;
}

export function sharedMemoryPath(name: string): string {
  return `${agentWorkspace(name)}/.arcadia/MEMORY.md`;
}
