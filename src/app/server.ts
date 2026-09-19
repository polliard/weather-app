/**
 * HTTP entry point for the weather application.
 *
 *   npm start                 # listens on http://127.0.0.1:3000
 *   PORT=8080 npm start       # choose the port
 *   HOST=0.0.0.0 npm start    # listen on every interface
 *
 * Adapts the transport-agnostic handler in `app.ts` to Node's built-in
 * `http` server. No framework, no runtime dependencies.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import { OpenMeteoDataSource } from "../weather/open-meteo.ts";
import { OpenMeteoGeocoder } from "./geocode.ts";
import { createWeatherApp, type WeatherApp } from "./app.ts";

export const DEFAULT_HOST = "127.0.0.1";
export const DEFAULT_PORT = 3000;

export interface ServerOptions {
  readonly host?: string;
  /** Port to listen on; `0` asks the OS for a free port (used by tests). */
  readonly port?: number;
}

export interface RunningServer {
  /** Base URL the server is reachable at, e.g. "http://127.0.0.1:3000". */
  readonly url: string;
  readonly server: Server;
  close(): Promise<void>;
}

/** Wraps `app` in a Node HTTP server and starts listening. */
export async function startServer(app: WeatherApp, options: ServerOptions = {}): Promise<RunningServer> {
  const host = options.host ?? DEFAULT_HOST;
  const port = options.port ?? DEFAULT_PORT;
  const server = createServer((req, res) => {
    void dispatch(app, req, res);
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address() as AddressInfo;
  const displayHost = address.family === "IPv6" ? `[${address.address}]` : address.address;
  return {
    url: `http://${displayHost}:${address.port}`,
    server,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error === undefined ? resolve() : reject(error)));
      }),
  };
}

async function dispatch(app: WeatherApp, req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    const response = await app.handle({ method: req.method ?? "GET", url });
    res.writeHead(response.status, {
      ...response.headers,
      "content-length": Buffer.byteLength(response.body),
    });
    res.end(req.method === "HEAD" ? undefined : response.body);
  } catch (error) {
    // Unexpected failure: never leak details to the client, but keep the process alive.
    console.error("unhandled error while serving request", error);
    if (!res.headersSent) {
      res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    }
    res.end("Internal server error\n");
  }
}

/** Reads `PORT`/`HOST` from the environment, rejecting unusable values. */
export function optionsFromEnv(env: NodeJS.ProcessEnv): ServerOptions {
  const options: { host?: string; port?: number } = {};
  if (env["HOST"] !== undefined && env["HOST"] !== "") {
    options.host = env["HOST"];
  }
  if (env["PORT"] !== undefined && env["PORT"] !== "") {
    const port = Number(env["PORT"]);
    if (!Number.isInteger(port) || port < 0 || port > 65535) {
      throw new RangeError(`PORT must be an integer in [0, 65535], got ${JSON.stringify(env["PORT"])}`);
    }
    options.port = port;
  }
  return options;
}

async function main(): Promise<void> {
  const app = createWeatherApp({ weather: new OpenMeteoDataSource(), geocoder: new OpenMeteoGeocoder() });
  const running = await startServer(app, optionsFromEnv(process.env));
  console.log(`weather app listening on ${running.url}`);

  const shutdown = (signal: NodeJS.Signals): void => {
    console.log(`received ${signal}, shutting down`);
    void running.close().then(() => process.exit(0));
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

// Only run when executed directly (`node src/app/server.ts`), not when imported by tests.
if (import.meta.filename === process.argv[1]) {
  await main();
}
