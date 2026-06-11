import { OpenRouter } from "@openrouter/sdk";
import type { Model } from "@arcadia/types";

/** Agents require tool-capable models. */
const TOOL_FILTER = "tools";

const CACHE_TTL_MS = 60 * 60 * 1000;

let cachedModelIds: Set<string> | null = null;
let cachedAt = 0;

const client = new OpenRouter();

async function loadModelIds(force = false): Promise<Set<string>> {
  if (!force && cachedModelIds && Date.now() - cachedAt < CACHE_TTL_MS) {
    return cachedModelIds;
  }

  try {
    const response = await client.models.list({
      supportedParameters: TOOL_FILTER,
    });
    cachedModelIds = new Set(response.data.map((entry) => entry.id));
    cachedAt = Date.now();
    return cachedModelIds;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "unknown network error";
    throw new Error(
      `Could not fetch OpenRouter models (${message}). Check your network and try again.`
    );
  }
}

export function assertOpenRouterApiKey(key: string): void {
  if (!key.startsWith("sk-or-")) {
    throw new Error(
      "Invalid OpenRouter API key. Keys start with sk-or-. Create one at https://openrouter.ai/keys"
    );
  }
}

export async function validateOpenRouterApiKey(key: string): Promise<void> {
  assertOpenRouterApiKey(key);

  const response = await fetch("https://openrouter.ai/api/v1/auth/key", {
    headers: { Authorization: `Bearer ${key}` },
  });

  if (!response.ok) {
    throw new Error(
      "OpenRouter rejected this API key. Check or recreate it at https://openrouter.ai/keys"
    );
  }
}

export async function validateOpenRouterModel(model: string): Promise<Model> {
  const modelIds = await loadModelIds();
  if (!modelIds.has(model)) {
    throw new Error(
      `Unknown or unsupported OpenRouter model: ${model}. Arcadia requires models that support tool calling. Browse compatible models at https://openrouter.ai/models?supported_parameters=${TOOL_FILTER}`
    );
  }
  return model as Model;
}
