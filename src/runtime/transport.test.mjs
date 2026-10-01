import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
import { test } from "vitest";
const assert = require("node:assert/strict");
const { createNativeClient } = require("../../dist");
const manifest = {
  createFromReadableStream: async () => ({ root: "ok" }),
};
function response(overrides = {}) {
  return {
    ok: true,
    status: 200,
    headers: {
      get: (name) =>
        ({
          "content-type": "text/x-component;charset=utf-8",
          "x-rshono-native-build": "current",
        })[name] ?? null,
    },
    body: new ReadableStream(),
    ...overrides,
  };
}
test("preserves the path, query, and authentication headers while forcing RSC", async () => {
  let received;
  const client = createNativeClient({
    manifest,
    fetch: async (...args) => {
      received = args;
      return response();
    },
  });
  const signal = new AbortController().signal;
  assert.deepEqual(
    await client.load("https://example.test/profile?id=42", {
      headers: {
        Authorization: "Bearer example",
        "x-app-version": "2.0.0",
        "x-app-release": "review-2",
        rsc: "0",
      },
      signal,
    }),
    { root: "ok" },
  );
  assert.deepEqual(received, [
    "https://example.test/profile?id=42",
    {
      headers: {
        Authorization: "Bearer example",
        "x-app-version": "2.0.0",
        "x-app-release": "review-2",
        RSC: "1",
      },
      signal,
      redirect: "manual",
    },
  ]);
});
test("does not fetch invalid URLs or already aborted requests", async () => {
  const client = createNativeClient({
    manifest,
    fetch: async () => {
      assert.fail("fetch must not be called");
    },
  });
  await assert.rejects(client.load("file:///tmp/page"), /HTTP/);
  await assert.rejects(client.load("https://example.test", { signal: AbortSignal.abort() }), {
    name: "AbortError",
  });
});
for (const [name, overrides, error] of [
  ["HTTP error", { ok: false, status: 503 }, /503/],
  ["HTML", { headers: { get: () => "text/html" } }, /RSC payload/],
  ["invalid MIME type", { headers: { get: () => "text/x-component-invalid" } }, /RSC payload/],
  ["missing body", { body: null }, /body/],
])
  test(name + " is rejected before decoding", async () => {
    const client = createNativeClient({
      manifest: {
        ...manifest,
        createFromReadableStream: () => assert.fail("decode must not be called"),
      },
      fetch: async () => response(overrides),
    });
    await assert.rejects(client.load("https://example.test"), error);
  });
test("rejects cancellation during decoding and missing roots", async () => {
  const controller = new AbortController();
  const client = createNativeClient({
    manifest: {
      ...manifest,
      createFromReadableStream: async () => {
        controller.abort();
        return { root: "old" };
      },
    },
    fetch: async () => response(),
  });
  await assert.rejects(client.load("https://example.test", { signal: controller.signal }), {
    name: "AbortError",
  });
  const malformed = createNativeClient({
    manifest: { ...manifest, createFromReadableStream: async () => ({}) },
    fetch: async () => response(),
  });
  await assert.rejects(malformed.load("https://example.test"), /root/);
});

test("supports fetching and cancellation with a basic React Native AbortSignal", async () => {
  const client = createNativeClient({
    manifest,
    fetch: async () => response(),
  });
  const signal = { aborted: false };
  assert.deepEqual(await client.load("https://example.test", { signal }), {
    root: "ok",
  });
  signal.aborted = true;
  await assert.rejects(client.load("https://example.test", { signal }), {
    name: "AbortError",
  });
});

for (const serverBuild of [null, "a-new-server-build"]) {
  test(`accepts server content without build agreement (${serverBuild})`, async () => {
    const client = createNativeClient({
      manifest,
      fetch: async () =>
        response({
          headers: {
            get: (name) => (name === "content-type" ? "text/x-component" : serverBuild),
          },
        }),
    });
    assert.deepEqual(await client.load("https://example.test"), { root: "ok" });
  });
}
