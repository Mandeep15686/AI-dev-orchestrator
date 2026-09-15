// ═══════════════════════════════════════════════════════════════
// packages/agents/shared/src/AgentAdapter.ts
// The contract every agent adapter must implement
// ═══════════════════════════════════════════════════════════════

import type {
  AgentId, AgentCapabilities, AgentDetectionResult,
  AgentSession, AgentEvent, Task, ContextPackage,
  SessionOptions, StopReason,
} from '@ai-orch/protocol';

export interface AgentAdapter {
  /** Unique identifier for this agent */
  readonly id: AgentId;

  /** Static capability declaration */
  readonly capabilities: AgentCapabilities;

  /**
   * Check if the agent CLI/SDK is installed and authenticated.
   * Called before every session start.
   */
  detect(): Promise<AgentDetectionResult>;

  /**
   * Start a new task session. Returns immediately with a session handle.
   * The agent process is spawned in the background.
   */
  startSession(
    task: Task,
    ctx: ContextPackage,
    opts: SessionOptions,
  ): Promise<AgentSession>;

  /**
   * Resume an existing session using a new context package.
   * Only available if capabilities.supportsResume === true.
   */
  resumeSession(
    session: AgentSession,
    ctx: ContextPackage,
  ): Promise<AgentSession>;

  /**
   * Send an additional message to a running session (e.g. clarification).
   */
  sendPrompt(session: AgentSession, prompt: string): Promise<void>;

  /**
   * Async generator that yields streamed events from the running session.
   * Completes when the session ends.
   */
  streamEvents(session: AgentSession): AsyncGenerator<AgentEvent>;

  /**
   * Block until the session reaches a terminal stop condition.
   */
  waitForStop(session: AgentSession): Promise<StopReason>;

  /**
   * Gracefully terminate the session (SIGTERM → 5s → SIGKILL).
   */
  stop(session: AgentSession): Promise<void>;

  /**
   * Build the initial system prompt for this agent given a task + context.
   * Agents have different prompt styles; this is adapter-specific.
   */
  buildSystemPrompt(task: Task, ctx: ContextPackage): string;
}

// ─── Base class with shared helpers ───────────────────────────
export abstract class BaseAgentAdapter implements AgentAdapter {
  abstract readonly id: AgentId;
  abstract readonly capabilities: AgentCapabilities;

  abstract detect(): Promise<AgentDetectionResult>;
  abstract startSession(task: Task, ctx: ContextPackage, opts: SessionOptions): Promise<AgentSession>;
  abstract resumeSession(session: AgentSession, ctx: ContextPackage): Promise<AgentSession>;
  abstract sendPrompt(session: AgentSession, prompt: string): Promise<void>;
  abstract streamEvents(session: AgentSession): AsyncGenerator<AgentEvent>;
  abstract waitForStop(session: AgentSession): Promise<StopReason>;
  abstract stop(session: AgentSession): Promise<void>;

  buildSystemPrompt(task: Task, ctx: ContextPackage): string {
    const handoffSection = ctx.handoffHistory.length > 0
      ? `\n## Previous Agent Work\n${ctx.handoffHistory.map(h =>
          `- Agent: ${h.agentId} | Commit: ${h.gitCommit}\n` +
          `  Completed: ${h.completed.join(', ')}\n` +
          `  Remaining: ${h.remaining.join(', ')}\n` +
          `  Decisions: ${h.decisions.join(', ')}`
        ).join('\n')}`
      : '';

    const codeSection = ctx.codeContext.symbols.length > 0
      ? `\n## Relevant Code Symbols\n${ctx.codeContext.symbols.map(s =>
          `- ${s.kind} ${s.name} in ${s.filePath}:${s.line}`
        ).join('\n')}`
      : '';

    const testSection = ctx.testStatus
      ? `\n## Last Test Status\n` +
        `Build: ${ctx.testStatus.build.passed ? '✅' : '❌'} | ` +
        `Tests: ${ctx.testStatus.unitTests.passed}✅ ${ctx.testStatus.unitTests.failed}❌`
      : '';

    return `# AI Dev Orchestrator — Task Assignment

## Your Task
**${task.name}**

${task.description}

## Project: ${ctx.project.name}
Language: ${ctx.project.language}
Current branch: ${ctx.gitContext.branch} (${ctx.gitContext.commit.slice(0, 8)})
${ctx.gitContext.dirty ? `Dirty files: ${ctx.gitContext.filesChanged.join(', ')}` : 'Working tree clean'}
${handoffSection}
${codeSection}
${testSection}

## Git Context (recent commits)
${ctx.gitContext.recentCommits.slice(0, 5).map(c => `- ${c.oid.slice(0, 8)} ${c.message}`).join('\n')}

## Instructions
- Focus only on this task. Do not refactor unrelated code.
- Commit changes incrementally with descriptive messages.
- If you encounter something that blocks you, output: NEEDS_INPUT: <explanation>
- When complete, output: TASK_COMPLETED: <summary of what was done>
- Estimated tokens available: ${Math.floor(this.capabilities.maxContextTokens * 0.7).toLocaleString()}
`;
  }

  /** Detect stop reason from agent output line */
  protected detectStopSignal(line: string): StopReason | null {
    if (/TASK_COMPLETED/i.test(line))    return 'COMPLETED';
    if (/NEEDS_INPUT/i.test(line))       return 'NEEDS_INPUT';
    if (/rate.?limit/i.test(line))       return 'RATE_LIMITED';
    if (/token.*limit|context.*full/i.test(line)) return 'TOKEN_LIMIT';
    if (/auth.*fail|not.*authenticated/i.test(line)) return 'AUTH_ERROR';
    return null;
  }

  /** Detect file change events from agent output */
  protected detectFileChange(
    line: string,
    sessionId: string,
  ): { path: string; changeType: 'added' | 'modified' | 'deleted' } | null {
    const created  = line.match(/(?:created?|wrote?|writing)\s+([^\s]+\.[a-z]+)/i);
    const modified  = line.match(/(?:modif|updat|edit)\w+\s+([^\s]+\.[a-z]+)/i);
    const deleted  = line.match(/(?:delet|remov)\w+\s+([^\s]+\.[a-z]+)/i);
    if (created) return { path: created[1]!, changeType: 'added' };
    if (modified) return { path: modified[1]!, changeType: 'modified' };
    if (deleted)  return { path: deleted[1]!, changeType: 'deleted' };
    return null;
  }
}
