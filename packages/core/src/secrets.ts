import keytar from "keytar";

const SERVICE = "arcadia";

export async function setSecret(name: string, value: string): Promise<void> {
  await keytar.setPassword(SERVICE, name, value);
}

export async function getSecret(name: string): Promise<string | null> {
  return keytar.getPassword(SERVICE, name);
}

export async function deleteSecret(name: string): Promise<boolean> {
  return keytar.deletePassword(SERVICE, name);
}

export async function ensureSecrets(
  required: string[],
  provided: Record<string, string> = {}
): Promise<Record<string, string>> {
  const resolved: Record<string, string> = { ...provided };

  for (const secret of required) {
    if (resolved[secret]) continue;

    const fromEnv = process.env[secret];
    if (fromEnv) {
      await setSecret(secret, fromEnv);
      resolved[secret] = fromEnv;
      continue;
    }

    const existing = await getSecret(secret);
    if (existing) {
      resolved[secret] = existing;
      continue;
    }

    const prompts = (await import("prompts")).default;
    const response = await prompts({
      type: "password",
      name: "value",
      message: `${secret} required\n\nEnter value:`,
    });

    if (!response.value) {
      throw new Error(`Secret ${secret} is required`);
    }

    await setSecret(secret, response.value);
    resolved[secret] = response.value;
  }

  return resolved;
}
