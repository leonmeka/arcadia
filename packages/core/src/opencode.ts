export function toOpencodeModel(model: string): string {
  return model.includes("/") ? model : `openrouter/${model}`;
}

export function parseOpencodeModel(model: string): {
  opencodeModel: string;
  provider: string;
  modelId: string;
} {
  const opencodeModel = toOpencodeModel(model);
  const slash = opencodeModel.indexOf("/");
  if (slash === -1) {
    return { opencodeModel, provider: "openrouter", modelId: opencodeModel };
  }
  return {
    opencodeModel,
    provider: opencodeModel.slice(0, slash),
    modelId: opencodeModel.slice(slash + 1),
  };
}

export function buildOpencodeConfig(
  model: string,
  instructionPaths: string | string[]
): string {
  const { opencodeModel, provider, modelId } = parseOpencodeModel(model);
  const instructions = Array.isArray(instructionPaths)
    ? instructionPaths
    : [instructionPaths];
  return JSON.stringify(
    {
      $schema: "https://opencode.ai/config.json",
      model: opencodeModel,
      instructions,
      permission: {
        external_directory: {
          "~/.agent/**": "allow",
        },
        read: {
          "*": "allow",
          "/": "deny",
          "/..": "deny",
          "/../**": "deny",
        },
        bash: {
          "*": "allow",
          "cd /": "deny",
          "cd /..": "deny",
          "cd /../..": "deny",
          "cd ..": "allow",
        },
      },
      provider: {
        [provider]: {
          models: {
            [modelId]: { name: modelId },
          },
        },
      },
    },
    null,
    2
  );
}
