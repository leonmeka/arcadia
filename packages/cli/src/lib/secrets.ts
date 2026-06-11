import prompts from "prompts";
import {
  getSecret,
  setSecret,
  validateOpenRouterApiKey,
} from "@arcadia/core";

const SECRET_HINTS: Record<string, string> = {
  OPENROUTER_API_KEY: "OpenRouter API key (sk-or-...)",
};

async function validateSecret(name: string, value: string): Promise<void> {
  if (name === "OPENROUTER_API_KEY") {
    await validateOpenRouterApiKey(value);
  }
}

export async function ensureSecrets(
  required: string[]
): Promise<Record<string, string>> {
  const resolved: Record<string, string> = {};

  for (const secret of required) {
    const stored = await getSecret(secret);
    const label = SECRET_HINTS[secret] ?? secret;

    while (true) {
      const response = await prompts({
        type: "password",
        name: "value",
        message: stored
          ? `${label}\n(Press enter to use stored value)`
          : label,
      });

      let value = response.value?.trim();
      if (!value && stored) {
        value = stored;
      }

      if (!value) {
        throw new Error(`Secret ${secret} is required`);
      }

      try {
        await validateSecret(secret, value);
        await setSecret(secret, value);
        resolved[secret] = value;
        break;
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Invalid secret value";
        console.error(message);
      }
    }
  }

  return resolved;
}
