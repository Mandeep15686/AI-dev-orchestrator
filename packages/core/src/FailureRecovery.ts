// ═══════════════════════════════════════════════════════════════
// packages/core/src/FailureRecovery.ts
// Maps every StopReason → RecoveryStrategy and executes it.
// Enforces max-retry limits and escalates to user when needed.
// ═══════════════════════════════════════════════════════════════

import type {
  StopReason, RecoveryAction, RecoveryStrategy,
  AgentId, TaskId, SessionId, VerificationResult, Task, AgentSession,
} from '@ai-orch/protocol';
import type { TypedEventBus }  from './EventBus.js';
import type { AgentRouter }    from './AgentRouter.js';
import type { Database }       from '../storage/Database.js';

interface RecoveryContext {
  task:          Task;
  session:       AgentSession;
  stopReason:    StopReason;
  attempt:       number;
  maxAttempts:   number;
  lastVerification: VerificationResult | null;
  failedAgents:  Set<AgentId>;
}

export class FailureRecovery {
  constructor(
    private eventBus: TypedEventBus,
    private router:   AgentRouter,
    private db:       Database,
  ) {}

  /**
   * Decide the recovery strategy for a given stop condition.
   * Returns a typed RecoveryAction for the orchestrator to execute.
   */
  async handleExitReason(ctx: RecoveryContext): Promise<RecoveryAction> {
    const { task, session, stopReason, attempt, maxAttempts, failedAgents } = ctx;

    this.eventBus.emit('RECOVERY_STARTED', {
      sessionId:   session.id,
      reason:      stopReason,
      attempt,
      maxAttempts,
    });

    switch (stopReason) {
      case 'COMPLETED':
        // Should not reach here — handled by main loop
        return this.action('SKIP_TASK', attempt, maxAttempts);

      case 'RATE_LIMITED':
      case 'TOKEN_LIMIT':
        return await this.handleRateLimit(task, session, attempt, maxAttempts, failedAgents);

      case 'TEST_FAILURE':
        return this.handleTestFailure(task, session, attempt, maxAttempts, ctx.lastVerification);

      case 'STUCK':
        return this.handleStuck(task, session, attempt, maxAttempts, failedAgents);

      case 'CRASH':
        return await this.handleCrash(task, session, attempt, maxAttempts, failedAgents);

      case 'TIMEOUT':
        return await this.handleTimeout(task, session, attempt, maxAttempts, failedAgents);

      case 'NEEDS_INPUT':
        return this.handleNeedsInput(task, session);

      case 'AUTH_ERROR':
        return this.handleAuthError(session);

      case 'USER_STOPPED':
        return this.action('ASK_USER', attempt, maxAttempts, 'User manually stopped the session');

      default:
        return this.action('ASK_USER', attempt, maxAttempts, `Unknown exit reason: ${stopReason}`);
    }
  }

  // ─── Handlers per stop reason ─────────────────────────────────

  private async handleRateLimit(
    task:        Task,
    session:     AgentSession,
    attempt:     number,
    max:         number,
    failedAgents: Set<AgentId>,
  ): Promise<RecoveryAction> {
    this.router.recordRateLimit(session.agentId, 60_000);
    const nextAgent = await this.findAlternativeAgent(task, failedAgents, session.agentId);

    if (!nextAgent) {
      return this.escalate(task.id, session.id, 'All agents rate-limited. Manual intervention required.', attempt, max);
    }

    this.eventBus.emit('RECOVERY_SWITCHING', {
      fromAgent: session.agentId,
      toAgent:   nextAgent,
      reason:    `${session.agentId} is rate-limited`,
    });

    return { strategy: 'SWITCH_AGENT', targetAgent: nextAgent, attempt, maxAttempts: max };
  }

  private handleTestFailure(
    task:     Task,
    session:  AgentSession,
    attempt:  number,
    max:      number,
    last:     VerificationResult | null,
  ): RecoveryAction {
    if (attempt >= max) {
      return this.escalate(
        task.id, session.id,
        `Test failures persist after ${max} attempts. ` +
        `Failing tests:\n${last?.unitTests.errors.slice(0, 5).join('\n') ?? 'unknown'}`,
        attempt, max,
      );
    }

    this.eventBus.emit('RECOVERY_RETRYING', { sessionId: session.id, attempt });
    return { strategy: 'DISPATCH_DEBUG', attempt, maxAttempts: max };
  }

