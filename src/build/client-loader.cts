import type { LoaderContext } from "@rspack/core" with {
  "resolution-mode": "import",
};
import { transformClientBoundary } from "./transform.cjs";
function clientLoader(this: LoaderContext<{ target: "server" | "client" }>, source: string) {
  return transformClientBoundary(source, this.resourcePath, this.getOptions().target);
}
export = clientLoader;
