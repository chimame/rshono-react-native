import { test } from "vitest";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const React = require("react");
const { create, act } = require("react-test-renderer");
const { useRsc, RscView } = require("../../dist");
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
test("refresh and refresh failures preserve state while reset discards it", async () => {
  let current,
    fail = false,
    view;
  function Counter() {
    const [count, setCount] = React.useState(0);
    return React.createElement("counter", { onPress: () => setCount(count + 1) }, String(count));
  }
  const client = {
    async load() {
      if (fail) throw new Error("offline");
      return { root: React.createElement(Counter) };
    },
  };
  function Screen() {
    const state = useRsc({ client, url: "https://example.test" });
    React.useEffect(() => {
      current = state;
    }, [state]);
    return React.createElement(RscView, {
      state,
      renderError: (error) => React.createElement("error", null, error.message),
    });
  }
  await act(async () => {
    view = create(React.createElement(Screen));
  });
  await act(async () => view.root.findByType("counter").props.onPress());
  await act(async () => current.refresh());
  assert.equal(view.root.findByType("counter").children[0], "1");
  fail = true;
  await act(async () => current.refresh());
  assert.equal(view.root.findByType("counter").children[0], "1");
  assert.equal(view.root.findByType("error").children[0], "offline");
  fail = false;
  await act(async () => current.refresh());
  assert.equal(view.root.findByType("counter").children[0], "1");
  await act(async () => current.reset());
  assert.equal(view.root.findByType("counter").children[0], "0");
  await act(async () => view.unmount());
});
test("serializes screen mutations and discards results from an obsolete screen", async () => {
  let current, view;
  const client = {
    async load() {
      return { root: "ready" };
    },
  };
  function Screen({ url }) {
    const state = useRsc({ client, url });
    React.useEffect(() => {
      current = state;
    }, [state]);
    return null;
  }
  await act(async () => {
    view = create(React.createElement(Screen, { url: "https://example.test/a" }));
  });
  const events = [];
  let release;
  const wait = new Promise((resolve) => {
    release = resolve;
  });
  let first, second;
  await act(async () => {
    first = current.runAction(async () => {
      events.push("first");
      await wait;
      return 1;
    });
    second = current.runAction(async () => {
      events.push("second");
      return 2;
    });
  });
  assert.deepEqual(events, ["first"]);
  assert.equal(current.actionPending, true);
  await act(async () => {
    release();
    await Promise.all([first, second]);
  });
  assert.deepEqual(events, ["first", "second"]);
  assert.equal(current.actionPending, false);
  let signal;
  client.load = async (_, options) => {
    signal = options.actionSignal;
    return { root: "new" };
  };
  await act(async () => current.refresh());
  const oldSignal = signal;
  await act(async () =>
    view.update(React.createElement(Screen, { url: "https://example.test/b" })),
  );
  assert.equal(oldSignal.aborted, true);
  assert.equal(signal.aborted, false);
  await act(async () => view.unmount());
  assert.equal(signal.aborted, true);
});

test("reloadKey bypasses cached wire bytes while StrictMode retains the initial fallback", async () => {
  let view;
  const caches = [];
  const client = {
    load: async (_, options) => {
      caches.push(options.cache);
      return { root: "ready" };
    },
  };
  function Screen({ reloadKey }) {
    const state = useRsc({ client, url: "https://example.test/a", reloadKey });
    return React.createElement(RscView, {
      state,
      fallback: "loading",
      renderError: (error) => error.message,
    });
  }
  await act(async () => {
    view = create(React.createElement(Screen, { reloadKey: 0 }));
  });
  await act(async () => view.update(React.createElement(Screen, { reloadKey: 1 })));
  assert.deepEqual(caches, [true, false]);
  await act(async () => view.unmount());
  const pending = { load: () => new Promise(() => {}) };
  function Pending() {
    const state = useRsc({ client: pending, url: "https://example.test/a" });
    return React.createElement(RscView, {
      state,
      fallback: "loading",
      renderError: (error) => error.message,
    });
  }
  await act(async () => {
    view = create(React.createElement(React.StrictMode, null, React.createElement(Pending)), {
      unstable_strictMode: true,
    });
  });
  assert.equal(view.toJSON(), "loading");
  await act(async () => view.unmount());
});
