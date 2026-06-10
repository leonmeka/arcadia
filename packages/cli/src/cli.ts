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
  .command("enter <name>")
  .description("Enter an agent machine")
  .action(async (name: string) => {
    const { enterCommand } = await import("./commands/lifecycle.js");
    await enterCommand(name);
  });

program
  .command("ls")
  .description("List agents")
  .action(async () => {
    const { lsCommand } = await import("./commands/list.js");
    await lsCommand();
  });

program
  .command("inspect <name>")
  .description("Inspect an agent")
  .action(async (name: string) => {
    const { inspectCommand } = await import("./commands/list.js");
    await inspectCommand(name);
  });

program
  .command("stop <name>")
  .description("Stop an agent")
  .action(async (name: string) => {
    const { stopCommand } = await import("./commands/lifecycle.js");
    await stopCommand(name);
  });

program
  .command("rm <name>")
  .description("Remove an agent")
  .action(async (name: string) => {
    const { rmCommand } = await import("./commands/lifecycle.js");
    await rmCommand(name);
  });

program.parseAsync(process.argv).catch((error: unknown) => {
  console.error((error as Error).message);
  process.exit(1);
});
