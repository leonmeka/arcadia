import chalk from "chalk";
import ora from "ora";
import type { CreateCommandOptions } from "@arcadia/types";
import {
  agentDir,
  agentExists,
  buildAgentConfig,
  createAgentContainer,
  ensureArcadiaHome,
  ensureDocker,
  ensureSecrets,
  getContainerState,
  readGlobalConfig,
  removeContainer,
  resolveTemplate,
  syncFleetToAllAgents,
  writeAgentConfig,
} from "@arcadia/core";
import { rm } from "node:fs/promises";

export async function createCommand(
  options: CreateCommandOptions
): Promise<void> {
  await ensureArcadiaHome();
  await ensureDocker();

  const name = options.name.toLowerCase().replace(/[^a-z0-9-]/g, "-");
  if (!name) {
    throw new Error("Agent name is required");
  }

  if (await agentExists(name)) {
    const state = await getContainerState(name);
    if (state === "missing") {
      // Recover from an interrupted create (config written, container never finished)
      await removeContainer(name);
      await rm(agentDir(name), { recursive: true, force: true });
    } else {
      throw new Error(`Agent already exists: ${name}`);
    }
  }

  const globalConfig = await readGlobalConfig();
  const template = await resolveTemplate(name, options.from);
  const model =
    options.model ||
    template.defaults.model ||
    globalConfig.defaultModel ||
    "anthropic/claude-sonnet-4";

  const secrets = await ensureSecrets(template.secrets.required);
  const config = buildAgentConfig(name, template, model);

  try {
    const provisionSpinner = ora({ text: "Configuring machine", color: "green" }).start();
    await createAgentContainer({ name, template, model, secrets });
    provisionSpinner.succeed("Configuring machine");

    const createSpinner = ora("Creating agent").start();
    await writeAgentConfig(name, config);
    createSpinner.succeed("Creating agent");

    await syncFleetToAllAgents();

    ora("Starting agent").start().succeed("Starting agent");

    console.log();
    console.log(chalk.green(`${capitalize(name)} is ready.`));
  } catch (error) {
    ora().fail("Failed to create agent");
    await removeContainer(name).catch(() => {});
    await rm(agentDir(name), { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
