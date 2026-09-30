import { test } from "vitest";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveNativeOptions } from "../../dist/build/options.mjs";
test("resolves native output and shared sources and rejects legacy options and missing apps", () => {
  const root = mkdtempSync(join(tmpdir(), "rshono-options-"));
  try {
    mkdirSync(join(root, "mobile"));
    writeFileSync(join(root, "mobile/package.json"), "{}");
    const result = resolveNativeOptions(
      { nativeRoot: "mobile", clientRoots: ["shared", "shared"] },
      root,
    );
    assert.equal(result.output, join(root, "mobile/.rshono-native/native-client.cjs"));
    assert.deepEqual(result.clientRoots, [
      join(root, "src"),
      join(root, "mobile"),
      join(root, "shared"),
    ]);
    assert.throws(
      () => resolveNativeOptions({ output: "old.cjs", components: [] }, root),
      /nativeRoot/,
    );
    assert.throws(() => resolveNativeOptions({ nativeRoot: "missing" }, root), /package.json/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
