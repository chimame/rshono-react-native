import { spawn, type ChildProcess } from "node:child_process";
import { stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { sourceFiles } from "./files.mjs";
import { resolveNativeOptions, nativeOptionsKey } from "./options.mjs";
export async function devCommand(args: string[]) {
  let port = "3100",
    host = "127.0.0.1";
  for (let i = 0; i < args.length; i += 2) {
    if (
      args[i] === "--port" &&
      /^\d+$/.test(args[i + 1] ?? "") &&
      Number(args[i + 1]) > 0 &&
      Number(args[i + 1]) <= 65535
    )
      port = args[i + 1];
    else if (args[i] === "--host" && args[i + 1]) host = args[i + 1];
    else throw new Error("Usage: rshono-native dev [--port 3100] [--host 127.0.0.1]");
  }
  const cwd = process.cwd();
  const configFile = ["rshono.config.ts", "rshono.config.js", "rshono.config.mjs"]
    .map((name) => resolve(cwd, name))
    .find(existsSync);
  if (!configFile) throw new Error("No rshono.config file found.");
  const config = (await import(pathToFileURL(configFile).href)).default;
  const rawOptions = config[nativeOptionsKey];
  const options = resolveNativeOptions(rawOptions, cwd);
  const roots = [
    ...options.clientRoots,
    ...(rawOptions.watchRoots ?? []).map((root: string) => resolve(cwd, root)),
  ];
  const require = createRequire(resolve(cwd, "package.json"));
  const upstream = resolve(dirname(require.resolve("@rshono/core/package.json")), "bin/rshono.mjs");
  const cli = fileURLToPath(new URL("./cli.mjs", import.meta.url));
  let server: ChildProcess | undefined, build: ChildProcess | undefined;
  let stopped = false,
    building = false,
    last = "";
  const runBuild = () =>
    new Promise<boolean>((resolveBuild, reject) => {
      build = spawn(process.execPath, [cli, "build"], { cwd, stdio: "inherit", env: process.env });
      build.once("error", reject);
      build.once("exit", (code) => resolveBuild(code === 0));
    });
  async function stopServer() {
    if (!server || server.exitCode !== null) return;
    const child = server;
    await new Promise<void>((resolveStop) => {
      const timer = setTimeout(() => child.kill("SIGKILL"), 5000);
      child.once("exit", () => {
        clearTimeout(timer);
        resolveStop();
      });
      child.kill("SIGTERM");
    });
    server = undefined;
  }
  async function snapshot() {
    const files = [
      ...(await sourceFiles(roots)),
      configFile!,
      resolve(cwd, "package.json"),
      resolve(cwd, "pnpm-lock.yaml"),
    ];
    return JSON.stringify(
      await Promise.all(
        files.map(async (file) => {
          try {
            const info = await stat(file);
            return [file, info.mtimeMs, info.size];
          } catch {
            return [file, null];
          }
        }),
      ),
    );
  }
  const stop = () => {
    stopped = true;
    build?.kill("SIGTERM");
    server?.kill("SIGTERM");
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  console.log(
    `Native dev: watching source changes, rebuilding RSC and restarting http://${host}:${port}. Start Metro separately with Fast Refresh enabled.`,
  );
  try {
    while (!stopped) {
      const current = await snapshot();
      if (current !== last && !building) {
        building = true;
        last = current;
        await stopServer();
        if ((await runBuild()) && !stopped) {
          server = spawn(process.execPath, [upstream, "start", "--port", port], {
            cwd,
            stdio: "inherit",
            env: { ...process.env, HOST: host },
          });
          server.on("error", (error) => console.error(error));
        }
        building = false;
      }
      await new Promise<void>((resolveWait) => {
        const timer = setTimeout(resolveWait, 750);
        const wake = () => {
          clearTimeout(timer);
          resolveWait();
        };
        process.once("SIGINT", wake);
        process.once("SIGTERM", wake);
        setTimeout(() => {
          process.removeListener("SIGINT", wake);
          process.removeListener("SIGTERM", wake);
        }, 750).unref();
      });
    }
  } finally {
    stop();
    await stopServer();
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
  }
}
