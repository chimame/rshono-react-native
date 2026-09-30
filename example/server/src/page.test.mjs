import assert from "node:assert/strict";
import { afterAll, beforeAll, test } from "vitest";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";

let child;
let origin;
let logs = "";
beforeAll(async () => {
  child = spawn(process.execPath, ["dist/server/main.mjs"], {
    cwd: fileURLToPath(new URL("../", import.meta.url)),
    env: { ...process.env, PORT: "0", HOST: "127.0.0.1", RSHONO_PRERENDER: "" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Server did not start: ${logs}`)), 10000);
    const fail = (error) => {
      clearTimeout(timer);
      reject(error);
    };
    child.once("error", fail);
    child.once("exit", (code) => fail(new Error(`Server exited ${code}: ${logs}`)));
    child.stderr.on("data", (chunk) => {
      logs += String(chunk);
    });
    child.stdout.on("data", (chunk) => {
      logs += String(chunk);
      const match = logs.match(/http:\/\/127\.0\.0\.1:\d+/);
      if (match) {
        origin = match[0];
        clearTimeout(timer);
        resolve();
      }
    });
  });
}, 15000);
afterAll(async () => {
  if (!child || child.exitCode !== null || !child.pid) return;
  const exited = once(child, "exit");
  child.kill("SIGTERM");
  const timer = setTimeout(() => child.kill("SIGKILL"), 3000);
  try {
    await exited;
  } finally {
    clearTimeout(timer);
  }
});
const app = { request: (path, init) => fetch(new URL(path, origin), init) };

test("starts the compiled application", async () => {
  assert.equal((await app.request("/health")).status, 200);
});

test("returns the async page and native references for an RSC request", async () => {
  const response = await app.request("/native?name=ConnectionCheck", {
    headers: { RSC: "1" },
  });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /^text\/x-component/);
  assert.equal(response.headers.get("x-rshono-native-build"), null);
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

test.each([
  [undefined, "Current experience"],
  ["store-1", "Current experience"],
  ["review-2", "Preview experience"],
  ["unknown", "Current experience"],
])("selects server content for release %s", async (release, expected) => {
  const response = await app.request("/native", {
    headers: { RSC: "1", ...(release ? { "x-app-release": release } : {}) },
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  const text = await response.text();
  assert.ok(text.includes(expected));
  assert.ok(
    !text.includes(expected === "Current experience" ? "Preview experience" : "Current experience"),
  );
});
