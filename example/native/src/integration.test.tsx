import { TextDecoder, TextEncoder } from "node:util";
import { ReadableStream } from "node:stream/web";
import { request as httpRequest } from "node:http";
import { fireEvent, renderAsync, screen, waitFor } from "@testing-library/react-native";
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
    { headers: { RSC: "1" }, signal, redirect: "manual" },
  );
});

test.each([
  ["HTTP error", { ok: false, status: 503 }, "HTTP 503"],
  ["HTML response", { headers: { get: () => "text/html" } }, "not an RSC payload"],
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
const httpFetch: FlightFetch = (url, { headers, signal, method, body }) =>
  new Promise((resolve, reject) => {
    let data: string | undefined;
    if (typeof body === "string") data = body;
    else if (body) {
      const boundary = "rshono-test-boundary";
      const parts = (
        body as unknown as { getParts(): { fieldName: string; string?: string }[] }
      ).getParts();
      data =
        parts
          .map(
            (part) =>
              `--${boundary}\r\nContent-Disposition: form-data; name="${part.fieldName}"\r\n\r\n${part.string}\r\n`,
          )
          .join("") + `--${boundary}--\r\n`;
      headers = { ...headers, "content-type": `multipart/form-data; boundary=${boundary}` };
    }
    const request = httpRequest(url, { headers, signal, method: method ?? "GET" }, (incoming) => {
      let ended = false;
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          incoming.on("data", (chunk: Buffer) => {
            if (!ended) controller.enqueue(new Uint8Array(chunk));
          });
          incoming.on("end", () => {
            if (!ended) {
              ended = true;
              controller.close();
            }
          });
          incoming.on("error", (error) => {
            if (!ended) {
              ended = true;
              controller.error(error);
            }
          });
        },
        cancel() {
          ended = true;
          incoming.destroy();
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
    request.end(data);
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

integration.each([
  [undefined, "Current experience"],
  ["store-1", "Current experience"],
  ["review-2", "Preview experience"],
  ["unknown", "Current experience"],
])("renders server-selected content for release %s", async (release, expected) => {
  await renderAsync(
    <RshonoProvider
      origin={process.env.RSHONO_POC_URL!}
      fetch={httpFetch}
      headers={release ? { "x-app-release": release } : undefined}
    >
      <ServerScreen path="/native" />
    </RshonoProvider>,
  );
  expect(await screen.findByText(expected)).toBeTruthy();
  expect(screen.getByText(process.env.RSHONO_EXPECTED_TITLE ?? "Screen from RSHono")).toBeTruthy();
  fireEvent.press(screen.getByLabelText("Increment local counter"));
  expect(screen.getByText("Local counter: 1")).toBeTruthy();
});

const newComponentIntegration =
  process.env.RSHONO_POC_URL && process.env.RSHONO_NEW_COMPONENT ? test : test.skip;
newComponentIntegration(
  "renders a newly added component only for its target app release",
  async () => {
    await renderAsync(
      <RshonoProvider
        origin={process.env.RSHONO_POC_URL!}
        fetch={httpFetch}
        headers={{ "x-app-release": "review-3" }}
      >
        <ServerScreen path="/native" />
      </RshonoProvider>,
    );
    expect(await screen.findByText("New review component")).toBeTruthy();
  },
);

integration(
  "preserves native state on refresh, resets explicitly, and calls both Server Function forms",
  async () => {
    await renderAsync(
      <RshonoProvider
        origin={process.env.RSHONO_POC_URL!}
        fetch={httpFetch}
        headers={{ Authorization: "Bearer example" }}
      >
        <ServerScreen path="/native" />
      </RshonoProvider>,
    );
    await screen.findByText("Server counter: 0");
    fireEvent.press(screen.getByLabelText("Increment local counter"));
    fireEvent.press(screen.getByLabelText("Refresh server screen"));
    await screen.findByText("Refresh");
    expect(screen.getByText("Local counter: 1")).toBeTruthy();
    fireEvent.press(screen.getByLabelText("Call server function prop"));
    await screen.findByText("Action result: 1");
    expect(await screen.findByText("Server counter: 1")).toBeTruthy();
    expect(screen.getByText("Local counter: 1")).toBeTruthy();
    fireEvent.press(screen.getByLabelText("Call imported server function"));
    await screen.findByText("Action result: 2");
    expect(await screen.findByText("Server counter: 2")).toBeTruthy();
    fireEvent.press(screen.getByLabelText("Reset server screen"));
    await screen.findByText("Local counter: 0");
  },
);

integration.each(["/redirect", "/late-redirect", "/http-redirect"])(
  "delivers %s to native navigation without following it",
  async (path) => {
    const onRedirect = jest.fn();
    await renderAsync(
      <RshonoProvider
        origin={process.env.RSHONO_POC_URL!}
        fetch={httpFetch}
        onRedirect={onRedirect}
      >
        <ServerScreen path={path} />
      </RshonoProvider>,
    );
    await waitFor(() => expect(onRedirect).toHaveBeenCalledTimes(1));
    expect(onRedirect.mock.calls[0][0]).toMatch(/\/native/);
  },
);
integration.each(["/missing", "/late-missing"])(
  "renders native not-found UI for %s",
  async (path) => {
    await renderAsync(
      <RshonoProvider
        origin={process.env.RSHONO_POC_URL!}
        fetch={httpFetch}
        renderNotFound={<Text>Native not found</Text>}
      >
        <ServerScreen path={path} />
      </RshonoProvider>,
    );
    expect(await screen.findByText("Native not found")).toBeTruthy();
  },
);
integration(
  "renders the server's not-found fallback when no native override is supplied",
  async () => {
    await renderAsync(
      <RshonoProvider origin={process.env.RSHONO_POC_URL!} fetch={httpFetch}>
        <ServerScreen path="/unknown-route" />
      </RshonoProvider>,
    );
    expect(await screen.findByText("Server not found page")).toBeTruthy();
  },
);
integration(
  "streams nested Suspense, times out stalled chunks, and recovers by changing the screen",
  async () => {
    function App({ path }: { path: string }) {
      return (
        <RshonoProvider
          origin={process.env.RSHONO_POC_URL!}
          fetch={httpFetch}
          renderError={(error) => (
            <Text>{(error as { code?: string }).code ?? "Stream error"}</Text>
          )}
        >
          <ServerScreen path={path} streamIdleTimeoutMs={150} />
        </RshonoProvider>
      );
    }
    const view = await renderAsync(<App path="/stream" />);
    expect(await screen.findByText("Stream shell")).toBeTruthy();
    expect(await screen.findByText("Stream completed")).toBeTruthy();
    await view.rerenderAsync(<App path="/stalled" />);
    expect(await screen.findByText("TIMEOUT")).toBeTruthy();
    await view.rerenderAsync(<App path="/stream" />);
    expect(await screen.findByText("Stream completed")).toBeTruthy();
  },
);

integration(
  "renders server-imported AsyncBoundary and a native useNavigation consumer",
  async () => {
    await renderAsync(
      <RshonoProvider origin={process.env.RSHONO_POC_URL!} fetch={httpFetch}>
        <ServerScreen path="/native-boundaries" />
      </RshonoProvider>,
    );
    expect(await screen.findByText("Native navigation: /native-boundaries")).toBeTruthy();
    expect(await screen.findByText("Stream completed")).toBeTruthy();
  },
);
