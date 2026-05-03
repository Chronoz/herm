#!/usr/bin/env bun
// Build the published artifact. Output: dist/ — a self-contained bundle
// plus the tree-sitter worker + wasm grammars. The only runtime deps
// are the platform-native `@opentui/core-<os>-<arch>` packages, which
// ship as optionalDependencies so npm/bun installs the matching one.
//
//   dist/
//     index.js                  — entry, shebang'd
//     parser.worker.js          — tree-sitter worker (bundled, web-tree-sitter inlined)
//     parser.worker.shim.js     — chdir wrapper (OTUI_TREE_SITTER_WORKER_PATH target)
//     *.wasm / *.scm            — emitted by bun build's `with { type: "file" }` assets

import { $ } from "bun"
import { rmSync, chmodSync } from "node:fs"
import pkg from "../package.json" with { type: "json" }

rmSync("dist", { recursive: true, force: true })

// react-devtools-core is a lazy peer of @opentui/react (DEV=true only),
// but bun hoists its static import outside the __esm wrapper. Stub it at
// resolve time so the published bundle carries no dep on it.
const noopDevtools: import("bun").BunPlugin = {
  name: "noop-devtools",
  setup(b) {
    b.onResolve({ filter: /^react-devtools-core$/ }, () =>
      ({ path: "rdc-stub", namespace: "stub" }))
    b.onLoad({ filter: /.*/, namespace: "stub" }, () => ({
      contents: "export default { initialize() {}, connectToDevTools() {} }",
      loader: "js",
    }))
  },
}

const external = [
  // Dynamic `@opentui/core-${platform}-${arch}` — resolved at runtime
  // against the installed optionalDependency. Kept out of the bundle.
  "@opentui/core-*",
  // `ws` is only reached by the devtools chunk above; harmless to
  // external (globalThis.WebSocket exists under bun anyway).
  "ws",
]

const result = await Bun.build({
  entrypoints: [
    "src/index.tsx",
    "node_modules/@opentui/core/parser.worker.js",
    "scripts/parser-worker-shim.ts",
  ],
  outdir: "dist",
  target: "bun",
  naming: { entry: "[name].[ext]" },
  minify: { whitespace: true, syntax: true, identifiers: false },
  sourcemap: "none",
  external,
  plugins: [noopDevtools],
  define: {
    "process.env.NODE_ENV": '"production"',
    "process.env.DEV": '"false"',
  },
})

if (!result.success) {
  for (const m of result.logs) console.error(m)
  process.exit(1)
}

await $`mv dist/parser-worker-shim.js dist/parser.worker.shim.js`
chmodSync("dist/index.js", 0o755)

// The published package is dist/ + this manifest. `dependencies` is
// empty — everything is bundled. Platform libs are optionals (bun/npm
// install the one that matches, skip the rest).
const platforms = [
  "darwin-arm64", "darwin-x64",
  "linux-arm64", "linux-x64",
  "win32-arm64", "win32-x64",
]
const ov = (pkg.dependencies as Record<string, string>)["@opentui/core"]
await Bun.write("dist/package.json", JSON.stringify({
  name: pkg.name,
  version: pkg.version,
  description: pkg.description,
  license: pkg.license,
  repository: pkg.repository,
  homepage: pkg.homepage,
  bugs: pkg.bugs,
  engines: pkg.engines,
  publishConfig: { access: "public", provenance: true },
  bin: { herm: "index.js" },
  optionalDependencies: Object.fromEntries(
    platforms.map(p => [`@opentui/core-${p}`, ov]),
  ),
}, null, 2) + "\n")

await $`cp README.md LICENSE dist/`

const sizes = result.outputs
  .map(o => [o.path.replace(/^.*\/dist\//, ""), (o.size / 1024).toFixed(0) + " KB"])
console.table(Object.fromEntries(sizes))
console.log(`\nbuild: dist/ ready (${result.outputs.length} files)`)
