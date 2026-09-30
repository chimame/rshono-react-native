import { resolve, join, relative, isAbsolute, sep } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import type { InputConfigT } from "metro-config";
import type { CustomResolver } from "metro-resolver";
export function withRshono<T extends InputConfigT>(config: T): T {
  const root = config.projectRoot;
  if (!root) throw new Error("Specify Metro projectRoot.");
  const entry = resolve(root, ".rshono-native", "client.cjs");
  const metadata = join(root, ".rshono-native/metro.json");
  const watchFolders = existsSync(metadata)
    ? JSON.parse(readFileSync(metadata, "utf8")).watchFolders
    : [];
  const previous = config.resolver?.resolveRequest;
  return {
    ...config,
    watchFolders: [...new Set([...(config.watchFolders ?? []), ...watchFolders])],
    resolver: {
      ...config.resolver,
      sourceExts: [...new Set([...(config.resolver?.sourceExts ?? []), "cjs"])],
      resolveRequest: ((context, moduleName, platform) => {
        if (moduleName === "rshono-react-native/internal/manifest") {
          if (!existsSync(entry))
            throw new Error(
              "Generated client not found. Run rshono-native build in the server project.",
            );
          return { type: "sourceFile", filePath: entry };
        }
        // Resolve React/RN to the native app instance even when shared source lives on the server.
        const importer = context.originModulePath ? relative(root, context.originModulePath) : "";
        const outside = importer.startsWith(".." + sep) || isAbsolute(importer);
        // Preserve origin checks inside the native app (for example, Uniwind self-reference prevention).
        const target =
          outside && /^(react|react-dom|react-native)(\/|$)/.test(moduleName)
            ? { ...context, originModulePath: join(root, "package.json") }
            : context;
        return previous
          ? previous(target, moduleName, platform)
          : context.resolveRequest(target, moduleName, platform);
      }) satisfies CustomResolver,
    },
  };
}
