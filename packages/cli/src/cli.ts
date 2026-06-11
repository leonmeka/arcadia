#!/usr/bin/env node

import { Command } from "commander";

const program = new Command();

program
  .name("arcadia")
  .description("A runtime for persistent AI agents")
  .version("0.1.0");

program
  .command("create <name>")
  .description("Create a persistent agent")
  .option("--from <template>", "Template reference (e.g. yc/startup-researcher)")
  .option("--model <model>", "Override default model")
  .action(async (name: string, options: { from?: string; model?: string }) => {
    const { createCommand } = await import("./commands/create.js");
    await createCommand({ name, from: options.from, model: options.model });
  });

program
  .command("summon <name>")
  .description("Summon an agent")
  .action(async (name: string) => {
    const { summonCommand } = await import("./commands/lifecycle.js");
    await summonCommand(name);
  });

program
  .command("list")
  .description("List agents")
  .action(async () => {
    const { listCommand } = await import("./commands/list.js");
    await listCommand();
  });

program
  .command("inspect <name>")
  .description("Inspect an agent")
  .action(async (name: string) => {
    const { inspectCommand } = await import("./commands/list.js");
    await inspectCommand(name);
  });

program
  .command("rest <name>")
  .description("Rest an agent")
  .action(async (name: string) => {
    const { restCommand } = await import("./commands/lifecycle.js");
    await restCommand(name);
  });

program
  .command("kill <name>")
  .description("Kill an agent")
  .action(async (name: string) => {
    const { killCommand } = await import("./commands/lifecycle.js");
    await killCommand(name);
  });

program.parseAsync(process.argv).catch((error: unknown) => {
  console.error((error as Error).message);
  process.exit(1);
});
