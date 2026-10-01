import type { LoaderContext } from "@rspack/core" with { "resolution-mode": "import" };
import { parse } from "@babel/parser";
import { readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { transformClientBoundary, bindingNames } from "./transform.cjs";
function clientLoader(this: LoaderContext<{ target: "server" | "client" }>, source: string) {
  const callback = this.async();
  const resolve = (from: string, specifier: string) =>
    new Promise<string>((yes, no) =>
      this.resolve(dirname(from), specifier, (error, result) =>
        error || !result ? no(error ?? new Error(`Cannot resolve ${specifier}`)) : yes(result),
      ),
    );
  const exportsFrom = async (file: string, seen: Set<string>): Promise<string[]> => {
    if (seen.has(file)) return [];
    const next = new Set(seen).add(file);
    this.addDependency(file);
    const ast = parse(await readFile(file, "utf8"), {
      sourceType: "unambiguous",
      plugins: ["typescript", "jsx"],
    });
    const names = new Set<string>();
    const stars = new Map<string, number>();
    for (const node of ast.program.body) {
      if (node.type === "ExportAllDeclaration" && node.exportKind !== "type") {
        for (const name of await exportsFrom(await resolve(file, node.source.value), next))
          if (name !== "default") stars.set(name, (stars.get(name) ?? 0) + 1);
      } else if (node.type === "ExportNamedDeclaration" && node.exportKind !== "type") {
        for (const specifier of node.specifiers)
          if (specifier.type === "ExportSpecifier" && specifier.exportKind !== "type")
            names.add(
              specifier.exported.type === "Identifier"
                ? specifier.exported.name
                : specifier.exported.value,
            );
        const declaration = node.declaration;
        if (
          declaration &&
          "id" in declaration &&
          declaration.id?.type === "Identifier" &&
          !["TSInterfaceDeclaration", "TSTypeAliasDeclaration"].includes(declaration.type)
        )
          names.add(declaration.id.name);
        if (declaration?.type === "VariableDeclaration")
          for (const variable of declaration.declarations)
            for (const name of bindingNames(
              variable.id as unknown as Parameters<typeof bindingNames>[0],
            ))
              names.add(name);
      }
    }
    for (const [name, count] of stars) if (count === 1) names.add(name);
    return [...names];
  };
  void (async () => {
    const ast = parse(source, { sourceType: "unambiguous", plugins: ["typescript", "jsx"] });
    const starExports: Record<string, string[]> = {};
    if (ast.program.directives.some((d) => d.value.value === "use client")) {
      const occurrences = new Map<string, number>();
      for (const node of ast.program.body)
        if (node.type === "ExportAllDeclaration" && node.exportKind !== "type") {
          const names = await exportsFrom(
            await resolve(this.resourcePath, node.source.value),
            new Set([this.resourcePath]),
          );
          starExports[node.source.value] = names;
          for (const name of names) occurrences.set(name, (occurrences.get(name) ?? 0) + 1);
        }
      for (const source of Object.keys(starExports))
        starExports[source] = starExports[source].filter((name) => occurrences.get(name) === 1);
    }
    return transformClientBoundary(
      source,
      this.resourcePath,
      this.getOptions().target,
      starExports,
    );
  })().then(
    (result) => callback(null, result),
    (error) => callback(error),
  );
}
export = clientLoader;
