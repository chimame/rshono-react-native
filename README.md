# rshono-react-native

[![CI](https://github.com/chimame/rshono-react-native/actions/workflows/ci.yml/badge.svg)](https://github.com/chimame/rshono-react-native/actions/workflows/ci.yml)

An unofficial, experimental adapter that renders RSHono React Server Components as React Native UI. It requires no changes to installed RSHono sources. The generated decoder adapts the pinned Flight callback implementation to bind Server Functions per screen.

**0.1.0-alpha.0 / Not yet published to npm.** This alpha targets a fixed set of compatible versions. Server Functions, state-preserving refresh, and a native watch/rebuild development workflow are supported. Applications control version-specific RSC responses on the server. You can use it within ordinary Expo Router screens; integration with Expo Router's own RSC implementation is outside the scope of this project.

## Run the example

Use Node.js 22.18 or later and Corepack.

```sh
git clone https://github.com/chimame/rshono-react-native.git
cd rshono-react-native
corepack pnpm install --frozen-lockfile
corepack pnpm example:build
corepack pnpm example:server
```

Open another terminal in the same directory:

```sh
corepack pnpm example:native
# Open in the iOS simulator
corepack pnpm --filter rshono-native-example ios
```

The server runs on port 3100 and Metro on port 8086. Use Expo Go with SDK 57 support. Connect to `http://127.0.0.1:3100` from the iOS simulator or `http://10.0.2.2:3100` from the Android emulator. See the [example guide](example/GUIDE.md) for details.

## Install in your own app

Until the package is published to npm, run `corepack pnpm pack --out package.tgz` and install the resulting tarball in both your server and native app. GitHub source archives are different from npm package tarballs.

```sh
# Run in each project; adjust the path to your tarball.
corepack pnpm add /path/to/package.tgz
```

The native app needs React/React DOM 19.2.3 and a streaming fetch implementation, such as `expo/fetch`. Install the following RSHono, Rspack, Flight, React, React DOM, and Hono versions in the server project. Node build tools and the Expo package itself are not bundled into the library's native runtime.

```sh
# Server project
corepack pnpm add @rshono/core@1.0.0-rc.23 @rspack/core@2.2.7 \
  react-server-dom-rspack@0.1.0 react@19.2.3 react-dom@19.2.3 hono@4.13.7
```

## Usage

Write your native component once:

```tsx
// mobile/components/Greeting.tsx
"use client";
import { Text } from "react-native";
export default function Greeting({ name }: { name: string }) {
  return <Text>Hello, {name}</Text>;
}
```

Import it directly into a server page. You do not need separate server-side prop declarations or a component registry.

```tsx
// server/src/page.tsx
import type { PageProps } from "@rshono/core";
import Greeting from "../../mobile/components/Greeting";
export default async function Page({ url }: PageProps) {
  return <Greeting name={url.searchParams.get("name") ?? "React Native"} />;
}
```

Pass connection options to the provider in your native screen:

```tsx
import { ActivityIndicator, Text } from "react-native";
import { fetch } from "expo/fetch";
import { RshonoProvider, ServerScreen } from "rshono-react-native";
export default function Screen() {
  return (
    <RshonoProvider
      origin="http://127.0.0.1:3100"
      fetch={fetch}
      fallback={<ActivityIndicator />}
      renderError={(error) => <Text>{error.message}</Text>}
    >
      <ServerScreen path="/native" searchParams={{ name: "Alex" }} />
    </RshonoProvider>
  );
}
```

Register `/native` on the server. See [routes.ts](example/server/src/routes.ts) for a minimal example.

Server configuration (`rshono.config.ts`):

```ts
import { defineNativeConfig } from "rshono-react-native/build";
export default defineNativeConfig({ nativeRoot: "../mobile" });
```

Paths are relative to the server's working directory. Pass an existing RSHono configuration as the second argument. Set `clientRoots: ["../shared"]` only when Client Components live outside the server's `src` directory and the native app.

Native configuration (`metro.config.cjs`):

```js
const { getDefaultConfig } = require("expo/metro-config");
const { withRshono } = require("rshono-react-native/metro");
module.exports = withRshono(getDefaultConfig(__dirname));
```

If you already have a Metro configuration, wrap the final configuration with `withRshono(config)`. Use `rshono-native build` as the server build script and the standard `rshono start` command to serve it. Build the server before starting Metro. Do not edit the generated `.rshono-native/` directory; exclude it from version control.

## Public API

| Entry point           | API                                         | Purpose                                                             |
| --------------------- | ------------------------------------------- | ------------------------------------------------------------------- |
| `rshono-react-native` | `RshonoProvider`                            | Origin, fetch, authentication headers, and shared rendering options |
| `rshono-react-native` | `ServerScreen`                              | Render a screen from a server path                                  |
| `rshono-react-native` | `RshonoError` / `RshonoErrorCode`           | Identify fetch and configuration errors                             |
| `rshono-react-native` | `createNativeClient` / `useRsc` / `RscView` | Lower-level APIs for custom integrations                            |
| `/build`              | `defineNativeConfig` / `NativeBuildOptions` | Configure the RSHono build                                          |
| `/metro`              | `withRshono`                                | Configure Metro                                                     |

Additional native exports: `useServerScreen`, `useServerFunction`, `createExpoRouterAdapter`, `createReactNavigationAdapter`, and `createNativeLifecycle`. Low-level clients expose `callServer`, `prefetch`, `invalidate`, and `serverFunctionId`; those capabilities are optional on custom clients.

`/internal/*` connects the CLI, Metro, and runtime. Do not use these entry points directly; they are not covered by compatibility guarantees. The unpublished proof of concept's `/client`, `/server`, and `output/components` configuration have been removed.

`RshonoProvider` accepts `origin`, `fetch`, `headers`, `getHeaders`, `onUnauthorized`, `timeoutMs`, `streamIdleTimeoutMs`, `preserveState`, `fallback`, `renderError`, `renderNotFound`, `onRedirect`, `navigation`, `lifecycle`, `refreshOn`, cache options, `onRequest`, `onError`, and `onRenderError`. Injecting a custom `client` bypasses the automatic manifest connection and the provider's `fetch`. The default fetch implementation is global fetch and must support ReadableStream.

`ServerScreen` accepts `path`, `searchParams`, and `reloadKey`. Query values can be strings, numbers, or booleans; null and undefined values are omitted. Screens can override `headers`, `timeoutMs`, `fallback`, and `renderError`. Headers are merged with the provider's headers. Update the provider's headers when authentication tokens change.

`origin` must be an HTTP(S) origin without a path. `path` must start with `/` and stay on the same server. Changes to the URL, query, headers, or `reloadKey` trigger another request. Refreshing the same screen preserves Client Component state and displays the previous tree while loading. Changing the URL, authentication headers, or client resets the tree. Set `preserveState={false}` for the previous behavior, or call `reset()` explicitly.

`renderError(error, retry)` receives fetch and rendering errors. Without it, errors propagate to a parent Error Boundary. The default fallback is null. The default root timeout and stream idle timeout are both 15 seconds. `timeoutMs` covers fetching/decoding the root; `streamIdleTimeoutMs` also watches delayed Suspense chunks until EOF. Set either to 0 to disable it.

## Refresh and Server Functions

Inside a native Client Component rendered by `ServerScreen`:

```tsx
"use client";
import { Pressable, Text } from "react-native";
import { useServerScreen, useServerFunction } from "rshono-react-native";
import { saveName } from "../../server/src/actions";

export function SaveButton() {
  const { refresh, reset, pending } = useServerScreen();
  const save = useServerFunction(saveName);
  return (
    <Pressable
      disabled={pending}
      onPress={async () => {
        await save("Alex"); // Action response also updates this screen's RSC tree.
      }}
    >
      <Text>Save</Text>
    </Pressable>
  );
}
```

`refresh()` and `reloadKey` preserve matching Client Components. `reset()` unmounts the current tree. `invalidate()` clears the provider client's cache and refreshes the current screen. `pending` covers root loading, refresh, and Server Functions. Requests are aborted on navigation/unmount, and queued mutations from the same screen run in order. Aborting a POST does not undo a mutation already executed by the server.

Module-level `"use server"` exports are discovered in `clientRoots` (including server/native defaults) and `watchRoots`, compiled into references, and replaced by generated proxies in Metro. Bind imported references with `useServerFunction`; calling an imported reference directly has no screen context. Functions passed as props by the server are already bound and can be called directly. Rebuild after adding an action. Bound references passed as props are supported; the hook accepts unbound module exports. Inline closures retain upstream RSHono/Rspack limitations.

A Server Function runs on the server, so it must validate authentication, authorization, and input there. The example demonstrates these checks with a demonstration credential. Use ordinary React Native event handlers, `useTransition`, or `useActionState` with an explicitly dispatched action; HTML form actions and DOM form hooks do not apply to native views.

## Authentication, caching, and lifecycle

`getHeaders()` can asynchronously read current credentials for every request. `onUnauthorized()` is shared by concurrent 401 GET responses; after it resolves, the library reads fresh headers and retries each GET once. POSTs are never automatically retried. Explicit screen headers override generated headers, case-insensitively; avoid supplying a stale static Authorization header when using `getHeaders`.

Caching is disabled by default. Set `cacheTimeMs` to enable byte-level request sharing and `prefetch(path, searchParams)` from `useServerScreen`. `maxCacheEntries` defaults to 32 and `maxCacheBytes` to 1 MiB per response. The key includes the complete URL, headers, and authentication generation, so users and app releases do not share entries. Every screen decodes independently and has its own action callbacks. Oversized, incomplete, failed, 404, `Cache-Control: no-store`, and action responses are not retained. Successful actions invalidate the cache. Use `invalidate()` at logout as well.

`staleIfErrorMs` optionally permits a recently expired cached GET after a network failure. It does not hide HTTP/authentication failures or restore native code missing from the installed app. The cache lives only in the provider/client instance and is lost when that instance is destroyed.

`createNativeLifecycle()` returns `{ subscribe, emit }`. Connect `AppState` becoming active to `emit("active")`, NetInfo reconnecting to `emit("reconnect")`, and a navigation focus listener to `emit("focus")`. Pass the instance as `lifecycle` and choose `refreshOn={["active", "reconnect", "focus"]}`. The screen removes its subscription on unmount. No native lifecycle packages are installed by this library.

## Navigation, 404s, and diagnostics

`onRedirect(href)` receives an absolute HTTP(S) URL; otherwise `navigation.replace(href)` handles it. The handler must switch screens or replace/unmount the current `ServerScreen`. After a handled redirect the screen renders null; a no-op handler leaves it blank. HTTP redirects are requested with `redirect: "manual"`; choose a streaming fetch that respects that option. The library never intentionally fetches an external redirect with application headers. If a fetch implementation follows redirects despite the option, the adapter rejects a foreign final URL, but cannot undo a request already sent by that implementation.

Pass `renderNotFound` for a native 404 view. A 404 Flight response containing the server's not-found tree can render that tree without an override. A `notFound()` thrown after the shell is sent travels as a control digest; handle it with `renderNotFound` or `renderError`. Late redirects from Suspense are handled as navigation too.

`createExpoRouterAdapter(router)` bridges relative native routes; `createReactNavigationAdapter(navigation, navigate)` delegates URL-to-route mapping to your application. For absolute redirect URLs, normalize the server origin to a native path and handle external URLs through your application's Linking policy. `@rshono/core/client` is mapped to native-compatible `useNavigation`, `AsyncBoundary`, and `CatchBoundary` by the build and Metro adapters.

`onRequest(event)` receives request/response/error events with a local request ID, sanitized URL (no query or credentials), method, status, timing, and optional server `x-request-id`. Headers and request bodies are omitted. `onError(error, event)` reports transport failures; `onRenderError(error, componentStack)` reports component/stream rendering failures. Application error values remain application data: redact them before sending them to an external tracker.

## Development and shared packages

```sh
# In the server project
rshono-native doctor
rshono-native doctor --origin http://127.0.0.1:3100/native
rshono-native dev --port 3100 --host 127.0.0.1
# Start Metro in the native project separately.
```

`doctor` checks installed versions, configuration, generated artifacts, Metro setup, and streaming fetch availability. The optional URL probes an RSC endpoint. `--host` overrides the pinned RSHono `start` command's `HOST` environment variable. The development smoke test verifies actual `127.0.0.1` and `0.0.0.0` socket binds against conflicting inherited `HOST` values, including wildcard binding after a rebuild. `dev` watches server/native/shared sources, stops the previous server, rebuilds, publishes the generated decoder, and restarts serving after a successful build. Failed builds leave the watcher running. Metro consumes native source with its normal Fast Refresh behavior; generated-client changes may require an application reload and reset local state. Server rebuilds currently use production compilation and therefore redact server errors. Restart `dev` after changing watch roots or dependency layouts.

`defineNativeConfig` additionally accepts `clientPackages`, `watchRoots`, and `aliases`. Mark native third-party package entry points as `"use client"`, or wrap/re-export them from your native app; add `clientPackages` for packages imported directly by the server. Explicit native variants (`.ios`, `.android`, `.native`) resolve through a common stem in Metro. Keep a common server-visible module with consistent export names across platforms. Configure matching TS/Metro aliases alongside build aliases. `server-only` and direct server imports of `react-native` have dedicated diagnostics.

## Server-controlled rendering and version skew

The server decides what to render for each request. The library does not generate or compare build IDs, enforce app versions, or require an app update for server-only wording and data changes. A screen receives updated content on its next request; updates are not pushed to an already displayed screen.

Use the existing optional `headers` prop to identify an app release. Header names and values belong to your application; the library reserves `RSC` and `x-rsc-action`.

```tsx
<RshonoProvider
  origin="https://example.com"
  fetch={fetch}
  headers={{ "x-app-version": "2.0.0", "x-app-release": "review-2" }}
>
  <ServerScreen path="/native" />
</RshonoProvider>
```

Read the headers through RSHono's standard request context and choose the response on the server:

```tsx
import type { PageProps } from "@rshono/core";
import { Label } from "../../native/src/components/native-host";

export default function Page({ ctx }: PageProps) {
  const release = ctx.req.header("x-app-release");
  return <Label>{release === "review-2" ? "Preview experience" : "Current experience"}</Label>;
}
```

This lets the current store release and a release under review request the same URL and receive different content. Missing or unknown release IDs follow the application's fallback branch. No app identifier is sent automatically. These headers select presentation; they are not authentication credentials.

Client Components and their dependencies still execute from the installed app. Keep existing component references and prop contracts compatible for older releases, and send new components only to releases that contain them. Removing the build check does not install missing native code or guarantee compatibility across React/Flight upgrades, component moves, or changed module IDs. When separate builds have incompatible reference maps, route requests to the appropriate retained server deployment using the same release header. Routing and retention policies belong to the application.

For cached responses, include the release headers in the cache key (and appropriate `Vary` headers), or disable caching. The example uses `Cache-Control: private, no-store` for `/native`. `pnpm verify` also retains a generated native decoder, rebuilds the server with changed wording, and verifies native rendering for current, review, missing, and unknown release IDs over real HTTP. It also adds a new Client Component, verifies existing releases with the old decoder, and renders the new component with the new decoder for its target release.

## Error contract

```tsx
import { RshonoError } from "rshono-react-native";
// For example, inside renderError:
if (error instanceof RshonoError && error.code === "HTTP_ERROR") {
  // Handle the server response using error.status.
}
```

| Code                  | Meaning                                                            |
| --------------------- | ------------------------------------------------------------------ |
| `CONFIGURATION_ERROR` | Missing or invalid manifest or provider configuration              |
| `INVALID_URL`         | Invalid URL, origin, or path                                       |
| `NETWORK_ERROR`       | Fetch failed; the original error is available as `cause`           |
| `HTTP_ERROR`          | HTTP failure; the response code is available as `status`           |
| `INVALID_RESPONSE`    | Invalid MIME type, body, or root payload                           |
| `DECODE_ERROR`        | Flight decoding failed; the original error is available as `cause` |
| `TIMEOUT`             | Root timeout or stream idle timeout expired                        |
| `REDIRECT`            | Native navigation is required; inspect `location`                  |
| `NOT_FOUND`           | Missing page or streamed not-found control signal                  |
| `ACTION_ERROR`        | Missing/invalid Server Function result or reference                |

Branch on `code` and `status`, not on message strings. Cancellation preserves the AbortSignal's reason, typically an AbortError. Errors from user components or custom clients are not necessarily RshonoError instances. Build tool errors are reported as CLI diagnostics.

## Compatibility and limitations

- Tested versions: RSHono 1.0.0-rc.23, Rspack 2.2.7, react-server-dom-rspack 0.1.0, React/React DOM 19.2.3, Expo 57.0.26, and React Native 0.86.3. Peer dependency ranges are not expanded to untested combinations.
- This adapter supports production builds and request-time GET rendering. Static HTML and simultaneous web/native serving are not supported. `rshono-native dev` rebuilds and restarts the native server; it does not provide RSHono web HMR. Offline fallback uses a bounded, opt-in in-memory Flight cache; persistent offline storage is not included.
- Named/default exports, explicit re-exports, static export stars, and destructured variable exports are supported. Namespace exports and enums at Client Component boundaries are rejected; keep value objects and enums inside Client Components. Put native state and event handlers in Client Components and pass RSC-serializable props from the server.
- A Rspack loader generates server references from native implementations. Flight references must resolve to components bundled in the requesting app. Metro processes the original native source; the server does not execute react-native itself.
- In addition to the public Rspack hook, the adapter depends on RSHono's internal RouterProvider and Flight format. It requires no RSHono source changes but still depends on upstream internals.
- CI checks real HTTP integration and iOS/Android Metro production bundles. Device, Hermes, development-build, and release-build coverage follow [the device verification checklist](example/DEVICE_TESTING.md); physical-device and app-store verification remain release gates.

## Development

Source code is organized into `src/runtime` (native), `src/build` (Node/Rspack), `src/metro` (Node/Metro), and `src/internal` (internal integration). Only the compiled `dist` implementation is shipped in the npm package, alongside package metadata, documentation, and licenses. Examples, tests, and source files are excluded. TypeScript `.mts` files compile to ESM and `.cts` files to CommonJS.

```sh
corepack pnpm verify
corepack pnpm verify:package
corepack pnpm verify:dev
corepack pnpm format:check
corepack pnpm lint
```

`verify` starts and stops a server automatically and runs the real HTTP tests. `verify:package` installs the tarball into a temporary project with pnpm and validates public entry points, types, the CLI, and RSC responses. It requires registry access.

[Contributing](CONTRIBUTING.md) · [Releasing](RELEASING.md) · [Changelog](CHANGELOG.md)

## License

MIT. Generated clients include license notices for RSHono and the Flight decoder.
