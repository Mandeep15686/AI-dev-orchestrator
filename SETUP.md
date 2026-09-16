# Setup Guide

This guide sets up AI Dev Orchestrator for development and native desktop builds. Commands below are run from the repository root unless stated otherwise.

## Requirements

| Tool | Recommended version | Why it is needed |
|---|---:|---|
| Node.js | 20 LTS | Matches the GitHub Actions runtime and native dependency support |
| Corepack | Bundled with Node 20 | Activates the repository-pinned pnpm release |
| pnpm | 9.15.9 | Workspace package manager, pinned in `package.json` |
| Rust and Cargo | Stable | Builds the Tauri native application |
| Git | Current | Checkpoints, worktrees, and repository operations |

Node 20 is intentionally used by CI. Using newer Node versions can require local recompilation of native modules such as `better-sqlite3`.

## Before you begin

Use a normal local clone rather than a network-mounted directory. The application creates Git worktrees, invokes local agent CLIs, and compiles native dependencies, all of which are more reliable on a local filesystem.

Verify that the required tools resolve before cloning or installing:

```bash
node --version
git --version
cargo --version
```

On Windows PowerShell, `where.exe node`, `where.exe git`, and `where.exe cargo` show which executable will be used. If multiple Node installations are present, make sure the one first on `PATH` is Node 20.

## Clone and install

```bash
git clone https://github.com/Mandeep15686/AI-dev-orchestrator.git ai-dev-orchestrator
cd ai-dev-orchestrator

corepack enable
corepack prepare pnpm@9.15.9 --activate
pnpm install --frozen-lockfile
```

Use `pnpm install` without `--frozen-lockfile` only when you intentionally change dependencies and will update `pnpm-lock.yaml`.

The first installation compiles or downloads native dependencies and may take longer than later installs. Do not copy `node_modules` between operating systems; run the install command separately on each platform.

## Platform prerequisites

### Windows (native)

Native Windows is the recommended environment for building the Windows desktop application.

1. Install Node.js 20 LTS, Git, and Rust stable.
2. Install Visual Studio Build Tools with the **Desktop development with C++** workload. Include the MSVC x64/x86 build tools and a Windows 10 or Windows 11 SDK.
3. Ensure Microsoft Edge WebView2 Runtime is installed (it is included with current Windows installations).
4. Open a new PowerShell window after installing Rust so `cargo --version` succeeds.

Confirm the native compiler is available before a release build:

```powershell
cargo --version
where.exe cl
where.exe rustc
```

WSL can build TypeScript packages, but it does not produce a normal native Windows Tauri application without additional GUI and cross-compilation setup.

### macOS

```bash
xcode-select --install
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

Restart the terminal after installing Rust, then verify `cargo --version`.

Tauri builds for the active macOS architecture. Building a universal package requires additional target/toolchain setup and is not configured by the default project scripts.

### Ubuntu or Debian

```bash
sudo apt-get update
sudo apt-get install -y \
  build-essential \
  libwebkit2gtk-4.1-dev \
  libappindicator3-dev \
  librsvg2-dev \
  libssl-dev \
  patchelf \
  pkg-config

curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

Restart the shell after Rust installation, or load Cargo’s environment before continuing.

The bundled Linux targets include AppImage support. The dependencies above match the CI environment and provide WebKit, SVG, and packaging support.

## Understand the workspace

This repository is a pnpm workspace coordinated by Turborepo:

```text
packages/protocol        Shared contracts used across the workspace
packages/agents/*        Provider-specific agent adapters
packages/core            Orchestration engine
packages/{git,storage,
  security,codegraph}    Core services used by the engine
apps/desktop             React frontend
src-tauri                Rust native shell and Tauri commands
```

`pnpm build` executes workspace builds in dependency order. Build output is written into package-level `dist/` directories, while the production frontend is emitted into `apps/desktop/dist/`.

## Verify the checkout

```bash
node --version
pnpm --version
cargo --version

pnpm typecheck
pnpm test
pnpm build
```

