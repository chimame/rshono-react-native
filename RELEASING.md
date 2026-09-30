# Releasing

Publishing source to GitHub and publishing a package to npm are separate steps. The project is currently in alpha and has no automatic npm publishing workflow.

## Release checklist

1. Update the package version, supported versions, changelog, and README limitations.
2. Run `corepack pnpm install --frozen-lockfile`, `corepack pnpm verify`, `corepack pnpm verify:package`, `corepack pnpm format:check`, and `corepack pnpm lint`.
3. Confirm that GitHub CI passes on Node 22/24, including iOS/Android production bundles.
4. Verify rendering, interaction, and refetching in a supported Expo Go version or development build. Clearly identify untested platforms.
5. Run `corepack pnpm pack --out package.tgz`. The `verify:package` script checks that only dist, README, LICENSE, CHANGELOG, and package.json are included.

## GitHub

Publish only this package directory with its own Git history. Do not include a parent repository's history, application code, node_modules, generated files, or environment files.

For a release, tag the verified commit with the matching package version and mark alpha releases as GitHub pre-releases. Attach the npm tarball if needed. GitHub's automatic source archives do not contain dist and cannot be used directly as npm package tarballs.

## npm (separate step)

Verify package name availability and ownership, authenticate with npm, and publish explicitly. The package's publishConfig specifies `access: public` and `tag: alpha`; do not publish an alpha under the stable latest tag.

```sh
corepack pnpm publish ./package.tgz --access public --tag alpha
```

After publishing, install the actual registry version into a new project and verify APIs, builds, and the native connection. Update the README's “Not yet published to npm” notice only after the npm publication is complete.

## Server and native deployments

The generated client and server must have matching build IDs. Rebuilding or replacing only the server causes older native apps to receive BUILD_MISMATCH errors. Consumer applications are responsible for retaining endpoints for older clients. This alpha does not manage deployments for multiple app versions.
