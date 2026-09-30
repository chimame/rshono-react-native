import { RshonoError } from "../runtime/errors";
import type { NativeManifest } from "../runtime/transport";
export function getManifest(): NativeManifest {
  throw new RshonoError(
    "CONFIGURATION_ERROR",
    "Apply withRshono to the Metro configuration and run rshono-native build in the server project.",
  );
}
