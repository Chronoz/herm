# Performance Patterns from OpenCode

> Analysis of performance patterns in [OpenCode](https://github.com/nicktomlin/opencode) — the reference TUI built by the OpenTUI team — and how they apply to Herm.

## Context

OpenCode is built with **SolidJS + OpenTUI** by the same team that develops OpenTUI itself. Herm uses **React + OpenTUI**. This distinction matters enormously for performance:

- **SolidJS** has fine-grained reactivity. When a signal changes, only the exact DOM expressions that read it update. There are no re-render cascades, no virtual DOM diffing, no component function re-execution.
- **React** re-executes the entire component function (and all children) when state changes, then diffs the virtual tree to find what actually changed. This is inherently more expensive per state update.

The patterns below were extracted from `~/Dev/clones/opencode`. They represent what the OpenTUI team considers best practice for building high-performance TUIs on their own framework. Where SolidJS gives OpenCode these patterns "for free," Herm must implement them explicitly.

---

## 1. Native `<spinner>` Element

### What OpenCode Does

OpenTUI has a **built-in `<spinner>` element** where the animation loop runs inside the native Zig renderer (`libopentui.so`), not in the JS framework:

```tsx
// OpenCode — animation runs in native Zig, zero JS overhead
<spinner frames={["⠋","⠙","⠹","⠸","⠼","⠴","⠦","⠧","⠇","⠏"]} interval={80} color="cyan" />
```

The renderer ticks the frame index internally. No JS callbacks, no state updates, no framework reconciliation. The spinner is painted as part of the normal render pass at native speed.

### What Herm Does

Herm's `AnimatedAvatar` uses a JS `setTimeout` chain at 12 FPS calling `setFrame()`, which triggers React re-renders:

```tsx
// Herm — every frame tick causes a full React re-render cycle
const [frame, setFrame] = useState(0);

useEffect(() => {
  if (!active) return;
  const id = setTimeout(() => {
    setFrame(f => (f + 1) % frames.length);
  }, 1000 / 12);
  return () => clearTimeout(id);
}, [frame, active]);
```

This was **the single largest render source**: 88,402 renders in 30 seconds for only 478 actual frame changes. Each `setFrame()` triggers AnimatedAvatar → parent → sibling re-renders throughout the tree.

### Action for Herm

**Investigate whether `@opentui/react` exposes `<spinner>`**. If it does, replace `AnimatedAvatar` entirely:

```tsx
// Target — zero React renders for animation
function Avatar({ active }: { active: boolean }) {
  if (!active) return <text>●</text>;
  return <spinner frames={["⠋","⠙","⠹","⠸","⠼","⠴","⠦","⠧","⠇","⠏"]} interval={80} color="cyan" />;
}
```

If `<spinner>` isn't exposed in the React bindings, file an issue or add the binding — the native element exists in the Zig renderer regardless.

---

## 2. 16ms Event Microbatching

### What OpenCode Does

OpenCode's SSE handler **queues events and flushes them in a single `batch()` call every 16ms** (frame-aligned). Events arriving within 16ms of the last flush are coalesced:

```ts
// OpenCode — SSE microbatch pattern (simplified from source)
let queue: Event[] = [];
let timer: number | null = null;

function onSSEEvent(event: Event) {
  queue.push(event);
  if (timer) return; // already scheduled
  timer = setTimeout(() => {
    batch(() => {
      for (const e of queue) applyEvent(e);
      queue = [];
    });
    timer = null;
  }, 16); // ~1 frame at 60fps
}
```

During fast streaming (e.g., LLM token output), dozens of events arrive per frame. Instead of N separate render cycles, they get **one batch per frame**.

### What Herm Does

Each SSE content chunk immediately fires **3 separate `setState` calls**:

```ts
// Herm — each SSE event triggers 3 independent state updates
eventSource.onmessage = (event) => {
  const data = JSON.parse(event.data);
  setHasContent(true);      // render 1
  setToolActive(false);     // render 2
  setMessages(prev => [...prev, data]); // render 3
};
```

Since these are in **async callbacks** (not React event handlers), they are **NOT auto-batched by React 18**. Each call triggers a separate reconciliation pass.

### Action for Herm

Implement a microbatch layer:

```ts
import { flushSync } from 'react-dom'; // NOT needed — we want the opposite

// Microbatch SSE events to one React update per frame
function createBatcher<T>(apply: (events: T[]) => void, ms = 16) {
  let queue: T[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;

  return (event: T) => {
    queue.push(event);
    if (timer) return;
    timer = setTimeout(() => {
      const batch = queue;
      queue = [];
      timer = null;
      // React 18 auto-batches within a single synchronous callback
      // so all setState calls inside apply() will be batched
      apply(batch);
    }, ms);
  };
}

// Usage
const push = createBatcher<SSEEvent>((events) => {
  // All these setState calls happen in one synchronous callback = one render
  setHasContent(true);
  setToolActive(events.some(e => e.type === 'tool'));
  setMessages(prev => [...prev, ...events.map(e => e.data)]);
});

eventSource.onmessage = (e) => push(JSON.parse(e.data));
```

> **Note**: React 18 *does* auto-batch within `setTimeout` callbacks, but only within the same synchronous tick. The key win here is **coalescing N events into 1 callback** so the batch actually has something to merge.

---

## 3. Renderer Configuration

### What OpenCode Does

```ts
// OpenCode renderer setup
const renderer = createCliRenderer(App, {
  targetFps: 60,
  gatherStats: false,
  autoFocus: false,
});
```

- **`targetFps: 60`** — Caps the native paint rate. Even if React triggers 200 state updates per second, the renderer only paints to the terminal at 60 FPS. This is a free throttle at the lowest level.
- **`gatherStats: false`** — Disables internal performance metric collection, removing overhead from every render pass.
- **`autoFocus: false`** — Prevents the renderer from automatically managing focus, avoiding unnecessary layout recalculations.

### What Herm Does

```ts
// Herm renderer setup
const renderer = createCliRenderer(App, {
  exitOnCtrlC: true,
  useMouse: true,
});
```

Missing `targetFps`, `gatherStats`, and `autoFocus` entirely.

### Action for Herm

Add renderer configuration — this is a one-line change with immediate impact:

```ts
const renderer = createCliRenderer(App, {
  exitOnCtrlC: true,
  useMouse: true,
  targetFps: 60,
  gatherStats: false,
});
```

---

## 4. Conditional Mounting

### What OpenCode Does

OpenCode uses SolidJS `<Show>`, `<Switch>`, and `<Match>` extensively — **490 uses** across the codebase. Components that aren't visible **don't exist in the tree at all**:

```tsx
// OpenCode — component fully unmounted when not visible
<Show when={store.activeTab === "chat"}>
  <ChatView />
</Show>
<Show when={store.activeTab === "files"}>
  <FileBrowser />
</Show>
```

Their `createSimpleContext` helper also won't mount children until context data is ready — no partially-initialized renders.

### What Herm Does

Tabs are conditionally rendered (good):
```tsx
{activeTab === "chat" && <ChatTab />}
{activeTab === "files" && <FilesTab />}
```

But **background polling intervals run regardless of tab visibility** (bad). A `useEffect` with `setInterval` starts on mount and keeps running even when the component's output isn't being used.

### Action for Herm

Pass visibility context to polling hooks:

```tsx
function usePolling(fn: () => void, ms: number, active: boolean) {
  useEffect(() => {
    if (!active) return;
    const id = setInterval(fn, ms);
    return () => clearInterval(id);
  }, [fn, ms, active]);
}

// Only polls when tab is visible
usePolling(fetchSessions, 30_000, activeTab === "sessions");
```

---

## 5. Event Isolation

### What OpenCode Does

OpenCode uses `stopPropagation()` and `preventDefault()` **61 times** across the codebase. When a keyboard event is consumed by a component, it stops there:

```tsx
// OpenCode — event consumed, doesn't bubble
<box onKeyPress={(e) => {
  if (e.key === "Enter") {
    e.stopPropagation();
    e.preventDefault();
    submitMessage();
  }
}} />
```

### What Herm Does

All `useKeyboard` handlers fire on every keypress regardless. If 5 components register keyboard handlers, every keypress triggers all 5 — even when only one is relevant.

### Action for Herm

Add event isolation to keyboard handlers:

```tsx
// Stop propagation when a handler consumes an event
useKeyboard((key, event) => {
  if (key === "enter" && focused) {
    event.stopPropagation();
    submit();
  }
});
```

Or implement a priority/focus-based keyboard system where only the focused component receives input.

---

## 6. State Architecture

### What OpenCode Does

OpenCode uses a **single central SolidJS store** with surgical update patterns:

| Pattern | Count | Purpose |
|---------|-------|---------|
| `reconcile()` | 37 | Structural diff — replaces store subtree, only triggers signals for actually-changed paths |
| `produce()` | — | Immer-style surgical mutations on store paths |
| `createMemo()` | 262 | Cached derived state — recomputes only when dependencies change |
| Binary search | — | Sorted array lookups for message insertion |
| Message cap | 100 | Per-session message limit with cleanup of associated parts |

```ts
// OpenCode — reconcile only updates changed paths
setStore("sessions", sessionId, "messages", reconcile(newMessages));

// OpenCode — binary search for sorted insertion
function insertSorted(messages: Message[], msg: Message) {
  let lo = 0, hi = messages.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (messages[mid].timestamp < msg.timestamp) lo = mid + 1;
    else hi = mid;
  }
  return [...messages.slice(0, lo), msg, ...messages.slice(lo)];
}

// OpenCode — message cap
if (messages.length > 100) {
  const removed = messages.slice(0, messages.length - 100);
  // clean up associated parts for removed messages
  for (const msg of removed) cleanupParts(msg.id);
  setStore("sessions", sid, "messages", messages.slice(-100));
}
```

### React Equivalents for Herm

| SolidJS | React Equivalent | Notes |
|---------|-----------------|-------|
| Central store | Zustand / Jotai | Granular subscriptions, components only re-render for slices they read |
| `reconcile()` | `immer` / structural sharing | Zustand + immer middleware |
| `createMemo()` | `useMemo()` | Must declare deps manually |
| `produce()` | `immer produce()` | Works with Zustand middleware |

```ts
// Zustand store with immer for surgical updates
import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';

const useStore = create(immer((set) => ({
  sessions: {},
  updateMessages: (sid: string, messages: Message[]) =>
    set((state) => {
      state.sessions[sid].messages = messages.slice(-100); // cap
    }),
})));

// Component only re-renders when THIS session's messages change
function MessageList({ sid }: { sid: string }) {
  const messages = useStore(s => s.sessions[sid]?.messages ?? []);
  // ...
}
```

---

## 7. Self-Stopping Animations

### What OpenCode Does

OpenCode's logo animation runs `setInterval` at 60fps but **self-stops when no animation is active**:

```ts
// OpenCode — interval only alive during actual animation
let interval: number | null = null;

function startAnimation() {
  if (interval) return;
  interval = setInterval(() => {
    const stillAnimating = tickFrame();
    if (!stillAnimating) {
      clearInterval(interval!);
      interval = null;
    }
  }, 1000 / 60);
}
```

Animations can also be **globally disabled** via configuration, so CI environments or screen readers don't pay animation costs at all.

### Action for Herm

Any remaining JS-driven animations should self-stop:

```tsx
function useAnimation(active: boolean, fps: number, tick: () => boolean) {
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => {
      if (!tick()) clearInterval(id);
    }, 1000 / fps);
    return () => clearInterval(id);
  }, [active]);
}
```

---

## 8. No Polling — Push Model

### What OpenCode Does

OpenCode uses **SSE for all real-time data**. There are zero `setInterval` polling loops for data fetching. The server pushes updates when they happen.

### What Herm Does

Herm has **4 background polling intervals** running simultaneously:

| Interval | Purpose |
|----------|---------|
| 10s | Session list refresh |
| 15s | Active session status |
| 30s | File watcher sync |
| 60s | Config reload |

That's 4 timers firing callbacks, potentially triggering state updates and re-renders, even when nothing has changed.

### Action for Herm

1. **Short term**: Pause polling on inactive tabs (see §4)
2. **Medium term**: Replace with event-driven updates where possible — SSE, file watchers (`Bun.watch`), or process exit hooks
3. **Long term**: Move to full push model matching OpenCode's architecture

---

## Priority List for Herm

Based on impact analysis (render count reduction × implementation effort):

| Priority | Change | Expected Impact | Effort |
|----------|--------|----------------|--------|
| **1** | Investigate `<spinner>` in `@opentui/react` | Eliminates ~88K renders/30s | Low — check if binding exists |
| **2** | Set `targetFps: 60` on renderer | Free throttle on native paint | Trivial — one line |
| **3** | `React.memo()` on Sidebar, AnimatedAvatar, tab components | Prevents cascade re-renders | Low — wrap exports |
| **4** | 16ms microbatch on SSE handler | Coalesces streaming updates | Medium — new utility |
| **5** | Pause polling on inactive tabs | Eliminates background work | Low — pass active flag |
| **6** | Message list cap (100/session) | Bounds memory and render cost | Low — slice on insert |

Items 1–3 are quick wins that can be done in a single PR. Items 4–6 are slightly more involved but still straightforward.

---

## Summary

The core insight is that **OpenCode gets many of these optimizations for free from SolidJS's reactivity model**, while Herm must implement them explicitly due to React's re-render-everything architecture. The good news is that every pattern has a clear React equivalent, and the highest-impact changes (native spinner, renderer config, memo boundaries) are the easiest to implement.
