import type { Template, TemplateDefinition } from "@arcadia/types";

export function isTemplateDefinition(value: unknown): value is TemplateDefinition {
  if (!value || typeof value !== "object") return false;
  const candidate = value as TemplateDefinition;
  return typeof candidate.name === "string" && typeof candidate.model === "string";
}

export function extractTemplateDefinition(module: unknown): TemplateDefinition {
  if (!module || typeof module !== "object") {
    throw new Error("Template module did not export a definition");
  }

  const exports = module as Record<string, unknown>;

  if (isTemplateDefinition(exports.template)) {
    return exports.template;
  }

  if (isTemplateDefinition(exports.default)) {
    return exports.default;
  }

  if (exports.templates && typeof exports.templates === "object") {
    const entries = Object.values(exports.templates as Record<string, unknown>);
    if (entries.length === 1 && isTemplateDefinition(entries[0])) {
      return entries[0];
    }
  }

  throw new Error(
    "Template module must export `template`, a default export, or a single-entry `templates` object"
  );
}

export function definitionToTemplate(
  definition: TemplateDefinition,
  source: string
): Template {
  return {
    ...definition,
    source,
    skills: [...(definition.skills ?? [])],
    packages: [...(definition.packages ?? [])],
    secrets: {
      required: [...(definition.secrets?.required ?? [])],
    },
  };
}
