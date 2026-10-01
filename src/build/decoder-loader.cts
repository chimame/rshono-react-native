import type { LoaderContext } from "@rspack/core" with { "resolution-mode": "import" };
/** The pinned decoder ignores callServer options. Bind each decoded response instead of using its global callback. */
function decoderLoader(this: LoaderContext, source: string) {
  const start = source.indexOf("function createResponseFromOptions(options)");
  const end = source.indexOf("function startReadingFromStream", start);
  if (start < 0 || end < 0)
    throw new Error(
      "Unsupported Flight decoder: createResponseFromOptions changed. Update the adapter and compatibility tests.",
    );
  const section = source.slice(start, end);
  if (!section.includes("callCurrentServerCallback,"))
    throw new Error("Unsupported Flight decoder callback. Update the adapter.");
  return (
    source.slice(0, start) +
    section.replace(
      "callCurrentServerCallback,",
      "options && options.callServer ? options.callServer : callCurrentServerCallback,",
    ) +
    source.slice(end)
  );
}
export = decoderLoader;
