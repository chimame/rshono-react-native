import assert from "node:assert/strict";
import { test } from "vitest";

// Run the compiled app without a port using the same path as CLI prerendering.
process.env.RSHONO_PRERENDER = "1";
const { app, checkAppModules } = await import("../dist/server/main.mjs");

test("validates the compiled page and Client Component boundaries", async () => {
  await checkAppModules();
});

test("returns the async page and native references for an RSC request", async () => {
  const response = await app.request("/native?name=ConnectionCheck", {
    headers: { RSC: "1" },
  });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /^text\/x-component/);
  assert.ok(response.headers.get("x-rshono-native-build"));
  const text = await response.text();
  assert.match(text, /ConnectionCheck/);
  assert.match(text, /Request ID/);
  assert.match(text, /"RouterProvider"/);
  assert.match(text, /"Panel"/);
  assert.match(text, /"default"/);
  assert.doesNotMatch(text, /<html|<script|<link/);
});

test("handles missing and long names and renders on each request", async () => {
  const first = await app.request("/native", { headers: { RSC: "1" } });
  const second = await app.request("/native", { headers: { RSC: "1" } });
  const firstText = await first.text();
  const secondText = await second.text();
  assert.match(firstText, /React Native/);
  assert.notEqual(firstText, secondText);
  const long = await app.request("/native?name=" + "a".repeat(100), {
    headers: { RSC: "1" },
  });
  const longText = await long.text();
  assert.match(longText, new RegExp('"' + "a".repeat(40) + '"'));
  assert.doesNotMatch(longText, new RegExp('"' + "a".repeat(41) + '"'));
});
