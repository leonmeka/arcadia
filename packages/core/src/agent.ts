import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { AgentConfig, CreateAgentOptions, Template } from "@arcadia/types";
import {
  AGENT_SCRIPTS_DIR,
  CONTAINER_LABEL,
  DEFAULT_IMAGE,
  WORKSPACE_VOLUME,
  agentAgentDir,
  agentHome,
  containerName,
} from "./paths.js";
import { docker, ensureWorkspaceVolume } from "./docker.js";
import { buildOpencodeConfig } from "./opencode.js";
import { installSkills } from "./templates.js";

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

async function readAgentScript(name: string): Promise<string> {
  return readFile(join(AGENT_SCRIPTS_DIR, name), "utf8");
}

export async function createAgentContainer(
  options: CreateAgentOptions
): Promise<void> {
  const { name, template, model, secrets } = options;
  const cname = containerName(name);
  const home = agentHome(name);
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
      "git",
      "curl",
      "ca-certificates",
      "python3",
      "nodejs",
      "npm",
    ]),
  ];

  const profileVars: Record<string, string> = {
    ARCADIA_HOME: home,
    ARCADIA_MODEL: model,
    OPENCODE_ATTACH: "http://127.0.0.1:4096",
    ...secrets,
  };

  // Env exports live in a dedicated file that sources nothing else.
  // Never make .bashrc source .profile: Ubuntu's .profile sources .bashrc,
  // so that creates an infinite loop that segfaults every interactive shell.
  const envFile = `${home}/.arcadia.env`;
  const sourceEnv = `[ -f ~/.arcadia.env ] && . ~/.arcadia.env`;
  const profileCommands = [
    `touch ${home}/.bashrc ${home}/.profile`,
    `: > ${envFile}`,
    ...Object.entries(profileVars).map(
      ([key, value]) => `echo 'export ${key}=${shellQuote(value)}' >> ${envFile}`
    ),
    `echo 'export PS1="${name}:/workspace\\$ "' >> ${envFile}`,
    `grep -q '.arcadia.env' ${home}/.bashrc 2>/dev/null || printf '\\n${sourceEnv}\\n' >> ${home}/.bashrc`,
    `grep -q '.arcadia.env' ${home}/.profile 2>/dev/null || printf '\\n${sourceEnv}\\n' >> ${home}/.profile`,
    `chown ${name}:${name} ${envFile} ${home}/.bashrc ${home}/.profile`,
    `chmod 600 ${envFile}`,
  ];

  const setupScript = [
    "#!/bin/bash",
    "set -euo pipefail",
    `id -u ${name} &>/dev/null || useradd -m -s /bin/bash ${name}`,
    `mkdir -p ${agentDir} ${home}/.agents/skills /workspace`,
    `chown -R ${name}:${name} ${home} /workspace`,
    ...profileCommands,
    "apt-get update -qq",
    `DEBIAN_FRONTEND=noninteractive apt-get install -y -qq ${packages.join(" ")}`,
    "npm install -g opencode-ai",
    `mkdir -p ${home}/.config/opencode`,
    `cat > ${home}/.config/opencode/opencode.json << 'ARCADIA_OPENCODE_EOF'
${buildOpencodeConfig(model)}
ARCADIA_OPENCODE_EOF`,
    `chown -R ${name}:${name} ${home}/.config`,
    ...(template.init || []),
    `touch ${agentDir}/journal.md ${agentDir}/activity.log`,
    `chown -R ${name}:${name} ${agentDir}`,
    `echo '${name} initialized' >> ${agentDir}/activity.log`,
  ].join("\n");

  const daemonScript = await readAgentScript("daemon.sh");
  const askScript = await readAgentScript("ask.sh");
  const statusScript = await readAgentScript("status.sh");
  const journalScript = await readAgentScript("journal.sh");
  const timelineScript = await readAgentScript("timeline.sh");

  const installCommands = [
    setupScript,
    `cat > /usr/local/bin/arcadia-daemon << 'ARCADIA_EOF'\n${daemonScript}\nARCADIA_EOF`,
    `cat > /usr/local/bin/ask << 'ARCADIA_EOF'\n${askScript}\nARCADIA_EOF`,
    `cat > /usr/local/bin/status << 'ARCADIA_EOF'\n${statusScript}\nARCADIA_EOF`,
    `cat > /usr/local/bin/journal << 'ARCADIA_EOF'\n${journalScript}\nARCADIA_EOF`,
    `cat > /usr/local/bin/timeline << 'ARCADIA_EOF'\n${timelineScript}\nARCADIA_EOF`,
    "chmod +x /usr/local/bin/arcadia-daemon /usr/local/bin/ask /usr/local/bin/status /usr/local/bin/journal /usr/local/bin/timeline",
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
    `${WORKSPACE_VOLUME}:/workspace`,
    "--workdir",
    "/workspace",
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
  model: string
): AgentConfig {
  return {
    name,
    template: template.source,
    image: DEFAULT_IMAGE,
    model,
    createdAt: new Date().toISOString(),
    skills: template.skills,
    packages: template.packages,
    secrets: template.secrets.required,
  };
}
