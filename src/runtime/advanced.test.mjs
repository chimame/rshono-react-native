import { test } from "vitest";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const {
  createNativeClient,
  createNativeLifecycle,
  createExpoRouterAdapter,
} = require("../../dist");
const { monitorStream, abortable } = require("../../dist/runtime/stream");
const { controlError } = require("../../dist/runtime/errors");
const encoder = new TextEncoder();
function response(text = '{"root":"ok"}', status = 200) {
  return {
    ok: status < 400,
    status,
    headers: { get: (name) => (name === "content-type" ? "text/x-component" : null) },
    body: new ReadableStream({
      start(c) {
        c.enqueue(encoder.encode(text));
        c.close();
      },
    }),
  };
}
const manifest = {
  async createFromReadableStream(stream, options) {
    const reader = stream.getReader();
    let text = "";
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      text += new TextDecoder().decode(part.value);
    }
    const payload = JSON.parse(text);
    if (options?.callServer) payload.action = options.callServer;
    return payload;
  },
};

test("shares wire requests while binding actions independently, partitions auth/releases and invalidates", async () => {
  let calls = 0;
  const client = createNativeClient({
    manifest,
    fetch: async () => {
      calls++;
      return response();
    },
    cacheTimeMs: 10000,
    maxCacheEntries: 2,
  });
  const [first, second] = await Promise.all([
    client.load("https://example.test/a"),
    client.load("https://example.test/a"),
  ]);
  assert.equal(calls, 1);
  assert.notEqual(first.action, second.action);
  await client.prefetch("https://example.test/a");
  assert.equal(calls, 1);
  await client.load("https://example.test/a", { headers: { Authorization: "other" } });
  await client.load("https://example.test/a", { headers: { "x-app-release": "other" } });
  assert.equal(calls, 3);
  await client.load("https://example.test/a");
  assert.equal(calls, 4);
  client.invalidate();
  await client.load("https://example.test/a");
  assert.equal(calls, 5);
});
test("a shared request survives one subscriber cancelling and stops when all cancel", async () => {
  let stream,
    upstreamSignal,
    cancelled = false;
  const client = createNativeClient({
    manifest,
    cacheTimeMs: 1000,
    fetch: async (_, init) => {
      upstreamSignal = init.signal;
      return {
        ...response(),
        body: new ReadableStream({
          start(c) {
            stream = c;
          },
          cancel() {
            cancelled = true;
          },
        }),
      };
    },
  });
  const a = new AbortController(),
    b = new AbortController();
  const first = client.load("https://example.test/a", { signal: a.signal });
  const second = client.load("https://example.test/a", { signal: b.signal });
  await new Promise((resolve) => setTimeout(resolve, 5));
  a.abort();
  await assert.rejects(first, { name: "AbortError" });
  assert.equal(upstreamSignal.aborted, false);
  stream.enqueue(encoder.encode('{"root":"second"}'));
  stream.close();
  assert.equal((await second).root, "second");
  assert.equal(cancelled, false);
  const c = new AbortController();
  const third = client.load("https://example.test/b", { signal: c.signal });
  await new Promise((resolve) => setTimeout(resolve, 5));
  c.abort();
  await assert.rejects(third);
  assert.equal(upstreamSignal.aborted, true);
});
test("does not retain oversized responses and supports bounded stale data only for network errors", async () => {
  let calls = 0,
    offline = false;
  const client = createNativeClient({
    manifest,
    cacheTimeMs: 5,
    staleIfErrorMs: 1000,
    fetch: async () => {
      calls++;
      if (offline) throw new Error("offline");
      return response();
    },
  });
  await client.load("https://example.test/a");
  await new Promise((resolve) => setTimeout(resolve, 15));
  offline = true;
  assert.equal((await client.load("https://example.test/a")).root, "ok");
  assert.equal(calls, 2);
  const small = createNativeClient({
    manifest,
    cacheTimeMs: 1000,
    maxCacheBytes: 1,
    fetch: async () => {
      calls++;
      return response();
    },
  });
  await small.load("https://example.test/a");
  await small.load("https://example.test/a");
  assert.equal(calls, 4);
});
test("coalesces concurrent 401 refreshes, resolves fresh headers, never retries a mutation", async () => {
  let token = "old",
    refreshes = 0,
    posts = 0;
  const client = createNativeClient({
    manifest: { ...manifest, encodeReply: async (args) => JSON.stringify(args) },
    getHeaders: () => ({ Authorization: token }),
    onUnauthorized: async () => {
      refreshes++;
      await new Promise((resolve) => setTimeout(resolve, 10));
      token = "new";
    },
    fetch: async (_, init) => {
      if (init.method) {
        posts++;
        return response("", 401);
      }
      return response(undefined, init.headers.Authorization === "old" ? 401 : 200);
    },
  });
  await Promise.all([client.load("https://example.test/a"), client.load("https://example.test/b")]);
  assert.equal(refreshes, 1);
  await assert.rejects(client.callServer("https://example.test/a", "id", []), { status: 401 });
  assert.equal(posts, 1);
});
test("sends action protocol headers and decodes error results from HTTP 500", async () => {
  let init;
  const client = createNativeClient({
    manifest: { ...manifest, encodeReply: async (args) => JSON.stringify(args) },
    fetch: async (_, options) => {
      init = options;
      return response('{"root":"updated","returnValue":{"ok":false,"error":"validation"}}', 500);
    },
  });
  const payload = await client.callServer("https://example.test/a", "id", [1], {
    headers: { "X-RSC-Action": "forged", rsc: "0" },
  });
  assert.equal(init.method, "POST");
  assert.equal(init.headers["x-rsc-action"], "id");
  assert.equal(init.headers.RSC, "1");
  assert.equal(init.body, "[1]");
  assert.equal(payload.returnValue.ok, false);
});
test("handles HTTP redirects, 404, control digests, invalid and foreign redirect responses", async () => {
  const redirect = createNativeClient({
    manifest,
    fetch: async () => ({
      ...response(),
      ok: false,
      status: 302,
      headers: { get: (name) => (name === "location" ? "/login" : null) },
    }),
  });
  await assert.rejects(redirect.load("https://example.test/a"), {
    code: "REDIRECT",
    location: "/login",
  });
  const missing = createNativeClient({ manifest, fetch: async () => response("", 404) });
  await assert.rejects(missing.load("https://example.test/a"), { code: "DECODE_ERROR" });
  assert.equal(controlError({ digest: "RSHONO_REDIRECT;303;%2Flogin" }).location, "/login");
  assert.equal(controlError({ digest: "RSHONO_REDIRECT;303;%ZZ" }), null);
  assert.equal(controlError({ digest: "RSHONO_NOT_FOUND" }).status, 404);
  const foreign = createNativeClient({
    manifest,
    fetch: async () => ({ ...response(), redirected: true, url: "https://other.test/a" }),
  });
  await assert.rejects(foreign.load("https://example.test/a"), { code: "INVALID_RESPONSE" });
});
test("times out late chunks, cancels the reader and cleans up on EOF", async () => {
  let cancelled = false;
  const body = new ReadableStream({
    start(c) {
      c.enqueue(encoder.encode("shell"));
    },
    cancel() {
      cancelled = true;
    },
  });
  const reader = monitorStream(body, new AbortController().signal, 10).getReader();
  assert.equal(new TextDecoder().decode((await reader.read()).value), "shell");
  await assert.rejects(reader.read(), { code: "TIMEOUT" });
  assert.equal(cancelled, true);
  let ended = 0;
  const complete = monitorStream(
    response().body,
    new AbortController().signal,
    10,
    () => ended++,
  ).getReader();
  await complete.read();
  await complete.read();
  assert.equal(ended, 1);
});
test("timeouts cover a fetch that ignores AbortSignal and diagnostics omit headers/query", async () => {
  const events = [];
  const client = createNativeClient({
    manifest,
    fetch: async () => new Promise(() => {}),
    onRequest: (event) => events.push(event),
  });
  await assert.rejects(
    client.load("https://example.test/a?secret=hidden", {
      headers: { Authorization: "hidden" },
      timeoutMs: 10,
    }),
    { code: "TIMEOUT" },
  );
  assert.equal(events[0].url, "https://example.test/a");
  assert.equal(JSON.stringify(events).includes("hidden"), false);
});
test("lifecycle subscriptions and navigation adapters preserve ownership and cleanup", () => {
  const lifecycle = createNativeLifecycle();
  const events = [];
  const off = lifecycle.subscribe((event) => events.push(event));
  lifecycle.emit("active");
  off();
  lifecycle.emit("focus");
  assert.deepEqual(events, ["active"]);
  const router = createExpoRouterAdapter({
    push: (href) => events.push(href),
    replace: (href) => events.push(href),
    back: () => events.push("back"),
  });
  router.replace("/login");
  router.back();
  assert.deepEqual(events, ["active", "/login", "back"]);
});