For a clean, CI-equivalent validation sequence, run the commands in this order after a fresh install:

```bash
pnpm typecheck
pnpm test
pnpm build
```

`pnpm test` asks Turborepo to build package dependencies first, so it may take longer than a focused test command.

Run a focused test suite when iterating:

```bash
pnpm test:core
pnpm test:security
pnpm --filter @ai-orch/core exec vitest run src/__tests__/AgentRouter.test.ts
```

Watch the core test suite during implementation:

```bash
pnpm test:watch
```

## Run the desktop app

```bash
pnpm tauri
```

This command invokes Tauri from the repository root, where it discovers `src-tauri/tauri.conf.json`. Tauri starts the configured development command and opens the desktop app with hot reload.

The development flow is:

1. Tauri starts the repository `dev` script.
2. Turborepo starts the workspace development tasks.
3. Vite serves the desktop UI at `http://localhost:1420`.
4. Tauri loads that URL in the native application window.

Stop the terminal process to stop both the frontend and native application. If port 1420 is already in use, stop the conflicting Vite process before starting again because the Vite configuration uses a strict port.

For frontend-only work:

```bash
pnpm --dir apps/desktop dev
```

## Build a distributable

```bash
pnpm tauri:build
```

The current platform’s packages are created under `src-tauri/target/release/bundle/`. The bundle configuration includes the PNG, Windows ICO, and macOS ICNS assets in `src-tauri/icons/`; keep those files when changing application branding.

GitHub Actions builds bundles independently on Ubuntu, macOS, and Windows. Local builds produce artifacts only for the host platform unless a cross-compilation toolchain is configured.

Expected artifact directories vary by host platform:

| Host | Typical bundle directories |
|---|---|
| Windows | `msi/` and `nsis/` |
| macOS | `dmg/` and `macos/` |
| Linux | `appimage/`, `deb/`, and `rpm/` |

The `bundle.targets` setting is `all`. Packaging consumes the configured PNG, ICO, and ICNS files from `src-tauri/icons/`, so do not remove an icon format that belongs to another operating system.

## Initialize and run a project

1. Start the application with `pnpm tauri`.
2. Import a local Git repository from the desktop UI.
3. Create or describe a goal, then begin the workflow.
4. Review agent output, changed files, permission prompts, checkpoints, and verification results in the UI.

The project initializer creates an `.ai-orchestrator/` directory in the imported project:

```text
.ai-orchestrator/
├── project.json       Project metadata and settings
├── state.json         Current orchestration state
├── workflow.json      Workflow graph data
├── task.md            Human-editable task description
├── decisions.md       Architectural decisions
├── agents/            Per-provider run history
├── handoffs/          Structured session handoffs
├── runs/              Raw run output (ignored by Git)
└── logs/              Runtime logs (ignored by Git)
```

Keep `project.json`, `task.md`, `decisions.md`, and handoffs under version control when they are useful to the team. The initializer adds the high-volume `runs/` and `logs/` directories to the imported project’s `.gitignore`.

## Configure agents

1. Start the desktop app.
2. Open **Agents**.
3. Enter the provider credential where required, save it, then select **Detect**.
4. Ensure the corresponding CLI is installed and authenticated when that adapter uses a CLI.

Adapter expectations:

| Adapter | Detection requirement | Notes |
|---|---|---|
| Claude Code | `claude` on `PATH` and authenticated | Supports CLI and SDK-style operation |
| Codex | `codex` on `PATH` | Uses CLI and ACP capabilities |
| Cursor | `cursor` on `PATH` | Uses CLI and ACP capabilities |
| Gemini | `GEMINI_API_KEY` available to the process | Uses the Gemini REST API |

The Agent Manager UI stores entered credentials in the OS keychain. The current Node adapter processes read provider credentials from their inherited environment, so set the required variable before launching a sidecar or testing an adapter directly. In particular, Gemini detection requires `GEMINI_API_KEY`.

```bash
ANTHROPIC_API_KEY=...
OPENAI_API_KEY=...
GEMINI_API_KEY=...
CURSOR_API_KEY=...
```

