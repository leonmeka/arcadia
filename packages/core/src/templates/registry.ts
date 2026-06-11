import { template as defaultTemplate } from "@arcadia/templates/default";
import type { Template, TemplateDefinition, TemplateIndexEntry } from "@arcadia/types";
import { definitionToTemplate } from "@/templates/definition";

const builtins: Record<string, TemplateDefinition> = {
  default: defaultTemplate,
};

export function listBuiltinTemplates(): TemplateIndexEntry[] {
  return Object.entries(builtins).map(([id, definition]) => ({
    id,
    name: definition.name,
    source: `local:${id}`,
  }));
}

export function loadBuiltinTemplate(id: string): Template {
  const definition = builtins[id];
  if (!definition) {
    throw new Error(`Template not found: ${id}`);
  }
  return definitionToTemplate(definition, `local:${id}`);
}
