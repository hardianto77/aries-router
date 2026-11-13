# X Router Architecture Migration Plan: Hybrid Go + Next.js (Single Repo)

> **Status:** Draft / Planned Architectural Roadmap  
> **Target:** Ultra-low RAM footprint (~25MB), high-throughput SSE concurrency, and single-binary packaging while retaining the Next.js dashboard UI and global NPM distribution (`npm install -g xrouter-ai`).

---

## 1. Executive Summary & Goals

### The Problem
* The current Node.js runtime consumes **150MB – 350MB RAM** at idle and scales up during high-concurrency streaming loads (V8 memory overhead + Garbage Collection pauses).
* Heavy multi-turn SSE streams (e.g., Cursor, Claude Code, Cline) create thousands of JS micro-objects that increase GC pressure.

### The Target State
* **Core Engine in Golang:** Sub-millisecond latency, native Goroutine concurrency (~2KB stack per streaming connection), and **idle memory footprint drop to ~15MB – 30MB (saving ~85% RAM)**.
* **Preserve Next.js Dashboard UI:** Zero degradation of UI/UX, charts, Bansos faucet, and settings panels.
* **Single Unified Git Repository:** No splitting into separate repos; maintain frontend and backend side-by-side.
* **Seamless Distribution via NPM:** Users continue installing via `npm install -g xrouter-ai` or running `npx xrouter-ai`. An automated multi-platform binary wrapper delivers pre-compiled Go binaries under the hood.

---

## 2. Target Repository Structure (Hybrid Monorepo)

```text
x-router/ (Single Git Repository)
├── cmd/
│   └── xrouter/                # Main Golang binary entrypoint (main.go)
│
├── internal/                   # Core Golang Backend
│   ├── gateway/                # HTTP server (Gin / Fiber / Chi) with HTTP/2 & Keep-Alive
│   ├── sse/                    # High-performance streaming proxy & chunk translator
│   ├── providers/              # 40+ provider adapters (OpenCode, Gemini, Claude, etc.)
│   ├── cache/                  # Cache-Aware Affinity (KV-cache) & RAM Semantic Cache
│   ├── database/               # Modern SQLite WAL engine (modernc.org/sqlite - CGO-free)
│   ├── vouchers/               # Bansos Anti-Abuse Engine (hardware hash, carrier /16 lock)
│   └── embed.go                # Go embed directive to bundle Next.js static export
│
├── frontend/ (or web/)         # Existing Next.js 14 Dashboard
│   ├── src/                    # React UI components, Tailwind CSS, charts, LeftRail
│   ├── public/                 # Static assets, logos, provider badges
│   └── package.json            # Frontend Next.js build scripts
│
├── cli/                        # NPM Distribution Wrapper
│   ├── bin/                    # OS-specific Go binary downloader / stub
│   ├── index.js                # Lightweight Node.js launcher (detects OS & launches Go)
│   └── package.json            # Published to npmjs.com as `xrouter-ai`
│
├── scripts/
│   └── build-all.sh            # Cross-compiles Go binaries for Linux, macOS, and Windows
├── Makefile                    # Unified build commands (`make build`, `make release`)
├── README.md
└── package.json
```

---

## 3. Key Architectural Pillars

### A. Core Engine Rewrite (Golang)
1. **Zero-CGO SQLite**: Use `modernc.org/sqlite` for 100% pure Go SQLite support with WAL mode. Ensures seamless cross-compilation for all platforms without needing GCC or cross-compilers.
2. **Streaming Pipeline**: Replace Node.js `TransformStream` with Go's `io.Pipe()` and `bufio.Scanner` for SSE streaming. Goroutines handle streaming chunks concurrently with minimal allocation overhead.
3. **Format Translation**: Re-implement OpenAI ↔ Anthropic ↔ Responses JSON schemas with Go structs and `sonic` or `bytedance/sonic` / `valyala/fastjson` for maximum JSON serialization speed.
4. **Cache-Aware Affinity & Semantic Cache**: In-memory thread-safe `sync.Map` / LRU cache with sub-millisecond atomic lookups.

### B. Single Self-Contained Binary (`//go:embed`)
* Next.js is configured for static export (`output: "export"`), compiling the dashboard into pure static HTML/CSS/JS.
* The compiled frontend is embedded directly into the Go binary:
  ```go
  //go:embed web/out/*
  var dashboardFS embed.FS
  ```
* Running `./xrouter` starts both the AI API Gateway (`/v1/*`) and serves the embedded Web Dashboard on port 8080 from a single 25MB executable!

### C. NPM Global Distribution ("Binary Wrapper Pattern")
* When a user runs `npm install -g xrouter-ai`, npm installs a tiny Node.js script.
* On installation (`postinstall`), it detects:
  * OS: `linux`, `darwin` (macOS), `win32` (Windows)
  * Arch: `x64`, `arm64`
* It fetches or unzips the matching pre-compiled Go binary and sets execution permissions.
* The user executes `xrouter` as usual; Node simply spawns the Go binary in the background.

---

## 4. Migration Roadmap & Phased Execution

```text
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│     PHASE 1     │ ──▶ │     PHASE 2     │ ──▶ │     PHASE 3     │ ──▶ │     PHASE 4     │
│ Foundation &    │     │ Provider        │     │ UI Static Embed │     │ NPM Packaging & │
│ Reverse Proxy   │     │ Adapters & SSE  │     │ & DB Migration  │     │ Production GA   │
└─────────────────┘     └─────────────────┘     └─────────────────┘     └─────────────────┘
```

### Phase 1: Foundation & Gateway Core
- Initialize Go module (`go.mod`) in repository.
- Implement HTTP server, authentication middleware (virtual API keys, rate limiters).
- Port SQLite schema v14 using `modernc.org/sqlite`.

### Phase 2: Streaming Engine & Provider Translators
- Build SSE streaming proxy engine.
- Implement key provider adapters (OpenCode Free, Antigravity, Gemini 4 Argon, Grok, Claude).
- Implement Cache-Aware Session Affinity & Exact Prompt RAM Cache.

### Phase 3: Dashboard Integration & Bansos Engine
- Configure Next.js static HTML export for the dashboard.
- Port Bansos Faucet & Voucher claim API with anti-bot challenge handlers into Go.
- Embed static assets into the Go binary via `//go:embed`.

### Phase 4: CI/CD, NPM Packaging & Cutover
- Build GitHub Actions workflow for multi-platform compilation (`goreleaser` or custom script).
- Update `cli/package.json` with the OS binary wrapper launcher.
- Test full deployment on Koyeb, Docker, and Linux VPS.
- Release as `xrouter-ai v1.0.0`.

---

## 5. Risk Assessment & Mitigation

| Potential Risk | Impact | Mitigation Strategy |
| :--- | :--- | :--- |
| **Breaking Existing Custom Models / SQLite** | High | Retain identical SQLite table schemas (`providerConnections`, `kv`, `vouchers`); zero database migrations required. |
| **Cross-Platform Binary Size in NPM** | Medium | Distribute platform-specific npm optional dependencies (like `@esbuild/linux-x64`) so users only download the binary for their machine. |
| **Rapid Upstream Provider Protocol Drift** | Medium | Maintain modular provider adapters in `internal/providers/` with config-driven endpoint definitions. |
