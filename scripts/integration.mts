import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { dirname, join } from "node:path";
import { root, pnpm } from "./commands.mts";

export async function integration() {
  const reservation = createServer();
  reservation.listen(0, "127.0.0.1");
  await once(reservation, "listening");
  const address = reservation.address();
  if (!address || typeof address === "string") throw new Error("Could not allocate a test port.");
  const port = address.port;
  await new Promise<void>((resolve, reject) =>
    reservation.close((error) => (error ? reject(error) : resolve())),
  );
  const cwd = join(root, "example/server");
  const require = createRequire(join(cwd, "package.json"));
  const cli = join(dirname(require.resolve("@rshono/core/package.json")), "bin/rshono.mjs");
  const child = spawn(process.execPath, [cli, "start", "--port", String(port)], {
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let logs = "";
  child.stdout.on("data", (chunk) => {
    logs += String(chunk);
  });
  child.stderr.on("data", (chunk) => {
    logs += String(chunk);
  });
  let spawnError: Error | undefined;
  child.on("error", (error) => {
    spawnError = error;
  });
  const origin = `http://127.0.0.1:${port}`;
  try {
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      if (spawnError) throw spawnError;
      if (child.exitCode !== null) throw new Error(logs);
      try {
        if (
          (
            await fetch(`${origin}/health`, {
              signal: AbortSignal.timeout(500),
            })
          ).ok
        ) {
          ready = true;
          break;
        }
      } catch {
        /* Wait for the server to start. */
      }
      await delay(100);
    }
    if (!ready) throw new Error(`Timed out waiting for RSHono to start.\n${logs}`);
    pnpm(["--filter", "rshono-native-example", "test", "--watchman=false"], {
      ...process.env,
      RSHONO_POC_URL: origin,
    });
  } finally {
    if (child.exitCode === null && child.pid) {
      const exited = once(child, "exit");
      child.kill("SIGTERM");
      const timer = setTimeout(() => child.kill("SIGKILL"), 3000);
      try {
        await exited;
      } finally {
        clearTimeout(timer);
      }
    }
  }
}
