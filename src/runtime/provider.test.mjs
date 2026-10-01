import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
import { test } from "vitest";
const assert = require("node:assert/strict");
const React = require("react");
const { act, create } = require("react-test-renderer");
const { RshonoProvider, ServerScreen } = require("../../dist");
const { serverScreenUrl } = require("../../dist/runtime/provider");
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
test("encodes screen queries and prevents credentials from being sent to another origin", () => {
  assert.equal(
    serverScreenUrl("https://example.test", "/profile?tab=info", {
      name: "\u592a\u90ce & \u82b1\u5b50",
      page: 2,
    }),
    "https://example.test/profile?tab=info&name=%E5%A4%AA%E9%83%8E+%26+%E8%8A%B1%E5%AD%90&page=2",
  );
  for (const path of ["https://other.test", "//other.test", "/\\other.test", "profile"])
    assert.throws(() => serverScreenUrl("https://example.test", path), /path/);
});
test("uses provider authentication and error handling and refetches on params, retry, and reloadKey changes", async () => {
  let view, retry;
  const requests = [];
  let fail = true;
  const client = {
    async load(url, options) {
      requests.push({ url, ...options });
      if (fail) throw new Error("offline");
      return { root: React.createElement("text", null, url) };
    },
  };
  function App({ id = 1, revision = 0, token = "first" }) {
    return React.createElement(
      RshonoProvider,
      {
        origin: "https://example.test",
        client,
        headers: { Authorization: token },
        fallback: React.createElement("loading"),
        renderError: (error, reload) => {
          retry = reload;
          return React.createElement("error", null, error.message);
        },
      },
      React.createElement(ServerScreen, {
        path: "/profile",
        searchParams: { id },
        reloadKey: revision,
      }),
    );
  }
  await act(async () => {
    view = create(React.createElement(App));
  });
  assert.equal(view.toJSON().children[0], "offline");
  fail = false;
  await act(async () => retry());
  assert.equal(view.toJSON().children[0], "https://example.test/profile?id=1");
  await act(async () => view.update(React.createElement(App, { id: 2 })));
  assert.equal(requests.at(-1).url, "https://example.test/profile?id=2");
  const count = requests.length;
  await act(async () =>
    view.update(React.createElement(App, { id: 2, revision: 1, token: "second" })),
  );
  assert.equal(requests.length, count + 1);
  assert.equal(requests.at(-1).headers.Authorization, "second");
  await act(async () => view.unmount());
});

test("delivers a redirect once even when inline handlers and navigation objects change", async () => {
  const calls = [];
  let view;
  const client = { load: async () => ({ root: null, redirect: "/login" }) };
  function App({ revision: _revision = 0 }) {
    return React.createElement(
      RshonoProvider,
      {
        origin: "https://example.test",
        client,
        onRedirect: (href) => calls.push(href),
        navigation: { replace: (href) => calls.push(href), push() {}, back() {} },
      },
      React.createElement(ServerScreen, { path: "/redirect" }),
    );
  }
  await act(async () => {
    view = create(React.createElement(App));
  });
  await act(async () => view.update(React.createElement(App, { revision: 1 })));
  assert.deepEqual(calls, ["https://example.test/login"]);
  await act(async () => view.unmount());
});
test("invalid redirects surface errors and undefined overrides inherit provider options", async () => {
  for (const location of ["http://[", "javascript:alert(1)"]) {
    let view;
    const client = { load: async () => ({ root: null, redirect: location }) };
    await act(async () => {
      view = create(
        React.createElement(
          RshonoProvider,
          {
            origin: "https://example.test",
            client,
            onRedirect: () => {
              throw new Error("must not navigate");
            },
            renderError: (error) => React.createElement("error", null, error.code),
          },
          React.createElement(ServerScreen, { path: "/a", renderError: undefined }),
        ),
      );
    });
    assert.equal(view.toJSON().children[0], "INVALID_RESPONSE");
    await act(async () => view.unmount());
  }
  const client = { load: () => new Promise(() => {}) };
  let view;
  await act(async () => {
    view = create(
      React.createElement(
        RshonoProvider,
        { origin: "https://example.test", client, fallback: React.createElement("loading") },
        React.createElement(ServerScreen, { path: "/a", fallback: undefined }),
      ),
    );
  });
  assert.equal(view.toJSON().type, "loading");
  await act(async () => view.unmount());
});
