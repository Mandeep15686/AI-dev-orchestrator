// ═══════════════════════════════════════════════════════════════
// packages/agents/claude/src/ClaudeAdapter.ts
// Adapter for Anthropic Claude Code CLI + SDK
// ═══════════════════════════════════════════════════════════════

import { spawn, type ChildProcess } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { which } from 'which';
import { BaseAgentAdapter } from '../../shared/src/AgentAdapter.js';
import type {
  AgentCapabilities, AgentDetectionResult, AgentSession,
  AgentEvent, Task, ContextPackage, SessionOptions, StopReason,
} from '@ai-orch/protocol';

const SESSION_MAP = new Map<string, ChildProcess>();

export class ClaudeAdapter extends BaseAgentAdapter {
  readonly id = 'claude' as const;

  readonly capabilities: AgentCapabilities = {
    interfaces:        ['cli', 'sdk'],
    strengths:         ['reasoning', 'architecture', 'code-review', 'testing', 'debugging', 'documentation'],
    weaknesses:        ['frontend-styling', 'very-large-diffs'],
    bestFor:           ['backend', 'review', 'debug', 'testing', 'documentation', 'refactor', 'security'],
    languages:         ['typescript', 'javascript', 'python', 'rust', 'go', 'java', 'c++'],
    supportsParallel:  true,
    supportsResume:    true,   // claude --continue
    supportsStreaming: true,
    supportsWorktrees: true,
    maxContextTokens:  200_000,
  };

  async detect(): Promise<AgentDetectionResult> {
    try {
      const cliPath = await which('claude').catch(() => null);
      if (!cliPath) {
        return { available: false, version: null, cliPath: null, authStatus: 'unknown', status: 'unavailable' };
      }
      const { execSync } = await import('node:child_process');
      const version = execSync('claude --version', { encoding: 'utf8', timeout: 5000 }).trim();
      const authRaw = execSync('claude auth status 2>&1', { encoding: 'utf8', timeout: 5000 });
      const authenticated = /authenticated|logged in/i.test(authRaw);
      return {
        available:  true,
        version,
        cliPath,
        authStatus: authenticated ? 'authenticated' : 'not_authenticated',
        status:     authenticated ? 'available' : 'unavailable',
      };
    } catch (err) {
      return {
        available: false, version: null, cliPath: null,
        authStatus: 'unknown', status: 'unavailable',
        error: String(err),
      };
    }
  }

  async startSession(task: Task, ctx: ContextPackage, opts: SessionOptions): Promise<AgentSession> {
    const id        = `claude-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const prompt    = this.buildSystemPrompt(task, ctx);
    const worktree  = opts.worktree ?? ctx.project.path;

    const args = [
      '--non-interactive',
      '--output-format', 'stream-json',
      '--max-turns', '50',
    ];
    if (opts.resumeMode) args.push('--continue');

    const proc = spawn('claude', args, {
      cwd:   worktree,
      env:   { ...process.env, CLAUDE_API_KEY: process.env['CLAUDE_API_KEY'] ?? '' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // Send task prompt to stdin
    proc.stdin?.write(prompt + '\n');

    SESSION_MAP.set(id, proc);

    return {
      id, agentId: 'claude', taskId: task.id,
      pid:      proc.pid ?? null,
      worktree: opts.worktree,
      startedAt: new Date().toISOString(),
      status:   'running',
      tokensUsed: 0,
    };
  }

  async resumeSession(session: AgentSession, ctx: ContextPackage): Promise<AgentSession> {
    const proc = SESSION_MAP.get(session.id);
    if (proc && !proc.killed) {
      const continuationPrompt = `\nContinue from where you left off. Recent handoff context:\n${JSON.stringify(ctx.handoffHistory.at(-1), null, 2)}\n`;
      proc.stdin?.write(continuationPrompt + '\n');
      return { ...session, status: 'running' };
    }
    // Session dead — start fresh with resume flag
    return this.startSession(
      { id: session.taskId, masterId: '', name: 'Resume', description: '', type: 'general', dependencies: [], agentHint: null, priority: 2, status: 'running', createdAt: new Date().toISOString() },
      ctx,
      { worktree: session.worktree, maxTokens: 100_000, timeoutMs: 30 * 60_000, resumeMode: true },
    );
  }

  async sendPrompt(session: AgentSession, prompt: string): Promise<void> {
    const proc = SESSION_MAP.get(session.id);
    if (!proc?.stdin) throw new Error('Session not found or stdin closed');
    proc.stdin.write(prompt + '\n');
  }

  async *streamEvents(session: AgentSession): AsyncGenerator<AgentEvent> {
    const proc = SESSION_MAP.get(session.id);
    if (!proc) throw new Error(`No process for session ${session.id}`);

    let buffer = '';
    for await (const chunk of proc.stdout!) {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (!line.trim()) continue;

        // Try parse as stream-json event
        try {
          const ev = JSON.parse(line) as { type: string; content?: string };
          yield {
            type:      ev.type === 'content' ? 'output' : 'progress',
            sessionId: session.id,
            timestamp: new Date().toISOString(),
            data:      { raw: ev.content ?? line },
          };
        } catch {
          yield {
            type:      'output',
            sessionId: session.id,
            timestamp: new Date().toISOString(),
            data:      { raw: line },
          };
        }
      }
    }
  }

  async waitForStop(session: AgentSession): Promise<StopReason> {
    return new Promise((resolve) => {
      const proc = SESSION_MAP.get(session.id);
      if (!proc) { resolve('CRASH'); return; }

      const stuckTimer = setTimeout(() => resolve('STUCK'), 5 * 60_000);
      let lastActivity = Date.now();
      let completedDetected = false;

      proc.stdout?.on('data', (chunk: Buffer) => {
        lastActivity = Date.now();
        const text = chunk.toString();
        const stopReason = this.detectStopSignal(text);
        if (stopReason) {
          completedDetected = true;
          clearTimeout(stuckTimer);
          resolve(stopReason);
        }
      });

      proc.on('close', (code) => {
        clearTimeout(stuckTimer);
        if (completedDetected) return;
        if (code === 0) resolve('COMPLETED');
        else if (code === 1) resolve('RATE_LIMITED');
        else resolve('CRASH');
      });

      proc.on('error', () => {
        clearTimeout(stuckTimer);
        resolve('CRASH');
      });
    });
  }

  async stop(session: AgentSession): Promise<void> {
    const proc = SESSION_MAP.get(session.id);
    if (!proc) return;
    proc.kill('SIGTERM');
    await new Promise(r => setTimeout(r, 5000));
    if (!proc.killed) proc.kill('SIGKILL');
    SESSION_MAP.delete(session.id);
  }
}
