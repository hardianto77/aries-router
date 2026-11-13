# Aries Router (9Router)

**One OpenAI/Anthropic-compatible endpoint for all your AI providers.**

Aries Router (originally 9Router) is a self-hosted AI gateway written in **Next.js (Node.js)** with a Go migration roadmap. It aggregates dozens of upstream AI providers behind a single unified API, with multi-account pooling, automatic failover, proxy management, a full web dashboard, and an integrated Telegram bot.

> Current version: `0.5.387` (see `package.json`). The public instance in this deployment runs on port `21008`; the upstream default is `20128`.

---

## Features

### Unified Gateway
- **Single endpoint** — expose every provider through one OpenAI-compatible API (`/v1/chat/completions`, `/v1/models`, `/v1/responses`) and Anthropic-compatible routes (`/anthropic/v1/messages`).
- **API keys** — issue, restrict, and track dashboard API keys (model allowlists, RPM/TPM limits, token budgets, expiry, IP whitelists).
- **Model combos** — chain multiple models into one alias (e.g. primary + fallback models), including "uncensored" custom combos.
- **Fallback chain** — per-request account rotation: when an account hits a rate limit (429), the request is automatically handed to the next account; server errors (5xx) and auth errors also rotate, with exponential backoff cooldowns.

### Providers (46 executors)
Native executor integrations for a wide range of upstreams, including:
- **First-party/native**: `antigravity` (Google Gemini OAuth), `gemini-cli`, `gemini-web`, `zcode` (Z.AI), `deepseek-web`, `kimi-web`, `grok-cli`, `qoder`, `kiro`, `cursor`, `windsurf`, `trae`, `iflow`, `codebuddy-cn/intl`, `devin-cli`, `minimax-code`, `xiaomi-mimo`, `zed`, and more.
- **OpenAI-compatible**: any provider with an OpenAI-style API can be added as a generic connection (used in this deployment for Upstage Solar, River, GLM, TokenJuice, TokenHarbor, Ptero, and custom relays).
- **Cloud/enterprise**: Azure OpenAI, AWS Bedrock, Google Vertex AI, GitHub Models, Ollama (local), and OpenCode variants.

### Multi-account & Rotation
- Unlimited **provider connections** per provider (multi-account pooling).
- **Rotation strategies**: `fill-first` (default, priority order), `round-robin` (sticky-N), per-provider overrides via `providerStrategies`.
- **Per-model locks** — a rate-limited account is cooled down per model (`modelLock_<model>`), not account-wide, so a ban on one model does not take down the rest.
- **Antigravity quota cache** — live per-model quota tracking with RAM-level blocking until upstream reset.

### Proxy System
- **Proxy pools** with per-connection binding, strict-proxy mode, Vercel relay support, and per-connection legacy proxy URLs.
- Geo/residential proxy friendly (FloppyData, BrightData-style gateways, static IPs).
- Fallback protects the main IP: if a proxy fails, direct egress is blocked rather than leaking the server IP.

### Dashboard (Next.js App Router)
- Providers, connections, proxy pools, API keys, combos, usage and cost analytics, token usage per key.
- **CLI tools** page with endpoint presets for Claude Code, Codex CLI, Gemini CLI, Grok CLI, Droid, Kilo, Cline, Copilot, Hermes, DeepSeek TUI, and more.
- **Harvester / auto-harvester**, **MITM server**, **model bypass**, **prompt injection**, **media providers** (image/video/TTS), **vouchers (bansos)**, **PxPipe**, **quota viewer**, **token saver**, **translator**, **skills**, and **PRD builder** modules.
- Multi-language UI (i18n, default English), theming with site-wide color modes, responsive layout.

### Telegram Bot
- Built-in Telegram bot service (`telegramBotService.cjs`) for remote control and chat through the router.
- Configurable per-session model/provider, works with the same rotation and fallback machinery.

### Tunneling & Access
- **Cloudflare Tunnel** and **Tailscale Funnel** integrations for exposing the router publicly without port forwarding.
- Embedded `tailscaled` (userspace) support with systemd service example.

---

## Architecture

```
┌──────────────┐   OpenAI/Anthropic API   ┌─────────────────────────────────┐
│   Clients    │ ───────────────────────▶ │  custom-server.js (Node/Express)│
│ (CLI, bots,  │                          │  ├─ Next.js dashboard           │
│  apps)       │ ◀─────────────────────── │  ├─ /v1 API layer               │
└──────────────┘                          │  └─ open-sse engine             │
                                          │      ├─ executors/*.js (46)     │
                                          │      ├─ auth.js (rotation,      │
                                          │      │   locks, fallback)       │
                                          │      └─ proxy layer             │
                                          └───────────────┬─────────────────┘
                                                          │
                                          ┌───────────────▼─────────────────┐
                                          │ SQLite DB (data/db/data.sqlite) │
                                          │ providerConnections, proxyPools,│
                                          │ apiKeys, combos, usageHistory   │
                                          └─────────────────────────────────┘
```

Key source trees:

| Path | Purpose |
|---|---|
| `custom-server.js` | Production HTTP server (Express + Next custom server) |
| `src/app/api/*` | ~40 API route groups (auth, keys, providers, proxy-pools, combos, oauth, mcp, health, …) |
| `src/app/(dashboard)/dashboard/*` | Dashboard pages (~30 modules) |
| `open-sse/executors/*.js` | 46 provider executors |
| `open-sse/services/auth.js` | Credential selection, rotation, rate-limit locks, fallback |
| `open-sse/config/errorConfig.js` | Error classification rules driving fallback/backoff |
| `src/shared/` | Shared UI components, theme store, i18n |

