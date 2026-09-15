# AI Dev Orchestrator

A local-first, multi-agent software development operating layer that routes work across **Codex, Claude Code, Cursor, and Gemini** — preserving context, checkpointing state with Git, and verifying every change before the next agent continues.

---

## Architecture at a Glance

```
UI (Tauri/React) → IPC Bridge → Orchestration Core (TypeScript)
                                       ↓
                              Agent Adapter Layer
                        ┌─────┬──────┬───────┬──────┐
                      Codex  Claude  Cursor  Gemini
                        └─────┴──────┴───────┴──────┘
                                       ↓
                          Git Repository (source of truth)
                          SQLite (orchestration metadata)
                          CodeGraph (local AST index)
```

## Monorepo Structure

```
ai-dev-orchestrator/
├── src-tauri/              # Rust: process mgmt, git, keychain, SQLite
├── packages/
│   ├── protocol/           # Shared TypeScript types + event catalog
│   ├── core/               # Orchestration logic (all 10 subsystems)
│   ├── agents/
│   │   ├── shared/         # AgentAdapter interface + BaseAgentAdapter
│   │   ├── claude/         # Claude Code adapter (CLI + SDK)
│   │   ├── codex/          # OpenAI Codex adapter (CLI + ACP)
│   │   ├── cursor/         # Cursor adapter (CLI + ACP)
│   │   └── gemini/         # Gemini adapter (REST API)
│   ├── git/                # GitEngine (TypeScript wrapper)
│   ├── storage/            # Database (SQLite via better-sqlite3)
│   ├── security/           # PermissionManager
│   ├── codegraph/          # CodeGraphProxy (MCP wrapper)
│   └── testing/            # VerificationEngine
└── apps/
    └── desktop/            # React + Tauri UI
```

## Key Subsystems

| Subsystem | File | Responsibility |
|---|---|---|
| OrchestratorCore | `core/OrchestratorCore.ts` | Main loop — coordinates all subsystems |
| TaskPlanner | `core/TaskPlanner.ts` | Decomposes goals → typed Task DAG |
| AgentRouter | `core/AgentRouter.ts` | Weighted scoring → selects best agent |
| ContextEngine | `core/ContextEngine.ts` | 92% token reduction via smart compression |
| HandoffEngine | `core/HandoffEngine.ts` | Distils sessions → structured HandoffJSON |
| DAGScheduler | `core/DAGScheduler.ts` | Parallel execution with Git worktrees |
| VerificationEngine | `core/VerificationEngine.ts` | build → lint → test gates |
| FailureRecovery | `core/FailureRecovery.ts` | Maps StopReason → RecoveryStrategy |
| EventBus | `core/EventBus.ts` | Typed pub/sub — decouples all subsystems |
| PermissionManager | `security/PermissionManager.ts` | Command allowlist + approval dialogs |

## Quick Start

### Prerequisites
- Node.js ≥ 20
- Rust + Cargo (stable)
- pnpm ≥ 9

### Install
```bash
git clone https://github.com/your-org/ai-dev-orchestrator
cd ai-dev-orchestrator
pnpm install
```

### Development
```bash
# Start the Tauri app (dev mode)
pnpm tauri

# Or run just the UI
cd apps/desktop && pnpm dev

# Build all packages
pnpm build
```

### Connect Agents
1. Open the app → **Agents** tab
2. For each agent: paste API key → Save → Detect
3. Keys are stored in your OS keychain (never on disk)

### Run a Goal
1. Open **Dashboard**
2. Type your goal: *"Build an auth system with JWT and a React login page"*
3. Click **▶ Start**
4. The orchestrator decomposes it, selects agents, and runs the pipeline

## Handoff Protocol

After each agent session, the HandoffEngine produces:

```json
{
  "version": "1.0",
  "agent": "codex",
  "gitCommit": "3a8f21d",
  "exitReason": "COMPLETED",
  "completed": ["User model", "DB migration", "bcrypt hashing"],
  "remaining": [],
  "filesModified": ["src/models/user.ts", "src/db/migrations/001.sql"],
  "tests": { "passed": 12, "failed": 0 },
  "decisions": ["Used bcrypt cost factor 12"],
  "knownIssues": []
}
```

## Security Model

- **OS Keychain** — All API keys (never SQLite or .env files)
- **Scoped filesystem** — Agents limited to project directory
- **Command allowlist** — Per-agent, per-task-type
- **Approval dialogs** — `git push`, `rm -rf`, and any high-risk command
- **Hardcoded blocklist** — `sudo`, `shutdown`, `fdisk` — never executed

## Adding a New Agent

```typescript
// 1. Implement the interface
export class MyAgentAdapter extends BaseAgentAdapter {
  readonly id = 'myagent';
  readonly capabilities: AgentCapabilities = { ... };
  async detect() { ... }
  async startSession(task, ctx, opts) { ... }
  async *streamEvents(session) { ... }
  async waitForStop(session) { ... }
  async stop(session) { ... }
}

// 2. Register in OrchestratorCore.ts
this.router.registerAdapter(new MyAgentAdapter());
```

## Technologies

- **Tauri 2** — Desktop shell (Rust + WebView)
- **React 18** — UI
- **TypeScript** — Orchestration logic + all adapters
- **Rust** — Process management, Git, OS keychain, SQLite commands
- **SQLite** — Orchestration metadata (better-sqlite3)
- **Git / libgit2** — Primary code state store + worktrees
- **CodeGraph** — Local AST-derived code intelligence
- **Zustand** — UI state management
- **ACP** — Agent Client Protocol (Cursor, Codex)

## License

MIT
