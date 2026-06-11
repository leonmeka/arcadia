import type { AgentConfig, Template } from "@arcadia/types";
import {
  agentAgentDir,
  agentAgentsMdPath,
  agentHome,
  agentMemoryPath,
  agentWorkspace,
  containerName,
  sharedMemoryPath,
} from "@/paths";
import { docker } from "@/docker";
import { resolveAgentIdentity } from "@/identity";
import {
  renderArcadiaEnvScript,
  renderEngineFilesScript,
} from "@/agent-workspace-files";
import { readAgentConfig, resolveTemplateName } from "@/config";
import { loadTemplateBySource } from "@/templates/index";
import { memoryBootstrapScript, shellQuote } from "@/agent-shared";

function templateFromConfig(config: AgentConfig): Template {
  return {
    name: resolveTemplateName(config),
    source: config.template,
    identity: config.identity,
    model: config.model,
    skills: config.skills,
    packages: config.packages,
    secrets: { required: config.secrets },
  };
}

async function buildWorkspaceSyncScript(
  name: string,
  config: AgentConfig,
  template: Template
): Promise<string> {
  const home = agentHome(name);
  const workspace = agentWorkspace(name);
  const agentDir = agentAgentDir(name);
  const agentsMdPath = agentAgentsMdPath(name);
  const privateMemoryPath = agentMemoryPath(name);
  const sharedMemPath = sharedMemoryPath(name);
  const envFile = `${home}/.arcadia.env`;
  const identity = resolveAgentIdentity(template);

  return [
    `WS=${shellQuote(workspace)}`,
    `HOME_DIR=${shellQuote(home)}`,
    `# Migrate legacy agents that still mount the shared volume at /workspace`,
    `if mountpoint -q /workspace 2>/dev/null && [ ! -L "$WS" ]; then`,
    `  rm -rf "$WS"`,
    `  ln -s /workspace "$WS"`,
    `fi`,
    `mkdir -p "$WS" ${agentDir} "$WS/.arcadia"`,
    memoryBootstrapScript(agentDir, workspace, name),
    `chown -R ${name}:${name} "$WS/.arcadia" ${agentDir}`,
    `rm -f ${workspace}/AGENTS.md`,
    ...renderArcadiaEnvScript({
      name,
      templateName: template.name,
      identityName: identity.name,
      envFile,
      reset: false,
    }),
    ...renderEngineFilesScript({
      name,
      template,
      model: config.model,
      home,
      agentsMdPath,
      privateMemoryPath,
      sharedMemPath,
    }),
    `su - ${name} -c 'arcadia-daemon stop >/dev/null 2>&1 || true; arcadia-daemon start'`,
  ].join("\n");
}

export async function syncAgentWorkspace(name: string): Promise<void> {
  const config = await readAgentConfig(name);
  let template: Template;
  try {
    template = await loadTemplateBySource(config.template);
  } catch {
    template = templateFromConfig(config);
  }
  const syncScript = await buildWorkspaceSyncScript(name, config, template);
  await docker(["exec", containerName(name), "bash", "-lc", syncScript]);
}
