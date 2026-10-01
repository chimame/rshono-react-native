import { Suspense } from "react";
import { AsyncBoundary } from "@rshono/core/client";
import NavigationProbe from "../../native/src/components/NavigationProbe";
import type { PageProps } from "@rshono/core";
import { redirect, notFound } from "@rshono/core/server";
import { Panel, Label } from "../../native/src/components/native-host";
async function Delayed({ path }: { path: string }) {
  await new Promise((resolve) => setTimeout(resolve, path === "/stalled" ? 250 : 80));
  if (path === "/late-redirect") redirect("/native?name=redirected");
  if (path === "/late-missing") notFound();
  if (path === "/stream-error") throw new Error("A streamed section failed");
  return <Label>Stream completed</Label>;
}
export default function Cases({ url }: PageProps) {
  if (url.pathname === "/redirect") redirect("/native?name=redirected");
  if (url.pathname === "/missing") notFound();
  if (url.pathname === "/native-boundaries")
    return (
      <AsyncBoundary
        loading={<Label>Native boundary loading</Label>}
        error={<Label>Native boundary error</Label>}
      >
        <NavigationProbe />
        <Delayed path="/stream" />
      </AsyncBoundary>
    );
  return (
    <Panel>
      <Label>Stream shell</Label>
      <Suspense fallback={<Label>Waiting for stream</Label>}>
        <Delayed path={url.pathname} />
      </Suspense>
    </Panel>
  );
}
