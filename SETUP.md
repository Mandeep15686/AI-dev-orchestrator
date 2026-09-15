# Setup Guide

Complete instructions for getting AI Dev Orchestrator running locally.

---

## System Requirements

| Requirement | Version | Notes |
|---|---|---|
| Node.js | ≥ 20.0.0 | Use `nvm` or `fnm` to manage |
| pnpm | ≥ 9.0.0 | `npm install -g pnpm` |
| Rust + Cargo | stable | [rustup.rs](https://rustup.rs/) |
| Git | any | Must be on PATH |
| macOS / Linux | — | Windows via WSL2 is supported |

---

## Step 1 — Clone and install

```bash
git clone https://github.com/your-org/ai-dev-orchestrator
cd ai-dev-orchestrator
pnpm install
```

This installs all workspace packages in a single pass.

---

## Step 2 — Install system dependencies

### macOS
```bash
# Xcode Command Line Tools (needed for Tauri/native builds)
xcode-select --install
```

### Ubuntu / Debian
```bash
sudo apt-get update
sudo apt-get install -y \
  libwebkit2gtk-4.1-dev \
  libappindicator3-dev \
  librsvg2-dev \
  patchelf \
  build-essential \
  libssl-dev \
  pkg-config
```

### Windows (WSL2)
Use Ubuntu in WSL2 and follow the Ubuntu instructions above.

---

## Step 3 — Build TypeScript packages

```bash
pnpm build
```

This runs `tsc` in each workspace package in dependency order via Turborepo.

---

## Step 4 — Run tests

```bash
# All tests
pnpm test

# Watch mode for active development
pnpm test:watch

# Specific package
pnpm --filter @ai-orch/core test
pnpm --filter @ai-orch/security test
```

---

## Step 5 — Connect AI agents

Launch the app (Step 6) then go to the **Agents** tab.

For each agent:
1. Paste your API key
2. Click **Save** (stored in OS keychain)
3. Click **Detect** to verify

### Getting API keys

| Agent | URL |
|---|---|
| Claude Code | [console.anthropic.com](https://console.anthropic.com) |
| OpenAI Codex | [platform.openai.com/api-keys](https://platform.openai.com/api-keys) |
| Gemini | [ai.google.dev](https://ai.google.dev) |
| Cursor | [cursor.sh/settings](https://cursor.sh/settings) |

You also need the agent CLI installed:
```bash
npm install -g @anthropic-ai/claude-code   # Claude Code
npm install -g openai-codex                # Codex (if available)
# Cursor: download from cursor.sh
```

---

## Step 6 — Run the app

### Development mode
```bash
pnpm tauri
```

This starts the Vite dev server + Tauri simultaneously with hot-reload.

### Build for distribution
```bash
pnpm tauri:build
```

Outputs to `src-tauri/target/release/bundle/`.

---

## Step 7 — Import your first project

1. Open the app → **Dashboard**
2. Click **Import Project** in the top-right
3. Paste the path to a local Git repository
4. Click **Import**

The orchestrator creates a `.ai-orchestrator/` directory in your project containing:

```
.ai-orchestrator/
├── project.json        ← project metadata
├── state.json          ← current orchestration state
├── task.md             ← edit this to describe your task
├── decisions.md        ← auto-appended architectural decisions
├── handoffs/           ← handoff JSON per agent session
├── runs/               ← raw agent output logs
└── agents/             ← per-agent run history
```

---

## Development Workflow

### Package dependency graph

```
protocol  ←  core  ←  agents/*
          ←  git
          ←  storage
          ←  security
          ←  codegraph
```

`protocol` has zero dependencies — all types live there.

### Adding a new subsystem

1. Create `packages/my-module/`
2. Add `package.json` with `"name": "@ai-orch/my-module"`
3. Add `tsconfig.json` extending `../../tsconfig.json`
4. Import it in `packages/core/src/OrchestratorCore.ts`
5. Run `pnpm build` to pick it up

### Adding a new agent

See [packages/agents/README.md](packages/agents/README.md).

### Running a single test file

```bash
pnpm --filter @ai-orch/core exec vitest run src/__tests__/AgentRouter.test.ts
```

---

## Environment Variables

These are only used during **development**. In production, credentials are in the OS keychain.

```bash
# Optional — for testing the sidecar directly
ORCH_DB_PATH=/tmp/test-orch.db

# Only if running agents outside the UI
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
GEMINI_API_KEY=AIza...
```

---

## Troubleshooting

### `tauri dev` fails with "webkit not found"
Install the Linux system dependencies from Step 2.

### `pnpm install` fails with workspace errors
Ensure Node.js ≥ 20: `node --version`

### Agent shows "Not detected"
1. Ensure the CLI is on your PATH: `which claude`
2. In the app → Agents tab → click **⟳ Detect**
3. Check credentials are saved in Settings

### Tests fail with import errors
Run `pnpm build` first — some tests import from compiled outputs.

### SQLite errors on first run
The database is created automatically at `$APP_DATA/orchestrator.db`.
Delete it to start fresh: `rm -rf ~/.local/share/ai-dev-orchestrator/`

---

## Project Layout

```
ai-dev-orchestrator/
├── .github/workflows/     ← CI (typecheck + test + Tauri build)
├── src-tauri/             ← Rust: process mgmt, git, keychain, SQLite
│   └── src/
│       ├── lib.rs         ← Tauri app bootstrap + command registration
│       ├── commands/      ← Tauri command handlers (git, fs, process, keychain, db)
│       ├── database.rs    ← SQLite init + schema
│       └── ipc.rs         ← Node.js sidecar JSON-RPC bridge
├── packages/
│   ├── protocol/          ← All shared TypeScript types + event catalog
│   ├── core/              ← Orchestration subsystems (10 classes)
│   │   └── src/__tests__/ ← Unit + integration tests (vitest)
│   ├── agents/
│   │   ├── shared/        ← AgentAdapter interface + BaseAgentAdapter
│   │   ├── claude/        ← Claude Code adapter
│   │   ├── codex/         ← OpenAI Codex adapter
│   │   ├── cursor/        ← Cursor adapter (ACP)
│   │   └── gemini/        ← Gemini REST adapter
│   ├── git/               ← GitEngine (wraps git CLI)
│   ├── storage/           ← Database.ts (better-sqlite3) + migrations
│   ├── security/          ← PermissionManager
│   ├── codegraph/         ← CodeGraphProxy (MCP wrapper + grep fallback)
│   └── testing/           ← VerificationEngine stub (logic is in core)
└── apps/
    └── desktop/           ← React 18 + Tauri UI
        └── src/
            ├── pages/     ← Dashboard, WorkflowEditor, AgentLogs, etc.
            ├── components/ ← Sidebar, PermissionDialog, etc.
            ├── store/     ← Zustand stores
            └── lib/       ← Tauri typed bindings
```
