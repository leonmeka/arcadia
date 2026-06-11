import prompts from "prompts";
import { getSecret, setSecret } from "@arcadia/core";

export async function ensureSecrets(
  required: string[]
): Promise<Record<string, string>> {
  const resolved: Record<string, string> = {};

  for (const secret of required) {
    const stored = await getSecret(secret);
    const response = await prompts({
      type: "password",
      name: "value",
      message: stored
        ? `${secret}\n(Press enter to use stored value)`
        : `${secret}`,
    });

    if (response.value) {
      await setSecret(secret, response.value);
      resolved[secret] = response.value;
      continue;
    }

    if (stored) {
      resolved[secret] = stored;
      continue;
    }

    throw new Error(`Secret ${secret} is required`);
  }

  return resolved;
}
