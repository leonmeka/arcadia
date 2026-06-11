function toOpencodeModel(model: string): string {
  return model.startsWith("openrouter/") ? model : `openrouter/${model}`;
}

function buildOpencodePermissions(): Record<string, unknown> {
  return {
    external_directory: {
      "~/.agent/**": "allow",
      "~/.agents/**": "allow",
    },
    read: {
      "*": "allow",
      "/": "deny",
      "/..": "deny",
      "/../**": "deny",
      "*.env": "deny",
      "*.env.*": "deny",
      "*.env.example": "allow",
    },
    edit: "allow",
    glob: "allow",
    grep: "allow",
    skill: "allow",
    todowrite: "allow",
    task: "allow",
    bash: {
      "*": "allow",
      "cd /": "deny",
      "cd /..": "deny",
      "cd /../..": "deny",
      "cd ..": "allow",
    },
    webfetch: "allow",
    websearch: "allow",
    question: "allow",
    doom_loop: "allow",
  };
}

export function buildOpencodeConfig(
  model: string,
  instructionPaths: string | string[]
): string {
  const opencodeModel = toOpencodeModel(model);
  const instructions = Array.isArray(instructionPaths)
    ? instructionPaths
    : [instructionPaths];
  return JSON.stringify(
    {
      $schema: "https://opencode.ai/config.json",
      model: opencodeModel,
      instructions,
      permission: buildOpencodePermissions(),
      provider: {
        openrouter: {
          options: {
            apiKey: "{env:OPENROUTER_API_KEY}",
          },
          models: {
            [model]: { name: model },
          },
        },
      },
    },
    null,
    2
  );
}
