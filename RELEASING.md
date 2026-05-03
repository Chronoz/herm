# Releasing

Versioning is automated by [semantic-release]. There is no manual bump.

| branch | publishes | npm dist-tag | version shape |
|---|---|---|---|
| `dev`  | every push with a `feat:`/`fix:`/`perf:` commit | `next`   | `0.2.0-dev.3` |
| `main` | every push (fast-forward from `dev`)            | `latest` | `0.2.0`       |

Bump derived from commits since last tag on that branch:

- `fix:` `perf:` → patch
- `feat:` → minor
- `feat!:` / `BREAKING CHANGE:` footer → major
- `chore:` `docs:` `refactor:` `test:` `ci:` → no release

`chore(release): …` commits are pushed back by the bot with `[skip ci]`.

## Cutting stable

```bash
git switch main
git merge --ff-only dev
git push origin main
```

CI does the rest (tag, CHANGELOG.md, GitHub release, `npm publish`).

## One-time setup

- Repo secret `NPM_TOKEN` — npm Automation token with publish on `herm-tui`
- `main` branch created from `dev`
- Settings → Actions → Workflow permissions → **Read and write**
- Optional: branch protection on `main` must allow `github-actions[bot]`
  to push (the `@semantic-release/git` commit)

[semantic-release]: https://github.com/semantic-release/semantic-release
