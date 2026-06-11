import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Template, TemplateIndexEntry } from "@arcadia/types";
import { TemplateAmbiguousError } from "@/errors";
import { loadTemplate } from "@/templates/load";
import { listBuiltinTemplates } from "@/templates/registry";

const execFileAsync = promisify(execFile);

export function findTemplates(query: string): TemplateIndexEntry[] {
  const normalized = query.toLowerCase();

  return listBuiltinTemplates().filter((entry) => {
    const id = entry.id.toLowerCase();
    const name = entry.name.toLowerCase().replace(/-/g, " ");
    return id.includes(normalized) || name.includes(normalized);
  });
}

export async function loadTemplateBySource(source: string): Promise<Template> {
  return loadTemplate(source);
}

export async function resolveTemplate(
  query: string,
  templateRef?: string
): Promise<Template> {
  if (templateRef) {
    return loadTemplate(templateRef);
  }

  const builtins = listBuiltinTemplates();
  if (builtins.length === 1) {
    return loadTemplate(builtins[0].source);
  }

  const matches = findTemplates(query);
  if (matches.length === 1) {
    return loadTemplate(matches[0].source);
  }

  if (matches.length > 1) {
    throw new TemplateAmbiguousError(matches);
  }

  throw new Error(`No template found for: ${query}`);
}

export async function installSkills(
  containerName: string,
  skills: string[]
): Promise<void> {
  for (const skill of skills) {
    const [owner, repo] = skill.includes("/")
      ? skill.split("/")
      : ["vercel-labs", skill];
    const url = `https://github.com/${owner}/${repo}.git`;
    await execFileAsync(
      "docker",
      [
        "exec",
        containerName,
        "bash",
        "-lc",
        `mkdir -p ~/.agents/skills && git clone --depth 1 ${url} ~/.agents/skills/${repo} 2>/dev/null || true`,
      ],
      { maxBuffer: 10 * 1024 * 1024 }
    );
  }
}
