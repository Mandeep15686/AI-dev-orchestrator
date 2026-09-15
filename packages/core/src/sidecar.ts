#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════
// packages/core/src/sidecar.ts
// The Node.js sidecar process spawned by Tauri at startup.
// Receives JSON-RPC requests from Rust over stdin.
// Emits orchestrator events to Tauri via stdout JSON-RPC.
// ═══════════════════════════════════════════════════════════════

import { createInterface } from 'node:readline';
import { OrchestratorCore } from './OrchestratorCore.js';
import { TypedEventBus }    from './EventBus.js';
import type { OrchestratorEvent, EventPayloadMap } from '@ai-orch/protocol';

// ─── JSON-RPC helpers ─────────────────────────────────────────

function sendResponse(id: number, result: unknown): void {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n');
}

function sendError(id: number, code: number, message: string): void {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }) + '\n');
}

function sendNotification<E extends OrchestratorEvent>(method: E, params: EventPayloadMap[E]): void {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
}

// ─── Bootstrap ────────────────────────────────────────────────

async function main() {
  const dbPath = process.env['ORCH_DB_PATH'] ?? ':memory:';
  const core   = new OrchestratorCore({
    dbPath,
    maxRetries:          3,
    verificationPolicy: 'normal',
    enableParallel:      true,
  });

  // Bridge all orchestrator events → Tauri via stdout
  const ALL_EVENTS: OrchestratorEvent[] = [
    'AGENT_SELECTED', 'AGENT_STARTED', 'AGENT_OUTPUT', 'FILE_CHANGED',
    'AGENT_STOPPED',  'AGENT_FAILED',  'AGENT_RESUMED',
    'VERIFICATION_STARTED', 'VERIFICATION_PASSED', 'VERIFICATION_FAILED',
    'CHECKPOINT_CREATED',   'HANDOFF_GENERATED',   'CONTEXT_BUILT',
    'RECOVERY_STARTED', 'RECOVERY_SWITCHING', 'RECOVERY_RETRYING', 'RECOVERY_ESCALATED',
    'TASK_STARTED',     'TASK_COMPLETED',     'TASK_FAILED',
    'WORKFLOW_STEP',    'WORKFLOW_DONE',
    'PERMISSION_REQUEST', 'PERMISSION_GRANTED', 'PERMISSION_DENIED',
    'USER_INTERVENTION',  'USER_PROMPT_NEEDED',
    'CODEGRAPH_UPDATED',  'WORKTREE_CREATED',   'WORKTREE_MERGED', 'WORKTREE_DELETED',
  ];

  for (const evt of ALL_EVENTS) {
    core.bus.on(evt as any, (payload: any) => {
      sendNotification(evt, payload);
    });
  }

  // ─── Request router ─────────────────────────────────────────

  const HANDLERS: Record<string, (params: any) => Promise<unknown>> = {

    'orchestrator/runGoal': async ({ goal, project }) => {
      // Fire-and-forget — progress comes through events
      core.runGoal(goal, project).catch(err =>
        sendNotification('TASK_FAILED', { taskId: 'unknown', reason: String(err), lastSessionId: null })
      );
      return { started: true };
    },

    'orchestrator/pause': async () => {
      core.pause();
      return { paused: true };
    },

    'orchestrator/resume': async () => {
      core.resume();
      return { resumed: true };
    },

    'orchestrator/abort': async () => {
      core.abort();
      return { aborted: true };
    },

    'orchestrator/detectAgents': async () => {
      // Return status of all registered adapters
      const adapters = (core as any).router?.getAll?.() ?? [];
      const results  = await Promise.allSettled(
        adapters.map((a: any) => a.detect().then((d: any) => ({ agentId: a.id, ...d })))
      );
      return results
        .filter(r => r.status === 'fulfilled')
        .map(r => (r as PromiseFulfilledResult<any>).value);
    },

    'orchestrator/ping': async () => ({ pong: true, ts: Date.now() }),

    'orchestrator/userResponse': async ({ sessionId, decision, answer }) => {
      // Resume after USER_PROMPT_NEEDED
      core.resume();
      return { acknowledged: true };
    },
  };

  // ─── Stdin reader ────────────────────────────────────────────

  const rl = createInterface({ input: process.stdin, terminal: false });

  rl.on('line', async (line) => {
    if (!line.trim()) return;

    let req: { jsonrpc: string; id: number; method: string; params: unknown };
    try {
      req = JSON.parse(line);
    } catch {
      sendError(0, -32700, 'Parse error');
      return;
    }

    const handler = HANDLERS[req.method];
    if (!handler) {
      sendError(req.id, -32601, `Method not found: ${req.method}`);
      return;
    }

    try {
      const result = await handler(req.params);
      sendResponse(req.id, result);
    } catch (err) {
      sendError(req.id, -32000, String(err));
    }
  });

  rl.on('close', () => {
    // Tauri closed the pipe — clean up and exit
    process.exit(0);
  });

  // Signal ready
  sendNotification('AGENT_OUTPUT', {
    sessionId: 'sidecar', chunk: '[Orchestrator sidecar ready]',
    isError: false, timestamp: new Date().toISOString(),
  } as any);
}

main().catch(err => {
  process.stderr.write(`[sidecar] Fatal: ${err}\n`);
  process.exit(1);
});
