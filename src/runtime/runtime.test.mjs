import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
import { test } from "vitest";
const assert = require("node:assert/strict");
const React = require("react");
const { create, act } = require("react-test-renderer");
const { useRsc, RscView } = require("../../dist");
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

test("aborts on URL changes, refetch, and unmount and ignores stale responses", async () => {
  const requests = [];
  const client = {
    load(url, options) {
      const pending = deferred();
      requests.push({ ...pending, url, ...options });
      return pending.promise;
    },
  };
  let state;
  function Screen({ url }) {
    const current = useRsc({ client, url, headers: { Authorization: "token" } });
    React.useEffect(() => {
      state = current;
    }, [current]);
    return null;
  }
  let view;
  await act(async () => {
    view = create(React.createElement(Screen, { url: "https://example.test/a" }));
  });
  await act(async () => {
    view.update(React.createElement(Screen, { url: "https://example.test/b" }));
  });
  assert.equal(requests[0].signal.aborted, true);
  await act(async () => {
    requests[1].resolve({ root: "new" });
  });
  await act(async () => {
    requests[0].resolve({ root: "old" });
  });
  assert.equal(state.root, "new");
  assert.equal(state.revision, 1);
  assert.equal(requests.length, 2);
  await act(async () => {
    state.reload();
  });
  assert.equal(requests.length, 3);
  await act(async () => {
    view.unmount();
  });
  assert.equal(requests[2].signal.aborted, true);
});
test("times out and supports retry even when fetch ignores cancellation", async () => {
  const requests = [];
  const client = {
    load(url, options) {
      const pending = deferred();
      requests.push({ ...pending, ...options });
      return pending.promise;
    },
  };
  let state, view;
  function Screen() {
    const current = useRsc({ client, url: "https://example.test", timeoutMs: 10 });
    React.useEffect(() => {
      state = current;
    }, [current]);
    return null;
  }
  await act(async () => {
    view = create(React.createElement(Screen));
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 25));
  });
  assert.equal(state.error.code, "TIMEOUT");
  assert.equal(state.loading, false);
  assert.equal(requests[0].signal.aborted, true);
  await act(async () => {
    requests[0].resolve({ root: "late" });
  });
  assert.equal(state.root, null);
  await act(async () => {
    state.reload();
  });
  await act(async () => {
    requests[1].resolve({ root: "retry" });
  });
  assert.equal(state.error, null);
  assert.equal(state.root, "retry");
  await act(async () => view.unmount());
});
test("passes render errors to the app UI and recovers after refetching", async () => {
  function Broken() {
    throw new Error("broken");
  }
  const state = {
    root: React.createElement(Broken),
    revision: 1,
    error: null,
    loading: false,
    reload() {},
  };
  const renderError = (error) => React.createElement("error", null, error.message);
  let view;
  const original = console.error;
  console.error = () => {};
  try {
    await act(async () => {
      view = create(React.createElement(RscView, { state, renderError }));
    });
    assert.equal(view.toJSON().children[0], "broken");
    await act(async () => {
      view.update(
        React.createElement(RscView, {
          state: {
            ...state,
            revision: 2,
            root: React.createElement("text", null, "recovered"),
          },
          renderError,
        }),
      );
    });
    assert.equal(view.toJSON().children[0], "recovered");
  } finally {
    console.error = original;
    if (view) await act(async () => view.unmount());
  }
});
