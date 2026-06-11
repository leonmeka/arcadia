import type { Template } from "@arcadia/types";
import { buildOpencodeConfig } from "@/opencode";
import { buildAgentsMd } from "@/identity";
import { shellExport } from "@/agent-shared";

export function renderEngineFilesScript(options: {
  name: string;
  template: Template;
  model: string;
  home: string;
  agentsMdPath: string;
  privateMemoryPath: string;
  sharedMemPath: string;
}): string[] {
  const agentsMd = buildAgentsMd(options.name, options.template);
  const opencodeConfig = buildOpencodeConfig(options.model, [
    options.agentsMdPath,
    options.privateMemoryPath,
    options.sharedMemPath,
  ]);

  return [
    `cat > ${options.agentsMdPath} << 'ARCADIA_AGENTS_EOF'\n${agentsMd}\nARCADIA_AGENTS_EOF`,
    `chown ${options.name}:${options.name} ${options.agentsMdPath}`,
    `mkdir -p ${options.home}/.config/opencode`,
    `cat > ${options.home}/.config/opencode/opencode.json << 'ARCADIA_OPENCODE_EOF'\n${opencodeConfig}\nARCADIA_OPENCODE_EOF`,
    `chown -R ${options.name}:${options.name} ${options.home}/.config`,
  ];
}

export function renderArcadiaEnvScript(options: {
  name: string;
  templateName: string;
  identityName: string;
  envFile: string;
  reset: boolean;
}): string[] {
  const lines = [
    `touch ${options.envFile}`,
  ];

  if (options.reset) {
    lines.push(`: > ${options.envFile}`);
  } else {
    lines.push(
      `grep -vE '^export (ARCADIA_(AGENT|TEMPLATE_NAME|IDENTITY_NAME)|OPENCODE_ENABLE_EXA)=' ${options.envFile} > ${options.envFile}.tmp || true`,
      `mv ${options.envFile}.tmp ${options.envFile}`
    );
  }

  lines.push(
    `${shellExport("ARCADIA_AGENT", options.name)} >> ${options.envFile}`,
    `${shellExport("ARCADIA_TEMPLATE_NAME", options.templateName)} >> ${options.envFile}`,
    `${shellExport("ARCADIA_IDENTITY_NAME", options.identityName)} >> ${options.envFile}`,
    `echo 'export OPENCODE_ENABLE_EXA=1' >> ${options.envFile}`,
    `chown ${options.name}:${options.name} ${options.envFile}`
  );

  return lines;
}