  private handleStuck(
    task:        Task,
    session:     AgentSession,
    attempt:     number,
    max:         number,
    failedAgents: Set<AgentId>,
  ): RecoveryAction {
    if (attempt >= 2) {
      return this.escalate(task.id, session.id, 'Agent stuck repeatedly — needs user clarification', attempt, max);
    }
    return { strategy: 'ASK_USER', attempt, maxAttempts: max, message: 'Agent appears stuck. Do you want to provide clarification or switch agent?' };
  }

  private async handleCrash(
    task:        Task,
    session:     AgentSession,
    attempt:     number,
    max:         number,
    failedAgents: Set<AgentId>,
  ): Promise<RecoveryAction> {
    const nextAgent = await this.findAlternativeAgent(task, failedAgents, session.agentId);
    if (nextAgent) {
      this.eventBus.emit('RECOVERY_SWITCHING', { fromAgent: session.agentId, toAgent: nextAgent, reason: 'crash' });
      return { strategy: 'SWITCH_AGENT', targetAgent: nextAgent, attempt, maxAttempts: max };
    }
    return { strategy: 'RETRY_SAME', attempt, maxAttempts: max };
  }

  private async handleTimeout(
    task:        Task,
    session:     AgentSession,
    attempt:     number,
    max:         number,
    failedAgents: Set<AgentId>,
  ): Promise<RecoveryAction> {
    const nextAgent = await this.findAlternativeAgent(task, failedAgents, session.agentId);
    if (nextAgent && attempt < max) {
      return { strategy: 'SWITCH_AGENT', targetAgent: nextAgent, attempt, maxAttempts: max };
    }
    return this.escalate(task.id, session.id, 'Task timed out repeatedly', attempt, max);
  }

  private handleNeedsInput(task: Task, session: AgentSession): RecoveryAction {
    this.eventBus.emit('USER_PROMPT_NEEDED', {
      sessionId: session.id,
      question:  'Agent needs clarification to proceed',
      options:   ['Provide more details', 'Skip this task', 'Switch agent'],
    });
    return { strategy: 'ASK_USER', attempt: 0, maxAttempts: 1 };
  }

  private handleAuthError(session: AgentSession): RecoveryAction {
    this.eventBus.emit('USER_PROMPT_NEEDED', {
      sessionId: session.id,
      question:  `Agent ${session.agentId} authentication failed. Please reconnect the agent in Settings.`,
      options:   null,
    });
    return { strategy: 'ASK_USER', attempt: 0, maxAttempts: 1, message: 'Auth error — reconfigure agent credentials' };
  }

  // ─── Helpers ──────────────────────────────────────────────────

  private async findAlternativeAgent(
    task:        Task,
    failedAgents: Set<AgentId>,
    currentAgent: AgentId,
  ): Promise<AgentId | null> {
    const excluded = new Set([...failedAgents, currentAgent]);
    try {
      return await this.router.selectBest(task, { excludeAgents: [...excluded] });
    } catch {
      return null;
    }
  }

  private escalate(
    taskId: TaskId, sessionId: SessionId,
    message: string, attempt: number, maxAttempts: number,
  ): RecoveryAction {
    const resumeToken = `resume-${taskId}-${Date.now()}`;
    this.eventBus.emit('RECOVERY_ESCALATED', {
      taskId,
      failures:    [],
      message,
    });
    this.eventBus.emit('USER_INTERVENTION', { taskId, message, context: sessionId, resumeToken });
    return { strategy: 'ASK_USER', attempt, maxAttempts, message };
  }

  private action(
    strategy: RecoveryStrategy,
    attempt:  number,
    max:      number,
    message?: string,
  ): RecoveryAction {
    return { strategy, attempt, maxAttempts: max, message };
  }
}
