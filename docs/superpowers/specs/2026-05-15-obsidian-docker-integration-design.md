# Obsidian Docker Integration — Design

**Status:** design approved, pending implementation plan
**Date:** 2026-05-15
**Author:** chien.tankieu (with Claude)

## Problem

`backend/.env.example` directs the user to point `KNOWLEDGE_DIR` at a path inside an existing Obsidian vault (`/path/to/your/obsidian-vault/team-kb`). That makes a native Obsidian install a hard prerequisite for any teammate who wants to author notes that flow through the ingestion pipeline.

Four concrete pains follow from that prerequisite:

1. **Onboarding friction.** A new teammate must download and install Obsidian before they can contribute notes through the canonical flow.
2. **Cross-platform inconsistency.** Windows / macOS / Linux installs diverge: different config paths, plugin sets, and update cadences drift across the team.
3. **No path to a shared vault.** Native Obsidian assumes one user, one vault on local disk. There is no obvious upgrade path to a shared instance.
4. **Reproducibility.** Demo and CI environments cannot replicate the authoring side of the pipeline because Obsidian is a desktop app.

This spec addresses #1, #2, and #4 directly for the local-dev case. #3 stays out of scope but is unblocked by the changes here (see Follow-ups).

## Goals

Make Obsidian a zero-install dependency for local development by running it in a container. Teammates run a single `docker compose up -d obsidian` and access Obsidian through a browser; the local backend reads markdown from the same vault directory via a bind mount.

**In scope:**

1. Add `docker-compose.yml` at the repo root with a single `obsidian` service backed by `lscr.io/linuxserver/obsidian:latest`.
2. Commit an empty vault skeleton (`vault/team-kb/raw/`, `vault/team-kb/wiki/`) to the repo via `.gitkeep` markers so the directory structure exists on fresh clone.
3. Update `.gitignore` to retain the skeleton while ignoring actual notes.
4. Update `backend/.env.example` to set `KNOWLEDGE_DIR=../vault/team-kb` (relative from the `backend/` working directory).
5. Document the new flow in `CLAUDE.md` under Development Commands.

**Out of scope:**

- Backend or frontend code changes. The existing `POST /api/ingest/sync` endpoint, `WikiFS`, agents, and tests are untouched.
- Containerizing the backend or frontend. `pnpm dev` remains the dev workflow for everything except Obsidian.
- A custom Docker image that pre-seeds `.obsidian/workspace.json` or pre-installs plugins. (Listed as a follow-up.)
- Multi-user / shared-server Obsidian deployments. (Listed as a follow-up.)
- Running Obsidian in CI. The container is a developer-machine convenience; CI continues to run `pytest` and `pnpm test` directly without an authoring UI.
- Any new Python or Node dependency.

## Architecture

The vault is a host directory bind-mounted into the Obsidian container. The local `uvicorn` reads the same directory directly via `KNOWLEDGE_DIR`. There is no networking between the container and the backend; the file system is the only contract.

```
┌─ host machine ────────────────────────────────────────────────┐
│                                                                │
│  docker compose                                                │
│  └── obsidian (lscr.io/linuxserver/obsidian)                   │
│      ├── ${OBSIDIAN_PORT:-3000}:3000  → browser UI (KasmVNC)   │
│      └── volume: ./vault → /config (Obsidian config + vault)   │
│                                                                │
│  pnpm dev (unchanged)                                          │
│  ├── backend (uvicorn :8000)                                   │
│  │   └── reads KNOWLEDGE_DIR=../vault/team-kb  ←┐              │
│  └── frontend (vite :5173)                      │              │
│                                                 │              │
│  ./vault/  (host filesystem, mostly gitignored) ┘              │
│  └── team-kb/                                                  │
│      ├── raw/      (.gitkeep committed; notes ignored)         │
│      └── wiki/     (.gitkeep committed; compiled pages ignored)│
└────────────────────────────────────────────────────────────────┘
```

### Why this works

The backend never talked to Obsidian; it only ever read markdown files from `KNOWLEDGE_DIR`. Containerizing Obsidian does not change that contract. The Obsidian process inside the container writes `.md` files to `/config/team-kb/raw/`, the bind mount surfaces them as `./vault/team-kb/raw/` on the host, and the existing `sync_vault` endpoint picks them up unchanged.

