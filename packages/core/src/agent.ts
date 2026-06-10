import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { AgentConfig, CreateAgentOptions, Template } from "@arcadia/types";
import {
  AGENT_SCRIPTS_DIR,
  CONTAINER_LABEL,
  DEFAULT_IMAGE,
  WORKSPACE_VOLUME,
  agentAgentDir,
  agentAgentsMdPath,
  agentHome,
  agentWorkspace,
  containerName,
} from "./paths.js";
import { docker, ensureWorkspaceVolume, getContainerState, startContainer } from "./docker.js";
import { ARCADIA_NETWORK, BUS_URL, connectAgentToNetwork, ensureFleetBus } from "./bus.js";
import { buildOpencodeConfig } from "./opencode.js";
import { buildAgentsMd, resolveAgentIdentity } from "./identity.js";
import { listFleetPeers, listAgentNames, readAgentConfig } from "./config.js";
import { installSkills, loadTemplateBySource } from "./templates.js";

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

async function readAgentScript(name: string): Promise<string> {
  return readFile(join(AGENT_SCRIPTS_DIR, name), "utf8");
}

function templateFromConfig(config: AgentConfig): Template {
  const templateName =
    config.templateName ??
    config.template.replace(/^local:/, "").split("/")[0] ??
    "default";

  return {
    name: templateName,
    source: config.template,
    identity: config.identity,
    defaults: { model: config.model },
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
  const envFile = `${home}/.arcadia.env`;
  const peers = await listFleetPeers(name);
  const allAgents = await listAgentNames();
  const fleetJson = JSON.stringify(
    { agents: allAgents, updatedAt: new Date().toISOString() },
    null,
    2
  );
  const agentsMd = buildAgentsMd(name, template, peers);
  const identity = resolveAgentIdentity(template);
  const opencodeConfig = buildOpencodeConfig(config.model, agentsMdPath);
  const mailboxSetup = allAgents
    .map((agent) => `mkdir -p "$WS/.arcadia/mailbox/${agent}/inbox"`)
    .join("\n");

  return [
    `WS=${shellQuote(workspace)}`,
    `HOME_DIR=${shellQuote(home)}`,
    `# Migrate legacy agents that still mount the shared volume at /workspace`,
    `if mountpoint -q /workspace 2>/dev/null && [ ! -L "$WS" ]; then`,
    `  rm -rf "$WS"`,
    `  ln -s /workspace "$WS"`,
    `fi`,
    `mkdir -p "$WS" ${agentDir} "$WS/.arcadia"`,
    mailboxSetup,
    `chown -R ${name}:${name} "$WS/.arcadia"`,
    `cat > "$WS/.arcadia/fleet.json" << 'ARCADIA_FLEET_EOF'\n${fleetJson}\nARCADIA_FLEET_EOF`,
    `chown ${name}:${name} "$WS/.arcadia/fleet.json"`,
    `rm -f ${workspace}/AGENTS.md`,
    `cat > ${agentsMdPath} << 'ARCADIA_EOF'\n${agentsMd}\nARCADIA_EOF`,
    `chown ${name}:${name} ${agentsMdPath}`,
    `touch ${envFile}`,
    `grep -vE '^export ARCADIA_(AGENT|TEMPLATE_NAME|IDENTITY_NAME|BUS_URL)=' ${envFile} > ${envFile}.tmp || true`,
    `mv ${envFile}.tmp ${envFile}`,
    `echo 'export ARCADIA_AGENT=${shellQuote(name)}' >> ${envFile}`,
    `echo 'export ARCADIA_TEMPLATE_NAME=${shellQuote(template.name)}' >> ${envFile}`,
    `echo 'export ARCADIA_IDENTITY_NAME=${shellQuote(identity.name)}' >> ${envFile}`,
    `echo 'export ARCADIA_BUS_URL=${shellQuote(BUS_URL)}' >> ${envFile}`,
    `chown ${name}:${name} ${envFile}`,
    `mkdir -p ${home}/.config/opencode`,
    `cat > ${home}/.config/opencode/opencode.json << 'ARCADIA_OPENCODE_EOF'\n${opencodeConfig}\nARCADIA_OPENCODE_EOF`,
    `chown -R ${name}:${name} ${home}/.config`,
    `su - ${name} -c 'arcadia-busd stop >/dev/null 2>&1 || true; arcadia-maild stop >/dev/null 2>&1 || true; arcadia-daemon stop >/dev/null 2>&1 || true; arcadia-daemon start'`,
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

/** Refresh fleet mailboxes, scripts, and AGENTS.md across all agents. */
export async function syncFleetToAllAgents(): Promise<void> {
  const names = await listAgentNames();

  for (const agentName of names) {
    const state = await getContainerState(agentName);
    if (state === "missing") continue;
    if (state !== "online") {
      await startContainer(agentName).catch(() => {});
    }
    try {
      await syncAgentScripts(agentName);
    } catch {
      // Skip agents that fail to sync
    }
  }
}

async function buildAgentScriptInstallScript(): Promise<string> {
  const daemonScript = await readAgentScript("daemon.sh");
  const shellScript = await readAgentScript("shell.sh");
  const promptScript = await readAgentScript("prompt.sh");
  const askScript = await readAgentScript("ask.sh");
  const streamScript = await readAgentScript("stream.sh");
  const statusScript = await readAgentScript("status.sh");
  const journalScript = await readAgentScript("journal.sh");
  const timelineScript = await readAgentScript("timeline.sh");
  const sendScript = await readAgentScript("send.sh");
  const inboxScript = await readAgentScript("inbox.sh");
  const mailDeliverScript = await readAgentScript("mail-deliver.sh");
  const maildScript = await readAgentScript("maild.sh");
  const busScript = await readAgentScript("bus.sh");
  const busdScript = await readAgentScript("busd.sh");

  return [
    `cat > /usr/local/bin/arcadia-daemon << 'ARCADIA_EOF'\n${daemonScript}\nARCADIA_EOF`,
    `cat > /usr/local/bin/arcadia-shell << 'ARCADIA_EOF'\n${shellScript}\nARCADIA_EOF`,
    `cat > /usr/local/bin/prompt << 'ARCADIA_EOF'\n${promptScript}\nARCADIA_EOF`,
    `cat > /usr/local/bin/ask << 'ARCADIA_EOF'\n${askScript}\nARCADIA_EOF`,
    `cat > /usr/local/bin/arcadia-stream << 'ARCADIA_EOF'\n${streamScript}\nARCADIA_EOF`,
    `cat > /usr/local/bin/status << 'ARCADIA_EOF'\n${statusScript}\nARCADIA_EOF`,
    `cat > /usr/local/bin/journal << 'ARCADIA_EOF'\n${journalScript}\nARCADIA_EOF`,
    `cat > /usr/local/bin/timeline << 'ARCADIA_EOF'\n${timelineScript}\nARCADIA_EOF`,
    `cat > /usr/local/bin/send << 'ARCADIA_EOF'\n${sendScript}\nARCADIA_EOF`,
    `cat > /usr/local/bin/inbox << 'ARCADIA_EOF'\n${inboxScript}\nARCADIA_EOF`,
    `cat > /usr/local/bin/arcadia-mail-deliver << 'ARCADIA_EOF'\n${mailDeliverScript}\nARCADIA_EOF`,
    `cat > /usr/local/bin/arcadia-maild << 'ARCADIA_EOF'\n${maildScript}\nARCADIA_EOF`,
    `cat > /usr/local/bin/bus << 'ARCADIA_EOF'\n${busScript}\nARCADIA_EOF`,
    `cat > /usr/local/bin/arcadia-busd << 'ARCADIA_EOF'\n${busdScript}\nARCADIA_EOF`,
    "rm -f /usr/local/bin/arcadia-bus-think /usr/local/bin/arcadia-bus-live",
    "chmod +x /usr/local/bin/arcadia-daemon /usr/local/bin/arcadia-shell /usr/local/bin/arcadia-stream /usr/local/bin/prompt /usr/local/bin/ask /usr/local/bin/status /usr/local/bin/journal /usr/local/bin/timeline /usr/local/bin/send /usr/local/bin/inbox /usr/local/bin/arcadia-mail-deliver /usr/local/bin/arcadia-maild /usr/local/bin/bus /usr/local/bin/arcadia-busd",
    "bash -n /usr/local/bin/arcadia-stream",
  ].join("\n");
}

export async function syncAgentScripts(name: string): Promise<void> {
  await ensureFleetBus();
  await connectAgentToNetwork(containerName(name));

  const installScript = [
    "command -v jq >/dev/null || (apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq jq)",
    await buildAgentScriptInstallScript(),
  ].join("\n");
  await docker([
    "exec",
    containerName(name),
    "bash",
    "-lc",
    installScript,
  ]);
  // Restart the fleet worker on the new script and drop legacy bus state.
  await docker([
    "exec",
    "-u",
    name,
    "-e",
    `HOME=/home/${name}`,
    containerName(name),
    "bash",
    "-lc",
    "arcadia-busd stop >/dev/null 2>&1 || true; rm -rf ~/.agent/bus ~/.agent/bus-pending ~/.agent/bus-think.lock ~/.agent/shell.pid ~/.agent/shell.tty; arcadia-busd start",
  ]);
  await syncAgentWorkspace(name);
}

export async function createAgentContainer(
  options: CreateAgentOptions
): Promise<void> {
  const { name, template, model, secrets } = options;
  const cname = containerName(name);
  const home = agentHome(name);
  const workspace = agentWorkspace(name);
  const agentDir = agentAgentDir(name);

  await ensureWorkspaceVolume();
  await ensureFleetBus();

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
    ]),
  ];

  const identity = resolveAgentIdentity(template);
  const peers = await listFleetPeers(name);
  const fleetAgents = [...new Set([name, ...(await listAgentNames())])].sort();
  const agentsMd = buildAgentsMd(name, template, peers);
  const agentsMdPath = agentAgentsMdPath(name);

  const profileVars: Record<string, string> = {
    ARCADIA_AGENT: name,
    ARCADIA_HOME: home,
    ARCADIA_WORKSPACE: workspace,
    ARCADIA_TEMPLATE_NAME: template.name,
    ARCADIA_IDENTITY_NAME: identity.name,
    ARCADIA_MODEL: model,
    ARCADIA_BUS_URL: BUS_URL,
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
    `echo 'export PS1="${name}:workspace\\$ "' >> ${envFile}`,
    `grep -q '.arcadia.env' ${home}/.bashrc 2>/dev/null || printf '\\n${sourceEnv}\\n' >> ${home}/.bashrc`,
    `grep -q '.arcadia.env' ${home}/.profile 2>/dev/null || printf '\\n${sourceEnv}\\n' >> ${home}/.profile`,
    `chown ${name}:${name} ${envFile} ${home}/.bashrc ${home}/.profile`,
    `chmod 600 ${envFile}`,
  ];

  const fleetJson = JSON.stringify(
    { agents: fleetAgents, updatedAt: new Date().toISOString() },
    null,
    2
  );
  const mailboxSetup = fleetAgents
    .map((agent) => `mkdir -p ${workspace}/.arcadia/mailbox/${agent}/inbox`)
    .join("\n");

  const setupScript = [
    "#!/bin/bash",
    "set -euo pipefail",
    `id -u ${name} &>/dev/null || useradd -m -s /bin/bash ${name}`,
    `mkdir -p ${agentDir} ${workspace} ${workspace}/.arcadia ${home}/.agents/skills`,
    mailboxSetup,
    `cat > ${workspace}/.arcadia/fleet.json << 'ARCADIA_FLEET_EOF'\n${fleetJson}\nARCADIA_FLEET_EOF`,
    `chown -R ${name}:${name} ${home} ${workspace}/.arcadia`,
    ...profileCommands,
    "apt-get update -qq",
    `DEBIAN_FRONTEND=noninteractive apt-get install -y -qq ${packages.join(" ")}`,
    "npm install -g opencode-ai",
    `rm -f ${workspace}/AGENTS.md`,
    `cat > ${agentsMdPath} << 'ARCADIA_AGENTS_EOF'\n${agentsMd}\nARCADIA_AGENTS_EOF`,
    `chown ${name}:${name} ${agentsMdPath}`,
    `mkdir -p ${home}/.config/opencode`,
    `cat > ${home}/.config/opencode/opencode.json << 'ARCADIA_OPENCODE_EOF'
${buildOpencodeConfig(model, agentsMdPath)}
ARCADIA_OPENCODE_EOF`,
    `chown -R ${name}:${name} ${home}/.config`,
    ...(template.init || []),
    `touch ${agentDir}/journal.md ${agentDir}/activity.log`,
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
    "--network",
    ARCADIA_NETWORK,
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
