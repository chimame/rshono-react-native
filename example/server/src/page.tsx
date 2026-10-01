import type { PageProps } from "@rshono/core";
import { Panel, Label } from "../../native/src/components/native-host";

import ServerControls from "../../native/src/components/ServerControls";
import { incrementServerCounter, readServerCounter } from "./actions";
import PlatformLabel from "../../native/src/components/PlatformLabel";
import Counter from "../../native/src/components/Counter";

export default async function NativePage({ url, ctx }: PageProps) {
  await new Promise((resolve) => setTimeout(resolve, 150));
  const name = url.searchParams.get("name")?.slice(0, 40) || "React Native";
  const release = ctx.req.header("x-app-release");
  return (
    <Panel>
      <Label>Screen from RSHono</Label>
      <Label>{release === "review-2" ? "Preview experience" : "Current experience"}</Label>
      <Label>Hello, {name}</Label>
      <Label>Server time: {new Date().toISOString()}</Label>
      <Label>Request ID: {crypto.randomUUID()}</Label>
      <PlatformLabel />
      <Counter />
      <Label>Server counter: {await readServerCounter()}</Label>
      <ServerControls increment={incrementServerCounter} />
    </Panel>
  );
}