### Components

#### Component A — `docker-compose.yml` (new, repo root)

A single-service compose file:

- **Image:** `lscr.io/linuxserver/obsidian:latest`. The image runs Obsidian inside a containerized Linux desktop env and exposes it over KasmVNC.
- **Ports:** `${OBSIDIAN_PORT:-3000}:3000` for HTTP. Templated so teammates with port 3000 already in use can override via env. The 3001 HTTPS port is omitted (HTTP is sufficient for localhost).
- **Volumes:** `./vault:/config`. The Obsidian image stores both vault content and Obsidian config under `/config`; binding the entire dir keeps everything (notes, plugins, workspace state) on the host.
- **Permissions:** `PUID=${UID:-1000}`, `PGID=${GID:-1000}`. Default of 1000 matches the typical first-user UID on Linux dev boxes; the env-var override lets users whose host UID differs avoid file-ownership mismatches. macOS / Docker Desktop users can ignore this (Docker Desktop translates ownership). Windows users can ignore this entirely.
- **Other:** `shm_size: 1gb` (Chromium-based GUI inside KasmVNC needs this), `restart: unless-stopped` (container survives reboots), `container_name: tkb-obsidian` (for `docker logs` ergonomics).

#### Component B — Vault skeleton

Two committed `.gitkeep` files:

```
vault/team-kb/raw/.gitkeep
vault/team-kb/wiki/.gitkeep
```

This is intentional in place of a custom Docker image with an init script. The bind mount makes the host directory equal the container's `/config`, so anything staged on the host before `docker compose up` shows up inside Obsidian. A `mkdir -p` baked into a custom image would do exactly the same thing at greater cost (rebuild step, image maintenance against base updates).

#### Component C — `.gitignore` updates (repo root)

Allow the two skeleton dirs through while ignoring everything inside them:

```
vault/*
!vault/team-kb/
vault/team-kb/*
!vault/team-kb/raw/
!vault/team-kb/wiki/
vault/team-kb/raw/*
vault/team-kb/wiki/*
!vault/team-kb/raw/.gitkeep
!vault/team-kb/wiki/.gitkeep
```

The `.obsidian/` directory and any user-authored notes under `raw/` or compiled pages under `wiki/` are ignored.

#### Component D — `backend/.env.example` update

Change the `KNOWLEDGE_DIR` example from the old "point at your existing Obsidian vault" pattern to the new repo-relative default:

```
KNOWLEDGE_DIR=../vault/team-kb
```

The relative path resolves against the backend's working directory (`backend/`, because `pnpm dev:backend` runs uvicorn from there), giving `<repo>/vault/team-kb` regardless of where the repo is checked out. This works identically on dev machines and self-hosted runner VMs.

#### Component E — Documentation (`CLAUDE.md`)

A short subsection under Development Commands titled "Obsidian (containerized)" covering:

- The one-time `docker compose up -d obsidian` setup
- Opening `http://localhost:3000`, clicking "Open folder as vault" → `/config`
- Day-to-day flow: edit in browser, then "Sync vault" in the app at `:5173`
- Port override (`OBSIDIAN_PORT=3010 docker compose up`)
- Windows note: if file saves feel laggy, move the vault into the WSL2 filesystem
- Teardown: `docker compose down` (notes survive because the vault is a bind mount, not a Docker volume)

### What stays untouched

- `backend/kb/api/ingest.py` (`POST /api/ingest/sync` and friends)
- `backend/kb/wiki/fs.py` (`WikiFS`)
- `backend/kb/agents/*` (`CompileAgent`, `QueryAgent`, `LintAgent`)
- All existing backend tests, including the integration tests added in `da3b434`
- All frontend code, hooks (`useChat`, `useWiki`, `useIngest`, `useVaultSync`), and tests
- `pyproject.toml`, `package.json`, all lockfiles
- The `scripts/preload.sh` setup script

## Data flow

