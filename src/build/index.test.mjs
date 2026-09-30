import { test } from "vitest";
import assert from "node:assert/strict";
import { defineNativeConfig } from "../../dist/build/index.mjs";

test("loads serving configuration without the native project or build dependencies", () => {
  const config = defineNativeConfig(
    { nativeRoot: "/nonexistent/native-project" },
    { siteUrl: "https://example.test" },
  );
  assert.equal(config.siteUrl, "https://example.test");
  assert.equal(typeof config.rspack, "function");
});
