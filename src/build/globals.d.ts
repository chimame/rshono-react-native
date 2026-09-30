/** Constant replaced by Rspack DefinePlugin at build time. */
declare const __RSHONO_NATIVE_BUILD_ID__: string;
declare module "@rshono-native/original-server-app" {
  const app: import("hono").Hono;
  export default app;
}
declare module "react-server-dom-rspack/client.browser" {
  export const createFromReadableStream: import("../runtime/transport").NativeManifest["createFromReadableStream"];
}
