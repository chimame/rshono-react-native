import { encodeReply, createTemporaryReferenceSet } from "react-server-dom-rspack/client.browser";
export {
  createFromReadableStream,
  encodeReply,
  createTemporaryReferenceSet,
} from "react-server-dom-rspack/client.browser";
/** Discover an imported action's compiler-owned ID without reimplementing Rspack's hashing. */
export async function getServerFunctionId(reference: unknown): Promise<string> {
  const body = await encodeReply([reference], {
    temporaryReferences: createTemporaryReferenceSet(),
  });
  if (typeof body === "string")
    throw new Error(
      "Expected a generated Server Function reference. Import a module-level use server function and bind it with useServerFunction.",
    );
  const get = (key: string) => {
    if (typeof body.get === "function") return body.get(key);
    // React Native FormData exposes getParts rather than the web get API.
    return (body as unknown as { getParts(): { fieldName: string; string?: string }[] })
      .getParts()
      .find((part) => part.fieldName === key)?.string;
  };
  const parsePart = (field: string): unknown => {
    try {
      const part = get(field);
      if (typeof part !== "string") throw new Error("Missing reference part");
      return JSON.parse(part);
    } catch (cause) {
      throw new Error(
        "The generated Server Function reference is incomplete or malformed. Rebuild the native client and import an unbound module-level use server function.",
        { cause },
      );
    }
  };
  const root = parsePart("0");
  const token = Array.isArray(root) ? root[0] : undefined;
  const match = typeof token === "string" ? /^\$[hf]([0-9a-f]+)$/i.exec(token) : null;
  if (!match) throw new Error("This value is not a Server Function reference.");
  const metadata = parsePart(String(parseInt(match[1], 16)));
  if (!metadata || typeof metadata !== "object" || !("id" in metadata))
    throw new Error(
      "The generated Server Function reference metadata is invalid. Rebuild the native client.",
    );
  if (typeof metadata.id !== "string" || ("bound" in metadata && metadata.bound != null))
    throw new Error(
      "Bind only unbound module-level Server Functions. Pass bound functions as server props.",
    );
  return metadata.id;
}
