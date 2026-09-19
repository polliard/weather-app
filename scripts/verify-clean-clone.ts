/**
 * Proves that the application is runnable from a clean clone of this
 * repository by doing exactly what the README "Quick start" tells a new user
 * to do, in a fresh clone, and checking every step.
 *
 *   npm run verify:clean-clone                        # offline steps only
 *   WEATHER_LIVE_TESTS=1 npm run verify:clean-clone   # also the live suites
 *   npm run verify:clean-clone -- --keep              # leave the clone behind
 *   npm run verify:clean-clone -- --dir <path>        # clone into <path> (must not exist)
 *
 * Steps:
 *   1. git clone the committed HEAD into a fresh directory
 *   2. npm ci
 *   3. npm run typecheck
 *   4. npm test
 *   5. npm start on an ephemeral port; GET /healthz, /, and a bad request; SIGTERM; expect exit 0
 *   6. npm run test:live (only when WEATHER_LIVE_TESTS=1 is set)
 *
 * Only committed work is verified: uncommitted changes never reach the clone.
 * The clone is deleted after a successful run and kept for inspection after a
 * failed one.
 *
 * Exit codes: 0 every step passed, 1 a step failed, 2 usage error.
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Absolute path of the repository root (the directory holding package.json). */
export const REPOSITORY_ROOT = fileURLToPath(new URL("..", import.meta.url));

export const USAGE = "usage: npm run verify:clean-clone -- [--keep] [--dir <path>]";

export interface VerifyArgs {
  readonly keep: boolean;
  readonly dir?: string;
}

export class VerifyUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VerifyUsageError";
  }
}

/** Parses `[--keep] [--dir <path>]` from raw CLI arguments. */
export function parseVerifyArgs(argv: readonly string[]): VerifyArgs {
  let keep = false;
  let dir: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--keep") {
      keep = true;
    } else if (argument === "--dir") {
      const value = argv[index + 1];
      if (value === undefined || value.trim() === "") {
        throw new VerifyUsageError("--dir requires a path");
      }
      dir = value;
      index += 1;
    } else {
      throw new VerifyUsageError(`unknown argument ${JSON.stringify(argument)}`);
    }
  }
  return dir === undefined ? { keep } : { keep, dir };
}

class StepFailed extends Error {
  constructor(step: string, detail: string) {
    super(`${step}: ${detail}`);
    this.name = "StepFailed";
  }
}

const NPM = process.platform === "win32" ? "npm.cmd" : "npm";
const SERVER_READY = /weather app listening on (http:\/\/\S+)/;
const SERVER_READY_TIMEOUT_MS = 15_000;

function log(message: string): void {
  process.stdout.write(`==> ${message}\n`);
}

