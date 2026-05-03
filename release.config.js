// semantic-release config — single authority for versioning.
// Push to `main`  → stable release  → npm dist-tag `latest`, GH release.
// Push to `dev`   → prerelease      → npm dist-tag `next` (x.y.z-dev.N).
// Bump derived from conventional commits since last tag on that branch:
//   fix:/perf: → patch   feat: → minor   BREAKING CHANGE / `!:` → major
// chore:/docs:/refactor:/test: → no release (angular preset default).
//
// Runs in CI only (see .github/workflows/release.yml). NPM_TOKEN +
// GITHUB_TOKEN come from the action env; --dry-run locally to preview.

export default {
  branches: [
    "main",
    { name: "dev", prerelease: true, channel: "next" },
  ],
  plugins: [
    "@semantic-release/commit-analyzer",
    "@semantic-release/release-notes-generator",
    ["@semantic-release/changelog", { changelogFile: "CHANGELOG.md" }],
    // Publish the built artifact, not the source tree. `scripts/build.ts`
    // writes a self-contained dist/ with its own package.json whose only
    // deps are the platform-native @opentui/core-* optionals.
    ["@semantic-release/npm", { pkgRoot: "dist" }],
    ["@semantic-release/git", {
      assets: ["CHANGELOG.md"],
      message: "chore(release): ${nextRelease.version} [skip ci]\n\n${nextRelease.notes}",
    }],
    "@semantic-release/github",
  ],
}
