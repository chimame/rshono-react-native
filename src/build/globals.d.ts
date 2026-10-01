declare module "react-server-dom-rspack/client.browser" {
  export const createFromReadableStream: import("../runtime/transport").NativeManifest["createFromReadableStream"];
  export const encodeReply: NonNullable<
    import("../runtime/transport").NativeManifest["encodeReply"]
  >;
  export const createTemporaryReferenceSet: () => unknown;
}
