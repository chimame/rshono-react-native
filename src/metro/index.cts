import { resolve, join, relative, isAbsolute, sep } from "node:path";
import { existsSync, readFileSync, watchFile } from "node:fs";
import type { InputConfigT } from "metro-config";
import type { CustomResolver } from "metro-resolver";
export function withRshono<T extends InputConfigT>(config: T): T {
  const root = config.projectRoot;
  if (!root) throw new Error("Specify Metro projectRoot.");
  const entry = resolve(root, ".rshono-native", "client.cjs");
  const metadata = resolve(root, ".rshono-native/metro.json");
  const metadataValue = sharedMetadata(metadata);
  const watchFolders = metadataValue.value.watchFolders ?? [];
  const navigation = resolve(__dirname, "../runtime/navigation.js");
  const previous = config.resolver?.resolveRequest;
  return {
    ...config,
    watchFolders: [...new Set([...(config.watchFolders ?? []), ...watchFolders])],
    resolver: {
      ...config.resolver,
      sourceExts: [...new Set([...(config.resolver?.sourceExts ?? []), "cjs"])],
      resolveRequest: ((context, moduleName, platform) => {
        if (/^(?:server-only|@rshono\/core\/server)(?:\/|$)/.test(moduleName))
          throw new Error(
            "A server-only module reached Metro. Move it into a module-level use server file, rebuild, and bind its exported functions with useServerFunction.",
          );
        if (moduleName === "@rshono/core/client")
          return { type: "sourceFile", filePath: navigation };
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
        const resolution = previous
          ? previous(target, moduleName, platform)
          : context.resolveRequest(target, moduleName, platform);
        if (resolution?.type === "sourceFile") {
          const actions = metadataValue.value.actions ?? {};
          if (actions[resolution.filePath])
            return { type: "sourceFile", filePath: actions[resolution.filePath] };
        }
        return resolution;
      }) satisfies CustomResolver,
    },
  };
}

type Metadata = { watchFolders?: string[]; actions?: Record<string, string> };
type MetadataStore = { value: Metadata; reload(): void };
// Metro configurations for the same absolute metadata path share one listener and snapshot.
// The process owns these stores; unref'ed polling does not keep Metro or test processes alive.
const metadataStores = new Map<string, MetadataStore>();
function sharedMetadata(file: string): MetadataStore {
  const existing = metadataStores.get(file);
  if (existing) {
    existing.reload();
    return existing;
  }
  const store: MetadataStore = {
    value: {},
    reload() {
      try {
        store.value = JSON.parse(readFileSync(file, "utf8"));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") store.value = {};
      }
    },
  };
  store.reload();
  metadataStores.set(file, store);
  watchFile(file, { persistent: false, interval: 250 }, store.reload);
  return store;
}
