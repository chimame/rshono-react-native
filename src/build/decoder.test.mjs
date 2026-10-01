import { test } from "vitest";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
const require = createRequire(import.meta.url);
const loader = require("../../dist/build/decoder-loader.cjs");
test("adapts both pinned decoder builds and fails closed when the upstream callback changes", async () => {
  for (const mode of ["production", "development"]) {
    const file = require
      .resolve("react-server-dom-rspack/client.browser")
      .replace("client.browser.js", `cjs/react-server-dom-rspack-client.browser.${mode}.js`);
    const source = await readFile(file, "utf8");
    const adapted = loader.call({}, source);
    assert.match(
      adapted,
      /options && options.callServer \? options.callServer : callCurrentServerCallback/,
    );
    assert.throws(
      () =>
        loader.call(
          {},
          source.replace(
            "function createResponseFromOptions(options)",
            "function changed(options)",
          ),
        ),
      /Unsupported Flight decoder/,
    );
  }
});
