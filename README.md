# rshono-react-native

[![CI](https://github.com/chimame/rshono-react-native/actions/workflows/ci.yml/badge.svg)](https://github.com/chimame/rshono-react-native/actions/workflows/ci.yml)

An unofficial, experimental adapter that renders RSHono React Server Components as React Native UI. It requires no source changes to RSHono or the Flight decoder.

**0.1.0-alpha.0 / Not yet published to npm.** This alpha targets a fixed set of compatible versions. Server Functions and HMR are not supported. Applications control version-specific RSC responses on the server. You can use it within ordinary Expo Router screens; integration with Expo Router's own RSC implementation is outside the scope of this project.

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

`/internal/*` connects the CLI, Metro, and runtime. Do not use these entry points directly; they are not covered by compatibility guarantees. The unpublished proof of concept's `/client`, `/server`, and `output/components` configuration have been removed.

`RshonoProvider` accepts `origin` and optional `fetch`, `headers`, `timeoutMs`, `fallback`, and `renderError`. Injecting a custom `client` bypasses the automatic manifest connection and the provider's `fetch`. The default fetch implementation is global fetch and must support ReadableStream.

`ServerScreen` accepts `path`, `searchParams`, and `reloadKey`. Query values can be strings, numbers, or booleans; null and undefined values are omitted. Screens can override `headers`, `timeoutMs`, `fallback`, and `renderError`. Headers are merged with the provider's headers. Update the provider's headers when authentication tokens change.

`origin` must be an HTTP(S) origin without a path. `path` must start with `/` and stay on the same server. Changes to the URL, query, headers, or `reloadKey` trigger another request. The previous screen is unmounted while loading and mounted again on success, resetting local component state.

`renderError(error, retry)` receives fetch and rendering errors. Without it, errors propagate to a parent Error Boundary. The default fallback is null. The default timeout is 15 seconds and covers fetching the root payload; it does not include subsequent Suspense waits.

## Server-controlled rendering and version skew

The server decides what to render for each request. The library does not generate or compare build IDs, enforce app versions, or require an app update for server-only wording and data changes. A screen receives updated content on its next request; updates are not pushed to an already displayed screen.

Use the existing optional `headers` prop to identify an app release. Header names and values belong to your application; the library only reserves `RSC`.

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
| `TIMEOUT`             | Fetching the root payload exceeded the timeout                     |

Branch on `code` and `status`, not on message strings. Cancellation preserves the AbortSignal's reason, typically an AbortError. Errors from user components or custom clients are not necessarily RshonoError instances. Build tool errors are reported as CLI diagnostics.

## Compatibility and limitations

- Tested versions: RSHono 1.0.0-rc.23, Rspack 2.2.7, react-server-dom-rspack 0.1.0, React/React DOM 19.2.3, Expo 57.0.26, and React Native 0.86.3. Peer dependency ranges are not expanded to untested combinations.
- This adapter supports production builds and request-time GET rendering. Server Functions, RSHono web navigation, HMR, static HTML, simultaneous web/native serving, and offline use are not supported.
- Named/default exports and explicit named re-exports are supported. Export stars, namespace exports, destructured exports, and enums are rejected at Client Component boundaries. Put native state and event handlers in Client Components and pass RSC-serializable props from the server.
- A Rspack loader generates server references from native implementations. Flight references must resolve to components bundled in the requesting app. Metro processes the original native source; the server does not execute react-native itself.
- In addition to the public Rspack hook, the adapter depends on RSHono's internal RouterProvider and Flight format. It requires no RSHono source changes but still depends on upstream internals.
- Rendering has been verified in Expo Go on an iOS simulator. CI checks real HTTP integration and iOS/Android Metro production bundles. Android device execution, physical devices, and app store distribution have not been verified.

## Development

Source code is organized into `src/runtime` (native), `src/build` (Node/Rspack), `src/metro` (Node/Metro), and `src/internal` (internal integration). Only the compiled `dist` implementation is shipped in the npm package, alongside package metadata, documentation, and licenses. Examples, tests, and source files are excluded. TypeScript `.mts` files compile to ESM and `.cts` files to CommonJS.

```sh
corepack pnpm verify
corepack pnpm verify:package
corepack pnpm format:check
corepack pnpm lint
```

`verify` starts and stops a server automatically and runs the real HTTP tests. `verify:package` installs the tarball into a temporary project with pnpm and validates public entry points, types, the CLI, and RSC responses. It requires registry access.

[Contributing](CONTRIBUTING.md) · [Releasing](RELEASING.md) · [Changelog](CHANGELOG.md)

## License

MIT. Generated clients include license notices for RSHono and the Flight decoder.
