/**
 * postinstall — stub out heavy optional dependencies that @opentui/core
 * and @opentui/react pull in but Herm never uses.
 *
 * react-devtools-core is imported statically by @opentui/react, so it needs
 * a real module that exports the expected API shape (not just an empty package).
 */
import { mkdirSync, writeFileSync, existsSync } from "fs"
import { join } from "path"

const nm = join(import.meta.dir, "..", "node_modules")

// Stub react-devtools-core with noop exports
const rdcDir = join(nm, "react-devtools-core")
if (!existsSync(rdcDir)) {
  mkdirSync(rdcDir, { recursive: true })
  writeFileSync(
    join(rdcDir, "package.json"),
    JSON.stringify({ name: "react-devtools-core", version: "0.0.0", main: "index.js" })
  )
  writeFileSync(
    join(rdcDir, "index.js"),
    [
      "const noop = () => {};",
      "module.exports = { initialize: noop, connectToDevTools: noop };",
      "module.exports.default = module.exports;",
    ].join("\n")
  )
}