test("adopts Flight-style thenables whose then returns void, including a Hermes Promise shortcut", async () => {
  const chunk = Object.create(Promise.prototype);
  chunk.then = (resolve) => {
    resolve({ root: "Hermes" });
  };
  const signal = new AbortController().signal;
  assert.equal((await abortable(chunk, signal)).root, "Hermes");
  const client = createNativeClient({
    manifest: { createFromReadableStream: () => chunk },
    fetch: async () => response(),
  });
  assert.equal((await client.load("https://example.test/a")).root, "Hermes");
});

test("caches actual fetch Response instances and honors no-store", async () => {
  let calls = 0;
  const client = createNativeClient({
    manifest,
    cacheTimeMs: 1000,
    fetch: async () => {
      calls++;
      return new Response('{"root":"native response"}', {
        headers: { "content-type": "text/x-component" },
      });
    },
  });
  assert.equal((await client.load("https://example.test/a")).root, "native response");
  await client.load("https://example.test/a");
  assert.equal(calls, 1);
  const uncached = createNativeClient({
    manifest,
    cacheTimeMs: 1000,
    fetch: async () => {
      calls++;
      return new Response('{"root":"private"}', {
        headers: { "content-type": "text/x-component", "cache-control": "private, no-store" },
      });
    },
  });
  await uncached.load("https://example.test/a");
  await uncached.load("https://example.test/a");
  assert.equal(calls, 3);
});

