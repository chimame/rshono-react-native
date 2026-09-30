# Changelog

## Unreleased

- Migrate development dependency management to pnpm workspaces.
- Replace the formatter with Oxfmt and add Oxlint checks.
- Migrate library and server tests to Vitest; retain jest-expo for the native example.
- Use English throughout documentation, comments, diagnostics, tests, and example UI.

## 0.1.0-alpha.0

- Initial alpha for rendering GET Flight responses in React Native without modifying RSHono.
- Expose RshonoProvider, ServerScreen, lower-level fetching and rendering APIs, and RshonoError.
- Implement automatic use client boundary transforms, Metro integration, build ID validation, and a CLI.
- Remove the proof of concept's manual component mapping and server helper; separate the internal manifest from public APIs.
- Generate JavaScript and types in dist from TypeScript in src. Include an independent Expo 57 example in the repository.
- Verify types, real HTTP integration, standalone package consumption, and native production bundles in CI.

This experimental release targets a fixed set of compatible versions. See the README for unsupported features and deployment limitations.
