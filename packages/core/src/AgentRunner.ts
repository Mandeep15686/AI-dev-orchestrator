// ═══════════════════════════════════════════════════════════════
// packages/core/src/AgentRunner.ts
// Manages a single agent session end-to-end:
// start → stream → detect stop → return result
// ═══════════════════════════════════════════════════════════════

import type {
  Task, AgentSession, AgentId, StopReason,
  ContextPackage, SessionOptions,
} from '@ai-orch/protocol';
import type { AgentAdapter } from '../agents/shared/src/AgentAdapter.js';
import type { TypedEventBus } from './EventBus.js';
import type { Database }      from '../storage/Database.js';
import type { PermissionManager } from '../security/PermissionManager.js';

export interface RunResult {
  session:     AgentSession;
  stopReason:  StopReason;
  outputLines: string[];
  durationMs:  number;
  filesChanged: string[];
}

export class AgentRunner {
  constructor(
    private eventBus:   TypedEventBus,
    private db:         Database,
    private permissions: PermissionManager,
  ) {}

  async run(
    adapter:   AgentAdapter,
    task:      Task,
    ctx:       ContextPackage,
    opts:      SessionOptions = {
      worktree: null, maxTokens: 80_000,
      timeoutMs: 30 * 60_000, resumeMode: false,
    },
  ): Promise<RunResult> {
    const start   = Date.now();
    const dbRunId = await this.db.insertAgentSession({
      agentId:      adapter.id,
      taskId:       task.id,
      worktreePath: opts.worktree,
      status:       'starting',
      git_before:   ctx.gitContext.commit,
    });

    // Start session
    const session = await adapter.startSession(task, ctx, opts);
    await this.db.updateAgentSession(dbRunId, { pid: session.pid, status: 'running' });

    this.eventBus.emit('AGENT_STARTED', {
      sessionId: session.id,
      agentId:   adapter.id,
      taskId:    task.id,
      worktree:  opts.worktree,
      pid:       session.pid ?? 0,
    });

    // Stream events
    const outputLines: string[] = [];
    const filesChanged: string[] = [];
    let tokensUsed = 0;

    const streamTimeout = setTimeout(async () => {
      await adapter.stop(session);
    }, opts.timeoutMs);

    try {
      for await (const event of adapter.streamEvents(session)) {
        clearTimeout(streamTimeout);

        switch (event.type) {
          case 'output': {
            const line = String(event.data['raw'] ?? '');
            outputLines.push(line);
            tokensUsed += Math.ceil(line.length / 4);
            this.eventBus.emit('AGENT_OUTPUT', {
              sessionId: session.id,
              chunk:     line,
              isError:   false,
              timestamp: event.timestamp,
            });
            break;
          }
          case 'file_changed': {
            const path       = String(event.data['path'] ?? '');
            const changeType = (event.data['changeType'] as 'added' | 'modified' | 'deleted') ?? 'modified';
            if (path && !filesChanged.includes(path)) filesChanged.push(path);
            this.eventBus.emit('FILE_CHANGED', { sessionId: session.id, path, changeType });
            break;
          }
          case 'error': {
            this.eventBus.emit('AGENT_OUTPUT', {
              sessionId: session.id,
              chunk:     String(event.data['raw'] ?? ''),
              isError:   true,
              timestamp: event.timestamp,
            });
            break;
          }
        }

        // Check token budget
        if (tokensUsed >= opts.maxTokens) {
          await adapter.stop(session);
          break;
        }
      }
    } finally {
      clearTimeout(streamTimeout);
    }

    const stopReason = await adapter.waitForStop(session).catch((): StopReason => 'CRASH');
    const durationMs = Date.now() - start;

    await this.db.updateAgentSession(dbRunId, {
      status:      'stopped',
      exit_reason: stopReason,
      ended_at:    new Date().toISOString(),
      tokens_used: tokensUsed,
    });

    this.eventBus.emit('AGENT_STOPPED', {
      sessionId:  session.id,
      reason:     stopReason,
      duration:   durationMs,
      tokensUsed,
    });

    return { session, stopReason, outputLines, durationMs, filesChanged };
  }

  async abort(session: AgentSession, adapter: AgentAdapter): Promise<void> {
    await adapter.stop(session);
    this.eventBus.emit('AGENT_STOPPED', {
      sessionId:  session.id,
      reason:     'USER_STOPPED',
      duration:   0,
      tokensUsed: 0,
    });
  }
}
