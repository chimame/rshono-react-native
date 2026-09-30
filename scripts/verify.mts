import { pnpm } from "./commands.mts";
import { versionSkew } from "./version-skew.mts";
import { integration } from "./integration.mts";
// Build examples first to generate manifests, then check types before running tests.
pnpm(["example:build"]);
pnpm(["typecheck"]);
pnpm(["typecheck:tools"]);
pnpm(["--filter", "rshono-native-server-example", "typecheck"]);
pnpm(["--filter", "rshono-native-example", "typecheck"]);
pnpm(["test:unit"]);
pnpm(["--filter", "rshono-native-server-example", "test"]);
await integration();
await versionSkew();
