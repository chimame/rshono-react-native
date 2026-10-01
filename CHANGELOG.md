# Changelog

## Unreleased

- Share Metro metadata watchers across repeated configurations and verify actual loopback/wildcard development server binds, including rebuilds and inherited `HOST` overrides.
- Release response bodies and cached subscribers when rejecting foreign or malformed final URLs.
- Report incomplete Server Function metadata clearly; atomically replace auxiliary build outputs and publish the manifest entry last.

- Fix duplicate redirect delivery, invalid redirect locations, reload-key cache bypass, StrictMode loading, undefined provider overrides, and cleanup of late fetch responses.
- Bound cached wire history before subscribers attach; refresh Metro metadata outside its resolver hot path.
- Generate portable file URL imports, discover actions in watch roots, and test the native boundary/navigation bridge across retained clients.

- Preserve native Client Component state during refresh; add explicit reset and screen-scoped controls.
- Support decoded and imported Server Functions, argument encoding, action results, serialized mutation dispatch, and screen updates without a global routing callback.
- Handle HTTP/Flight redirects, late control digests, native/server 404 displays, stream idle timeouts, and reader cancellation.
- Add asynchronous authentication headers, shared 401 GET refresh, bounded byte caching, request sharing, prefetch/invalidation, and opt-in stale network fallback.
- Add native navigation/lifecycle adapters and transport/render diagnostics.
- Add native dev/watch and doctor commands, third-party boundary roots, aliases, platform resolution, static export stars, destructured exports, and server-only diagnostics.
- Expand integration coverage and add reusable device/release verification workflows.

- Remove generated build IDs, the build-match response header, and the `BUILD_MISMATCH` error. Build agreement remains application-controlled; manifests also expose decoder/action encoding capabilities.
- Let applications select RSC responses using optional release/version headers; add a server-controlled example and cross-build native rendering tests.

- Migrate development dependency management to pnpm workspaces.
- Replace the formatter with Oxfmt and add Oxlint checks.
- Migrate library and server tests to Vitest; retain jest-expo for the native example.
- Use English throughout documentation, comments, diagnostics, tests, and example UI.

## 0.1.0-alpha.0

- Initial alpha for rendering GET Flight responses in React Native without modifying RSHono.
- Expose RshonoProvider, ServerScreen, lower-level fetching and rendering APIs, and RshonoError.
- Implement automatic use client boundary transforms, Metro integration, application-controlled release headers, and a CLI.
- Remove the proof of concept's manual component mapping and server helper; separate the internal manifest from public APIs.
- Generate JavaScript and types in dist from TypeScript in src. Include an independent Expo 57 example in the repository.
- Verify types, real HTTP integration, standalone package consumption, and native production bundles in CI.

This experimental release targets a fixed set of compatible versions. See the README for unsupported features and deployment limitations.
