import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
import { test } from "vitest";
const assert = require("node:assert/strict");
const { transformClientBoundary, PREFIX } = require("../../dist/build/transform.cjs");
const file = "/app/components/Button.tsx";
test("generates named/default references from native code and omits type exports", () => {
  const source = `"use client"; import {Text} from 'react-native'; export interface Props { title: string }; export type ID = string; export function Button(p:Props){return <Text>{p.title}</Text>}; export { Button as Alias }; export default Button;`;
  const client = transformClientBoundary(source, file, "client");
  assert.match(client, /export \{ Button, Alias, default \}/);
  assert.ok(client.includes(PREFIX + Buffer.from(file).toString("base64url")));
  assert.doesNotMatch(client, /react-native|Props|ID/);
  const server = transformClientBoundary(source, file, "server");
  assert.match(server, /use client/);
  assert.match(server, /as default/);
  assert.doesNotMatch(server, /from 'react-native'/);
});
test("ignores directives in comments and rejects export stars explicitly", () => {
  const plain = `// 'use client';\nexport default async function Page() { return null }`;
  assert.equal(transformClientBoundary(plain, file, "server"), plain);
  assert.throws(
    () => transformClientBoundary(`'use client'; export * from './ui'`, file, "client"),
    /export \*/,
  );
  assert.throws(
    () =>
      transformClientBoundary(
        `'use client'; 'use server'; export const Button = () => null`,
        file,
        "client",
      ),
    /together/,
  );
  assert.match(
    transformClientBoundary(
      `'use client'; export { View as Panel, Text } from 'react-native'; export type { Props } from './types';`,
      file,
      "client",
    ),
    /Panel, Text/,
  );
});
