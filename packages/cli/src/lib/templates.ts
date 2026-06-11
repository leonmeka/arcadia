import prompts from "prompts";
import type { Template, TemplateIndexEntry } from "@arcadia/types";
import {
  TemplateAmbiguousError,
  loadTemplate,
  resolveTemplate,
} from "@arcadia/core";

export async function pickTemplate(
  query: string,
  templateRef?: string
): Promise<Template> {
  try {
    return await resolveTemplate(query, templateRef);
  } catch (error) {
    if (!(error instanceof TemplateAmbiguousError)) {
      throw error;
    }
    return promptTemplateChoice(error.matches);
  }
}

async function promptTemplateChoice(
  matches: TemplateIndexEntry[]
): Promise<Template> {
  const response = await prompts({
    type: "select",
    name: "template",
    message: "Choose template:",
    choices: matches.map((match) => ({
      title: match.name
        .replace(/-/g, " ")
        .replace(/\b\w/g, (character) => character.toUpperCase()),
      value: match,
      description: match.source,
    })),
  });

  if (!response.template) {
    throw new Error("Template selection cancelled");
  }

  return loadTemplate(response.template.source);
}
