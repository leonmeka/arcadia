import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { AGENT_SCRIPTS_DIR } from "@/paths";
import {
  DEFAULT_PRIVATE_MEMORY,
  DEFAULT_SHARED_MEMORY,
} from "@/identity";

export const AGENT_SUDOERS_VERSION = "1";

export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export async function readAgentScript(name: string): Promise<string> {
  return readFile(join(AGENT_SCRIPTS_DIR, name), "utf8");
}

export function memoryBootstrapScript(
  agentDir: string,
  workspace: string,
  name: string
): string {
  const privateMem = `${agentDir}/MEMORY.md`;
  const workspacePrivateMem = `${workspace}/.arcadia/agents/${name}/MEMORY.md`;
  return [
    `PRIVATE_MEM=${shellQuote(privateMem)}`,
    `WORKSPACE_PRIVATE_MEM=${shellQuote(workspacePrivateMem)}`,
    `SHARED_MEM=${shellQuote(`${workspace}/.arcadia/MEMORY.md`)}`,
    `mkdir -p ${shellQuote(agentDir)} ${shellQuote(`${workspace}/.arcadia`)}`,
    `touch "$PRIVATE_MEM" "$SHARED_MEM"`,
    `# Migrate mistaken workspace private memory back into container-local storage`,
    `if [[ -s "$WORKSPACE_PRIVATE_MEM" ]]; then`,
    `  if [[ ! -s "$PRIVATE_MEM" ]]; then`,
    `    cp "$WORKSPACE_PRIVATE_MEM" "$PRIVATE_MEM"`,
    `  else`,
    `    cat "$WORKSPACE_PRIVATE_MEM" >> "$PRIVATE_MEM"`,
    `  fi`,
    `  rm -f "$WORKSPACE_PRIVATE_MEM"`,
    `fi`,
    `rm -rf ${shellQuote(`${workspace}/.arcadia/agents`)}`,
    `if [[ ! -s "$PRIVATE_MEM" ]]; then`,
    `cat > "$PRIVATE_MEM" << 'ARCADIA_PRIVATE_MEM_EOF'`,
    DEFAULT_PRIVATE_MEMORY,
    `ARCADIA_PRIVATE_MEM_EOF`,
    `fi`,
    `if [[ ! -s "$SHARED_MEM" ]]; then`,
    `cat > "$SHARED_MEM" << 'ARCADIA_SHARED_MEM_EOF'`,
    DEFAULT_SHARED_MEMORY,
    `ARCADIA_SHARED_MEM_EOF`,
    `fi`,
  ].join("\n");
}

export function ensureAgentSudoScript(name: string): string {
  const sudoersFile = `/etc/sudoers.d/arcadia-${name}`;
  const versionFile = `/etc/sudoers.d/arcadia-${name}.version`;
  return [
    `SUDOERS_VERSION=${shellQuote(AGENT_SUDOERS_VERSION)}`,
    `if [[ -f ${versionFile} && "$(cat ${versionFile})" == "$SUDOERS_VERSION" ]]; then`,
    `  :`,
    `else`,
    `DEBIAN_FRONTEND=noninteractive apt-get install -y -qq sudo 2>/dev/null || true`,
    `cat > ${sudoersFile} << 'ARCADIA_SUDOERS_EOF'`,
    `Defaults:${name} !requiretty`,
    `${name} ALL=(ALL) NOPASSWD: /usr/bin/apt-get *, /usr/bin/apt *`,
    `ARCADIA_SUDOERS_EOF`,
    `chmod 440 ${sudoersFile}`,
    `visudo -cf ${sudoersFile} >/dev/null 2>&1 || rm -f ${sudoersFile}`,
    `echo "$SUDOERS_VERSION" > ${versionFile}`,
    `fi`,
  ].join("\n");
}
