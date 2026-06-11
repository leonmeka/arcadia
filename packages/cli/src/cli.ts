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
  .option(
    "--template <ref>",
    "Template ref: built-in id, owner/repo, or github:owner/repo"
  )
  .option("--model <model>", "Override default model")
  .action(async (name: string, options: { template?: string; model?: string }) => {
    const { createCommand } = await import("@/commands/create");
    await createCommand({ name, template: options.template, model: options.model });
  });

program
  .command("summon <name>")
  .description("Summon an agent (start and sync, without entering)")
  .action(async (name: string) => {
    const { summonCommand } = await import("@/commands/lifecycle");
    await summonCommand(name);
  });

program
  .command("enter <name>")
  .description("Enter an agent (interactive shell)")
  .action(async (name: string) => {
    const { enterCommand } = await import("@/commands/lifecycle");
    await enterCommand(name);
  });

program
  .command("list")
  .description("List agents")
  .action(async () => {
    const { listCommand } = await import("@/commands/list");
    await listCommand();
  });

program
  .command("inspect <name>")
  .description("Inspect an agent")
  .action(async (name: string) => {
    const { inspectCommand } = await import("@/commands/list");
    await inspectCommand(name);
  });

program
  .command("rest <name>")
  .description("Rest an agent")
  .action(async (name: string) => {
    const { restCommand } = await import("@/commands/lifecycle");
    await restCommand(name);
  });

program
  .command("kill <name>")
  .description("Kill an agent")
  .action(async (name: string) => {
    const { killCommand } = await import("@/commands/lifecycle");
    await killCommand(name);
  });

program.parseAsync(process.argv).catch((error: unknown) => {
  console.error((error as Error).message);
  process.exit(1);
});
