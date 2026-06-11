import type { TemplateIndexEntry } from "@arcadia/types";

export class TemplateAmbiguousError extends Error {
  readonly matches: TemplateIndexEntry[];

  constructor(matches: TemplateIndexEntry[]) {
    super("Multiple templates match the query");
    this.name = "TemplateAmbiguousError";
    this.matches = matches;
  }
}

export class MissingSecretsError extends Error {
  readonly missing: string[];

  constructor(missing: string[]) {
    super(`Missing secrets: ${missing.join(", ")}`);
    this.name = "MissingSecretsError";
    this.missing = missing;
  }
}
