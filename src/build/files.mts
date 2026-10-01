import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, relative, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parse } from "@babel/parser";
export async function sourceFiles(roots: string[]): Promise<string[]> {
  const files = new Set<string>();
  for (const root of roots) {
    try {
      for (const entry of await readdir(root, { recursive: true, withFileTypes: true })) {
        if (!entry.isFile() || !/\.[cm]?[jt]sx?$/.test(entry.name)) continue;
        const file = resolve(entry.parentPath, entry.name);
        if (
          /(?:^|[\\/])(?:node_modules|dist|\.rshono-native|\.git|\.expo)(?:[\\/]|$)/.test(
            relative(root, file),
          )
        )
          continue;
        files.add(file);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return [...files].sort();
}
export async function prepareEntry(roots: string[], nativeRoot: string) {
  const dir = resolve(nativeRoot, ".rshono-native");
  await mkdir(dir, { recursive: true });
  const actions: string[] = [];
  for (const file of await sourceFiles(roots)) {
    const source = await readFile(file, "utf8");
    if (!source.includes("use server")) continue;
    const ast = parse(source, { sourceType: "unambiguous", plugins: ["typescript", "jsx"] });
    if (ast.program.directives.some((d) => d.value.value === "use server")) actions.push(file);
  }
  const runtime = fileURLToPath(new URL("./flight-entry.mjs", import.meta.url));
  const imports = actions
    .map((file, i) => `import * as action${i} from ${JSON.stringify(pathToFileURL(file).href)};`)
    .join("\n");
  const serverModules = actions
    .map(
      (file, i) => `${JSON.stringify(relative(nativeRoot, file).replaceAll("\\", "/"))}:action${i}`,
    )
    .join(",");
  const entry = resolve(dir, "flight-entry.mjs");
  const content = `export * from ${JSON.stringify(pathToFileURL(runtime).href)};\n${imports}\nexport const serverModules = {${serverModules}};\n`;
  let before: string | undefined;
  try {
    before = await readFile(entry, "utf8");
  } catch {}
  if (before !== content) await writeFile(entry, content);
  return { entry, actions };
}
export async function writeActionProxies(actions: string[], nativeRoot: string) {
  const proxies: Record<string, string> = {};
  for (const [i, file] of actions.entries()) {
    const output = resolve(nativeRoot, ".rshono-native/actions", `${i}.cjs`);
    await mkdir(dirname(output), { recursive: true });
    await writeFile(
      output,
      `module.exports = require('../native-client.cjs').serverModules[${JSON.stringify(relative(nativeRoot, file).replaceAll("\\", "/"))}];\n`,
    );
    proxies[file] = output;
  }
  return proxies;
}
