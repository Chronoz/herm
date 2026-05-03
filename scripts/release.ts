#!/usr/bin/env bun
// Bump version, run checks, commit, and tag. Does NOT push.
//
//   bun scripts/release.ts [patch|minor|major|<x.y.z>]   default: patch
//
// Idempotent refusal: dirty tree, failing tests/tsc, or tag-exists all
// abort before anything is written.

import { $ } from "bun"

const arg = Bun.argv[2] ?? "patch"
const pkgPath = "package.json"
const pkg = await Bun.file(pkgPath).json()

const bump = (v: string, kind: string): string => {
  if (/^\d+\.\d+\.\d+/.test(kind)) return kind
  const [maj, min, pat] = v.split(".").map(Number)
  return kind === "major" ? `${maj + 1}.0.0`
       : kind === "minor" ? `${maj}.${min + 1}.0`
       :                    `${maj}.${min}.${pat + 1}`
}

const next = bump(pkg.version, arg)
const tag = `v${next}`

const die = (msg: string): never => { console.error(`release: ${msg}`); process.exit(1) }

// Preconditions
const status = await $`git status --porcelain`.text()
if (status.trim()) die(`working tree dirty\n${status}`)
const tags = (await $`git tag -l`.text()).split("\n")
if (tags.includes(tag)) die(`tag ${tag} already exists`)

// Checks (fail-fast; no writes yet)
console.log(`release: ${pkg.version} → ${next}`)
console.log("release: typecheck…")
const tsc = await $`bunx tsc --noEmit`.nothrow()
const src = tsc.text().split("\n").filter(l => l.startsWith("src/"))
if (src.length) die(`tsc errors in src/\n${src.join("\n")}`)
console.log("release: tests…")
if ((await $`bun test`.nothrow()).exitCode !== 0) die("tests failed")

// Write, commit, tag
pkg.version = next
await Bun.write(pkgPath, JSON.stringify(pkg, null, 2) + "\n")
await $`git add ${pkgPath}`
await $`git commit -m ${`release: v${next}`}`
await $`git tag -a ${tag} -m ${`herm ${tag}`}`

console.log(`\nrelease: tagged ${tag}. Push with:\n  git push origin dev --follow-tags`)
