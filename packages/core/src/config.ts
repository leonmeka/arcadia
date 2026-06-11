import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import yaml from "js-yaml";
import type { AgentConfig, FleetPeer, GlobalConfig } from "@arcadia/types";
import {
  AGENTS_DIR,
  ARCADIA_HOME,
  CONFIG_PATH,
  agentConfigPath,
  agentDir,
} from "./paths.js";
import { parseAgentIdentity, resolveAgentIdentity } from "./identity.js";

export async function ensureArcadiaHome(): Promise<void> {
  await mkdir(ARCADIA_HOME, { recursive: true });
  await mkdir(AGENTS_DIR, { recursive: true });

  if (!existsSync(CONFIG_PATH)) {
    await writeFile(
      CONFIG_PATH,
      yaml.dump({
        defaultModel: "anthropic/claude-sonnet-4",
        openrouterBaseUrl: "https://openrouter.ai/api/v1",
      } satisfies GlobalConfig),
      "utf8"
    );
  }
}

export async function readGlobalConfig(): Promise<GlobalConfig> {
  await ensureArcadiaHome();
  const raw = await readFile(CONFIG_PATH, "utf8");
  return yaml.load(raw) as GlobalConfig;
}

export async function listFleetPeers(selfName: string): Promise<FleetPeer[]> {
  const names = await listAgentNames();
  const peers: FleetPeer[] = [];

  for (const name of names) {
    if (name === selfName) continue;
    try {
      const config = await readAgentConfig(name);
      const templateName =
        config.templateName ??
        config.template.replace(/^local:/, "").split("/")[0] ??
        "default";
      const identity =
        config.identity ??
        resolveAgentIdentity({
          name: templateName,
          source: config.template,
          defaults: {},
          skills: [],
          packages: [],
          secrets: { required: [] },
        });
      peers.push({ name, identityName: identity.name });
    } catch {
      peers.push({ name, identityName: name });
    }
  }

  return peers.sort((a, b) => a.name.localeCompare(b.name));
}

export async function readAgentConfig(name: string): Promise<AgentConfig> {
  const raw = await readFile(agentConfigPath(name), "utf8");
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

export async function writeAgentConfig(
  name: string,
  config: AgentConfig
): Promise<void> {
  await mkdir(agentDir(name), { recursive: true });
  await writeFile(agentConfigPath(name), yaml.dump(config), "utf8");
}

export async function listAgentNames(): Promise<string[]> {
  await ensureArcadiaHome();
  if (!existsSync(AGENTS_DIR)) return [];

  const entries = await readdir(AGENTS_DIR, { withFileTypes: true });
  const names: string[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (existsSync(agentConfigPath(entry.name))) names.push(entry.name);
  }

  return names.sort();
}

export async function agentExists(name: string): Promise<boolean> {
  return existsSync(agentConfigPath(name));
}

/** Drop local config for an agent whose container no longer exists. */
export async function pruneOrphanedAgent(name: string): Promise<void> {
  if (!(await agentExists(name))) return;
  await rm(agentDir(name), { recursive: true, force: true });
}
