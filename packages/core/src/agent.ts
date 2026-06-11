import { listAgentNames } from "@/config";
import { getContainerState, startContainer } from "@/docker";
import { syncAgentScripts } from "@/agent-scripts";

export { buildAgentConfig, createAgentContainer } from "@/agent-provision";
export { syncAgentWorkspace } from "@/agent-workspace";
export { syncAgentScripts } from "@/agent-scripts";

export async function syncFleetToAllAgents(): Promise<void> {
  const names = await listAgentNames();

  for (const agentName of names) {
    const state = await getContainerState(agentName);
    if (state === "missing") continue;
    if (state !== "online") {
      await startContainer(agentName).catch(() => {});
    }
    try {
      await syncAgentScripts(agentName);
    } catch {
      // Skip agents that fail to sync
    }
  }
}
