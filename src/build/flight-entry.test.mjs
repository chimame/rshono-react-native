import { test, vi } from "vitest";
import assert from "node:assert/strict";
vi.mock("react-server-dom-rspack/client.browser", () => ({
  encodeReply: vi.fn(),
  createTemporaryReferenceSet: () => ({}),
  createFromReadableStream: () => {},
}));
import { encodeReply } from "react-server-dom-rspack/client.browser";
import { getServerFunctionId } from "../../dist/build/flight-entry.mjs";
test("parses reference tokens case-insensitively and resolves hexadecimal field indices", async () => {
  for (const token of ["$F1", "$f1", "$H1", "$h1", "$HA"]) {
    const field = String(parseInt(token.slice(2), 16));
    encodeReply.mockResolvedValue({
      get: (key) =>
        key === "0"
          ? JSON.stringify([token])
          : key === field
            ? JSON.stringify({ id: "compiler-reference", bound: null })
            : null,
    });
    assert.equal(await getServerFunctionId(() => {}), "compiler-reference");
  }
  encodeReply.mockResolvedValue({ get: () => JSON.stringify(["$X1"]) });
  await assert.rejects(
    getServerFunctionId(() => {}),
    /not a Server Function/,
  );
});

test("reports missing and malformed reference parts with actionable diagnostics", async () => {
  for (const metadata of [undefined, null, "{", "null", "[]"]) {
    encodeReply.mockResolvedValue({ get: (key) => (key === "0" ? '["$h1"]' : metadata) });
    await assert.rejects(
      getServerFunctionId(() => {}),
      (error) =>
        error instanceof Error &&
        !(error instanceof SyntaxError) &&
        /reference.*(incomplete|invalid).*Rebuild/s.test(error.message),
    );
  }
  encodeReply.mockResolvedValue({ get: () => undefined });
  await assert.rejects(
    getServerFunctionId(() => {}),
    /incomplete or malformed.*Rebuild/,
  );
});
