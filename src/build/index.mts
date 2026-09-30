import type { RshonoConfig } from "@rshono/core";
import { nativeOptionsKey, type NativeBuildOptions } from "./options.mjs";
import { createRspackHook } from "./rspack.mjs";
export type { NativeBuildOptions } from "./options.mjs";

/** Add native build integration to RSHono. Paths are relative to the server working directory. */
export function defineNativeConfig(
  options: NativeBuildOptions,
  config: RshonoConfig = {},
): RshonoConfig {
  const result: RshonoConfig = {
    ...config,
    rspack: createRspackHook(options, config, process.env.RSHONO_NATIVE_BUILD_ID),
  };
  Object.defineProperty(result, nativeOptionsKey, { value: options });
  return result;
}
