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

## Clone and install

```bash
git clone https://github.com/Mandeep15686/AI-dev-orchestrator.git ai-dev-orchestrator
cd ai-dev-orchestrator

corepack enable
corepack prepare pnpm@9.15.9 --activate
pnpm install --frozen-lockfile
```

Use `pnpm install` without `--frozen-lockfile` only when you intentionally change dependencies and will update `pnpm-lock.yaml`.

## Platform prerequisites

### Windows (native)

Native Windows is the recommended environment for building the Windows desktop application.

1. Install Node.js 20 LTS, Git, and Rust stable.
2. Install Visual Studio Build Tools with the **Desktop development with C++** workload and the MSVC build tools.
3. Ensure Microsoft Edge WebView2 Runtime is installed (it is included with current Windows installations).
4. Open a new PowerShell window after installing Rust so `cargo --version` succeeds.

WSL can build TypeScript packages, but it does not produce a normal native Windows Tauri application without additional GUI and cross-compilation setup.

### macOS

```bash
xcode-select --install
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

Restart the terminal after installing Rust, then verify `cargo --version`.

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

## Verify the checkout

```bash
node --version
pnpm --version
cargo --version

pnpm typecheck
pnpm test
pnpm build
```

Run a focused test suite when iterating:

```bash
pnpm test:core
pnpm test:security
pnpm --filter @ai-orch/core exec vitest run src/__tests__/AgentRouter.test.ts
```

## Run the desktop app

```bash
pnpm tauri
```

This command invokes Tauri from the repository root, where it discovers `src-tauri/tauri.conf.json`. Tauri starts the configured development command and opens the desktop app with hot reload.

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

## Configure agents

1. Start the desktop app.
2. Open **Agents**.
3. Enter the provider credential where required, save it, then select **Detect**.
4. Ensure the corresponding CLI is installed and authenticated when that adapter uses a CLI.

The application stores credentials in the OS keychain. Environment variables are useful only for development or direct adapter testing:

```bash
ANTHROPIC_API_KEY=...
OPENAI_API_KEY=...
GEMINI_API_KEY=...
CURSOR_API_KEY=...
```

Never commit real credentials, `.env` files containing credentials, or generated application databases.

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

## Troubleshooting

### `pnpm` uses the wrong version

Run the Corepack commands from the installation step again:

```bash
corepack enable
corepack prepare pnpm@9.15.9 --activate
```

### `better-sqlite3` fails to install

Confirm that the active Node version is 20. On Windows, also install the Visual Studio C++ build tools before retrying the install.

### `cargo` is not recognized

Install Rust with `rustup`, restart the terminal, and verify `cargo --version`. On Windows, confirm that `%USERPROFILE%\.cargo\bin` is on `PATH`.

### Linux Tauri build fails due to WebKit or AppImage dependencies

Install the Ubuntu/Debian packages listed above. Tauri’s AppImage packaging needs `librsvg2-dev` and `patchelf` in addition to the WebKit packages.

### Tauri says it cannot find a project configuration

Run `pnpm tauri` or `pnpm tauri:build` from the repository root. Running the Tauri CLI directly inside `apps/desktop/` does not discover `src-tauri/tauri.conf.json`.

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
