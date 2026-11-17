# W2V Frontend

The browser UI for the w2v Studio — a SvelteKit app that authenticates users through Keycloak, lets them define projects and deliverables, and launch, monitor, and download runs that turn source material into narrated video. Port 6183.

|                     |                                                                    |
| ------------------- | ------------------------------------------------------------------ |
| **Stack**           | SvelteKit 2 · Svelte 5 (runes) · Vite 8 · Tailwind v4 · TypeScript |
| **Auth**            | Keycloak (keycloak-js) + license token                             |
| **Package manager** | bun (`bun.lock`, pinned 1.3.11)                                    |
| **Serving**         | `@sveltejs/adapter-node` behind a custom `server.js` reverse proxy |

## What W2V Frontend Does

W2V Frontend is the only public-facing surface of the w2v pipeline. Every other service — `w2v_orchestrator` and the fleet of analysis, TTS, video, and rendering backends behind it — has no public hostname, so the browser talks exclusively to this app. The app is publicly named **Studio**. When a user opens `studio.nonagentic.ai` (the old `w2v.nonagentic.ai` host 308-redirects there) they authenticate against Keycloak (realm `portal`, client `w2v-frontend`), and the SPA holds the resulting JWT for the session while carrying an optional opaque license token for backend authorization. The backend accepts either axis: `Authorization: Bearer <jwt>` read fresh per request, or `X-Tenant-Id: Bearer <license_token>`.

Once signed in, the user works inside the Studio. They create a project, pick a deliverable type through a wizard, and configure the inputs — source URLs, manuscripts, verbatim text, voices, and rendering options — that describe the video they want. Launching a deliverable submits a run to the orchestrator, and the run viewer then tracks progress live: a Server-Sent Events subscription (`GET /api/runs/{id}/events`) streams stage and run _status_ transitions, while the storyboard of stage outputs, usage, and artifacts is bound to the loader snapshot and refetched once when the run reaches a terminal state. The SSE stream deliberately carries no media payloads — "reveal" is a refetch, not a push — which keeps the CPU-constrained run page from re-rendering the whole storyboard on every stage completion.

When a run finishes, the SPA previews and downloads the rendered artifacts — video, audio, captions — through the same proxied API. Super-admins and tenant-admins get additional route groups for cross-tenant provisioning, audit, member management, and usage, with a tenant scope-switch that re-scopes the entire app to a selected tenant by attaching an `X-Active-Tenant-Id` header the orchestrator honors.

In production the app is not a static SPA: it is built with `@sveltejs/adapter-node` and run as `node server.js`, a custom Node server that wraps SvelteKit's `build/handler.js` and reverse-proxies `/api/*` (HTTP and WebSocket upgrades) to `w2v-orchestrator.w2v:6300` over cluster DNS. That proxy injects `Authorization`/`X-Tenant-Id` from `kc_token`/`license_token` cookies for header-less navigations (window.open, `<a href="/api/...">`, SSE), refuses the cookie fallback for cross-site requests as a CSRF defense, and propagates an `X-Request-Id` so one user action can be grepped across the fleet's logs. The public path is Internet → Cloudflare → istio-ingress → the `w2v-frontend` Service, Keycloak-gated at the edge.

## Features

- **Keycloak session auth** — signs users in against the `portal` realm via keycloak-js and reads a fresh access token per request so the SPA never ships a stale JWT to the backend.
- **Dual-axis backend authz** — carries both the Keycloak JWT and an opaque license token, letting the orchestrator authorize a request by whichever axis is present.
- **Project & deliverable wizard** — guides users through picking a deliverable type and its inputs so a run can be configured without knowing the pipeline's internals.
- **Live run viewer** — subscribes to run/stage status over SSE and drives a storyboard that reveals stage outputs as the run progresses, with a single terminal-state refetch to avoid re-render storms.
- **Stage I/O inspector** — drills into any run stage to show its inputs, outputs, and usage so failures and blueprint drift are diagnosable from the UI.
- **Artifact preview & download** — previews and downloads rendered video, audio, and captions through the proxied API, including TTS voice previews played from object URLs.
- **Super-admin platform screens** — cross-tenant `tenants`, `provision`, `audit`, and `request-audit` views gated by role so operators can manage the whole fleet.
- **Tenant-admin screens** — `admin`, `members`, and `usage` views scoped to a single tenant for tenant-level administration.
- **Tenant scope-switch** — attaches `X-Active-Tenant-Id` on every request so a super-admin can browse the app as any tenant, persisted in localStorage.
- **Generated API types** — `src/lib/api/types.gen.ts` is generated from the orchestrator's OpenAPI package and checked in CI so the client never drifts from the backend contract.
- **Hardened CSP** — a hash-mode Content-Security-Policy scoped to the SPA's own origin plus the Keycloak host, with explicit `blob:` allowances for media and image object URLs.
- **Cookie-auth proxy** — the Node server forwards auth cookies onto header-less `/api/*` navigations while refusing cross-site requests, so downloads and SSE work without exposing tokens to XSS.

