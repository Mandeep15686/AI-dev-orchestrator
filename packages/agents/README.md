# Adding a New Agent Adapter

This guide walks you through creating a new adapter so the orchestrator can use a new AI coding agent.

---

## 1. Create the package

```bash
mkdir -p packages/agents/myagent/src
```

Create `packages/agents/myagent/package.json`:
```json
{
  "name": "@ai-orch/agent-myagent",
  "version": "0.1.0",
  "type": "module",
  "main": "./dist/index.js",
  "exports": { ".": "./dist/index.js" },
  "scripts": { "build": "tsc", "dev": "tsc --watch" },
  "dependencies": { "@ai-orch/protocol": "workspace:*" },
  "devDependencies": { "typescript": "^5.4.0" }
}
```

Create `packages/agents/myagent/tsconfig.json`:
```json
{
  "extends": "../../../../tsconfig.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src",
    "composite": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

---

## 2. Implement AgentAdapter

Create `packages/agents/myagent/src/MyAgentAdapter.ts`:

```typescript
import { spawn } from 'node:child_process';
import { BaseAgentAdapter } from '../../shared/src/AgentAdapter.js';
import type {
  AgentCapabilities, AgentDetectionResult, AgentSession,
  AgentEvent, Task, ContextPackage, SessionOptions, StopReason,
} from '@ai-orch/protocol';

const SESSIONS = new Map<string, ReturnType<typeof spawn>>();

export class MyAgentAdapter extends BaseAgentAdapter {
  readonly id = 'myagent';

  readonly capabilities: AgentCapabilities = {
    // ✅ Fill these in accurately — the router uses them for scoring
    interfaces:        ['cli'],
    strengths:         ['frontend', 'styling'],
    weaknesses:        ['deep-backend-logic'],
    bestFor:           ['frontend', 'refactor'],
    languages:         ['typescript', 'javascript', 'css'],
    supportsParallel:  true,
    supportsResume:    false,   // ← set true only if your agent supports it
    supportsStreaming: true,
    supportsWorktrees: true,
    maxContextTokens:  128_000,
  };

  async detect(): Promise<AgentDetectionResult> {
    // Check if the CLI is installed and authenticated
    try {
      const { execSync } = await import('node:child_process');
      const version = execSync('myagent --version', { encoding: 'utf8', timeout: 5000 }).trim();
      return { available: true, version, cliPath: '/usr/local/bin/myagent', authStatus: 'authenticated', status: 'available' };
    } catch {
      return { available: false, version: null, cliPath: null, authStatus: 'unknown', status: 'unavailable' };
    }
  }

  async startSession(task: Task, ctx: ContextPackage, opts: SessionOptions): Promise<AgentSession> {
    const id      = `myagent-${Date.now()}`;
    const prompt  = this.buildSystemPrompt(task, ctx); // ← inherited from BaseAgentAdapter
    const workdir = opts.worktree ?? ctx.project.path;

    // Spawn the agent CLI
    const proc = spawn('myagent', ['--headless', '--stdin'], {
      cwd:   workdir,
      env:   { ...process.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    proc.stdin?.write(prompt + '\n');
    SESSIONS.set(id, proc);

    return { id, agentId: 'myagent', taskId: task.id, pid: proc.pid ?? null, worktree: opts.worktree, startedAt: new Date().toISOString(), status: 'running', tokensUsed: 0 };
  }

  async resumeSession(session: AgentSession, ctx: ContextPackage): Promise<AgentSession> {
    // If not supported, just start a new session
    return this.startSession({ id: session.taskId } as Task, ctx, { worktree: session.worktree, maxTokens: 80_000, timeoutMs: 30 * 60_000, resumeMode: false });
  }

  async sendPrompt(session: AgentSession, prompt: string): Promise<void> {
    SESSIONS.get(session.id)?.stdin?.write(prompt + '\n');
  }

  async *streamEvents(session: AgentSession): AsyncGenerator<AgentEvent> {
    const proc = SESSIONS.get(session.id);
    if (!proc) return;

    for await (const chunk of proc.stdout!) {
      const line = chunk.toString().trim();
      if (!line) continue;

      const fileChange = this.detectFileChange(line, session.id); // ← inherited
      yield {
        type:      fileChange ? 'file_changed' : 'output',
        sessionId: session.id,
        timestamp: new Date().toISOString(),
        data:      fileChange ? { ...fileChange } : { raw: line },
      };
    }
  }

  async waitForStop(session: AgentSession): Promise<StopReason> {
    return new Promise(resolve => {
      const proc = SESSIONS.get(session.id);
      if (!proc) { resolve('CRASH'); return; }

      let output = '';
      proc.stdout?.on('data', (d: Buffer) => {
        output += d.toString();
        const sig = this.detectStopSignal(output); // ← inherited
        if (sig) resolve(sig);
      });

      proc.on('close', code => resolve(code === 0 ? 'COMPLETED' : 'CRASH'));
    });
  }

  async stop(session: AgentSession): Promise<void> {
    const proc = SESSIONS.get(session.id);
    if (!proc) return;
    proc.kill('SIGTERM');
    await new Promise(r => setTimeout(r, 3000));
    if (!proc.killed) proc.kill('SIGKILL');
    SESSIONS.delete(session.id);
  }
}
```

---

## 3. Export it

`packages/agents/myagent/src/index.ts`:
```typescript
export { MyAgentAdapter } from './MyAgentAdapter.js';
```

---

## 4. Register in OrchestratorCore

Add one line to `packages/core/src/OrchestratorCore.ts`:

```typescript
import { MyAgentAdapter } from '../agents/myagent/src/MyAgentAdapter.js';

// In registerAdapters():
private registerAdapters(): void {
  this.router.registerAdapter(new ClaudeAdapter());
  this.router.registerAdapter(new CodexAdapter());
  this.router.registerAdapter(new GeminiAdapter());
  this.router.registerAdapter(new MyAgentAdapter()); // ← add this
}
```

---

## 5. Add to capability registry comment

Update `AgentRouter.ts` capabilities comment so the router documentation stays current.

---

## 6. Build and test

```bash
pnpm build
pnpm --filter @ai-orch/core test
```

Open the app → **Agents** tab → your agent should appear with a **Detect** button.

---

## Checklist

- [ ] `capabilities.bestFor` accurately lists task types this agent excels at
- [ ] `detect()` returns `available: false` gracefully when CLI is missing
- [ ] `streamEvents()` yields `file_changed` events so the UI shows file activity
- [ ] `waitForStop()` recognises `TASK_COMPLETED` and `RATE_LIMITED` signals
- [ ] `stop()` sends SIGTERM, waits 3–5s, then SIGKILL — never leaves zombies
- [ ] Package is listed in `packages/agents/` and exported from `src/index.ts`
- [ ] Adapter is registered in `OrchestratorCore.registerAdapters()`
- [ ] At least one unit test exists in `src/__tests__/`
