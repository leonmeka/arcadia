import chalk from "chalk";
import ora from "ora";
import type { CreateCommandOptions } from "@arcadia/types";
import {
  agentExists,
  createAgentContainer,
  ensureDocker,
  removeContainer,
  syncAgentScripts,
  validateOpenRouterModel,
} from "@arcadia/core";
import { ensureSecrets } from "@/lib/secrets";
import { pickTemplate } from "@/lib/templates";

export async function createCommand(
  options: CreateCommandOptions
): Promise<void> {
  await ensureDocker();

  const name = options.name.toLowerCase().replace(/[^a-z0-9-]/g, "-");
  if (!name) {
    throw new Error("Agent name is required");
  }

  if (await agentExists(name)) {
    throw new Error(`Agent already exists: ${name}`);
  }

  const template = await pickTemplate(name, options.template);
  const model = await validateOpenRouterModel(
    options.model ?? template.model
  );

  const secrets = await ensureSecrets(template.secrets.required);

  try {
    const provisionSpinner = ora({ text: "Configuring machine", color: "green" }).start();
    await createAgentContainer({ name, template, model, secrets });
    provisionSpinner.succeed("Configuring machine");

    await syncAgentScripts(name);

    ora("Starting agent").start().succeed("Starting agent");

    console.log();
    console.log(chalk.green(`${capitalize(name)} is ready.`));
  } catch (error) {
    ora().fail("Failed to create agent");
    await removeContainer(name).catch(() => {});
    throw error;
  }
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
