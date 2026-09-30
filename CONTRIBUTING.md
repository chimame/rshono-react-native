# Contributing

This directory is the root of a standalone repository. It does not depend on an external application repository. Use Node.js 22.18 or later, Corepack, and pnpm 10.34.6.

## Setup and verification

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm verify
corepack pnpm verify:package
corepack pnpm format:check
corepack pnpm lint
```

`verify` builds the library and examples, checks types, and runs unit, server, and real HTTP native integration tests. It allocates a test port and shuts down the server it starts. `verify:package` installs the tarball into a consumer project without the library source and validates exports, generated types, and the CLI's relative file references.

CI runs these commands on Linux with Node 22 and 24. The Node 22 job also creates iOS and Android production bundles. Manual device testing is separate from CI.

## Source layout

- `src/runtime`: Fetching, state, React components, and the error contract.
- `src/build`: Public configuration, internal options, Rspack hooks, loader, CLI, and injected build entries.
- `src/metro`: Generated manifest resolution and shared source watching.
- `src/internal`: Manifest integration that is not intended for direct use.
- `example`: Independent server and native apps using only public APIs.
- `scripts`: Verification commands shared by CI and local development.

Implementation code is TypeScript. `tsc` generates JavaScript and type declarations in `dist`. Library and server Vitest tests live alongside the implementation as `.test.mjs` files and exercise the compiled JavaScript. The native example uses jest-expo and React Native Testing Library. Do not maintain duplicate TypeScript and JavaScript implementations. Keep internal declarations for virtual modules and build constants in `globals.d.ts`.

## Making changes

Write documentation, code comments, test descriptions, diagnostics, and example UI text in English.

Changes to public APIs or behavior should include regression tests beside the affected code and updates to the README. Add public exports only when consumers need them; keep internal options and symbols out of public entry points. Record compatibility changes in the changelog, including during alpha development.

Format only changed files with `pnpm exec oxfmt --write <files...>` and run `pnpm lint`. Validate React, React DOM, RSHono, and Flight upgrades together. Do not import Node modules or build-only dependencies into the native runtime.

## Why tsc?

The library needs compilation and type declaration generation. Rspack builds the application's RSC bundles, while Metro bundles the native app. We do not bundle the library into a single file because relative loader paths and the import boundaries replaced by Metro must remain intact.

Before switching to Vite, Rolldown, or another bundler, validate React externalization, the manifest entry point, CLI entry/loader paths, and generated types with `verify:package` and native production bundles.

## Development tools

A pnpm workspace keeps library and example dependencies separate. pnpm is pinned to version 10 for compatibility with the existing Corepack setup in Node 22. The `prepare` script builds the library before pnpm links its CLI into dependent examples, so a fresh clone does not need prebuilt `dist` files. Update `pnpm-lock.yaml` when dependencies change. CI uses `--frozen-lockfile` for reproducibility.

Oxfmt handles formatting and Oxlint checks TypeScript, React, and Hooks correctness rules. Configuration lives in `.oxfmtrc.json` and `.oxlintrc.json`; generated files are excluded. The `react/purity` rule is disabled for Server Components that read request-time values. Vitest tests the library and server against compiled `dist`, including actual Node CommonJS loading. Run `pnpm test` after implementation changes to rebuild before testing.

We use Oxc and Vitest directly instead of adopting Vite+. This keeps their responsibilities clear alongside tsc, Rspack, and Metro. Native tests retain jest-expo's Expo module mocks.
