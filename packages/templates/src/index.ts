import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export const TEMPLATES_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  ".."
);

export function templatePath(id: string): string {
  return join(TEMPLATES_DIR, id, "template.yaml");
}