test("delivers action control errors to the originating screen", async () => {
  const controls = [];
  const client = createNativeClient({
    manifest: { ...manifest, encodeReply: async () => "[]" },
    fetch: async (_, init) => {
      if (init.method)
        return {
          ...response(),
          ok: false,
          status: 303,
          headers: { get: (name) => (name === "location" ? "/login" : null) },
        };
      return response();
    },
  });
  const payload = await client.load("https://example.test/a", {
    onControl: (error) => controls.push(error),
  });
  await assert.rejects(payload.action("id", []), { code: "REDIRECT" });
  assert.equal(controls[0].location, "/login");
});

test("shares 404 Flight bodies for current readers without retaining them", async () => {
  let calls = 0;
  const client = createNativeClient({
    manifest,
    cacheTimeMs: 1000,
    fetch: async () => {
      calls++;
      return new Response('{"root":"not found","notFound":true}', {
        status: 404,
        headers: { "content-type": "text/x-component" },
      });
    },
  });
  const [a, b] = await Promise.all([
    client.load("https://example.test/missing"),
    client.load("https://example.test/missing"),
  ]);
  assert.equal(a.root, "not found");
  assert.equal(b.notFound, true);
  assert.equal(calls, 1);
  await client.load("https://example.test/missing");
  assert.equal(calls, 2);
});

