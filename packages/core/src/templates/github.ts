import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { createJiti } from "jiti";
import type { Template } from "@arcadia/types";
import {
  definitionToTemplate,
  extractTemplateDefinition,
} from "@/templates/definition";

const execFileAsync = promisify(execFile);

export interface GitHubTemplateRef {
  owner: string;
  repo: string;
  subpath?: string;
  branch?: string;
}

export function parseGitHubRef(ref: string): GitHubTemplateRef | null {
  const cleaned = ref
    .replace(/^github:/, "")
    .replace(/^https?:\/\/github\.com\//, "")
    .replace(/\.git$/, "")
    .replace(/\/$/, "");

  let branch: string | undefined;
  let path = cleaned;

  if (path.includes("@")) {
    [path, branch] = path.split("@");
  } else if (path.includes("#")) {
    [path, branch] = path.split("#");
  }

  const parts = path.split("/").filter(Boolean);
  if (parts.length < 2) {
    return null;
  }

  return {
    owner: parts[0],
    repo: parts[1],
    subpath: parts.length > 2 ? parts.slice(2).join("/") : undefined,
    branch,
  };
}

export function isGitHubRef(ref: string): boolean {
  return parseGitHubRef(ref) !== null;
}

export function formatGitHubSource(ref: GitHubTemplateRef): string {
  const base = `github:${ref.owner}/${ref.repo}`;
  return ref.subpath ? `${base}/${ref.subpath}` : base;
}

function templateCacheDir(ref: GitHubTemplateRef): string {
  const branch = ref.branch ?? "default";
  return join(
    homedir(),
    ".arcadia",
    "template-cache",
    ref.owner,
    ref.repo,
    branch
  );
}

async function ensureGitHubRepo(ref: GitHubTemplateRef): Promise<string> {
  const cacheDir = templateCacheDir(ref);
  if (existsSync(join(cacheDir, ".git"))) {
    return cacheDir;
  }

  await mkdir(cacheDir, { recursive: true });
  const url = `https://github.com/${ref.owner}/${ref.repo}.git`;
  const args = ["clone", "--depth", "1", url, cacheDir];

  if (ref.branch) {
    args.splice(1, 0, "--branch", ref.branch);
  }

  try {
    await execFileAsync("git", args, { maxBuffer: 10 * 1024 * 1024 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Failed to clone template repo github:${ref.owner}/${ref.repo}: ${message}`
    );
  }

  return cacheDir;
}

function resolveTemplateFile(
  repoDir: string,
  ref: GitHubTemplateRef
): string {
  const candidates: string[] = [];

  if (ref.subpath) {
    candidates.push(
      join(repoDir, ref.subpath, "template.ts"),
      join(repoDir, ref.subpath, "index.ts")
    );
  }

  candidates.push(
    join(repoDir, "template.ts"),
    join(repoDir, "src", "template.ts"),
    join(repoDir, "src", "index.ts"),
    join(repoDir, "index.ts")
  );

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error(
    `No template.ts or index.ts found in ${formatGitHubSource(ref)}`
  );
}

export async function loadGitHubTemplate(ref: string): Promise<Template> {
  const parsed = parseGitHubRef(ref);
  if (!parsed) {
    throw new Error(`Invalid GitHub template ref: ${ref}`);
  }

  const repoDir = await ensureGitHubRepo(parsed);
  const templateFile = resolveTemplateFile(repoDir, parsed);
  const jiti = createJiti(import.meta.url, {
    interopDefault: true,
    alias: {
      "@arcadia/types": "@arcadia/types",
    },
  });
  const module = await jiti.import(templateFile);
  const definition = extractTemplateDefinition(module);

  return definitionToTemplate(definition, formatGitHubSource(parsed));
}
