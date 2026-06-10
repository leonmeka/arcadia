/** Normalize a template model into OpenCode's provider/model format. */
export function toOpencodeModel(model: string): string {
  return model.includes("/") ? model : `openrouter/${model}`;
}

/** Split "openai/gpt-4o" into provider + model id for OpenCode config. */
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

export function buildOpencodeConfig(model: string): string {
  const { opencodeModel, provider, modelId } = parseOpencodeModel(model);
  return JSON.stringify(
    {
      $schema: "https://opencode.ai/config.json",
      model: opencodeModel,
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
