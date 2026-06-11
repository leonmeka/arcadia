import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { ContainerState } from "@arcadia/types";
import {
  CONTAINER_LABEL,
  CONTAINER_PREFIX,
  containerName,
} from "@/paths";

const execFileAsync = promisify(execFile);

export class DockerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DockerError";
  }
}

export async function ensureDocker(): Promise<void> {
  try {
    await execFileAsync("docker", ["info"]);
  } catch {
    throw new DockerError(
      "Docker is not running. Start Docker Desktop and try again."
    );
  }
}

export async function docker(args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync("docker", args, {
      maxBuffer: 10 * 1024 * 1024,
    });
    return stdout.trim();
  } catch (error) {
    const err = error as { stderr?: string; message?: string };
    throw new DockerError(err.stderr?.trim() || err.message || "Docker failed");
  }
}

export async function ensureWorkspaceVolume(): Promise<void> {
  const volumes = await docker(["volume", "ls", "--format", "{{.Name}}"]);
  if (!volumes.split("\n").includes("arcadia-workspace")) {
    await docker(["volume", "create", "arcadia-workspace"]);
  }
}

export async function getContainerState(name: string): Promise<ContainerState> {
  try {
    const status = await docker([
      "inspect",
      "-f",
      "{{.State.Status}}",
      containerName(name),
    ]);
    if (status === "running") return "online";
    if (status === "exited" || status === "created") return "idle";
    return "stopped";
  } catch {
    return "missing";
  }
}

export async function containerExists(name: string): Promise<boolean> {
  return (await getContainerState(name)) !== "missing";
}

export async function listArcadiaAgentNames(): Promise<string[]> {
  try {
    const out = await docker([
      "ps",
      "-a",
      "--filter",
      `label=${CONTAINER_LABEL}`,
      "--format",
      "{{.Names}}",
    ]);
    if (!out) return [];

    return out
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((cname) =>
        cname.startsWith(CONTAINER_PREFIX)
          ? cname.slice(CONTAINER_PREFIX.length)
          : cname
      )
      .sort();
  } catch {
    return [];
  }
}

export async function readContainerFile(
  name: string,
  containerPath: string
): Promise<string> {
  const cname = containerName(name);
  const dir = await mkdtemp(join(tmpdir(), "arcadia-read-"));
  const localPath = join(dir, "file");
  try {
    await docker(["cp", `${cname}:${containerPath}`, localPath]);
    return await readFile(localPath, "utf8");
  } catch (error) {
    const err = error as { stderr?: string; message?: string };
    throw new DockerError(
      err.stderr?.trim() || err.message || `Failed to read ${containerPath}`
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export async function writeContainerFile(
  name: string,
  containerPath: string,
  contents: string
): Promise<void> {
  const cname = containerName(name);
  const dir = await mkdtemp(join(tmpdir(), "arcadia-write-"));
  const localPath = join(dir, "file");
  try {
    await writeFile(localPath, contents, "utf8");
    await docker(["cp", localPath, `${cname}:${containerPath}`]);
  } catch (error) {
    const err = error as { stderr?: string; message?: string };
    throw new DockerError(
      err.stderr?.trim() || err.message || `Failed to write ${containerPath}`
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export async function isContainerRunning(name: string): Promise<boolean> {
  return (await getContainerState(name)) === "online";
}

export async function startContainer(name: string): Promise<void> {
  await docker(["start", containerName(name)]);
}

export async function stopContainer(name: string): Promise<void> {
  const state = await getContainerState(name);
  if (state === "missing") {
    throw new DockerError(`Agent container not found: ${name}`);
  }
  if (state === "online" || state === "idle") {
    await docker(["stop", containerName(name)]);
  }
}

export async function removeContainer(name: string): Promise<void> {
  const state = await getContainerState(name);
  if (state === "missing") return;

  if (state === "online") {
    await docker(["stop", containerName(name)]);
  }
  await docker(["rm", "-f", containerName(name)]);
}

export async function inspectContainer(
  name: string
): Promise<Record<string, unknown>> {
  const raw = await docker(["inspect", containerName(name)]);
  return JSON.parse(raw)[0] as Record<string, unknown>;
}
