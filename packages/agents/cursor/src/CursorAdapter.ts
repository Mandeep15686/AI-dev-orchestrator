// ═══════════════════════════════════════════════════════════════
// packages/agents/cursor/src/CursorAdapter.ts
// Adapter for Cursor agent via CLI + ACP (Agent Client Protocol)
// Best for: frontend, UI components, interactive editing
// ═══════════════════════════════════════════════════════════════

import { spawn, type ChildProcess } from 'node:child_process';
import { which } from 'which';
import { BaseAgentAdapter } from '@ai-orch/agent-shared';
import type {
  AgentCapabilities, AgentDetectionResult, AgentSession,
  AgentEvent, Task, ContextPackage, SessionOptions, StopReason,
} from '@ai-orch/protocol';

const SESSION_MAP = new Map<string, { proc: ChildProcess; sessionKey: string }>();

export class CursorAdapter extends BaseAgentAdapter {
  readonly id = 'cursor' as const;

  readonly capabilities: AgentCapabilities = {
    interfaces:        ['cli', 'acp'],
    strengths:         ['frontend', 'UI', 'styling', 'autocomplete', 'interactive-editing'],
    weaknesses:        ['deep-backend-logic', 'security-analysis'],
    bestFor:           ['frontend', 'refactor', 'general'],
    languages:         ['typescript', 'javascript', 'tsx', 'jsx', 'css', 'html'],
    supportsParallel:  true,
    supportsResume:    true,  // ACP session reconnect
    supportsStreaming: true,
    supportsWorktrees: true,
    maxContextTokens:  200_000,
  };

  async detect(): Promise<AgentDetectionResult> {
    try {
      const cliPath = await which('cursor').catch(() => null);
      if (!cliPath) return { available: false, version: null, cliPath: null, authStatus: 'unknown', status: 'unavailable' };
      const { execSync } = await import('node:child_process');
      const version = execSync('cursor --version', { encoding: 'utf8', timeout: 5000 }).trim();
      return { available: true, version, cliPath, authStatus: 'authenticated', status: 'available' };
    } catch (err) {
      return { available: false, version: null, cliPath: null, authStatus: 'unknown', status: 'unavailable', error: String(err) };
    }
  }

  async startSession(task: Task, ctx: ContextPackage, opts: SessionOptions): Promise<AgentSession> {
    const id       = `cursor-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const prompt   = this.buildSystemPrompt(task, ctx);
    const worktree = opts.worktree ?? ctx.project.path;

    // Cursor supports ACP: send init message as JSON-RPC
    const initMsg = JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'session/init',
      params: { project: worktree, prompt, mode: 'agent', stream: true },
    });

    const proc = spawn('cursor', ['--headless', '--acp'], {
      cwd:   worktree,
      env:   { ...process.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    proc.stdin?.write(initMsg + '\n');
    const sessionKey = `orch-${id}`;
    SESSION_MAP.set(id, { proc, sessionKey });

    return {
      id, agentId: 'cursor', taskId: task.id,
      pid:       proc.pid ?? null,
      worktree:  opts.worktree,
      startedAt: new Date().toISOString(),
      status:    'running',
      tokensUsed: 0,
    };
  }

  async resumeSession(session: AgentSession, ctx: ContextPackage): Promise<AgentSession> {
    const entry = SESSION_MAP.get(session.id);
    if (entry && !entry.proc.killed) {
      const msg = JSON.stringify({
        jsonrpc: '2.0', id: 2, method: 'session/continue',
        params: { sessionKey: entry.sessionKey, context: ctx.handoffHistory.at(-1) },
      });
      entry.proc.stdin?.write(msg + '\n');
      return { ...session, status: 'running' };
    }
    // Session dead — fresh start
    const task: Task = {
      id: session.taskId, masterId: '', name: 'Resume', description: '',
      type: 'frontend', dependencies: [], agentHint: null,
      priority: 2, status: 'running', createdAt: new Date().toISOString(),
    };
    return this.startSession(task, ctx, { worktree: session.worktree, maxTokens: 80_000, timeoutMs: 20 * 60_000, resumeMode: true });
  }

  async sendPrompt(session: AgentSession, prompt: string): Promise<void> {
    const entry = SESSION_MAP.get(session.id);
    if (!entry) throw new Error('No session: ' + session.id);
    const msg = JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method: 'session/message', params: { text: prompt } });
    entry.proc.stdin?.write(msg + '\n');
  }

  async *streamEvents(session: AgentSession): AsyncGenerator<AgentEvent> {
    const entry = SESSION_MAP.get(session.id);
    if (!entry) throw new Error('No process: ' + session.id);

    let buffer = '';
    for await (const chunk of entry.proc.stdout!) {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          // Parse ACP JSON-RPC event
          const ev  = JSON.parse(line) as { method?: string; params?: Record<string, unknown> };
          const method = ev.method ?? 'output';
          const text   = String(ev.params?.['text'] ?? ev.params?.['content'] ?? '');
          if (method === 'file/changed') {
            yield { type: 'file_changed', sessionId: session.id, timestamp: new Date().toISOString(),
              data: { path: ev.params?.['path'] ?? '', changeType: ev.params?.['changeType'] ?? 'modified' } };
          } else if (text) {
            const stop = this.detectStopSignal(text);
            yield { type: stop ? 'stop' : 'output', sessionId: session.id, timestamp: new Date().toISOString(), data: { raw: text } };
          }
        } catch {
          // Plain text output
          yield { type: 'output', sessionId: session.id, timestamp: new Date().toISOString(), data: { raw: line } };
        }
      }
    }
  }

  async waitForStop(session: AgentSession): Promise<StopReason> {
    return new Promise(resolve => {
      const entry = SESSION_MAP.get(session.id);
      if (!entry) { resolve('CRASH'); return; }
      const timer = setTimeout(() => resolve('STUCK'), 5 * 60_000);
      entry.proc.on('close', code => {
        clearTimeout(timer);
        resolve(code === 0 ? 'COMPLETED' : 'CRASH');
      });
    });
  }

  async stop(session: AgentSession): Promise<void> {
    const entry = SESSION_MAP.get(session.id);
    if (!entry) return;
    // Send graceful shutdown via ACP
    try { entry.proc.stdin?.write(JSON.stringify({ jsonrpc: '2.0', id: 99, method: 'session/stop', params: {} }) + '\n'); } catch {}
    await new Promise(r => setTimeout(r, 3000));
    if (!entry.proc.killed) entry.proc.kill('SIGTERM');
    SESSION_MAP.delete(session.id);
  }
}
