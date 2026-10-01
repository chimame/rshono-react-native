import { test } from "vitest";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { prepareEntry } from "../../dist/build/files.mjs";
test("generates URL imports for runtime and discovered actions with special path characters", async () => {
  const root = await mkdtemp(join(tmpdir(), "rshono files #"));
  try {
    const watched = join(root, "watched"),
      native = join(root, "native");
    await mkdir(watched);
    const file = join(watched, "actions.ts");
    await writeFile(file, '"use server"; export async function action(){return 1;}');
    const { entry, actions } = await prepareEntry([watched], native);
    const source = await readFile(entry, "utf8");
    assert.deepEqual(actions, [file]);
    assert.ok(source.includes(JSON.stringify(pathToFileURL(file).href)));
    assert.match(source, /export \* from "file:/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
