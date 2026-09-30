import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
import { test } from "vitest";
const assert = require("node:assert/strict");
const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { withRshono } = require("../../dist/metro/index.cjs");
test("replaces only the generated client and preserves the existing resolver", () => {
  const root = mkdtempSync(join(tmpdir(), "rshono-metro-"));
  try {
    let origin;
    const previous = (context, name, platform) => {
      origin = context.originModulePath;
      return { name, platform };
    };
    const config = withRshono({
      projectRoot: root,
      resolver: { sourceExts: ["tsx"], resolveRequest: previous },
    });
    assert.throws(
      () => config.resolver.resolveRequest({}, "rshono-react-native/internal/manifest", "ios"),
      /build/,
    );
    mkdirSync(join(root, ".rshono-native"));
    writeFileSync(join(root, ".rshono-native/client.cjs"), "");
    assert.deepEqual(
      config.resolver.resolveRequest({}, "rshono-react-native/internal/manifest", "ios"),
      { type: "sourceFile", filePath: join(root, ".rshono-native/client.cjs") },
    );
    assert.deepEqual(config.resolver.resolveRequest({}, "other", "android"), {
      name: "other",
      platform: "android",
    });
    assert.deepEqual(config.resolver.sourceExts, ["tsx", "cjs"]);
    config.resolver.resolveRequest(
      { originModulePath: "/server/Button.tsx" },
      "react/jsx-runtime",
      "ios",
    );
    assert.equal(origin, join(root, "package.json"));
    const wrapper = join(root, "node_modules/uniwind/native.js");
    config.resolver.resolveRequest({ originModulePath: wrapper }, "react-native", "ios");
    assert.equal(origin, wrapper);
    writeFileSync(
      join(root, ".rshono-native/metro.json"),
      JSON.stringify({ watchFolders: ["/server/src"] }),
    );
    assert.deepEqual(withRshono({ projectRoot: root, watchFolders: ["/shared"] }).watchFolders, [
      "/shared",
      "/server/src",
    ]);
  } finally {
    rmSync(root, { recursive: true });
  }
});
