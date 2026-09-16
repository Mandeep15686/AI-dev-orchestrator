# AI Dev Orchestrator

[![CI](https://github.com/Mandeep15686/AI-dev-orchestrator/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/Mandeep15686/AI-dev-orchestrator/actions/workflows/ci.yml)

AI Dev Orchestrator is a local-first desktop application for coordinating coding work across Codex, Claude Code, Cursor, and Gemini. It plans work as a task DAG, selects an available adapter, keeps Git checkpoints, and records orchestration state locally.

## Architecture

```text
Tauri + React desktop UI
          │
          ▼
TypeScript orchestration core ── Agent adapters ── Codex / Claude / Cursor / Gemini
          │
          ├── Git worktrees and checkpoints
          ├── SQLite orchestration metadata
          └── CodeGraph context queries
```

## Repository layout

```text
src-tauri/                 Rust Tauri application, commands, database, and icons
apps/desktop/              React desktop interface
packages/protocol/         Shared TypeScript types and event catalog
packages/core/             Planning, routing, scheduling, handoffs, and recovery
packages/agents/           Shared adapter contract and agent implementations
packages/{git,storage,
  security,codegraph}/     Supporting services
.github/workflows/ci.yml   TypeScript, Rust, and cross-platform bundle checks
```

## Quick start

Prerequisites: Node.js 20 LTS, Corepack, Rust stable with Cargo, and Git. See [SETUP.md](SETUP.md) for Windows, macOS, and Linux instructions.

```bash
git clone https://github.com/Mandeep15686/AI-dev-orchestrator.git ai-dev-orchestrator
cd ai-dev-orchestrator

corepack enable
corepack prepare pnpm@9.15.9 --activate
pnpm install --frozen-lockfile

pnpm typecheck
pnpm test
```

Start the desktop app from the repository root:

```bash
pnpm tauri
```

Build a distributable for the current operating system:

```bash
pnpm tauri:build
```

Build outputs are written under `src-tauri/target/release/bundle/`.

## Everyday commands

| Command | Purpose |
|---|---|
| `pnpm build` | Build all workspace packages in dependency order |
| `pnpm typecheck` | Run TypeScript type checks across the workspace |
| `pnpm test` | Run all workspace tests |
| `pnpm test:core` | Run the core package tests |
| `pnpm test:security` | Run the security package tests |
| `pnpm tauri` | Start Vite and the Tauri desktop application |
| `pnpm tauri:build` | Build and bundle the desktop application |

## Agent credentials

Use the app’s **Agents** page to save credentials and detect available agent CLIs. Credentials are stored through the operating system keychain; they are not written to the project database or committed to Git. Each provider may also require its own authenticated CLI or account session.

## Security model

- Agent commands are checked by the permission manager before execution.
- Risky operations can require an explicit approval.
- Git checkpoints and worktrees isolate and preserve changes during orchestration.
- Local SQLite stores orchestration metadata; OS keychain storage holds credentials.

## Continuous integration

GitHub Actions runs on pushes to `main` and `dev`, and on pull requests to `main`. The workflow uses Node.js 20 and the repository-pinned pnpm 9.15.9, then runs:

1. Type checking and tests on Ubuntu.
2. Rust build and Clippy with warnings treated as errors on Ubuntu.
3. Tauri bundles on Ubuntu, macOS, and Windows.

The bundle jobs publish the generated artifacts from `src-tauri/target/release/bundle/`.

## Extending the project

To add an adapter, implement `AgentAdapter` (normally by extending `BaseAgentAdapter`), export it from a workspace package, and register it in `OrchestratorCore`. The adapter authoring guide is in [packages/agents/README.md](packages/agents/README.md).

## License

MIT
