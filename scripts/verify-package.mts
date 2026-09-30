import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, cp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { root, run, pnpm } from "./commands.mts";

const temp = await mkdtemp(join(tmpdir(), "rshono-consumer-"));
let success = false;
try {
  const archive = join(temp, "package.tgz");
  pnpm(["pack", "--out", archive]);
  const entries = execFileSync("tar", ["-tzf", archive], { encoding: "utf8" }).trim().split("\n");
  for (const entry of entries) {
    const name = entry.replace(/^package\//, "");
    assert.ok(
      name.startsWith("dist/") ||
        ["package.json", "README.md", "LICENSE", "CHANGELOG.md"].includes(name),
      `Unexpected package entry: ${name}`,
    );
    assert.ok(!/\.test\.|node_modules|\.env/.test(name), `Unexpected package entry: ${name}`);
  }
  const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  const dependencies = {
    "rshono-react-native": `file:${archive}`,
    react: pkg.peerDependencies.react,
    "react-dom": pkg.peerDependencies["react-dom"],
    "@rshono/core": pkg.peerDependencies["@rshono/core"],
    "@rspack/core": pkg.peerDependencies["@rspack/core"],
    "react-server-dom-rspack": pkg.peerDependencies["react-server-dom-rspack"],
    "metro-config": pkg.peerDependencies["metro-config"],
    hono: pkg.devDependencies.hono,
    vitest: pkg.devDependencies.vitest,
    typescript: pkg.devDependencies.typescript,
    "@types/react": pkg.devDependencies["@types/react"],
    "@types/node": pkg.devDependencies["@types/node"],
  };
  await writeFile(
    join(temp, "package.json"),
    JSON.stringify({
      name: "package-consumer",
      packageManager: pkg.packageManager,
      private: true,
      type: "module",
      dependencies,
    }),
  );
  run("corepack", ["pnpm", "install", "--ignore-scripts"], temp);
  await writeFile(
    join(temp, "check.mts"),
    `
import assert from "node:assert/strict";
import { createNativeClient, RshonoProvider, ServerScreen, RshonoError, type NativeManifest } from "rshono-react-native";
import * as build from "rshono-react-native/build";
import { withRshono } from "rshono-react-native/metro";
const manifest: NativeManifest = {createFromReadableStream:async()=>({root:"ok"})};
assert.equal(typeof createNativeClient({manifest, fetch:async()=>{throw new Error("unused")}}).load,"function");
assert.equal(typeof RshonoProvider,"function");
assert.equal(typeof ServerScreen,"function");
assert.deepEqual(Object.keys(build),["defineNativeConfig"]);
assert.equal(typeof build.defineNativeConfig({nativeRoot:"/not-needed-on-import"}).rspack,"function");
assert.equal(withRshono({projectRoot:process.cwd()}).projectRoot,process.cwd());
assert.equal(new RshonoError("HTTP_ERROR","message",{status:401}).status,401);
for (const suffix of ["/server","/client","/dist/build/options.mjs"]) {
 await assert.rejects(import("rshono-react-native"+suffix),{code:"ERR_PACKAGE_PATH_NOT_EXPORTED"});
}
if(false) {
 // @ts-expect-error The legacy build API is not exported.
 build.defineNativeConfig({output:"client.cjs",components:[]});
 // @ts-expect-error Only known error codes are accepted.
 new RshonoError("UNKNOWN","message");
}
`,
  );
  await writeFile(
    join(temp, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        module: "NodeNext",
        moduleResolution: "NodeNext",
        target: "ES2022",
        strict: true,
        noEmit: true,
        skipLibCheck: true,
        types: ["node", "react"],
      },
      include: ["check.mts"],
    }),
  );
  run(process.execPath, ["node_modules/typescript/bin/tsc"], temp);
  run(process.execPath, ["check.mts"], temp);
  await mkdir(join(temp, "server"));
  await cp(join(root, "example/server/src"), join(temp, "server/src"), {
    recursive: true,
  });
  await cp(join(root, "example/server/rshono.config.ts"), join(temp, "server/rshono.config.ts"));
  await writeFile(join(temp, "server/package.json"), '{"type":"module"}');
  await mkdir(join(temp, "native/src"), { recursive: true });
  await cp(join(root, "example/native/src/components"), join(temp, "native/src/components"), {
    recursive: true,
  });
  await writeFile(join(temp, "native/package.json"), '{"name":"native-consumer"}');
  run(
    process.execPath,
    ["../node_modules/rshono-react-native/dist/build/cli.mjs", "build"],
    join(temp, "server"),
  );
  await cp(join(root, "example/server/vitest.config.mts"), join(temp, "server/vitest.config.mts"));
  run("corepack", ["pnpm", "exec", "vitest", "run"], join(temp, "server"));
  console.log(
    "Standalone package verification passed: public entry points, types, CLI, and RSC responses.",
  );
  success = true;
} finally {
  if (success) await rm(temp, { recursive: true, force: true });
  else console.error(`Failed consumer fixture: ${temp}`);
}
