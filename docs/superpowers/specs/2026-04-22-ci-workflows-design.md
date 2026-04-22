# CI Workflows — Design

**Date:** 2026-04-22
**Status:** Approved (pending spec review)

## Goal

Add GitHub Actions CI to the monorepo so that every push to `main` and every pull request runs **lint → build → test** for the affected package. Frontend and backend each get their own workflow. Path-based triggers ensure a workflow only runs when its package changed.

## Scope

- Add two workflow files under `.github/workflows/`.
- Add `ruff` as a backend dev dependency; no ruff configuration file (use defaults).
- No other changes — no local tooling files, no branch-protection setup, no additional CI stages.

## Non-Goals

- No `.nvmrc` / `.python-version` / `packageManager` pins in the repo.
- No trigger on root-level files (`package.json`, `pnpm-workspace.yaml`, root scripts).
- No matrix builds, artifact upload, coverage reporting, or deploy steps.
- No `workflow_dispatch` manual trigger.
- No branch-protection rules configured in this change (that is a GitHub org/repo setting, not code).

## Files Changed

### New: `.github/workflows/ci-frontend.yml`

**Triggers**
- `push` to `main` on paths: `frontend/**`, `.github/workflows/ci-frontend.yml`
- `pull_request` (default activity types: `opened`, `synchronize`, `reopened`) on the same paths

**Concurrency**
- `group: ci-frontend-${{ github.ref }}`
- `cancel-in-progress: true`

**Job `ci` on `ubuntu-latest`:**
1. `actions/checkout@v4`
2. `pnpm/action-setup@v4` — `version: 10`
3. `actions/setup-node@v4` — `node-version: 22`, `cache: pnpm`
4. `pnpm install --frozen-lockfile` (run from repo root so the workspace resolves)
5. `pnpm --filter frontend lint`
6. `pnpm --filter frontend build`
7. `pnpm --filter frontend test`

Steps 5–7 run sequentially; a failure in any one fails the job and skips the rest.

### New: `.github/workflows/ci-backend.yml`

**Triggers**
- `push` to `main` on paths: `backend/**`, `.github/workflows/ci-backend.yml`
- `pull_request` on the same paths

**Concurrency**
- `group: ci-backend-${{ github.ref }}`
- `cancel-in-progress: true`

**Job `ci` on `ubuntu-latest` with `defaults.run.working-directory: backend`:**
1. `actions/checkout@v4`
2. `astral-sh/setup-uv@v3` — `enable-cache: true`
   (uv installs Python 3.13 automatically based on `backend/pyproject.toml`'s `requires-python = ">=3.13"`)
3. `uv sync --extra dev`
4. `uv run ruff check .` — **lint**
5. `uv run python -m compileall kb tests` — **build** (syntax / import smoke test)
6. `uv run pytest` — **test**

### Modified: `backend/pyproject.toml`

Add `"ruff>=0.6"` to the existing `[project.optional-dependencies].dev` list. No `[tool.ruff]` section — defaults only.

## Path-Filter Semantics (Q2: option C)

Each workflow triggers **only** when changes touch:
- Its package directory (`frontend/**` or `backend/**`), *or*
- Its own workflow file (so edits to `ci-<package>.yml` re-run it).

Root-level files are intentionally excluded. A PR that only modifies `README.md`, `package.json`, or `pnpm-workspace.yaml` triggers neither workflow. This is a deliberate simplicity choice; if a root-level change breaks a package, it is caught by the next PR touching that package.

## Version Pinning (Q3: option A)

Versions are pinned loosely in the workflow files only:
- Node: `22` (major)
- pnpm: `10` (major)
- Python: `3.13` (via `requires-python`, uv handles installation)

No repo-level version files. Bumping a major happens by editing the workflow.

## Backend "Build" Stage (Q + B1)

Python has no compile artifact, so `python -m compileall kb tests` stands in as a **build** stage. It parses every module and writes bytecode, which surfaces syntax errors and broken imports before the test phase runs. It takes ~2 seconds and preserves the requested three-stage shape (lint → build → test) consistently across both packages.

## Concurrency Behavior

`cancel-in-progress: true` scoped by `github.ref` means:
- Pushing a new commit to a PR branch cancels any still-running CI for that same branch and starts fresh.
- Pushes to `main` are each on their own ref group, so parallel commits to `main` do not cancel each other (important for release history).

## Verification Criteria

There is no traditional test harness for CI workflows. Success is defined by observable GHA behavior after the workflows land:

1. A PR touching only `frontend/src/**` triggers `ci-frontend` and **not** `ci-backend`.
2. A PR touching only `backend/kb/**` triggers `ci-backend` and **not** `ci-frontend`.
3. A PR touching only root files (e.g., `README.md`) triggers **neither** workflow.
4. A PR touching a workflow file (e.g., `ci-frontend.yml`) triggers **that** workflow and no other.
5. Each triggered workflow runs its steps in declared order; a red lint step prevents build and test from running; a red build step prevents test.
6. A direct push to `main` that touches a package's paths triggers that package's workflow.
7. Pushing a new commit to an open PR cancels the previous in-flight run on that same ref.

The implementation plan must include a **smoke-test sequence** — trivial edits exercising paths (1)–(6) on a throwaway branch — as the final verification gate before declaring the work done.

## Risks and Mitigations

- **Backend ruff introduces new lint failures on existing code.**
  Mitigation: the implementation plan includes a step to run `ruff check .` locally first and either fix any reported issues or narrow the ruff rule set before enabling CI. CI is not merged green-then-red.
- **`pnpm install --frozen-lockfile` fails if the lockfile is stale relative to `package.json`.**
  Mitigation: the frozen flag is correct for CI (it catches unintentional lockfile drift); any failure is an actionable signal, not a bug in the workflow.
- **`setup-uv@v3` Python auto-install could surprise with a patch-version bump.**
  Mitigation: accepted trade-off for simpler workflow config (per Q3 option A). If it becomes a problem, add `uv python install 3.13` with an explicit version.

## Out-of-Session Follow-Ups

These are not part of this change but worth noting:
- Branch-protection rules to require `ci-frontend` and `ci-backend` as merge checks — configured in GitHub repo settings, not code.
- Adding `workflow_dispatch` for manual re-runs if the team ever needs it.
- Tightening ruff configuration once baseline is green.
