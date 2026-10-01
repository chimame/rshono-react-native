import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
import { test, vi } from "vitest";
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

test("replaces use server imports with generated references and diagnoses server-only imports", () => {
  const root = mkdtempSync(join(tmpdir(), "rshono-actions-"));
  try {
    mkdirSync(join(root, ".rshono-native"));
    const source = join(root, "server/actions.ts"),
      proxy = join(root, ".rshono-native/actions/0.cjs");
    writeFileSync(
      join(root, ".rshono-native/metro.json"),
      JSON.stringify({ watchFolders: [], actions: { [source]: proxy } }),
    );
    const config = withRshono({ projectRoot: root });
    const context = { resolveRequest: () => ({ type: "sourceFile", filePath: source }) };
    assert.deepEqual(config.resolver.resolveRequest(context, "./actions", "ios"), {
      type: "sourceFile",
      filePath: proxy,
    });
    assert.throws(
      () => config.resolver.resolveRequest(context, "server-only", "ios"),
      /server-only/,
    );
    assert.match(
      config.resolver.resolveRequest(context, "@rshono/core/client", "android").filePath,
      /navigation\.js$/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("uses cached metadata in resolution and observes rebuild replacements", async () => {
  const root = mkdtempSync(join(tmpdir(), "rshono-metro-cache-"));
  try {
    mkdirSync(join(root, ".rshono-native"));
    const metadata = join(root, ".rshono-native/metro.json"),
      source = join(root, "actions.ts");
    writeFileSync(metadata, JSON.stringify({ actions: { [source]: "first" } }));
    const config = withRshono({ projectRoot: root });
    const context = { resolveRequest: () => ({ type: "sourceFile", filePath: source }) };
    for (let i = 0; i < 100; i++)
      assert.equal(config.resolver.resolveRequest(context, "./actions", "ios").filePath, "first");
    // A malformed partial write must not corrupt the active resolver map.
    writeFileSync(metadata, "{");
    await new Promise((resolve) => setTimeout(resolve, 350));
    assert.equal(config.resolver.resolveRequest(context, "./actions", "ios").filePath, "first");
    writeFileSync(metadata, JSON.stringify({ actions: { [source]: "second" } }));
    await new Promise((resolve) => setTimeout(resolve, 350));
    assert.equal(config.resolver.resolveRequest(context, "./actions", "ios").filePath, "second");
    assert.throws(
      () => config.resolver.resolveRequest(context, "@rshono/core/server/internal", "ios"),
      /server-only/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("shares a single metadata watcher across repeated configurations", async () => {
  const fs = require("node:fs"),
    watch = vi.spyOn(fs, "watchFile");
  const root = mkdtempSync(join(tmpdir(), "rshono-metro-shared-"));
  try {
    mkdirSync(join(root, ".rshono-native"));
    const file = join(root, ".rshono-native/metro.json"),
      source = join(root, "actions.ts");
    writeFileSync(file, JSON.stringify({ actions: { [source]: "first" } }));
    const configs = Array.from({ length: 10 }, (_, index) =>
      withRshono({ projectRoot: index % 2 ? join(root, ".") : root }),
    );
    assert.equal(watch.mock.calls.filter(([path]) => path === file).length, 1);
    writeFileSync(file, JSON.stringify({ actions: { [source]: "second" } }));
    const context = { resolveRequest: () => ({ type: "sourceFile", filePath: source }) };
    await vi.waitFor(
      () => {
        for (const config of configs)
          assert.equal(
            config.resolver.resolveRequest(context, "./actions", "ios").filePath,
            "second",
          );
      },
      { timeout: 2000, interval: 50 },
    );
  } finally {
    watch.mockRestore();
    rmSync(root, { recursive: true, force: true });
  }
});
