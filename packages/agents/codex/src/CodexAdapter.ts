// ═══════════════════════════════════════════════════════════════
// packages/agents/codex/src/CodexAdapter.ts
// Adapter for OpenAI Codex CLI + ACP protocol
// ═══════════════════════════════════════════════════════════════

import { spawn, type ChildProcess } from 'node:child_process';
import { which } from 'which';
import { BaseAgentAdapter } from '@ai-orch/agent-shared';
import type {
  AgentCapabilities, AgentDetectionResult, AgentSession,
  AgentEvent, Task, ContextPackage, SessionOptions, StopReason,
} from '@ai-orch/protocol';

const SESSION_MAP = new Map<string, ChildProcess>();

export class CodexAdapter extends BaseAgentAdapter {
  readonly id = 'codex' as const;

  readonly capabilities: AgentCapabilities = {
    interfaces:        ['cli', 'acp'],
    strengths:         ['implementation', 'debugging', 'refactoring', 'algorithms'],
    weaknesses:        ['large-context-reasoning', 'architecture-design'],
    bestFor:           ['backend', 'database', 'refactor', 'debug', 'general'],
    languages:         ['typescript', 'javascript', 'python', 'go', 'rust'],
    supportsParallel:  true,
    supportsResume:    false,
    supportsStreaming: true,
    supportsWorktrees: true,
    maxContextTokens:  128_000,
  };

  async detect(): Promise<AgentDetectionResult> {
    try {
      const cliPath = await which('codex').catch(() => null);
      if (!cliPath) return { available: false, version: null, cliPath: null, authStatus: 'unknown', status: 'unavailable' };
      const { execSync } = await import('node:child_process');
      const version = execSync('codex --version', { encoding: 'utf8', timeout: 5000 }).trim();
      return { available: true, version, cliPath, authStatus: 'authenticated', status: 'available' };
    } catch (err) {
      return { available: false, version: null, cliPath: null, authStatus: 'unknown', status: 'unavailable', error: String(err) };
    }
  }

  async startSession(task: Task, ctx: ContextPackage, opts: SessionOptions): Promise<AgentSession> {
    const id       = `codex-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const prompt   = this.buildSystemPrompt(task, ctx);
    const worktree = opts.worktree ?? ctx.project.path;

    const proc = spawn('codex', ['--full-auto', '--quiet'], {
      cwd:   worktree,
      env:   { ...process.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    proc.stdin?.write(prompt);
    proc.stdin?.end();

    SESSION_MAP.set(id, proc);

    return {
      id, agentId: 'codex', taskId: task.id,
      pid:       proc.pid ?? null,
      worktree:  opts.worktree,
      startedAt: new Date().toISOString(),
      status:    'running',
      tokensUsed: 0,
    };
  }

  async resumeSession(session: AgentSession, ctx: ContextPackage): Promise<AgentSession> {
    // Codex doesn't support session resume — start fresh
    const task: Task = {
      id: session.taskId, masterId: '', name: 'Resume', description: '',
      type: 'general', dependencies: [], agentHint: null,
      priority: 2, status: 'running', createdAt: new Date().toISOString(),
    };
    return this.startSession(task, ctx, { worktree: session.worktree, maxTokens: 80_000, timeoutMs: 30 * 60_000, resumeMode: false });
  }

  async sendPrompt(session: AgentSession, prompt: string): Promise<void> {
    const proc = SESSION_MAP.get(session.id);
    if (!proc?.stdin) throw new Error('Stdin not available for codex session');
    proc.stdin.write('\n' + prompt + '\n');
  }

  async *streamEvents(session: AgentSession): AsyncGenerator<AgentEvent> {
    const proc = SESSION_MAP.get(session.id);
    if (!proc) throw new Error(`No process for ${session.id}`);

    for await (const chunk of proc.stdout!) {
      const lines = chunk.toString().split('\n');
      for (const line of lines) {
        if (!line.trim()) continue;
        const fileChg = this.detectFileChange(line, session.id);
        yield {
          type:      fileChg ? 'file_changed' : 'output',
          sessionId: session.id,
          timestamp: new Date().toISOString(),
          data:      fileChg ? { ...fileChg } : { raw: line },
        };
      }
    }
  }

  async waitForStop(session: AgentSession): Promise<StopReason> {
    return new Promise((resolve) => {
      const proc = SESSION_MAP.get(session.id);
      if (!proc) { resolve('CRASH'); return; }
      const stuckTimer = setTimeout(() => resolve('STUCK'), 5 * 60_000);
      proc.on('close', (code) => {
        clearTimeout(stuckTimer);
        resolve(code === 0 ? 'COMPLETED' : code === 130 ? 'USER_STOPPED' : 'CRASH');
      });
    });
  }

  async stop(session: AgentSession): Promise<void> {
    const proc = SESSION_MAP.get(session.id);
    if (!proc) return;
    proc.kill('SIGTERM');
    await new Promise(r => setTimeout(r, 3000));
    if (!proc.killed) proc.kill('SIGKILL');
    SESSION_MAP.delete(session.id);
  }
}
