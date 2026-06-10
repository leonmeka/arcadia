import { readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import yaml from "js-yaml";
import type { Template, TemplateIndexEntry } from "@arcadia/types";
import { TEMPLATES_DIR } from "@arcadia/templates";

const execFileAsync = promisify(execFile);

function parseTemplate(raw: string, source: string): Template {
  const data = yaml.load(raw) as Partial<Template>;
  return {
    name: data.name || "unnamed",
    source,
    defaults: data.defaults || {},
    skills: data.skills || [],
    packages: data.packages || [],
    secrets: data.secrets || { required: [] },
    init: data.init,
  };
}

async function loadLocalTemplates(): Promise<TemplateIndexEntry[]> {
  const entries: TemplateIndexEntry[] = [];

  if (!existsSync(TEMPLATES_DIR)) return entries;

  async function walk(dir: string, prefix = ""): Promise<void> {
    const items = await readdir(dir, { withFileTypes: true });
    for (const item of items) {
      const fullPath = join(dir, item.name);
      if (item.isDirectory()) {
        await walk(fullPath, prefix ? `${prefix}/${item.name}` : item.name);
        continue;
      }
      if (item.name === "template.yaml" || item.name.endsWith(".yaml")) {
        const raw = await readFile(fullPath, "utf8");
        const template = parseTemplate(raw, `local:${prefix || item.name}`);
        entries.push({
          id: prefix || template.name,
          name: template.name,
          path: fullPath,
          source: `local:${prefix || template.name}`,
        });
      }
    }
  }

  await walk(TEMPLATES_DIR);
  return entries;
}

function normalizeTemplateRef(ref: string): {
  owner: string;
  repo: string;
  path: string;
} {
  const cleaned = ref.replace(/^github:/, "").replace(/\.git$/, "");
  const parts = cleaned.split("/");

  if (parts.length >= 3) {
    return {
      owner: parts[0],
      repo: parts[1],
      path: parts.slice(2).join("/"),
    };
  }

  return {
    owner: parts[0] || "arcadia",
    repo: parts[1] || "templates",
    path: parts[2] || "",
  };
}

async function fetchGitHubTemplate(ref: string): Promise<Template> {
  const { owner, repo, path } = normalizeTemplateRef(ref);
  const baseUrl = `https://raw.githubusercontent.com/${owner}/${repo}/main`;
  const candidates = path
    ? [`${baseUrl}/${path}/template.yaml`, `${baseUrl}/${path}.yaml`]
    : [`${baseUrl}/template.yaml`, `${baseUrl}/${repo.split("/").pop()}.yaml`];

  for (const url of candidates) {
    try {
      const response = await fetch(url);
      if (!response.ok) continue;
      const raw = await response.text();
      return parseTemplate(
        raw,
        `github:${owner}/${repo}${path ? `/${path}` : ""}`
      );
    } catch {
      continue;
    }
  }

  throw new Error(`Template not found: ${ref}`);
}

export async function listMatchingTemplates(
  query: string
): Promise<TemplateIndexEntry[]> {
  const local = await loadLocalTemplates();
  const normalized = query.toLowerCase();

  const matches = local.filter((entry) => {
    const id = entry.id.toLowerCase();
    const name = entry.name.toLowerCase().replace(/-/g, " ");
    return id.includes(normalized) || name.includes(normalized);
  });

  if (matches.length > 0) return matches;

  // Built-in fallback when no local templates match
  return [
    {
      id: "default",
      name: query,
      path: join(TEMPLATES_DIR, "default", "template.yaml"),
      source: "local:default",
    },
  ];
}

export async function resolveTemplate(
  query: string,
  fromRef?: string
): Promise<Template> {
  if (fromRef) {
    if (fromRef.startsWith("local:") || existsSync(fromRef)) {
      const path = fromRef.startsWith("local:")
        ? join(TEMPLATES_DIR, fromRef.replace("local:", ""), "template.yaml")
        : fromRef;
      const raw = await readFile(path, "utf8");
      return parseTemplate(raw, fromRef);
    }
    return fetchGitHubTemplate(fromRef);
  }

  const local = await loadLocalTemplates();

  // One local template → always use it (agent name is unrelated to template choice)
  if (local.length === 1) {
    const raw = await readFile(local[0].path, "utf8");
    return parseTemplate(raw, local[0].source);
  }

  const matches = await listMatchingTemplates(query);
  if (matches.length === 1) {
    const raw = await readFile(matches[0].path, "utf8");
    return parseTemplate(raw, matches[0].source);
  }

  if (matches.length > 1) {
    const prompts = (await import("prompts")).default;
    const response = await prompts({
      type: "select",
      name: "template",
      message: "Choose template:",
      choices: matches.map((m) => ({
        title: m.name
          .replace(/-/g, " ")
          .replace(/\b\w/g, (c) => c.toUpperCase()),
        value: m,
        description: m.source,
      })),
    });

    if (!response.template) {
      throw new Error("Template selection cancelled");
    }

    const raw = await readFile(response.template.path, "utf8");
    return parseTemplate(raw, response.template.source);
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
