#!/usr/bin/env node
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { nativeOptionsKey, resolveNativeOptions } from "./options.mjs";

if (process.argv[2] !== "build" || process.argv.length > 3) {
  console.error("Usage: rshono-native build (run in the server project)");
  process.exit(1);
}
const cwd = process.cwd();
const configFile = ["rshono.config.ts", "rshono.config.js", "rshono.config.mjs"]
  .map((name) => resolve(cwd, name))
  .find(existsSync);
if (!configFile) throw new Error("No rshono.config file found.");
const config = (await import(pathToFileURL(configFile).href)).default;
const rawOptions = config[nativeOptionsKey];
if (!rawOptions) throw new Error("Use defineNativeConfig in your RSHono configuration.");
const options = resolveNativeOptions(rawOptions, cwd);
const { output, nativeRoot } = options;
const require = createRequire(resolve(cwd, "package.json"));
const cli = join(dirname(require.resolve("@rshono/core/package.json")), "bin/rshono.mjs");
const result = spawnSync(process.execPath, [cli, "build"], {
  cwd,
  stdio: "inherit",
  env: process.env,
});
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
await mkdir(dirname(output), { recursive: true });
await copyFile(resolve(cwd, "dist/static/native-client.cjs"), output);
await writeFile(
  output.replace(/\.cjs$/, ".d.cts"),
  `import type { NativeManifest } from 'rshono-react-native'\nexport const createFromReadableStream: NativeManifest['createFromReadableStream']\n`,
);
if (nativeRoot) {
  await writeFile(
    resolve(nativeRoot, ".rshono-native/metro.json"),
    JSON.stringify({ watchFolders: options.clientRoots }),
  );
  await writeFile(
    resolve(nativeRoot, ".rshono-native/client.cjs"),
    "exports.getManifest = () => require('./native-client.cjs');\n",
  );
}
const notices = await Promise.all(
  ["@rshono/core", "react-server-dom-rspack"].map(async (name) => {
    const root = dirname(require.resolve(`${name}/package.json`));
    return `${name}\n\n${await readFile(join(root, "LICENSE"), "utf8")}`;
  }),
);
await writeFile(output + ".LICENSE.txt", notices.join("\n\n"));
console.log(`Generated native client: ${output}`);