test("evicts wire entries when the decoder rejects the payload", async () => {
  let calls = 0;
  const client = createNativeClient({
    manifest,
    cacheTimeMs: 1000,
    fetch: async () => {
      calls++;
      return response("broken");
    },
  });
  await assert.rejects(client.load("https://example.test/a"), { code: "DECODE_ERROR" });
  await assert.rejects(client.load("https://example.test/a"), { code: "DECODE_ERROR" });
  assert.equal(calls, 2);
});

test("cancels fetch bodies that arrive after GET and POST timeouts", async () => {
  for (const action of [false, true]) {
    let finish,
      cancelled = 0;
    const client = createNativeClient({
      manifest: { ...manifest, encodeReply: async () => "[]" },
      fetch: () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    });
    const request = action
      ? client.callServer("https://example.test/a", "id", [], { timeoutMs: 5 })
      : client.load("https://example.test/a", { timeoutMs: 5 });
    await assert.rejects(request, { code: "TIMEOUT" });
    finish({
      ...response(),
      body: new ReadableStream({
        cancel() {
          cancelled++;
        },
      }),
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(cancelled, 1);
  }
});
test("oversized cache streams remain complete for concurrent subscribers", async () => {
  let calls = 0;
  const body = '{"root":"' + "x".repeat(10000) + '"}';
  const client = createNativeClient({
    manifest,
    cacheTimeMs: 1000,
    maxCacheBytes: 8,
    fetch: async () => {
      calls++;
      return response(body);
    },
  });
  const [a, b] = await Promise.all([
    client.load("https://example.test/a"),
    client.load("https://example.test/a"),
  ]);
  assert.equal(a.root.length, 10000);
  assert.equal(b.root.length, 10000);
  assert.equal(calls, 1);
  await client.load("https://example.test/a");
  assert.equal(calls, 2);
});

test("rejecting foreign final URLs releases every shared reader and evicts the cache entry", async () => {
  for (const cacheTimeMs of [0, 1000]) {
    let calls = 0,
      cancelled = 0,
      invalid = true;
    const signals = [];
    const client = createNativeClient({
      manifest,
      cacheTimeMs,
      fetch: async (_, init) => {
        calls++;
        signals.push(init.signal);
        if (!invalid) return response();
        return {
          ...response(),
          redirected: true,
          url: "https://foreign.test/a",
          body: new ReadableStream({
            start(controller) {
              controller.enqueue(encoder.encode('{"root":'));
            },
            cancel() {
              cancelled++;
            },
          }),
        };
      },
    });
    const results = await Promise.allSettled([
      client.load("https://example.test/a"),
      client.load("https://example.test/a"),
    ]);
    for (const result of results) {
      assert.equal(result.status, "rejected");
      assert.equal(result.reason.code, "INVALID_RESPONSE");
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(cancelled, cacheTimeMs ? 1 : 2);
    if (cacheTimeMs) assert.equal(signals[0].aborted, true);
    const before = calls;
    invalid = false;
    assert.equal((await client.load("https://example.test/a")).root, "ok");
    assert.equal(calls, before + 1);
  }
});
test("evicts completed redirected payloads and cancels malformed final URLs", async () => {
  let calls = 0;
  const client = createNativeClient({
    manifest,
    cacheTimeMs: 1000,
    fetch: async () => {
      calls++;
      return { ...response(), redirected: true, url: "https://foreign.test/a" };
    },
  });
  await assert.rejects(client.load("https://example.test/a"), { code: "INVALID_RESPONSE" });
  await assert.rejects(client.load("https://example.test/a"), { code: "INVALID_RESPONSE" });
  assert.equal(calls, 2);
  let cancelled = 0;
  const malformed = createNativeClient({
    manifest,
    fetch: async () => ({
      ...response(),
      redirected: true,
      url: "http://[",
      body: new ReadableStream({
        cancel() {
          cancelled++;
        },
      }),
    }),
  });
  await assert.rejects(malformed.load("https://example.test/a"), { code: "INVALID_RESPONSE" });
  assert.equal(cancelled, 1);
});
