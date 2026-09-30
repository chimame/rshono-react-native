import { TextDecoder, TextEncoder } from "node:util";
import { ReadableStream } from "node:stream/web";
import { get } from "node:http";
import { fireEvent, renderAsync, screen } from "@testing-library/react-native";
import { Text, View } from "react-native";
import * as manifest from "../.rshono-native/native-client.cjs";
import {
  createNativeClient,
  RshonoProvider,
  ServerScreen,
  type FlightFetch,
  type FlightResponse,
} from "rshono-react-native";
jest.mock("rshono-react-native/internal/manifest", () => require("../.rshono-native/client.cjs"));

const { buildId } = manifest;
function loadPayload(serverUrl: string, name: string, signal: AbortSignal, fetch: FlightFetch) {
  const url = new URL("/native", serverUrl);
  url.searchParams.set("name", name);
  return createNativeClient({ manifest, fetch }).load(url.href, { signal });
}

Object.assign(globalThis, { TextDecoder, TextEncoder });

function response(text = '0:{"root":"Connected"}\n'): FlightResponse {
  return {
    ok: true,
    status: 200,
    headers: {
      get: (name) =>
        ({
          "content-type": "text/x-component;charset=utf-8",
          "x-rshono-native-build": buildId,
        })[name] ?? null,
    },
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(text));
        controller.close();
      },
    }) as unknown as FlightResponse["body"],
  };
}

test("sends the RSC header and encoded name and decodes with the real decoder", async () => {
  const fetcher = jest.fn(async () => response());
  const signal = new AbortController().signal;
  const payload = await loadPayload(
    "http://localhost:3100",
    "\u592a\u90ce & \u82b1\u5b50",
    signal,
    fetcher,
  );
  expect(payload.root).toBe("Connected");
  expect(fetcher).toHaveBeenCalledWith(
    "http://localhost:3100/native?name=%E5%A4%AA%E9%83%8E+%26+%E8%8A%B1%E5%AD%90",
    { headers: { RSC: "1" }, signal },
  );
});

test.each([
  ["HTTP error", { ok: false, status: 503 }, "HTTP 503"],
  ["HTML response", { headers: { get: () => "text/html" } }, "not an RSC payload"],
  [
    "different build",
    {
      headers: {
        get: (name: string) => (name === "content-type" ? "text/x-component" : "old-build"),
      },
    },
    "builds do not match",
  ],
  ["missing body", { body: null }, "body is missing"],
])("rejects %s before rendering", async (_, overrides, message) => {
  await expect(
    loadPayload("http://localhost:3100", "test", new AbortController().signal, async () => ({
      ...response(),
      ...overrides,
    })),
  ).rejects.toThrow(message);
});

test("rejects a truncated Flight response", async () => {
  await expect(
    loadPayload("http://localhost:3100", "test", new AbortController().signal, async () =>
      response('0:{"root":'),
    ),
  ).rejects.toThrow();
});

// Optional integration test against a running RSHono server, without HTTP or Flight mocks.
const integration = process.env.RSHONO_POC_URL ? test : test.skip;
const httpFetch: FlightFetch = (url, { headers, signal }) =>
  new Promise((resolve, reject) => {
    const request = get(url, { headers, signal }, (incoming) => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          incoming.on("data", (chunk: Buffer) => controller.enqueue(new Uint8Array(chunk)));
          incoming.on("end", () => controller.close());
          incoming.on("error", (error) => controller.error(error));
        },
      });
      resolve({
        ok: incoming.statusCode === 200,
        status: incoming.statusCode ?? 0,
        headers: {
          get: (name) => {
            const value = incoming.headers[name];
            return typeof value === "string" ? value : null;
          },
        },
        body: body as unknown as FlightResponse["body"],
      });
    });
    request.setTimeout(5000, () => request.destroy(new Error("Connection timed out")));
    request.on("error", reject);
  });

integration(
  "renders real server Flight as native UI and supports interaction and refetching",
  async () => {
    function Example({ name }: { name: string }) {
      return (
        <View>
          <RshonoProvider
            origin={process.env.RSHONO_POC_URL!}
            fetch={httpFetch}
            fallback={<Text>Loading</Text>}
            renderError={(error) => <Text>{error.message}</Text>}
          >
            <ServerScreen path="/native" searchParams={{ name }} />
          </RshonoProvider>
        </View>
      );
    }
    const view = await renderAsync(<Example name="Connection test" />);
    expect(await screen.findByText("Hello, Connection test")).toBeTruthy();
    expect(screen.getByTestId("rshono-server-panel")).toBeTruthy();
    const firstId = screen.getByText(/^Request ID:/).props.children;
    fireEvent.press(screen.getByLabelText("Increment local counter"));
    expect(screen.getByText("Local counter: 1")).toBeTruthy();
    await view.rerenderAsync(<Example name="Updated name" />);
    expect(await screen.findByText("Hello, Updated name")).toBeTruthy();
    expect(screen.getByText("Local counter: 0")).toBeTruthy();
    expect(screen.getByText(/^Request ID:/).props.children).not.toEqual(firstId);
  },
);
