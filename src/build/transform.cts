import { parse } from "@babel/parser";
export const PREFIX = "rshono-native-module:";
export function transformClientBoundary(
  source: string,
  filename: string,
  target: "server" | "client",
): string {
  // Parse the directive prologue; ignore use client text in comments.
  const ast = parse(source, {
    sourceType: "unambiguous",
    plugins: ["typescript", "jsx"],
    sourceFilename: filename,
  });
  if (!ast.program.directives.some((directive) => directive.value.value === "use client"))
    return source;
  if (ast.program.directives.some((directive) => directive.value.value === "use server"))
    throw new Error(`${filename}: use client and use server cannot be used together.`);
  const names = new Set<string>();
  for (const node of ast.program.body) {
    if (node.type === "ExportAllDeclaration" && node.exportKind !== "type")
      throw new Error(
        `${filename}: Use named re-exports instead of export * at a use client boundary.`,
      );
    if (node.type === "ExportDefaultDeclaration") {
      names.add("default");
      continue;
    }
    if (node.type !== "ExportNamedDeclaration" || node.exportKind === "type") continue;
    const declaration = node.declaration;
    if (declaration && !("declare" in declaration && declaration.declare)) {
      if (declaration.type === "FunctionDeclaration" || declaration.type === "ClassDeclaration") {
        if (declaration.id) names.add(declaration.id.name);
      } else if (declaration.type === "VariableDeclaration") {
        for (const variable of declaration.declarations) {
          if (variable.id.type !== "Identifier")
            throw new Error(`${filename}: Declare exported variables with identifiers.`);
          names.add(variable.id.name);
        }
      } else if (
        !["TSInterfaceDeclaration", "TSTypeAliasDeclaration", "TSDeclareFunction"].includes(
          declaration.type,
        )
      ) {
        throw new Error(`${filename}: Unsupported export: ${declaration.type}`);
      }
    }
    for (const specifier of node.specifiers ?? []) {
      if (specifier.type === "ExportSpecifier" && specifier.exportKind === "type") continue;
      if (specifier.type !== "ExportSpecifier")
        throw new Error(`${filename}: Namespace exports are not supported.`);
      const name = specifier.exported.type === "Identifier" ? specifier.exported.name : undefined;
      if (!name) throw new Error(`${filename}: String-literal exports are not supported.`);
      names.add(name);
    }
  }
  if (!names.size) throw new Error(`${filename}: The use client boundary has no runtime exports.`);
  if (target === "client") {
    const request = PREFIX + Buffer.from(filename).toString("base64url");
    return `'use client';\nexport { ${[...names].join(", ")} } from ${JSON.stringify(request)};\n`;
  }
  return (
    `'use client';\n` +
    [...names]
      .map((name, index) => {
        const local = `__native_${index}`;
        return `const ${local} = () => { throw new Error(${JSON.stringify("This component is native-only. Use an RSC request: " + filename + "#" + name)}); }; export { ${local} as ${name} };`;
      })
      .join("\n")
  );
}
