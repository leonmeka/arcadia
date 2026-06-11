export type { ModelId as Model } from "@openrouter/sdk/types/models";

import type { ModelId as Model } from "@openrouter/sdk/types/models";

export interface AgentIdentity {
  name: string;
  mood: string;
  properties: string[];
}

export interface TemplateSecrets {
  required: string[];
}

export interface TemplateDefinition {
  name: string;
  model: Model;
  identity?: AgentIdentity;
  skills?: readonly string[];
  packages?: readonly string[];
  secrets?: { required: readonly string[] };
}

export interface Template {
  name: string;
  source: string;
  model: Model;
  identity?: AgentIdentity;
  skills: string[];
  packages: string[];
  secrets: TemplateSecrets;
}

export interface AgentConfig {
  name: string;
  template: string;
  templateName: string;
  identity?: AgentIdentity;
  image: string;
  model: Model;
  createdAt: string;
  skills: string[];
  packages: string[];
  secrets: string[];
}

export interface TemplateIndexEntry {
  id: string;
  name: string;
  source: string;
}

export type ContainerState = "online" | "idle" | "stopped" | "missing";

export interface CreateAgentOptions {
  name: string;
  template: Template;
  model: Model;
  secrets: Record<string, string>;
}

export interface CreateCommandOptions {
  name: string;
  template?: string;
  model?: string;
}
