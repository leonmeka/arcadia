# @arcadia/templates

Built-in agent template definitions. Each file is one template:

```
src/
  default.ts
  researcher.ts   # add more as needed
```

Every file exports a single `template`:

```typescript
import type { TemplateDefinition } from "@arcadia/types";

export const template: TemplateDefinition = {
  name: "researcher",
  model: "openai/gpt-4o",
  // ...
};
```

Register new built-ins in `packages/core/src/templates/registry.ts`.

External templates can also live in GitHub repos — see the root README.
