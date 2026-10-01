import type { RshonoConfig } from "@rshono/core";
import type { NativeBuildOptions } from "./options.mjs";
import { resolveNativeOptions } from "./options.mjs";
import { createRequire } from "node:module";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import bridge from "./transform.cjs";
export function createRspackHook(
  options: NativeBuildOptions,
  config: RshonoConfig,
): NonNullable<RshonoConfig["rspack"]> {
  return (input, context) => {
    const require = createRequire(resolve(process.cwd(), "package.json"));
    const { rspack } = require("@rspack/core");
    const normalized = resolveNativeOptions(options);
    const { output, clientRoots } = normalized;
    if (context.isDev)
      throw new Error("Use rshono-native dev for the native watch/rebuild development workflow.");
    const result = config.rspack?.(input, context) ?? input;
    result.plugins ??= [];
    result.module ??= {};
    result.module.rules ??= [];
    const navigation = fileURLToPath(new URL("../runtime/navigation.mjs", import.meta.url));
    const upstreamNavigation = resolve(
      dirname(require.resolve("@rshono/core/package.json")),
      "dist/runtime/navigation.js",
    );
    const upstreamBoundaries = resolve(
      dirname(require.resolve("@rshono/core/package.json")),
      "dist/runtime/boundaries.js",
    );
    const packages = (options.clientPackages ?? []).map((name) => {
      try {
        return dirname(require.resolve(`${name}/package.json`));
      } catch {
        let directory: string;
        try {
          directory = dirname(require.resolve(name));
        } catch (cause) {
          throw new Error(
            `Cannot resolve clientPackages entry "${name}". Install it in the server project and ensure it exports an entry point.`,
            { cause },
          );
        }
        while (!existsSync(resolve(directory, "package.json"))) {
          const parent = dirname(directory);
          if (parent === directory) throw new Error(`Cannot find the package root for ${name}.`);
          directory = parent;
        }
        return directory;
      }
    });
    result.resolve = {
      ...result.resolve,
      alias: {
        ...result.resolve?.alias,
        ...options.aliases,
        [upstreamNavigation]: navigation,
        "@rshono/core/client$": navigation,
      },
    };
    result.module.rules.unshift({
      test: /react-server-dom-rspack-client\.browser\.(production|development)\.js$/,
      enforce: "pre",
      use: [fileURLToPath(new URL("./decoder-loader.cjs", import.meta.url))],
    });
    result.module.rules.unshift({
      test: /\.[cm]?[jt]sx?$/,
      include: (file: string) =>
        file === navigation ||
        file === upstreamBoundaries ||
        packages.some((root) => file.startsWith(root + sep)) ||
        (clientRoots.some((root) => file.startsWith(root + sep)) &&
          !/[\\/]node_modules[\\/]|[\\/]\.rshono-native[\\/]/.test(file)),
      enforce: "pre",
      use: [
        {
          loader: fileURLToPath(new URL("./client-loader.cjs", import.meta.url)),
          options: { target: context.isServer ? "server" : "client" },
        },
      ],
    });
    if (context.isServer) {
      const externals = result.externals
        ? Array.isArray(result.externals)
          ? result.externals
          : [result.externals]
        : [];
      result.externals = externals.map((external) =>
        typeof external === "function"
          ? (data, callback) => {
              if (
                [
                  "@rshono/core/client",
                  ...(options.clientPackages ?? []),
                  ...Object.keys(options.aliases ?? {}),
                ].some((name) => data.request === name || data.request?.startsWith(name + "/"))
              )
                return callback();
              return external(data, callback);
            }
          : external,
      );
      return result;
    }
    result.target = "node";
    result.entry = {
      main: existsSync(resolve(normalized.nativeRoot, ".rshono-native/flight-entry.mjs"))
        ? resolve(normalized.nativeRoot, ".rshono-native/flight-entry.mjs")
        : fileURLToPath(new URL("./flight-entry.mjs", import.meta.url)),
    };
    result.output = {
      ...result.output,
      filename: "native-client.cjs",
      library: { type: "commonjs2" },
      chunkLoading: false,
    };
    result.optimization = { ...result.optimization, minimize: false };
    result.resolve = {
      ...result.resolve,
      alias: {
        ...result.resolve?.alias,
        "react-server-dom-rspack/client$":
          require.resolve("react-server-dom-rspack/client.browser"),
        "react-server-dom-rspack/client.node$":
          require.resolve("react-server-dom-rspack/client.browser"),
        [require.resolve("react-server-dom-rspack/client.node")]:
          require.resolve("react-server-dom-rspack/client.browser"),
        "react-server-dom-rspack/client.browser$":
          require.resolve("react-server-dom-rspack/client.browser"),
      },
    };
    const previous = result.externals
      ? Array.isArray(result.externals)
        ? result.externals
        : [result.externals]
      : [];
    result.externalsType = "commonjs";
    result.externals = [
      {
        react: "react",
        "react/jsx-runtime": "react/jsx-runtime",
        "react/jsx-dev-runtime": "react/jsx-dev-runtime",
        "react-dom": "react-dom",
      },
      ({ request }, callback) => {
        if (request?.startsWith(bridge.PREFIX)) {
          const rawFile = Buffer.from(request.slice(bridge.PREFIX.length), "base64url").toString();
          const file = rawFile === navigation ? rawFile.replace(/\.mjs$/, ".js") : rawFile;
          // Let Metro choose .ios/.android/.native variants from a common module stem.
          const source = file.replace(/\.(?:native|ios|android)(?=\.[cm]?[jt]sx?$)/, "");
          const stem = source.replace(/\.[cm]?[jt]sx?$/, "");
          const hasVariants = ["ios", "android", "native"].some((platform) =>
            ["tsx", "ts", "jsx", "js"].some((ext) => existsSync(`${stem}.${platform}.${ext}`)),
          );
          let target = relative(dirname(output), hasVariants ? stem : file).replaceAll("\\", "/");
          if (!target.startsWith(".")) target = "./" + target;
          return callback(undefined, `commonjs ${target}`);
        }
        return callback();
      },
      ...previous,
    ];
    result.plugins.push(new rspack.optimize.LimitChunkCountPlugin({ maxChunks: 1 }));
    return result;
  };
}
