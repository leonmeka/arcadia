import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { PACKAGE_ROOT } from "./paths.js";
import { docker } from "./docker.js";

export const ARCADIA_NETWORK = "arcadia-net";
export const BUS_CONTAINER = "arcadia-bus";
export const BUS_PORT = 7474;
export const BUS_URL = `http://${BUS_CONTAINER}:${BUS_PORT}`;

export async function ensureArcadiaNetwork(): Promise<void> {
  const networks = await docker(["network", "ls", "--format", "{{.Name}}"]);
  if (!networks.split("\n").includes(ARCADIA_NETWORK)) {
    await docker(["network", "create", ARCADIA_NETWORK]);
  }
}

export async function getBusState(): Promise<"online" | "missing"> {
  try {
    const status = await docker([
      "inspect",
      "-f",
      "{{.State.Status}}",
      BUS_CONTAINER,
    ]);
    return status === "running" ? "online" : "missing";
  } catch {
    return "missing";
  }
}

export async function ensureBusContainer(): Promise<void> {
  await ensureArcadiaNetwork();

  const serverScript = await readFile(
    join(PACKAGE_ROOT, "bus", "server.mjs"),
    "utf8"
  );

  const state = await getBusState();
  if (state === "online") return;

  try {
    await docker(["rm", "-f", BUS_CONTAINER]);
  } catch {
    // not running
  }

  const setup = [
    "cat > /server.mjs << 'ARCADIA_BUS_EOF'",
    serverScript,
    "ARCADIA_BUS_EOF",
    `node /server.mjs`,
  ].join("\n");

  await docker([
    "run",
    "-d",
    "--name",
    BUS_CONTAINER,
    "--network",
    ARCADIA_NETWORK,
    "--label",
    "arcadia.component=bus",
    "-e",
    `PORT=${BUS_PORT}`,
    "node:22-alpine",
    "sh",
    "-lc",
    setup,
  ]);
}

export async function connectAgentToNetwork(agentContainer: string): Promise<void> {
  await ensureArcadiaNetwork();
  try {
    const raw = await docker([
      "inspect",
      "-f",
      "{{json .NetworkSettings.Networks}}",
      agentContainer,
    ]);
    const networks = JSON.parse(raw) as Record<string, unknown>;
    if (networks[ARCADIA_NETWORK]) return;
  } catch {
    return;
  }

  try {
    await docker(["network", "connect", ARCADIA_NETWORK, agentContainer]);
  } catch {
    // already connected or container missing
  }
}

export async function ensureFleetBus(): Promise<void> {
  await ensureBusContainer();
}
