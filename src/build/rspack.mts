import type { RshonoConfig } from "@rshono/core";
import type { NativeBuildOptions } from "./options.mjs";
import { resolveNativeOptions } from "./options.mjs";
import { createRequire } from "node:module";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
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
    if (context.isDev) throw new Error("Only production builds are currently supported.");
    const result = config.rspack?.(input, context) ?? input;
    result.plugins ??= [];
    result.module ??= {};
    result.module.rules ??= [];
    result.module.rules.unshift({
      test: /\.[cm]?[jt]sx?$/,
      include: clientRoots,
      exclude: /[\\/]node_modules[\\/]|[\\/]\.rshono-native[\\/]/,
      enforce: "pre",
      use: [
        {
          loader: fileURLToPath(new URL("./client-loader.cjs", import.meta.url)),
          options: { target: context.isServer ? "server" : "client" },
        },
      ],
    });
    if (context.isServer) return result;
    result.target = "node";
    result.entry = {
      main: fileURLToPath(new URL("./flight-entry.mjs", import.meta.url)),
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
          const file = Buffer.from(request.slice(bridge.PREFIX.length), "base64url").toString();
          let target = relative(dirname(output), file).replaceAll("\\", "/");
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
