import { existsSync } from "node:fs";
import { resolve } from "node:path";
export interface NativeBuildOptions {
  /** Path to the native app, relative to the server working directory. */
  nativeRoot: string;
  /** Additional Client Component roots outside server/src and nativeRoot. */
  clientRoots?: string[];
  /** Client Component packages compiled as native boundaries rather than executed on the server. */
  clientPackages?: string[];
  /** Additional build roots to watch, including aliases and shared server code. */
  watchRoots?: string[];
  /** Rspack aliases for shared modules; Metro needs matching aliases. */
  aliases?: Record<string, string>;
}
/** Internal protocol between the CLI and configuration; not a public export. */
export const nativeOptionsKey = Symbol.for("rshono-react-native.options");
export function resolveNativeOptions(options: NativeBuildOptions, cwd = process.cwd()) {
  if (!options || typeof options.nativeRoot !== "string" || !options.nativeRoot.trim())
    throw new Error("Specify nativeRoot in defineNativeConfig.");
  for (const name of ["clientRoots", "clientPackages", "watchRoots"] as const) {
    const values = options[name];
    if (
      values !== undefined &&
      (!Array.isArray(values) || values.some((value) => typeof value !== "string" || !value.trim()))
    )
      throw new Error(`${name} must be an array of non-empty strings.`);
  }
  if (
    options.aliases !== undefined &&
    (typeof options.aliases !== "object" ||
      options.aliases === null ||
      Object.values(options.aliases).some((value) => typeof value !== "string" || !value.trim()))
  )
    throw new Error("aliases must map specifiers to non-empty paths.");
  const nativeRoot = resolve(cwd, options.nativeRoot);
  if (!existsSync(resolve(nativeRoot, "package.json")))
    throw new Error("No package.json found in nativeRoot.");
  return {
    nativeRoot,
    output: resolve(nativeRoot, ".rshono-native/native-client.cjs"),
    clientRoots: [
      ...new Set([
        resolve(cwd, "src"),
        nativeRoot,
        ...(options.clientRoots ?? []).map((root) => resolve(cwd, root)),
      ]),
    ],
  };
}
