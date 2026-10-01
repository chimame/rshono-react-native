import { parse } from "@babel/parser";
export const PREFIX = "rshono-native-module:";
export function transformClientBoundary(
  source: string,
  filename: string,
  target: "server" | "client",
  starExports?: Record<string, string[]>,
): string {
  // Parse the directive prologue; ignore use client text in comments.
  const ast = parse(source, {
    sourceType: "unambiguous",
    plugins: ["typescript", "jsx"],
    sourceFilename: filename,
  });
  const isClient = ast.program.directives.some(
    (directive) => directive.value.value === "use client",
  );
  if (!isClient) {
    if (target === "server")
      for (const node of ast.program.body) {
        if (
          node.type === "ImportDeclaration" &&
          node.importKind !== "type" &&
          /^react-native(?:\/|$)/.test(node.source.value)
        )
          throw new Error(
            `${filename}: react-native must be imported inside a use client boundary. Wrap native components and re-export them from that module.`,
          );
      }
    return source;
  }
  for (const node of ast.program.body)
    if (
      node.type === "ImportDeclaration" &&
      node.importKind !== "type" &&
      /^(?:server-only|@rshono\/core\/server)(?:\/|$)/.test(node.source.value)
    )
      throw new Error(
        `${filename}: server-only code cannot enter a use client boundary. Move it to a use server module.`,
      );
  if (ast.program.directives.some((directive) => directive.value.value === "use server"))
    throw new Error(`${filename}: use client and use server cannot be used together.`);
  const names = new Set<string>();
  for (const node of ast.program.body) {
    if (node.type === "ExportAllDeclaration" && node.exportKind !== "type") {
      const expanded = starExports?.[node.source.value];
      if (!expanded)
        throw new Error(
          `${filename}: Resolve export * with the native build loader, or use named re-exports.`,
        );
      for (const name of expanded) if (name !== "default") names.add(name);
      continue;
    }
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
          for (const name of bindingNames(
            variable.id as unknown as Parameters<typeof bindingNames>[0],
          ))
            names.add(name);
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

export function bindingNames(node: { type: string; [key: string]: unknown }): string[] {
  if (node.type === "Identifier") return [node.name as string];
  if (node.type === "RestElement")
    return bindingNames(node.argument as Parameters<typeof bindingNames>[0]);
  if (node.type === "AssignmentPattern")
    return bindingNames(node.left as Parameters<typeof bindingNames>[0]);
  if (node.type === "ArrayPattern")
    return (node.elements as (Parameters<typeof bindingNames>[0] | null)[]).flatMap((element) =>
      element ? bindingNames(element) : [],
    );
  if (node.type === "ObjectPattern")
    return (node.properties as Parameters<typeof bindingNames>[0][]).flatMap((property) =>
      bindingNames(
        (property.type === "RestElement" ? property.argument : property.value) as Parameters<
          typeof bindingNames
        >[0],
      ),
    );
  return [];
}