1. User authors `notes.md` inside browser Obsidian at `http://localhost:3000`, saving into the vault at `/config/team-kb/raw/notes.md`.
2. The bind mount surfaces the file on the host as `<repo>/vault/team-kb/raw/notes.md`.
3. User clicks "Sync vault" in the app UI at `http://localhost:5173/ingest`.
4. Frontend `useVaultSync` POSTs `/api/ingest/sync`.
5. Backend `sync_vault` reads the log at `<repo>/vault/team-kb/wiki/log.md`, lists raw files, and enqueues compile jobs for any file not yet logged as `ingest | <filename>`.
6. Each `CompileAgent.compile` run writes pages into `<repo>/vault/team-kb/wiki/pages/` and appends to `log.md`. Both files appear inside the Obsidian browser tab on next refresh (bind mount is bidirectional).

## Setup flow (new teammate)

```
1.  git clone <repo>
2.  pnpm install                    # frontend deps + workspace registration
3.  scripts/preload.sh              # creates backend/.venv, copies .env, etc.
4.  docker compose up -d obsidian   # one-time, ~1 GB image pull
5.  open http://localhost:3000      # Obsidian in browser
       └── "Open folder as vault" → /config (≈30 sec of clicks)
6.  pnpm dev                        # backend + frontend
7.  open http://localhost:5173      # team-knowledge-base UI
```

After step 5 the vault skeleton (`team-kb/raw/`, `team-kb/wiki/`) is already visible inside Obsidian because of the committed `.gitkeep` markers.

## Risks & known limitations

| # | Risk | Mitigation |
|---|------|------------|
| 1 | Image pull size (~1 GB) intimidates first-time users | Documented in `CLAUDE.md`. One-time cost; subsequent starts are fast. |
| 2 | Port 3000 conflict with other dev services | `${OBSIDIAN_PORT:-3000}:3000` template. Documented override. |
| 3 | Windows bind-mount performance for many small files | Doc note: "if saves feel laggy on Windows, move the vault inside the WSL2 filesystem". For markdown the latency is acceptable in practice. |
| 4 | First-launch Obsidian friction ("Open folder as vault", theme picker, ≈30 sec) | Accepted. Solving it requires the custom-image follow-up (see below); skeleton commit reduces but does not eliminate it. |
| 5 | PUID/PGID mismatch on Linux hosts with non-1000 UID | `PUID=${UID:-1000}` / `PGID=${GID:-1000}` in `docker-compose.yml`. Users whose shell exports `UID`/`GID` get correct ownership automatically; everyone else gets the 1000 default which works on most Debian-derived distros. |
| 6 | Browser-based Obsidian feels heavier than native (mouse latency over WebSocket on KasmVNC) | Accepted tradeoff. For authoring sessions, latency is acceptable. Power users who prefer native can still install Obsidian and point it at `<repo>/vault` directly — both modes coexist. |

## Verification

Because no application code changes, verification is limited to:

1. **Backend test suite still green.** `cd backend && .venv/bin/pytest` — every test (including the `da3b434` integration tests) passes unchanged.
2. **Frontend test suite still green.** `cd frontend && pnpm lint && pnpm test`.
3. **End-to-end smoke test (manual).** From a clean clone:
   - `pnpm install`
   - `scripts/preload.sh`
   - `docker compose up -d obsidian`
   - Open `http://localhost:3000`, mount `/config` as vault
   - Create `team-kb/raw/smoke.md` with a short body inside Obsidian
   - `pnpm dev`
   - In `http://localhost:5173/ingest`, click "Sync vault"
   - Confirm a wiki page appears under `/wiki` and `vault/team-kb/wiki/log.md` records the ingest
4. **Cross-platform spot check.** At minimum one Linux and one Windows-via-WSL2 host. macOS is best-effort if no machine is available.

## Follow-ups (deferred)

- **Custom image with init script.** A Dockerfile extending `linuxserver/obsidian` that drops a script into `/custom-cont-init.d/` to pre-seed `.obsidian/workspace.json` so the vault auto-opens, and optionally pre-installs community plugins. Worth doing once the "Open folder as vault" prompt becomes a recurring annoyance or once we want a shared plugin baseline. Not justified yet.
- **Shared / multi-user vault.** Deploy a single Obsidian instance on a LAN or cloud server with auth in front of KasmVNC. Unblocked by this spec because the file-on-disk contract works identically; only the volume host changes.
- **Containerizing backend + frontend.** Once the team finds Docker-Obsidian comfortable, a follow-up could fold backend and frontend into the same compose file so `docker compose up` is the only command. Out of scope here because the Python toolchain is comfortable in `pnpm dev` today.