/** Runs a command to completion with inherited stdio, failing the step on a non-zero exit. */
function run(step: string, command: string, args: readonly string[], cwd: string, env: NodeJS.ProcessEnv = {}): void {
  log(`${step}: ${command} ${args.join(" ")}`);
  const result = spawnSync(command, args, {
    cwd,
    env: { ...process.env, ...env },
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.error !== undefined) {
    throw new StepFailed(step, `could not run ${command}: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new StepFailed(step, `${command} exited with ${result.status ?? `signal ${result.signal}`}`);
  }
}

/** Runs a command and returns its trimmed stdout, failing the step on a non-zero exit. */
function capture(step: string, command: string, args: readonly string[], cwd: string): string {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", shell: process.platform === "win32" });
  if (result.error !== undefined) {
    throw new StepFailed(step, `could not run ${command}: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new StepFailed(step, `${command} ${args.join(" ")} exited with ${result.status}: ${result.stderr.trim()}`);
  }
  return result.stdout.trim();
}

function cloneRepository(clone: string): void {
  const step = "clone";
  const head = capture(step, "git", ["rev-parse", "HEAD"], REPOSITORY_ROOT);
  const dirty = capture(step, "git", ["status", "--porcelain"], REPOSITORY_ROOT);
  if (dirty !== "") {
    log(`${step}: the working tree has uncommitted changes; they are NOT part of the clone`);
  }
  run(step, "git", ["clone", "--quiet", REPOSITORY_ROOT, clone], REPOSITORY_ROOT);
  const cloned = capture(step, "git", ["rev-parse", "HEAD"], clone);
  if (cloned !== head) {
    throw new StepFailed(step, `the clone checked out ${cloned} but the repository HEAD is ${head} (is HEAD detached?)`);
  }
  log(`${step}: ${clone} is at ${head}`);
}

/** The `start` script from the clone's package.json, split into command words. */
function startScript(clone: string): readonly string[] {
  const manifest = JSON.parse(readFileSync(join(clone, "package.json"), "utf8")) as { scripts?: Record<string, string> };
  const script = manifest.scripts?.["start"];
  if (script === undefined) {
    throw new StepFailed("start", "package.json has no \"start\" script");
  }
  const words = script.split(/\s+/).filter((word) => word !== "");
  if (words[0] !== "node") {
    throw new StepFailed("start", `expected the start script to run node, got ${JSON.stringify(script)}`);
  }
  return words;
}

/**
 * Starts the server the way `npm start` does (the same script, run with the
 * current Node binary so signals reach it directly), checks that it answers,
 * and shuts it down with SIGTERM.
 */
async function verifyServer(clone: string): Promise<void> {
  const step = "start";
  const [, ...args] = startScript(clone);
  log(`${step}: node ${args.join(" ")} (PORT=0 HOST=127.0.0.1)`);
  const child = spawn(process.execPath, args, {
    cwd: clone,
    env: { ...process.env, PORT: "0", HOST: "127.0.0.1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const output = { stdout: "", stderr: "" };
  child.stdout?.setEncoding("utf8").on("data", (chunk: string) => {
    output.stdout += chunk;
  });
  child.stderr?.setEncoding("utf8").on("data", (chunk: string) => {
    output.stderr += chunk;
  });
  const closed = once(child, "close") as Promise<[number | null, NodeJS.Signals | null]>;

  const url = await waitForReady(child, output, step);
  log(`${step}: listening on ${url}`);
  try {
    await expectResponses(url);
  } finally {
    child.kill("SIGTERM");
  }

  const [code, signal] = await closed;
  if (code !== 0) {
    throw new StepFailed(step, `server exited with ${code ?? `signal ${signal}`} after SIGTERM:\n${output.stderr}`);
  }
  if (!/received SIGTERM, shutting down/.test(output.stdout)) {
    throw new StepFailed(step, `server did not report a clean shutdown:\n${output.stdout}`);
  }
  log(`${step}: shut down cleanly on SIGTERM`);
}

function waitForReady(child: ChildProcess, output: { stdout: string; stderr: string }, step: string): Promise<string> {
  return new Promise<string>((resolvePromise, reject) => {
    const check = (): void => {
      const found = output.stdout.match(SERVER_READY);
      if (found?.[1] !== undefined) {
        cleanup();
        resolvePromise(found[1]);
      }
    };
    const onExit = (code: number | null, signal: NodeJS.Signals | null): void => {
      cleanup();
      reject(new StepFailed(step, `server exited (code ${code}, signal ${signal}) before becoming ready:\n${output.stderr}`));
    };
    const timer = setTimeout(() => {
      cleanup();
      child.kill("SIGKILL");
      reject(new StepFailed(step, `server did not become ready within ${SERVER_READY_TIMEOUT_MS}ms:\n${output.stdout}\n${output.stderr}`));
    }, SERVER_READY_TIMEOUT_MS);
    const cleanup = (): void => {
      clearTimeout(timer);
      child.stdout?.off("data", check);
      child.off("exit", onExit);
    };
    child.stdout?.on("data", check);
    child.on("exit", onExit);
    check();
  });
}

/** Requests only routes that never contact the weather provider, so this stays offline. */
async function expectResponses(url: string): Promise<void> {
  const step = "start";

  const health = await fetch(`${url}/healthz`);
  const healthBody = (await health.json()) as { status?: string };
  if (health.status !== 200 || healthBody.status !== "ok") {
    throw new StepFailed(step, `GET /healthz returned ${health.status} ${JSON.stringify(healthBody)}`);
  }
  log(`${step}: GET /healthz -> ${health.status} ${JSON.stringify(healthBody)}`);

  const landing = await fetch(`${url}/`);
  const html = await landing.text();
  if (landing.status !== 200 || !landing.headers.get("content-type")?.startsWith("text/html") || !/<form/.test(html)) {
    throw new StepFailed(step, `GET / returned ${landing.status} ${landing.headers.get("content-type") ?? ""} without the search form`);
  }
  log(`${step}: GET / -> ${landing.status} ${landing.headers.get("content-type") ?? ""}`);

  const bad = await fetch(`${url}/api/weather?lat=abc&lon=0`);
  if (bad.status !== 400) {
    throw new StepFailed(step, `GET /api/weather?lat=abc&lon=0 returned ${bad.status}, expected 400`);
  }
  log(`${step}: GET /api/weather?lat=abc&lon=0 -> ${bad.status}`);
}

function chooseCloneDirectory(args: VerifyArgs): string {
  if (args.dir === undefined) {
    return mkdtempSync(join(tmpdir(), "weather-app-clean-clone-"));
  }
  const dir = resolve(args.dir);
  if (existsSync(dir)) {
    throw new VerifyUsageError(`--dir ${dir} already exists; a clean clone needs a fresh directory`);
  }
  return dir;
}

/** Runs every step and returns the process exit code. */
export async function verifyCleanClone(argv: readonly string[], env: NodeJS.ProcessEnv = process.env): Promise<number> {
  let args: VerifyArgs;
  let clone: string;
  try {
    args = parseVerifyArgs(argv);
    clone = chooseCloneDirectory(args);
  } catch (error) {
    if (error instanceof VerifyUsageError) {
      process.stderr.write(`${error.message}\n${USAGE}\n`);
      return 2;
    }
    throw error;
  }

  try {
    cloneRepository(clone);
    run("install", NPM, ["ci"], clone);
    run("typecheck", NPM, ["run", "typecheck"], clone);
    run("test", NPM, ["test"], clone);
    await verifyServer(clone);
    if (env["WEATHER_LIVE_TESTS"] === "1") {
      run("live", NPM, ["run", "test:live"], clone);
    } else {
      log("live: skipped (set WEATHER_LIVE_TESTS=1 to run the live suites in the clone)");
    }
  } catch (error) {
    if (error instanceof StepFailed) {
      process.stderr.write(`FAILED ${error.message}\nclone kept for inspection at ${clone}\n`);
      return 1;
    }
    throw error;
  }

  if (args.keep) {
    log(`done: clone kept at ${clone}`);
  } else {
    rmSync(clone, { recursive: true, force: true });
    log(`done: clone removed from ${clone}`);
  }
  log("the application is runnable from a clean clone of this repository");
  return 0;
}

// Only run when executed directly (`node scripts/verify-clean-clone.ts`), not when imported.
if (import.meta.filename === process.argv[1]) {
  process.exitCode = await verifyCleanClone(process.argv.slice(2));
}
