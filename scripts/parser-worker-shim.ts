// Wrapper worker: chdir into dist/ before the real OpenTUI parser.worker
// runs, so its emscripten `locateFile` resolves "./tree-sitter-*.wasm"
// against the bundle dir rather than whatever cwd the host was launched
// from. Only used in the built artifact; dev relies on Bun's asset
// resolution inside node_modules/@opentui/core/.

import { dirname, join } from "path"
import { fileURLToPath } from "url"

const here = dirname(fileURLToPath(import.meta.url))
process.chdir(here)
// Absolute path avoids Bun's build-time resolver — emitted at runtime.
await import(join(here, "parser.worker.js"))
