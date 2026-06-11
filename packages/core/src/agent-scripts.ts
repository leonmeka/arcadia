import { containerName } from "@/paths";
import { docker } from "@/docker";
import {
  ensureAgentSudoScript,
  readAgentScript,
} from "@/agent-shared";
import { syncAgentWorkspace } from "@/agent-workspace";

export async function buildAgentScriptInstallScript(): Promise<string> {
  const libScript = await readAgentScript("lib.sh");
  const daemonScript = await readAgentScript("daemon.sh");
  const shellScript = await readAgentScript("shell.sh");
  const promptScript = await readAgentScript("prompt.sh");
  const streamScript = await readAgentScript("stream.sh");
  const statusScript = await readAgentScript("status.sh");
  const timelineScript = await readAgentScript("timeline.sh");
  const memoryScript = await readAgentScript("memory.sh");

  return [
    `cat > /usr/local/bin/arcadia-lib << 'ARCADIA_EOF'\n${libScript}\nARCADIA_EOF`,
    `cat > /usr/local/bin/arcadia-daemon << 'ARCADIA_EOF'\n${daemonScript}\nARCADIA_EOF`,
    `cat > /usr/local/bin/arcadia-shell << 'ARCADIA_EOF'\n${shellScript}\nARCADIA_EOF`,
    `cat > /usr/local/bin/prompt << 'ARCADIA_EOF'\n${promptScript}\nARCADIA_EOF`,
    `cat > /usr/local/bin/arcadia-stream << 'ARCADIA_EOF'\n${streamScript}\nARCADIA_EOF`,
    `cat > /usr/local/bin/status << 'ARCADIA_EOF'\n${statusScript}\nARCADIA_EOF`,
    `cat > /usr/local/bin/timeline << 'ARCADIA_EOF'\n${timelineScript}\nARCADIA_EOF`,
    `cat > /usr/local/bin/memory << 'ARCADIA_EOF'\n${memoryScript}\nARCADIA_EOF`,
    "rm -f /usr/local/bin/send /usr/local/bin/inbox /usr/local/bin/arcadia-mail-deliver /usr/local/bin/arcadia-maild /usr/local/bin/bus /usr/local/bin/arcadia-busd /usr/local/bin/arcadia-bus-think /usr/local/bin/arcadia-bus-live /usr/local/bin/journal /usr/local/bin/ask /usr/local/bin/arcadia-apt",
    "chmod +x /usr/local/bin/arcadia-daemon /usr/local/bin/arcadia-shell /usr/local/bin/arcadia-stream /usr/local/bin/prompt /usr/local/bin/status /usr/local/bin/timeline /usr/local/bin/memory",
    "bash -n /usr/local/bin/arcadia-lib /usr/local/bin/arcadia-stream",
  ].join("\n");
}

export async function syncAgentScripts(name: string): Promise<void> {
  const installScript = [
    "command -v jq >/dev/null || (apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq jq)",
    ensureAgentSudoScript(name),
    await buildAgentScriptInstallScript(),
  ].join("\n");
  await docker([
    "exec",
    containerName(name),
    "bash",
    "-lc",
    installScript,
  ]);
  await syncAgentWorkspace(name);
}
