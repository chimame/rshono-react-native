import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
import { test } from "vitest";
const assert = require("node:assert/strict");
const { createNativeClient, RshonoError } = require("../../dist");
const response = () => ({
  ok: true,
  status: 200,
  headers: {
    get: (name) => (name === "content-type" ? "text/x-component" : "current"),
  },
  body: new ReadableStream(),
});
const manifest = {
  createFromReadableStream: async () => ({ root: "ok" }),
};
test("exposes HTTP status and network/decode causes without relying on messages", async () => {
  const cause = new Error("connection failed");
  for (const [fetcher, decoder, code, status] of [
    [
      async () => ({ ...response(), ok: false, status: 401 }),
      manifest.createFromReadableStream,
      "HTTP_ERROR",
      401,
    ],
    [
      async () => {
        throw cause;
      },
      manifest.createFromReadableStream,
      "NETWORK_ERROR",
      undefined,
    ],
    [
      async () => response(),
      async () => {
        throw cause;
      },
      "DECODE_ERROR",
      undefined,
    ],
  ]) {
    const client = createNativeClient({
      manifest: { ...manifest, createFromReadableStream: decoder },
      fetch: fetcher,
    });
    await assert.rejects(client.load("https://example.test"), (error) => {
      assert.ok(error instanceof RshonoError);
      assert.equal(error.code, code);
      assert.equal(error.status, status);
      if (code !== "HTTP_ERROR") assert.equal(error.cause, cause);
      return true;
    });
  }
});
test("distinguishes invalid responses while preserving AbortError", async () => {
  await assert.rejects(
    createNativeClient({
      manifest,
      fetch: async () => ({ ...response(), body: null }),
    }).load("https://example.test"),
    { code: "INVALID_RESPONSE" },
  );
  const controller = new AbortController();
  const client = createNativeClient({
    manifest,
    fetch: async () => {
      controller.abort();
      throw new Error("fetch abort");
    },
  });
  await assert.rejects(client.load("https://example.test", { signal: controller.signal }), {
    name: "AbortError",
  });
  await assert.rejects(client.load("not a url"), { code: "INVALID_URL" });
});
