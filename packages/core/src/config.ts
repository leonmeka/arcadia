import { readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import yaml from "js-yaml";
import type { AgentConfig } from "@arcadia/types";
import { agentContainerConfigPath } from "./paths.js";
import { parseAgentIdentity } from "./identity.js";
import {
  containerExists,
  listArcadiaAgentNames,
  readContainerFile,
  writeContainerFile,
} from "./docker.js";

function parseAgentConfig(raw: string): AgentConfig {
  const config = yaml.load(raw) as AgentConfig & { identity?: unknown };
  const templateName =
    config.templateName ??
    config.template?.replace(/^local:/, "").split("/")[0] ??
    "default";

  if (config.identity != null && typeof config.identity === "string") {
    config.identity = parseAgentIdentity(config.identity, templateName);
  }

  return config;
}

function legacyHostConfigPath(name: string): string {
  return join(homedir(), ".arcadia", "agents", name, "config.yaml");
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
