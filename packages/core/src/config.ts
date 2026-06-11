import { readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { AgentConfig } from "@arcadia/types";
import { agentContainerConfigPath } from "@/paths";
import { parseAgentIdentity } from "@/identity";
import {
  containerExists,
  listArcadiaAgentNames,
  readContainerFile,
  writeContainerFile,
} from "@/docker";

export function resolveTemplateName(config: AgentConfig): string {
  if (config.templateName) {
    return config.templateName;
  }

  if (config.template.startsWith("github:")) {
    const path = config.template.slice("github:".length);
    const parts = path.split("/").filter(Boolean);
    return parts[parts.length - 1] ?? parts[1] ?? "default";
  }

  return config.template.replace(/^local:/, "").split("/")[0] ?? "default";
}

function parseAgentConfig(raw: string): AgentConfig {
  const config = JSON.parse(raw) as AgentConfig & { identity?: unknown };
  const templateName = resolveTemplateName(config);

  if (config.identity != null && typeof config.identity === "string") {
    config.identity = parseAgentIdentity(config.identity, templateName);
  }

  return config;
}

function legacyHostConfigPath(name: string): string {
  return join(homedir(), ".arcadia", "agents", name, "config.json");
}

async function migrateLegacyHostConfig(name: string): Promise<void> {
  const legacyPath = legacyHostConfigPath(name);
  if (!existsSync(legacyPath)) return;

  const raw = await readFile(legacyPath, "utf8");
  await writeContainerFile(name, agentContainerConfigPath(name), raw);
  await rm(join(homedir(), ".arcadia", "agents", name), {
    recursive: true,
    force: true,
  });
}

export async function readAgentConfig(name: string): Promise<AgentConfig> {
  const path = agentContainerConfigPath(name);
  try {
    const raw = await readContainerFile(name, path);
    return parseAgentConfig(raw);
  } catch {
    await migrateLegacyHostConfig(name);
    const raw = await readContainerFile(name, path);
    return parseAgentConfig(raw);
  }
}

export async function listAgentNames(): Promise<string[]> {
  return listArcadiaAgentNames();
}

export async function agentExists(name: string): Promise<boolean> {
  return containerExists(name);
}
