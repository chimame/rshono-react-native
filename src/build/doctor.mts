import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { nativeOptionsKey, resolveNativeOptions } from "./options.mjs";
export type Diagnostic = { level: "ok" | "warning" | "error"; message: string };
export async function diagnose(cwd: string): Promise<Diagnostic[]> {
  const diagnostics: Diagnostic[] = [];
  const pkg = JSON.parse(
    readFileSync(fileURLToPath(new URL("../../package.json", import.meta.url)), "utf8"),
  );
  const checkPackages = (root: string, names: string[]) => {
    const require = createRequire(resolve(root, "package.json"));
    for (const name of names) {
      try {
        const installed = require(`${name}/package.json`).version as string;
        const expected = pkg.peerDependencies[name] as string;
        const matches = expected.startsWith("^")
          ? installed.split(".").slice(0, 2).join(".") ===
            expected.slice(1).split(".").slice(0, 2).join(".")
          : installed === expected;
        diagnostics.push({
          level: matches ? "ok" : "error",
          message: `${root}: ${name} ${installed}${matches ? "" : `; supported version: ${expected}`}`,
        });
      } catch {
        diagnostics.push({
          level: "error",
          message: `${root}: install ${name}@${pkg.peerDependencies[name]}`,
        });
      }
    }
  };
  diagnostics.push({
    level:
      Number(process.versions.node.split(".")[0]) >= 22 &&
      (Number(process.versions.node.split(".")[0]) > 22 ||
        Number(process.versions.node.split(".")[1]) >= 18)
        ? "ok"
        : "error",
    message: `Node ${process.versions.node}; requires >=22.18.0`,
  });
  checkPackages(cwd, [
    "react",
    "react-dom",
    "@rshono/core",
    "@rspack/core",
    "react-server-dom-rspack",
  ]);
  try {
    const file = ["rshono.config.ts", "rshono.config.js", "rshono.config.mjs"]
      .map((name) => resolve(cwd, name))
      .find(existsSync);
    if (!file) throw new Error("No rshono.config found. Add defineNativeConfig({nativeRoot}).");
    const config = (await import(pathToFileURL(file).href)).default;
    const options = resolveNativeOptions(config[nativeOptionsKey], cwd);
    checkPackages(options.nativeRoot, ["react", "react-dom", "metro-config"]);
    for (const name of ["native-client.cjs", "client.cjs", "metro.json"])
      diagnostics.push({
        level: existsSync(resolve(dirname(options.output), name)) ? "ok" : "error",
        message: `Generated ${name}: run rshono-native build if missing.`,
      });
    const metro = ["metro.config.cjs", "metro.config.js"]
      .map((name) => resolve(options.nativeRoot, name))
      .find(existsSync);
    diagnostics.push({
      level: metro && /withRshono/.test(readFileSync(metro, "utf8")) ? "ok" : "warning",
      message:
        "Metro must wrap its final configuration in withRshono(config). Runtime verification is still required for composed configs.",
    });
    const nativeRequire = createRequire(resolve(options.nativeRoot, "package.json"));
    let expo = false;
    try {
      nativeRequire.resolve("expo/fetch");
      expo = true;
    } catch {}
    diagnostics.push({
      level: expo ? "ok" : "warning",
      message: expo
        ? "expo/fetch is available; pass it to RshonoProvider."
        : "Provide a streaming fetch implementation. Global React Native fetch may not expose response.body.",
    });
  } catch (error) {
    diagnostics.push({ level: "error", message: (error as Error).message });
  }
  return diagnostics;
}
export async function doctor(cwd: string, args: string[]) {
  if (args.length && (args.length !== 2 || args[0] !== "--origin"))
    throw new Error("Usage: rshono-native doctor [--origin https://server/native]");
  const results = await diagnose(cwd);
  if (args[1]) {
    try {
      const url = new URL(args[1]);
      if (!["http:", "https:"].includes(url.protocol) || url.username || url.password)
        throw new Error("Use an HTTP(S) URL without credentials.");
      const response = await fetch(url, {
        headers: { RSC: "1" },
        signal: AbortSignal.timeout(5000),
        redirect: "manual",
      });
      results.push({
        level:
          response.ok &&
          response.headers.get("content-type")?.startsWith("text/x-component") &&
          response.body
            ? "ok"
            : "error",
        message: `Streaming RSC endpoint: HTTP ${response.status}, ${response.headers.get("content-type") ?? "missing content-type"}`,
      });
      await response.body?.cancel();
    } catch (error) {
      results.push({ level: "error", message: `Endpoint check: ${(error as Error).message}` });
    }
  }
  for (const result of results) console.log(`[${result.level}] ${result.message}`);
  return results.some((result) => result.level === "error") ? 1 : 0;
}
