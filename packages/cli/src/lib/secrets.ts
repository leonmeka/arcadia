import prompts from "prompts";
import {
  MissingSecretsError,
  resolveSecrets,
  setSecret,
} from "@arcadia/core";

export async function ensureSecrets(
  required: string[]
): Promise<Record<string, string>> {
  const provided: Record<string, string> = {};

  while (true) {
    try {
      return await resolveSecrets(required, provided);
    } catch (error) {
      if (!(error instanceof MissingSecretsError)) {
        throw error;
      }

      for (const secret of error.missing) {
        const response = await prompts({
          type: "password",
          name: "value",
          message: `${secret} required\n\nEnter value:`,
        });

        if (!response.value) {
          throw new Error(`Secret ${secret} is required`);
        }

        await setSecret(secret, response.value);
        provided[secret] = response.value;
      }
    }
  }
}
