import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { root, pnpm } from "./commands.mts";
import { integration } from "./integration.mts";

// Keep the working example untouched and retain the old decoder across server builds.
export async function versionSkew() {
  const artifacts = join(root, ".artifacts");
  await mkdir(artifacts, { recursive: true });
  const workspace = await mkdtemp(join(artifacts, "version-skew-"));
  try {
    for (const name of ["native", "server"]) {
      const source = join(root, "example", name);
      const target = join(workspace, "example", name);
      await cp(source, target, {
        recursive: true,
        filter: (path) =>
          !["node_modules", "dist", ".rshono-native", ".expo"].includes(basename(path)),
      });
      await symlink(join(source, "node_modules"), join(target, "node_modules"), "junction");
    }
    const server = join(workspace, "example/server");
    const decoder = join(workspace, "example/native/.rshono-native/native-client.cjs");
    pnpm(["--dir", server, "build"]);
    const oldDecoder = await readFile(decoder);
    const page = join(server, "src/page.tsx");
    const before = await readFile(page, "utf8");
    const title = "Updated server wording";
    if (!before.includes("Screen from RSHono")) throw new Error("Missing version skew fixture.");
    await writeFile(
      join(workspace, "example/native/src/components/ReviewBadge.tsx"),
      `'use client';
import { Text } from 'react-native';
export default function ReviewBadge() { return <Text>New review component</Text>; }
`,
    );
    await writeFile(
      page,
      'import ReviewBadge from "../../native/src/components/ReviewBadge";\n' +
        before
          .replace("Screen from RSHono", title)
          .replace("<Counter />", '{release === "review-3" ? <ReviewBadge /> : null}<Counter />'),
    );
    pnpm(["--dir", server, "build"]);
    const newDecoder = await readFile(decoder);
    await writeFile(decoder, oldDecoder);
    const env = { ...process.env, RSHONO_EXPECTED_TITLE: title };
    await integration(workspace, env);
    await writeFile(decoder, newDecoder);
    await integration(workspace, { ...env, RSHONO_NEW_COMPONENT: "1" });
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}
