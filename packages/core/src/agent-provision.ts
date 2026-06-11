import type { AgentConfig, CreateAgentOptions, Model, Template } from "@arcadia/types";
import {
  CONTAINER_LABEL,
  DEFAULT_IMAGE,
  WORKSPACE_VOLUME,
  agentAgentDir,
  agentAgentsMdPath,
  agentHome,
  agentMemoryPath,
  agentWorkspace,
  containerName,
  sharedMemoryPath,
} from "@/paths";
import { docker, ensureWorkspaceVolume } from "@/docker";
import { resolveAgentIdentity } from "@/identity";
import { renderEngineFilesScript } from "@/agent-workspace-files";
import { installSkills } from "@/templates/index";
import {
  ensureAgentSudoScript,
  memoryBootstrapScript,
  shellExport,
} from "@/agent-shared";
import { buildAgentScriptInstallScript } from "@/agent-scripts";

async function waitForAgentSetup(
  name: string,
  timeoutMs = 300_000
): Promise<void> {
  const cname = containerName(name);
  const marker = `${agentAgentDir(name)}/.setup-complete`;
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    try {
      await docker(["exec", cname, "test", "-f", marker]);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }

  throw new Error(`Agent setup timed out: ${name}`);
}

export function buildAgentConfig(
  name: string,
  template: Template,
  model: Model
): AgentConfig {
  return {
    name,
    template: template.source,
    templateName: template.name,
    identity: template.identity ?? resolveAgentIdentity(template),
    image: DEFAULT_IMAGE,
    model,
    createdAt: new Date().toISOString(),
    skills: template.skills,
    packages: template.packages,
    secrets: template.secrets.required,
  };
}

export async function createAgentContainer(
  options: CreateAgentOptions
): Promise<void> {
  const { name, template, model, secrets } = options;
  const config = buildAgentConfig(name, template, model);
  const configJson = JSON.stringify(config, null, 2);
  const cname = containerName(name);
  const home = agentHome(name);
  const workspace = agentWorkspace(name);
  const agentDir = agentAgentDir(name);

  await ensureWorkspaceVolume();

  const envVars = [
    `ARCADIA_AGENT=${name}`,
    `ARCADIA_MODEL=${model}`,
    `ARCADIA_HOME=${home}`,
    ...Object.entries(secrets).map(([k, v]) => `${k}=${v}`),
  ];

  const packages = [
    ...new Set([
      ...template.packages,
      "procps",
      "git",
      "curl",
      "ca-certificates",
      "python3",
      "jq",
      "nodejs",
      "npm",
      "sudo",
    ]),
  ];

  const identity = resolveAgentIdentity(template);
  const agentsMdPath = agentAgentsMdPath(name);
  const privateMemoryPath = agentMemoryPath(name);
  const sharedMemPath = sharedMemoryPath(name);

  const profileVars: Record<string, string> = {
    ARCADIA_AGENT: name,
    ARCADIA_HOME: home,
    ARCADIA_WORKSPACE: workspace,
    ARCADIA_TEMPLATE_NAME: template.name,
    ARCADIA_IDENTITY_NAME: identity.name,
    ARCADIA_MODEL: model,
    OPENCODE_ATTACH: "http://127.0.0.1:4096",
    OPENCODE_ENABLE_EXA: "1",
    ...secrets,
  };

  const envFile = `${home}/.arcadia.env`;
  const sourceEnv = `[ -f ~/.arcadia.env ] && . ~/.arcadia.env`;
  const profileCommands = [
    `touch ${home}/.bashrc ${home}/.profile`,
    `: > ${envFile}`,
    ...Object.entries(profileVars).map(
      ([key, value]) => `${shellExport(key, value)} >> ${envFile}`
    ),
    `echo 'export PS1="${name}:workspace\\$ "' >> ${envFile}`,
    `grep -q '.arcadia.env' ${home}/.bashrc 2>/dev/null || printf '\\n${sourceEnv}\\n' >> ${home}/.bashrc`,
    `grep -q '.arcadia.env' ${home}/.profile 2>/dev/null || printf '\\n${sourceEnv}\\n' >> ${home}/.profile`,
    `chown ${name}:${name} ${envFile} ${home}/.bashrc ${home}/.profile`,
    `chmod 600 ${envFile}`,
  ];

  const setupScript = [
    "#!/bin/bash",
    "set -euo pipefail",
    `id -u ${name} &>/dev/null || useradd -m -s /bin/bash ${name}`,
    `mkdir -p ${agentDir} ${workspace} ${workspace}/.arcadia ${home}/.agents/skills`,
    memoryBootstrapScript(agentDir, workspace, name),
    `chown -R ${name}:${name} ${home} ${workspace}/.arcadia ${agentDir}`,
    ...profileCommands,
    "apt-get update -qq",
    `DEBIAN_FRONTEND=noninteractive apt-get install -y -qq ${packages.join(" ")}`,
    ensureAgentSudoScript(name),
    "npm install -g opencode-ai",
    ...(secrets.OPENROUTER_API_KEY
      ? [
          `mkdir -p ${home}/.local/share/opencode`,
          `cat > ${home}/.local/share/opencode/auth.json << 'ARCADIA_AUTH_EOF'\n${JSON.stringify(
            {
              openrouter: {
                type: "api",
                key: secrets.OPENROUTER_API_KEY,
              },
            },
            null,
            2
          )}\nARCADIA_AUTH_EOF`,
          `chown ${name}:${name} ${home}/.local/share/opencode/auth.json`,
          `chmod 600 ${home}/.local/share/opencode/auth.json`,
        ]
      : []),
    `rm -f ${workspace}/AGENTS.md`,
    ...renderEngineFilesScript({
      name,
      template,
      model,
      home,
      agentsMdPath,
      privateMemoryPath,
      sharedMemPath,
    }),
    `cat > ${agentDir}/config.json << 'ARCADIA_CONFIG_EOF'\n${configJson}\nARCADIA_CONFIG_EOF`,
    `touch ${agentDir}/activity.log ${agentDir}/session.json`,
    `chown -R ${name}:${name} ${agentDir}`,
    `echo '${name} initialized' >> ${agentDir}/activity.log`,
  ].join("\n");

  const scriptInstall = await buildAgentScriptInstallScript();

  const installCommands = [
    setupScript,
    scriptInstall,
    `su - ${name} -c 'arcadia-daemon start'`,
    `touch ${agentDir}/.setup-complete`,
    "exec sleep infinity",
  ].join("\n");

  const runArgs = [
    "run",
    "-d",
    "--name",
    cname,
    "--label",
    `${CONTAINER_LABEL}=${name}`,
    "--volume",
    `${WORKSPACE_VOLUME}:${workspace}`,
    "--workdir",
    workspace,
    ...envVars.flatMap((e) => ["-e", e]),
    DEFAULT_IMAGE,
    "bash",
    "-lc",
    installCommands,
  ];

  await docker(runArgs);
  await waitForAgentSetup(name);

  if (template.skills.length > 0) {
    await installSkills(cname, template.skills);
  }
}
