import type { Template } from "@arcadia/types";
import { loadBuiltinTemplate } from "@/templates/registry";
import { isGitHubRef, loadGitHubTemplate } from "@/templates/github";

export async function loadTemplate(ref: string): Promise<Template> {
  if (ref.startsWith("local:")) {
    return loadBuiltinTemplate(ref.slice("local:".length));
  }

  if (isGitHubRef(ref)) {
    return loadGitHubTemplate(ref);
  }

  if (!ref.includes("/")) {
    return loadBuiltinTemplate(ref);
  }

  throw new Error(`Unsupported template ref: ${ref}`);
}