## Quick Start

```bash
bun install
bun run dev          # Vite dev server on http://localhost:6183
bun run test:run     # vitest single-run (bun run test is watch-mode)
bun run lint         # eslint .
```

## Configuration

Build-time `VITE_*` vars are inlined into the SPA bundle by Vite; the `W2V_*`/`PORT` vars are read at runtime by `server.js`. See `.env.example`.

| Variable                   | Default                            | Description                                                                        |
| -------------------------- | ---------------------------------- | ---------------------------------------------------------------------------------- |
| `VITE_API_URL`             | `http://localhost:6300`            | Backend API base (server-side; browser uses the `/api` proxy)                      |
| `VITE_KEYCLOAK_URL`        | `https://auth.nonagentic.ai`       | Keycloak base URL                                                                  |
| `VITE_KEYCLOAK_REALM`      | `portal`                           | Keycloak realm                                                                     |
| `VITE_KEYCLOAK_CLIENT_ID`  | `w2v-frontend`                     | Keycloak client ID                                                                 |
| `VITE_LICENSE_TOKEN`       | --                                 | Optional license token for local dev/smoke (sent as `X-Tenant-Id: Bearer <token>`) |
| `VITE_W2V_WS_URL`          | --                                 | Optional WebSocket override (else derived from `window.location`)                  |
| `VITE_AUTH_BYPASS`         | --                                 | Dev escape hatch — skips Keycloak and uses a mock dev user                         |
| `PORT`                     | `6183`                             | Production Node server listen port                                                 |
| `W2V_API_URL`              | `http://w2v-orchestrator.w2v:6300` | Backend the proxy forwards `/api/*` to                                             |
| `W2V_PROXY_TIMEOUT_MS`     | `30000`                            | Upstream proxy + proxy-response timeout                                            |
| `W2V_REQUEST_TIMEOUT_MS`   | `60000`                            | Inbound request timeout                                                            |
| `W2V_HEADERS_TIMEOUT_MS`   | `65000`                            | Inbound headers timeout                                                            |
| `W2V_KEEPALIVE_TIMEOUT_MS` | `10000`                            | Keep-alive socket timeout                                                          |

## Architecture

```
src/
├── app.html                     # SvelteKit HTML shell
├── app.css                      # Tailwind v4 entry + font imports
├── app.d.ts                     # Ambient type declarations
├── routes/                      # SvelteKit file-based routing
│   ├── +layout.svelte           # Root shell + auth bootstrap
│   ├── +error.svelte            # 401/error surface (no auto Keycloak redirect)
│   ├── +page.svelte             # Landing / dashboard
│   ├── (platform)/              # super_admin: tenants, provision, audit, request-audit
│   ├── (tenant)/                # tenant_admin: admin, members, usage
│   ├── projects/                # product surface: new wizard, [pid]/deliverables,
│   │                            #   verbatim, runs/[id] viewer + stages/[stage] inspector
│   ├── runs/                    # standalone run viewer
│   ├── critique/                # critique views
│   ├── settings/                # user/app settings
│   ├── license-upgrade/         # license gate upgrade flow
│   ├── auth/                    # POST /auth/cookie + auth callbacks
│   ├── api/[...path]            # catch-all /api proxy used in `vite dev` only
│   └── health, healthz, readyz  # probe routes
├── lib/
│   ├── api/                     # typed HTTP clients (client.ts, runs, projects,
│   │                            #   deliverables, tts, downloads, ...) + types.gen.ts
│   ├── stores/                  # Svelte 5 rune stores (auth, projects, run-events,
│   │                            #   sse-subscription, tenant-switcher, job-progress/)
│   ├── components/              # UI by domain: runs, studio, wizard, video, audio,
│   │                            #   charts, dashboard, reviews, jobs, errors, ui
│   ├── layout/                  # Header, ShellLayout, SidebarNav, TenantSwitcher, UserMenu
│   ├── services/                # keycloak.ts (keycloak-js init + token refresh)
│   ├── studio/                  # project-request, media-source, kokoro-voices
│   ├── server/                  # config.ts (server-only settings)
│   ├── utils/                   # diff, format, stage-labels, auth-guards, validation
│   └── types/                   # shared TS types (api, runs, annotations)
├── server.js                    # prod Node server: adapter-node handler + /api proxy
├── svelte.config.js             # adapter-node + hash-mode CSP
└── vite.config.ts               # dev server on 6183, Tailwind + SvelteKit plugins
```

