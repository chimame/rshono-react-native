# Device verification

Run this checklist for every release. Node/Jest integration and Metro production exports do not prove that a physical device, signed release application, or native streaming fetch behaves correctly.

## Setup

1. Run `pnpm example:build` and `pnpm example:server` in separate terminals. Start Metro with `pnpm example:native`.
2. Open the native example in the supported Expo Go SDK, or a development build. For iOS Simulator use `http://127.0.0.1:3100`. For Android Emulator use `http://10.0.2.2:3100`. For a physical device use the development machine's LAN address and a reachable server; production should use HTTPS.
3. Record device/OS, app release, React/RSHono/Flight versions, fetch implementation, and server commit. Never record authentication tokens.

## Interaction and transport

- Confirm the greeting, server timestamp, request ID, and native controls render without DOM tags.
- Confirm the platform label says `iOS native implementation` or `Android native implementation` on the corresponding platform.
- Increment the local counter. Refresh the server screen and confirm the timestamp changes while the local count survives. Reset the screen and confirm local state returns to zero.
- Call the Server Function prop, then the imported Server Function. Confirm both the returned result and server counter change. Repeated clicks must execute in order.
- Stop the server, refresh, and confirm the previous screen remains with a retry error. Restart the server and retry. No mutation should be retried automatically.
- Navigate away during a stalled request and during a mutation. Confirm the departed screen does not update or navigate after completion.
- Exercise the `/stream`, `/stalled`, `/stream-error`, `/redirect`, `/late-redirect`, `/missing`, and `/late-missing` server fixtures with a `ServerScreen` path and explicit `renderNotFound`/navigation callbacks. Confirm Suspense fallback, late timeout recovery, one redirect callback, and native not-found UI.
- In an application using `createNativeLifecycle`, subscribe to AppState, NetInfo and navigation focus, then emit `active`, `reconnect`, and `focus`. Confirm only configured `refreshOn` events refresh the screen, without resetting local state or leaving subscriptions after unmount.
- With authentication enabled, expire a token and confirm concurrent GETs share one refresh. Confirm rejected POSTs surface an error without replaying a mutation. Sign out/change headers and confirm the previous user's tree disappears immediately.

## Distribution

- Export production bundles for both platforms using the CI commands. Also launch a signed release build on a physical iOS and Android device, with developer tooling disabled, before declaring those combinations supported.
- Test background/foreground, network loss/recovery, and HTTPS against the deployment used by the release build.
- Test both current and retained app releases against the same deployment or their version-routed deployments. Keep old Client Component references available while installed clients use them.
- After an authorized npm publication, run `pnpm verify:registry <exact-version>` and repeat a native smoke test from the installed package.

Actual registry verification requires a published version. Signing, store rollout, and physical-device validation require the release owner's credentials/devices and are separate from local implementation verification.
