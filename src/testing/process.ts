/**
 * Test support for exercising the application's real command-line entry
 * points (`npm start`, `npm run probe`) as child processes, exactly the way a
 * user runs them from a clean clone. Not a test file itself (no `.test.ts`
 * suffix), so the runner never executes it directly.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** Absolute path of the repository root (the directory holding package.json). */
export const REPOSITORY_ROOT = fileURLToPath(new URL("../..", import.meta.url));

export interface ProcessResult {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stdout: string;
  readonly stderr: string;
}

export interface StartedProcess {
  readonly child: ChildProcess;
  /** The match that satisfied the readiness pattern. */
  readonly ready: RegExpMatchArray;
  /** Everything written so far; keeps growing while the child runs. */
  readonly output: { stdout: string; stderr: string };
  /** Waits for the child to exit and returns its final output. */
  exited(): Promise<ProcessResult>;
}

/** Returns the npm script with the given name from package.json. */
export function npmScript(name: string): string {
  const manifest = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as {
    scripts?: Record<string, string>;
  };
  const script = manifest.scripts?.[name];
  if (script === undefined) {
    throw new Error(`package.json has no "${name}" script`);
  }
  return script;
}

/**
 * Runs `node <script> ...args` from the repository root with the current
 * Node binary and waits for it to exit.
 */
export async function runNode(
  script: string,
  args: readonly string[] = [],
  env: NodeJS.ProcessEnv = {},
): Promise<ProcessResult> {
  const started = spawnNode(script, args, env);
  return started.exited();
}

/**
 * Starts `node <script> ...args` and resolves once its stdout matches
 * `ready`. Rejects if the child exits first or `timeoutMs` elapses.
 */
export async function startNode(
  script: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv,
  ready: RegExp,
  timeoutMs = 15_000,
): Promise<StartedProcess> {
  const started = spawnNode(script, args, env);
  const { child, output } = started;

  const match = await new Promise<RegExpMatchArray>((resolve, reject) => {
    const check = (): void => {
      const found = output.stdout.match(ready);
      if (found !== null) {
        cleanup();
        resolve(found);
      }
    };
    const onExit = (code: number | null, signal: NodeJS.Signals | null): void => {
      cleanup();
      reject(new Error(`${script} exited (code ${code}, signal ${signal}) before becoming ready:\n${output.stderr}`));
    };
    const timer = setTimeout(() => {
      cleanup();
      child.kill("SIGKILL");
      reject(new Error(`${script} did not become ready within ${timeoutMs}ms:\n${output.stdout}\n${output.stderr}`));
    }, timeoutMs);
    const cleanup = (): void => {
      clearTimeout(timer);
      child.stdout?.off("data", check);
      child.off("exit", onExit);
    };
    child.stdout?.on("data", check);
    child.on("exit", onExit);
    check();
  });

  return { ...started, ready: match };
}

function spawnNode(script: string, args: readonly string[], env: NodeJS.ProcessEnv): Omit<StartedProcess, "ready"> {
  const child = spawn(process.execPath, [script, ...args], {
    cwd: REPOSITORY_ROOT,
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const output = { stdout: "", stderr: "" };
  child.stdout?.setEncoding("utf8").on("data", (chunk: string) => {
    output.stdout += chunk;
  });
  child.stderr?.setEncoding("utf8").on("data", (chunk: string) => {
    output.stderr += chunk;
  });
  const exit = once(child, "close") as Promise<[number | null, NodeJS.Signals | null]>;

  return {
    child,
    output,
    exited: async () => {
      const [code, signal] = await exit;
      return { code, signal, stdout: output.stdout, stderr: output.stderr };
    },
  };
}