---

## Getting Started

### Requirements
- Node.js 20+ (tested with Node 22)
- npm
- SQLite (bundled via better-sqlite3)
- For Docker: Docker + Docker Compose

### Local development

```bash
# install dependencies
npm install

# configure environment
cp .env.example .env
# edit .env as needed (BASE_URL, CLOUD_URL, OAuth clients, proxies, SEARXNG_URL …)

# run dev server (port 20128)
npm run dev

# production build
npm run build

# start production server (default port 20127; pass --port to override)
npm start -- --port 20128
```

The dev server binds to `127.0.0.1:20128`. Point your clients at:

```
http://localhost:20128/v1
```

### Environment variables

Core variables (see `.env.example` for the full annotated list):

| Variable | Description |
|---|---|
| `DATA_DIR` | Data directory holding the SQLite DB (`<DATA_DIR>/db/data.sqlite`) |
| `AUTH_COOKIE_SECURE` | Set `true` behind HTTPS |
| `REQUIRE_API_KEY` | Force API key on dashboard routes |
| `BASE_URL` / `NEXT_PUBLIC_BASE_URL` | Public base URL of this instance |
| `CLOUD_URL` / `NEXT_PUBLIC_CLOUD_URL` | Cloud sync endpoint |
| `HTTP_PROXY` / `HTTPS_PROXY` / `ALL_PROXY` / `NO_PROXY` | Optional outbound proxy for upstream calls (lowercase variants supported) |
| `SEARXNG_URL` | Optional SearXNG endpoint for the built-in web-search provider |
| `GOOGLE_OAUTH_CLIENT_ID/SECRET` | Google OAuth (required for Gemini/Antigravity OAuth flows) |
| `ANTIGRAVITY_OAUTH_CLIENT_ID/SECRET` | Antigravity OAuth client |

### Docker

```bash
cp .env.example .env   # configure first
docker compose up -d
```

`docker-compose.yml` starts two services:

- `xrouter` — the router itself (image `decolua/xrouter:latest`), port `20128`, data persisted in the `xrouter-data` volume.
- `headroom` — companion quota/headroom service (port `8787`).

Data lives under `/app/data` inside the container (SQLite DB, settings, tunnel state).

---

## API Usage

Once running, all clients speak plain OpenAI:

```bash
curl http://localhost:20128/v1/chat/completions \
  -H "Authorization: Bearer <your-router-api-key>" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gemini-3.8-flash",
    "messages": [{"role": "user", "content": "Hello"}]
  }'
```

- List models: `GET /v1/models`
- Anthropic-style: `POST /anthropic/v1/messages`
- Health: `GET /api/health` → `{"ok":true}`

Model names follow the `<provider>/<model>` convention, e.g. `gemini-3.8-flash-high`, `glm-5.3-flash`, `solar-pro4`, or fully-prefixed variants such as `Rv/moonshotai/Kimi-K3` for per-connection routing.

### CLI integrations
The dashboard's **CLI tools** page generates ready-to-paste configs for Claude Code, Codex CLI, Gemini CLI, Grok CLI, Droid, Kilo, Cline, Copilot, DeepSeek TUI, Hermes, and others — all pointing at your router endpoint and key.

---

## Rate Limits & Failover

`open-sse/config/errorConfig.js` defines the error→action matrix:

| Upstream status | Action |
|---|---|
| `429` (rate limit / quota) | Lock account for the model (exponential backoff, 2s → max 5min), hand over to next account |
| `401/402/403/404` (auth/billing/model) | Long cooldown, rotate to next account |
| `5xx` server errors | Short transient cooldown, rotate |
| `400/406/422` client errors | No penalty, error returned as-is |

Rotation behavior is controlled by:

- `settings.fallbackStrategy` — global (`fill-first` by default)
- `settings.providerStrategies[provider]` — per-provider override (`fill-first`, `round-robin` with `stickyRoundRobinLimit`)

---

## Security Notes

- The SQLite database holds **credentials in plaintext** (API keys, OAuth tokens). Keep `data/` out of version control (already git-ignored) and protect backups.
- `.env*` files are git-ignored; only `.env.example` is committed.
- `dashboardGuard.js` protects the dashboard; API keys for the gateway are managed under **Keys** in the dashboard.
- When exposing publicly, prefer an authenticated tunnel (Cloudflare Access / Tailscale) or set `REQUIRE_API_KEY=true`.

---

## Project Layout

```
.
├── custom-server.js        # production server entry
├── src/                    # Next.js app (dashboard + API routes)
├── open-sse/               # gateway engine (executors, auth, config)
├── cli/, cmd/              # Go CLI (migration roadmap: docs/ROADMAP_GO_MIGRATION.md)
├── gitbook/                # documentation site
├── docs/                   # ARCHITECTURE.md, ROADMAP_GO_MIGRATION.md
├── Dockerfile, docker-compose.yml
└── .env.example
```

## Roadmap

- Go migration of the gateway core (`docs/ROADMAP_GO_MIGRATION.md`)
- Extending provider executors and media generation
- Deeper quota observability per connection

## License

Private project. All rights reserved by the repository owner.
