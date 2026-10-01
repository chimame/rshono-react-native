#!/usr/bin/env node
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { copyFile, mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { nativeOptionsKey, resolveNativeOptions } from "./options.mjs";

import { prepareEntry, writeActionProxies } from "./files.mjs";
import { doctor } from "./doctor.mjs";
import { devCommand } from "./dev.mjs";
const command = process.argv[2];
if (!["build", "dev", "doctor"].includes(command ?? "")) {
  console.error(
    "Usage: rshono-native build | dev [--port 3100] [--host 127.0.0.1] | doctor [--origin URL]",
  );
  process.exit(1);
}
if (command === "doctor") {
  process.exitCode = await doctor(process.cwd(), process.argv.slice(3));
} else if (command === "dev") {
  await devCommand(process.argv.slice(3));
} else {
  if (process.argv.length > 3) throw new Error("Usage: rshono-native build");
  await buildNative();
}
export async function buildNative() {
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
  const sourceRoots = [
    ...options.clientRoots,
    ...(rawOptions.watchRoots ?? []).map((root: string) => resolve(cwd, root)),
  ];
  const { actions } = await prepareEntry(sourceRoots, nativeRoot);
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
  await copyFile(resolve(cwd, "dist/static/native-client.cjs"), output + ".tmp");
  await rename(output + ".tmp", output);
  await writeAtomic(
    output.replace(/\.cjs$/, ".d.cts"),
    `import type { NativeManifest } from 'rshono-react-native'\nexport const createFromReadableStream: NativeManifest['createFromReadableStream']\nexport const encodeReply: NonNullable<NativeManifest['encodeReply']>\nexport const createTemporaryReferenceSet: NonNullable<NativeManifest['createTemporaryReferenceSet']>\nexport const getServerFunctionId: NonNullable<NativeManifest['getServerFunctionId']>\n`,
  );
  if (nativeRoot) {
    await writeFile(
      resolve(nativeRoot, ".rshono-native/metro.json.tmp"),
      JSON.stringify({
        watchFolders: sourceRoots,
        actions: await writeActionProxies(actions, nativeRoot),
      }),
    );
    await rename(
      resolve(nativeRoot, ".rshono-native/metro.json.tmp"),
      resolve(nativeRoot, ".rshono-native/metro.json"),
    );
  }
  const notices = await Promise.all(
    ["@rshono/core", "react-server-dom-rspack"].map(async (name) => {
      const root = dirname(require.resolve(`${name}/package.json`));
      return `${name}\n\n${await readFile(join(root, "LICENSE"), "utf8")}`;
    }),
  );
  await writeAtomic(output + ".LICENSE.txt", notices.join("\n\n"));
  // Publish the manifest entry last: it triggers Metro reload after the decoder,
  // proxies, resolver metadata, declarations, and notices have been written.
  // Each replacement is atomic; the set is not a filesystem-wide transaction.
  await writeAtomic(
    resolve(nativeRoot, ".rshono-native/client.cjs"),
    `// build ${Date.now()}\nexports.getManifest = () => require('./native-client.cjs');\n`,
  );
  console.log(`Generated native client: ${output}`);
}

async function writeAtomic(file: string, contents: string) {
  await writeFile(file + ".tmp", contents);
  await rename(file + ".tmp", file);
}
