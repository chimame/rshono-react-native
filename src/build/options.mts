import { existsSync } from "node:fs";
import { resolve } from "node:path";
export interface NativeBuildOptions {
  /** Path to the native app, relative to the server working directory. */
  nativeRoot: string;
  /** Additional Client Component roots outside server/src and nativeRoot. */
  clientRoots?: string[];
}
/** Internal protocol between the CLI and configuration; not a public export. */
export const nativeOptionsKey = Symbol.for("rshono-react-native.options");
export function resolveNativeOptions(options: NativeBuildOptions, cwd = process.cwd()) {
  if (!options || typeof options.nativeRoot !== "string" || !options.nativeRoot.trim())
    throw new Error("Specify nativeRoot in defineNativeConfig.");
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
