import { randomUUID } from "node:crypto";
import type { PageProps } from "@rshono/core";
import { Panel, Label } from "../../native/src/components/native-host";

import Counter from "../../native/src/components/Counter";

export default async function NativePage({ url }: PageProps) {
  await new Promise((resolve) => setTimeout(resolve, 150));
  const name = url.searchParams.get("name")?.slice(0, 40) || "React Native";
  return (
    <Panel>
      <Label>Screen from RSHono</Label>
      <Label>Hello, {name}</Label>
      <Label>Server time: {new Date().toISOString()}</Label>
      <Label>Request ID: {randomUUID()}</Label>
      <Counter />
    </Panel>
  );
}