## Testing

```bash
bun run test:run     # vitest unit tests (happy-dom, single-run)
bun run test         # vitest watch mode
bun run test:e2e     # Playwright e2e (playwright test)
bun run check        # svelte-check (type + a11y gate — this is the CI gate)
bun run lint         # eslint .
bun run format:check # prettier --check .
```

`svelte-check` (`bun run check`) is the type gate — type and a11y errors fail CI, not just `tsc`. Unit tests run under vitest with happy-dom and Testing Library (`@testing-library/svelte`). The Playwright e2e matrix runs post-promote only (see CI/CD), not per-PR.

## Docker

Multi-stage build: the builder stage runs `bun install --frozen-lockfile` + `bun run build` (adapter-node) on the bun base, and the production stage is a **real node base** that keeps only runtime `dependencies` and serves via `node server.js` as the non-root `node` user. The runtime is deliberately not bun: bun's `node:http` keeps draining a request socket into an internal buffer even after an explicit `req.pause()`, retaining ~76 MiB per in-flight 64 MiB upload part, which OOMKilled both replicas on 2026-08-20. See the comment on the runtime stage in the `Dockerfile` and the repro in `scripts/oom-repro/`.

```bash
docker build -t w2v-frontend .
docker run -p 6183:6183 w2v-frontend
docker run -p 6183:6183 -e W2V_API_URL=http://host.docker.test:6300 w2v-frontend
```

Production serves via `server.js` (adapter-node handler + reverse proxy), forwarding `/api/*` HTTP and WebSocket traffic to the orchestrator. Build args `VITE_KEYCLOAK_URL`, `VITE_KEYCLOAK_REALM`, `VITE_KEYCLOAK_CLIENT_ID`, and `VITE_AUTH_BYPASS` are baked into the SPA bundle at build time — missing them yields an empty Keycloak config and an infinite redirect loop.

## CI/CD

`.github/workflows/ci-public.yml` is self-contained and runs on GitHub-hosted runners: a betterleaks secret scan, the `no-private-refs` guard, then `bun install --frozen-lockfile` → `bun run check` (svelte-check) → `bun run lint` → `bun run test:run` (vitest) → `bun run build`. Bun is pinned to `1.3.11` in lockstep with the Dockerfile base tag.

The Playwright end-to-end matrix that ran against a live deployment in the private estate is not part of this published source tree.

## Dependencies

- **w2v_orchestrator** (port 6300) — the backend; every `/api/*` request is reverse-proxied to it, and `src/lib/api/types.gen.ts` is generated (gitignored) at `dev`/`check`/`build` time from its live `@latest` OpenAPI package (`@nonagentic/w2v-orchestrator-openapi` on npm.test, via `scripts/fetch-openapi.ts`).
- **Keycloak** (`auth.nonagentic.ai`, realm `portal`) — user session authentication via **keycloak-js**.
- **SvelteKit** (`@sveltejs/kit`) + **Svelte 5** — app framework and reactive runtime.
- **@sveltejs/adapter-node** — builds the Node server target that `server.js` wraps.
- **Vite 8** + **@sveltejs/vite-plugin-svelte** — build tooling and dev server.
- **Tailwind CSS v4** (`@tailwindcss/vite`) — styling.
- **http-proxy-3** — the `/api/*` HTTP + WebSocket reverse proxy in `server.js`.
- **@lucide/svelte** — icon set; **svelte-dnd-action** — drag-and-drop; **diff** — text diffing in the critique/redesign views.
- **vitest** + **happy-dom** + **@testing-library/svelte** — unit testing; **@playwright/test** — e2e.
- **eslint** + **typescript-eslint** + **prettier** + **svelte-check** — lint, format, and type gate.

## License

Apache 2.0 — see [`LICENSE`](LICENSE) and [`NOTICE`](NOTICE).

## Licensing

This application contains no licence enforcement of its own and runs no licence
server. Tenant and licence identity travels in the API calls it proxies to the
orchestrator. It runs with no licence switch set; unset means off.