Never commit real credentials, `.env` files containing credentials, or generated application databases.

When launching from a terminal, environment variables are inherited by child processes. For example, in PowerShell, set a key for the current terminal session before starting the app or a direct adapter test:

```powershell
$env:GEMINI_API_KEY = "your-key"
pnpm tauri
```

CLI-based adapters also need their provider-specific login flow completed. Keychain storage prevents credentials entered in the UI from being written to the repository, but does not replace the CLI or environment configuration used by the current adapter runtime.

## CI workflow

The workflow in `.github/workflows/ci.yml` uses the same installation contract as local setup:

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm build
pnpm tauri build
```

It also runs `cargo clippy -- -D warnings` and a Rust debug build. If CI reports an icon error, verify that all files in `src-tauri/icons/` are tracked and that `src-tauri/tauri.conf.json` lists the complete icon set.

The build matrix packages the app on Ubuntu, macOS, and Windows after the TypeScript and Rust jobs pass. CI artifacts are uploaded from `src-tauri/target/release/bundle/` with names based on the operating system.

## Dependency updates

1. Change the relevant `package.json` dependency declaration.
2. Run `pnpm install` to regenerate `pnpm-lock.yaml`.
3. Run `pnpm typecheck`, `pnpm test`, and `pnpm build`.
4. Commit the package manifest and lockfile together.

Avoid manually editing generated lockfile resolution data. The only supported package manager for this workspace is pnpm, and the committed lockfile is required by CI’s frozen installation.

## Troubleshooting

### `pnpm` uses the wrong version

Run the Corepack commands from the installation step again:

```bash
corepack enable
corepack prepare pnpm@9.15.9 --activate
```

### `better-sqlite3` fails to install

Confirm that the active Node version is 20. On Windows, also install the Visual Studio C++ build tools before retrying the install.

If a previous install was interrupted, delete only the repository’s `node_modules` directory and rerun `pnpm install --frozen-lockfile`. Do not delete `pnpm-lock.yaml` to work around an installation issue.

### `cargo` is not recognized

Install Rust with `rustup`, restart the terminal, and verify `cargo --version`. On Windows, confirm that `%USERPROFILE%\.cargo\bin` is on `PATH`.

### Linux Tauri build fails due to WebKit or AppImage dependencies

Install the Ubuntu/Debian packages listed above. Tauri’s AppImage packaging needs `librsvg2-dev` and `patchelf` in addition to the WebKit packages.

### Tauri says it cannot find a project configuration

Run `pnpm tauri` or `pnpm tauri:build` from the repository root. Running the Tauri CLI directly inside `apps/desktop/` does not discover `src-tauri/tauri.conf.json`.

### The frontend starts but the native window does not open

Confirm `cargo --version` succeeds and that the platform prerequisites are installed. On Windows, make sure the C++ build tools and WebView2 Runtime are available. On Linux, recheck the WebKit packages.

### A Tauri bundle fails because an icon is missing

Verify these tracked assets exist:

```text
src-tauri/icons/32x32.png
src-tauri/icons/128x128.png
src-tauri/icons/128x128@2x.png
src-tauri/icons/icon.png
src-tauri/icons/icon.ico
src-tauri/icons/icon.icns
```

Then confirm that the platform-specific bundle assets are listed in `src-tauri/tauri.conf.json` under `bundle.icon`. Tauri also uses `icon.png` as the application icon source during Rust configuration generation.

### An agent is not detected

Confirm that its CLI is on `PATH`, that its provider login is complete, and then use **Detect** again from the app’s Agents page.

## Project layout

```text
src-tauri/                 Rust application, capabilities, bundle config, and icons
apps/desktop/              React and Vite desktop frontend
packages/core/             Orchestration engine and tests
packages/agents/           Adapter contract and provider adapters
packages/protocol/         Shared TypeScript types
packages/storage/          SQLite persistence
packages/security/         Command permission checks
packages/git/              Git and worktree operations
packages/codegraph/        Code-context query support
packages/testing/          Test-related workspace package
```
