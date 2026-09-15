// ═══════════════════════════════════════════════════════════════
// packages/agents/gemini/src/GeminiAdapter.ts
// Adapter for Google Gemini via REST API
// Best for: research, testing strategy, documentation
// ═══════════════════════════════════════════════════════════════

import { BaseAgentAdapter } from '../../shared/src/AgentAdapter.js';
import type {
  AgentCapabilities, AgentDetectionResult, AgentSession,
  AgentEvent, Task, ContextPackage, SessionOptions, StopReason,
} from '@ai-orch/protocol';

const MODEL   = 'gemini-2.0-flash-exp';
const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:streamGenerateContent`;

const SESSION_STATE = new Map<string, { task: Task; outputs: string[] }>();

export class GeminiAdapter extends BaseAgentAdapter {
  readonly id = 'gemini' as const;

  readonly capabilities: AgentCapabilities = {
    interfaces:        ['rest'],
    strengths:         ['research', 'documentation', 'testing-strategy', 'architecture-review'],
    weaknesses:        ['file-level-editing', 'terminal-operations', 'large-codebases'],
    bestFor:           ['testing', 'documentation', 'review'],
    languages:         ['typescript', 'javascript', 'python', 'go', 'java'],
    supportsParallel:  false,
    supportsResume:    false,
    supportsStreaming: true,
    supportsWorktrees: false,
    maxContextTokens:  1_000_000,
  };

  async detect(): Promise<AgentDetectionResult> {
    const apiKey = process.env['GEMINI_API_KEY'];
    if (!apiKey) {
      return { available: false, version: null, cliPath: null, authStatus: 'not_authenticated', status: 'unavailable' };
    }
    try {
      const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`, { signal: AbortSignal.timeout(5000) });
      return {
        available:  resp.ok,
        version:    MODEL,
        cliPath:    null,
        authStatus: resp.ok ? 'authenticated' : 'not_authenticated',
        status:     resp.ok ? 'available' : 'unavailable',
      };
    } catch {
      return { available: false, version: null, cliPath: null, authStatus: 'unknown', status: 'unavailable' };
    }
  }

  async startSession(task: Task, ctx: ContextPackage, _opts: SessionOptions): Promise<AgentSession> {
    const id = `gemini-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    SESSION_STATE.set(id, { task, outputs: [] });
    return {
      id, agentId: 'gemini', taskId: task.id,
      pid: null, worktree: null,
      startedAt: new Date().toISOString(),
      status: 'running', tokensUsed: 0,
    };
  }

  async resumeSession(session: AgentSession, _ctx: ContextPackage): Promise<AgentSession> {
    return { ...session, status: 'running' };
  }

  async sendPrompt(_session: AgentSession, _prompt: string): Promise<void> {}

  async *streamEvents(session: AgentSession): AsyncGenerator<AgentEvent> {
    const state  = SESSION_STATE.get(session.id);
    if (!state) throw new Error('Session not found');
    const apiKey = process.env['GEMINI_API_KEY'];
    if (!apiKey) throw new Error('GEMINI_API_KEY not set');

    const prompt = this.buildSystemPrompt(state.task, {
      task: state.task,
      project: {} as never, gitContext: {} as never,
      codeContext: { symbols: [], dependencies: [], callPaths: [] },
      handoffHistory: [], testStatus: null, tokenEstimate: 0,
    });

    const body = {
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: 8192, temperature: 0.2 },
    };

    const resp = await fetch(`${API_URL}?key=${apiKey}&alt=sse`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!resp.body) {
      yield { type: 'error', sessionId: session.id, timestamp: new Date().toISOString(), data: { raw: 'No response body' } };
      return;
    }

    const reader  = resp.body.getReader();
    const decoder = new TextDecoder();
    let   buffer  = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        try {
          const data = JSON.parse(line.slice(6));
          const text = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
          if (text) {
            state.outputs.push(text);
            yield { type: 'output', sessionId: session.id, timestamp: new Date().toISOString(), data: { raw: text } };
          }
        } catch { /* skip malformed */ }
      }
    }
    SESSION_STATE.delete(session.id);
  }

  async waitForStop(session: AgentSession): Promise<StopReason> {
    // Gemini is synchronous per call — always completes
    return 'COMPLETED';
  }

  async stop(session: AgentSession): Promise<void> {
    SESSION_STATE.delete(session.id);
  }
}
