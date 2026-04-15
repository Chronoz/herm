# Baseline Performance Analysis

**Date**: 2026-04-14

## Test Conditions

- **Command**: `bun run dev:perf` (`PERF=1`)
- **Duration**: ~30 seconds
- **Actions**: Opened Herm, clicked through all 11 tabs, sent 1 message (received 2 content chunks), then Ctrl+C
- **Environment**: Development build with performance instrumentation enabled

## Raw Perf Report

```
Memory Snapshots:
  pre-renderer: RSS=100.7MB heap=36.9MB ext=33.8MB
  post-renderer: RSS=103.3MB heap=36.9MB ext=33.8MB
  post-first-render: RSS=103.4MB heap=36.9MB ext=33.8MB
  stream-start: RSS=318.4MB heap=61.8MB ext=47.2MB
  stream-done: RSS=337.9MB heap=62.2MB ext=50.9MB
  stream-done: RSS=338.2MB heap=62.2MB ext=50.9MB
  Δ RSS: +237.6MB (pre-renderer → stream-done)

Timings:
  avatar:render: 88402× avg=0.02ms min=0.02ms max=2.98ms total=2115ms
  io:readHermesHome: 3× avg=122.63ms min=41.96ms max=278.01ms total=368ms
  io:queryRecentSessions: 4× avg=1.73ms min=1.36ms max=2.18ms total=7ms
  io:queryAnalytics: 1× avg=4.79ms min=4.79ms max=4.79ms total=5ms
  renderer-init: 1× avg=3.83ms min=3.83ms max=3.83ms total=4ms
  first-render: 1× avg=0.76ms min=0.76ms max=0.76ms total=1ms

React Renders:
  <sidebar>: 88402× avg=0.05ms max=3.10ms total=4565ms
  <shell>: 88402× avg=0.21ms max=12.27ms total=18682ms
  <tab:Chat>: 51600× avg=0.04ms max=4.54ms total=2216ms
  <tab:Cron>: 11804× avg=0.01ms max=2.78ms total=96ms
  <tab:Config>: 5535× avg=0.47ms max=4.42ms total=2607ms
  <tab:Context>: 4287× avg=0.48ms max=12.13ms total=2048ms
  <tab:Memory>: 4168× avg=0.08ms max=1.86ms total=332ms
  <tab:Env>: 3344× avg=0.15ms max=3.18ms total=496ms
  <tab:Analytics>: 2467× avg=0.17ms max=2.26ms total=415ms
  <tab:Toolsets>: 2122× avg=0.09ms max=1.76ms total=196ms
  <tab:Overview>: 1344× avg=0.06ms max=1.55ms total=81ms
  <tab:Skills>: 1178× avg=0.79ms max=6.52ms total=925ms
  <tab:Sessions>: 553× avg=1.95ms max=9.71ms total=1080ms

Counters:
  avatar:tick: 478
  stream:chunk: 2
  stream:done: 2
  stream:start: 1
```

## Key Findings

### 1. The Render Cascade

88,402 renders for 478 avatar ticks = **~185 renders per actual frame change**. Every state change anywhere in `AppInner` re-renders the entire tree because there are zero `React.memo()` boundaries.

`<shell>` spent **18.7 seconds** of CPU in React reconciliation during a ~40-second session — roughly **47% of runtime** burned in diffing alone.

This is the single biggest problem. Individual render costs are irrelevant when every tick fans out to 185 component re-renders.

### 2. Memory Growth

| Phase | RSS | Heap | External |
|-------|-----|------|----------|
| Pre-renderer (startup) | 100.7MB | 36.9MB | 33.8MB |
| Post-first-render | 103.4MB | 36.9MB | 33.8MB |
| Stream start (after tab navigation) | 318.4MB | 61.8MB | 47.2MB |
| Stream done (final) | 338.2MB | 62.2MB | 50.9MB |

- **100MB at startup** — OpenTUI native + WASM already loaded at import time, before any rendering.
- **Jumps to 318MB** after navigating tabs and loading data.
- Heap grew **+25MB** (JS objects), external grew **+17MB** (Yoga nodes, FFI structs).
- The remaining **~195MB** gap is Bun/JSC overhead: JIT compilation, GC reserves, module cache.

### 3. Render Cost By Tab

| Tab | Avg Render | Render Count | Total CPU |
|-----|-----------|-------------|-----------|
| Sessions | 1.95ms | 553 | 1,080ms |
| Skills | 0.79ms | 1,178 | 925ms |
| Context | 0.48ms | 4,287 | 2,048ms |
| Config | 0.47ms | 5,535 | 2,607ms |
| Env | 0.15ms | 3,344 | 496ms |
| Analytics | 0.17ms | 2,467 | 415ms |
| Memory | 0.08ms | 4,168 | 332ms |
| Toolsets | 0.09ms | 2,122 | 196ms |
| Overview | 0.06ms | 1,344 | 81ms |
| Chat | 0.04ms | 51,600 | 2,216ms |
| Cron | 0.01ms | 11,804 | 96ms |

Sessions (1.95ms avg) is the heaviest per-render. Skills (0.79ms), Context (0.48ms), Config (0.47ms) are medium. Everything else is cheap (<0.2ms).

**But cost-per-render doesn't matter when you're rendering 88,000 times — the cascade is the problem.**

### 4. I/O Cost

`readHermesHome` averages **122ms** (278ms cold, 42ms warm). It's synchronous on the main thread — blocks the UI. Called by 3 tabs on background intervals even when those tabs are not visible.

Other I/O is negligible: `queryRecentSessions` at 1.7ms, `queryAnalytics` at 4.8ms.

### 5. Avatar Dominance

`avatar:render` ran 88,402 times at 0.02ms each = 2.1 seconds direct cost. But the sidebar React Profiler shows 4.5 seconds and shell shows 18.7 seconds — the avatar's `setFrame()` call triggers the cascade that causes **all** of that additional reconciliation work.

The avatar animation is the primary driver of the render storm. Each tick propagates through the unmemoized tree, re-rendering every mounted component.

### 6. Counter Cross-Reference

- **478** avatar ticks → 88,402 renders (185× amplification)
- **2** stream chunks, **1** stream start → streaming contributed negligibly to render load
- The 88,402 renders are almost entirely from mouse/keyboard events + avatar ticks cascading through the unmemoized tree

## Current vs Target

| Metric | Current | Target | Method |
|--------|---------|--------|--------|
| Shell renders/sec | ~2,200 | <100 | `React.memo` boundaries |
| Sidebar renders/sec | ~2,200 | ~12 | `memo` + native animation |
| RSS steady state | 338MB | <200MB | Reduce render objects, pause polling |
| `readHermesHome` | 122ms avg | <50ms or async | Cache, pause when inactive |
| CPU in reconciliation | ~47% | <10% | All of the above |
