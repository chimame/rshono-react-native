import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, cp, symlink, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import { root } from "./commands.mts";
import { pathToFileURL } from "node:url";

// Isolate edits and generated bundles from the checkout and any running example.
const temp = await mkdtemp(join(tmpdir(), "rshono-dev-"));
let child: ReturnType<typeof spawn> | undefined;
let logs = "";
async function waitFor(check: () => Promise<boolean>, label: string) {
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    if (child?.exitCode !== null) throw new Error(`Dev exited: ${logs}`);
    try {
      if (await check()) return;
    } catch {
      /* Server is restarting or output is not ready. */
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`${label}: ${logs}`);
}
async function stopChild() {
  const current = child;
  if (current && current.exitCode === null)
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => current.kill("SIGKILL"), 6000);
      current.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
      current.kill("SIGTERM");
    });
  child = undefined;
}
function boundAddresses() {
  return logs
    .split("\n")
    .filter((line) => line.startsWith("RSHONO_TEST_BOUND "))
    .map(
      (line) =>
        JSON.parse(line.slice("RSHONO_TEST_BOUND ".length)) as { address: string; port: number },
    );
}
try {
  await mkdir(join(temp, "server"));
  await mkdir(join(temp, "native"));
  await cp(join(root, "example/server/src"), join(temp, "server/src"), { recursive: true });
  await cp(join(root, "example/native/src"), join(temp, "native/src"), { recursive: true });
  await cp(join(root, "example/server/rshono.config.ts"), join(temp, "server/rshono.config.ts"));
  await writeFile(join(temp, "server/package.json"), '{"type":"module"}');
  await writeFile(join(temp, "native/package.json"), '{"name":"native-dev-fixture"}');
  await symlink(
    join(root, "example/server/node_modules"),
    join(temp, "server/node_modules"),
    "dir",
  );
  await symlink(
    join(root, "example/native/node_modules"),
    join(temp, "native/node_modules"),
    "dir",
  );
  const listener = createServer();
  await new Promise<void>((resolve) => listener.listen(0, "127.0.0.1", resolve));
  const port = (listener.address() as { port: number }).port;
  await new Promise<void>((resolve, reject) =>
    listener.close((error) => (error ? reject(error) : resolve())),
  );
  // Observe the actual Node listener in fixture processes, rather than trusting CLI URLs
  // (upstream prints "localhost" for 0.0.0.0). Production code is not instrumented.
  const probe = join(temp, "address-probe.mjs");
  await writeFile(
    probe,
    `import {Server} from "node:net";
const listen=Server.prototype.listen;
Server.prototype.listen=function(...args){
 this.once("listening",()=>console.log("RSHONO_TEST_BOUND "+JSON.stringify(this.address())));
 return Reflect.apply(listen,this,args);
};`,
  );
  const startChild = (host: string) => {
    logs = "";
    child = spawn(
      process.execPath,
      [join(root, "dist/build/cli.mjs"), "dev", "--port", String(port), "--host", host],
      {
        cwd: join(temp, "server"),
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...process.env,
          HOST: host === "0.0.0.0" ? "127.0.0.1" : "0.0.0.0",
          NODE_OPTIONS: [process.env.NODE_OPTIONS, `--import=${pathToFileURL(probe).href}`]
            .filter(Boolean)
            .join(" "),
        },
      },
    );
    child.stdout?.on("data", (part) => {
      logs += String(part);
    });
    child.stderr?.on("data", (part) => {
      logs += String(part);
    });
    child.on("error", (error) => {
      logs += String(error);
    });
  };
  startChild("127.0.0.1");
  const origin = `http://127.0.0.1:${port}`;
  await waitFor(async () => (await fetch(`${origin}/health`)).ok, "initial build");
  await waitFor(
    async () =>
      boundAddresses().some((address) => address.port === port && address.address === "127.0.0.1"),
    "loopback bind address",
  );
  const file = join(temp, "server/src/page.tsx"),
    source = await readFile(file, "utf8");
  await writeFile(file, source.replace("Screen from RSHono", "Watch rebuild verified"));
  await waitFor(
    async () =>
      (await (await fetch(`${origin}/native`, { headers: { RSC: "1" } })).text()).includes(
        "Watch rebuild verified",
      ),
    "server edit rebuild",
  );
  const decoder = join(temp, "native/.rshono-native/client.cjs");
  const before = await readFile(decoder, "utf8");
  const nativeFile = join(temp, "native/src/components/Counter.tsx");
  await writeFile(nativeFile, (await readFile(nativeFile, "utf8")) + "\n// Native watch fixture\n");
  await waitFor(async () => (await readFile(decoder, "utf8")) !== before, "native edit rebuild");
  const logOffset = logs.length;
  await writeFile(file, "export default function Invalid( {\n");
  await waitFor(
    async () => /ERROR|Error|failed/i.test(logs.slice(logOffset)),
    "failed build diagnostics",
  );
  await writeFile(file, source.replace("Screen from RSHono", "Recovered watch build"));
  await waitFor(
    async () =>
      (await (await fetch(`${origin}/native`, { headers: { RSC: "1" } })).text()).includes(
        "Recovered watch build",
      ),
    "failed build recovery",
  );
  assert.match(logs, /Native dev: watching/);
  await stopChild();
  startChild("0.0.0.0");
  await waitFor(async () => (await fetch(`${origin}/health`)).ok, "wildcard host server");
  await waitFor(
    async () =>
      boundAddresses().some((address) => address.port === port && address.address === "0.0.0.0"),
    "wildcard bind address",
  );
  const wildcardBuild = await readFile(decoder, "utf8");
  await writeFile(
    nativeFile,
    (await readFile(nativeFile, "utf8")) + "\n// Wildcard host rebuild fixture\n",
  );
  await waitFor(
    async () =>
      (await readFile(decoder, "utf8")) !== wildcardBuild &&
      boundAddresses().filter((address) => address.port === port && address.address === "0.0.0.0")
        .length >= 2 &&
      (await fetch(`${origin}/health`)).ok,
    "wildcard bind after rebuild",
  );
  console.log(
    "Development verification passed: initial server, source rebuild, native regeneration, failed build recovery, loopback/wildcard binds (including rebuild), process cleanup.",
  );
} finally {
  await stopChild();
  await rm(temp, { recursive: true, force: true });
}
