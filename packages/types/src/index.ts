export interface AgentIdentity {
  name: string;
  mood: string;
  properties: string[];
}

export interface AgentConfig {
  name: string;
  template: string;
  templateName: string;
  identity?: AgentIdentity;
  image: string;
  model: string;
  createdAt: string;
  skills: string[];
  packages: string[];
  secrets: string[];
}

export interface TemplateDefaults {
  model?: string;
}

export interface TemplateSecrets {
  required: string[];
}

export interface Template {
  name: string;
  source: string;
  identity?: AgentIdentity;
  defaults: TemplateDefaults;
  skills: string[];
  packages: string[];
  secrets: TemplateSecrets;
  init?: string[];
}

export interface TemplateIndexEntry {
  id: string;
  name: string;
  path: string;
  source: string;
}

export type ContainerState = "online" | "idle" | "stopped" | "missing";

export interface CreateAgentOptions {
  name: string;
  template: Template;
  model: string;
  secrets: Record<string, string>;
}

export interface CreateCommandOptions {
  name: string;
  from?: string;
  model?: string;
}
