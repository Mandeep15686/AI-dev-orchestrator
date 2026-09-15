// ═══════════════════════════════════════════════════════════════
// packages/core/src/OrchestratorCore.ts
// The heart of the system.  Coordinates all subsystems through
// the main orchestration loop.
// ═══════════════════════════════════════════════════════════════

import type {
  Task, TaskId, AgentId, ProjectMeta, StopReason,
  VerificationPolicy, ContextPackage, HandoffJSON,
} from '@ai-orch/protocol';

import { TypedEventBus }       from './EventBus.js';
import { TaskPlanner }         from './TaskPlanner.js';
import { AgentRouter }         from './AgentRouter.js';
import { ContextEngine }       from './ContextEngine.js';
import { HandoffEngine }       from './HandoffEngine.js';
import { AgentRunner }         from './AgentRunner.js';
import { VerificationEngine }  from './VerificationEngine.js';
import { FailureRecovery }     from './FailureRecovery.js';
import { DAGScheduler }        from './DAGScheduler.js';

import { Database }            from '@ai-orch/storage';
import { GitEngine }           from '@ai-orch/git';
import { CodeGraphProxy }      from '@ai-orch/codegraph';
import { PermissionManager }   from '@ai-orch/security';

import { ClaudeAdapter }   from '@ai-orch/agent-claude';
import { CodexAdapter }    from '@ai-orch/agent-codex';
import { GeminiAdapter }   from '@ai-orch/agent-gemini';

export interface OrchestratorConfig {
  dbPath:          string;
  maxRetries:      number;
  verificationPolicy: VerificationPolicy;
  enableParallel:  boolean;
}

export class OrchestratorCore {
  // Subsystems
  private eventBus:    TypedEventBus;
  private planner:     TaskPlanner;
  private router:      AgentRouter;
  private contextEng:  ContextEngine;
  private handoffEng:  HandoffEngine;
  private runner:      AgentRunner;
  private verification: VerificationEngine;
  private recovery:    FailureRecovery;
  private db:          Database;
  private git:         GitEngine;
  private codegraph:   CodeGraphProxy;
  private permissions: PermissionManager;

  // State
  private activeWorkflowId: string | null = null;
  private paused = false;
  private abortController = new AbortController();

  constructor(private cfg: OrchestratorConfig) {
    this.db          = new Database(cfg.dbPath);
    this.git         = new GitEngine();
    this.codegraph   = new CodeGraphProxy();
    this.permissions = new PermissionManager(this.db);

    this.eventBus    = new TypedEventBus({ db: this.db });
    this.planner     = new TaskPlanner();
    this.router      = new AgentRouter(this.db);
    this.contextEng  = new ContextEngine(this.db, this.git, this.codegraph);
    this.handoffEng  = new HandoffEngine();
    this.runner      = new AgentRunner(this.eventBus, this.db, this.permissions);
    this.verification = new VerificationEngine();
    this.recovery    = new FailureRecovery(this.eventBus, this.router, this.db);

    this.registerAdapters();
  }

  // ─── Public API ───────────────────────────────────────────────

  get bus(): TypedEventBus { return this.eventBus; }

  async runGoal(goal: string, project: ProjectMeta): Promise<void> {
    const { masterTask, tasks, dag } = await this.planner.plan(
      goal, project.id, project.language,
    );

    const runId = await this.db.insertWorkflowRun({
      projectId:  project.id,
      masterTask: goal,
      workflow:   '{}',
      status:     'running',
    });
    this.activeWorkflowId = runId;

    await this.db.insertTasks(tasks.map(({
      id, name, type, description, dependencies, agentHint, priority,
    }) => ({
      id,
      workflowRunId: runId,
      name,
      type,
      description,
      deps: dependencies,
      agentHint,
      priority,
    })));
    await this.codegraph.init(project.path);

    const scheduler = new DAGScheduler(this.eventBus, this.git, project.path);
    const start     = Date.now();

    await scheduler.execute(dag, async (task, worktree) => {
      const result = await this.executeTask(task, project, worktree);
      return result ? 'success' : 'failure';
    });

    const totalTime = Date.now() - start;
    await this.db.updateWorkflowRun(runId, { status: 'completed', ended_at: new Date().toISOString() });

    this.eventBus.emit('WORKFLOW_DONE', {
      workflowRunId: runId,
      totalTime,
      checkpoints:   await this.db.countCheckpoints(runId),
    });
  }

  pause():  void { this.paused = true; }
  resume(): void { this.paused = false; }
  abort():  void { this.abortController.abort(); }

  // ─── Core task execution loop ─────────────────────────────────

  private async executeTask(
    task:    Task,
    project: ProjectMeta,
    worktree: string | null,
  ): Promise<boolean> {
    const failedAgents = new Set<AgentId>();
    let attempt = 0;
    const maxAttempts = this.cfg.maxRetries;

    while (attempt < maxAttempts + 1) {
      if (this.abortController.signal.aborted) return false;

      // Wait if paused
      while (this.paused) await new Promise(r => setTimeout(r, 500));

      // 1. Select agent
      let agentId: AgentId;
      try {
        agentId = await this.router.selectBest(task, {
          excludeAgents:   [...failedAgents],
          projectLanguage: project.language,
        });
      } catch (err) {
        this.eventBus.emit('TASK_FAILED', { taskId: task.id, reason: String(err), lastSessionId: null });
        return false;
      }

      const adapter = this.router.getAdapter(agentId)!;

      // 2. Build context
      const ctx = await this.contextEng.buildContextPackage(
        task, agentId, project, adapter.capabilities,
      );
      this.eventBus.emit('CONTEXT_BUILT', {
        taskId:        task.id,
        agentId,
        tokenEstimate: ctx.tokenEstimate,
        sources:       ['task', 'git', 'codegraph', 'handoffs'],
      });

      // 3. Run agent
      const runResult = await this.runner.run(adapter, task, ctx, {
        worktree,
        maxTokens:  adapter.capabilities.maxContextTokens * 0.7,
        timeoutMs:  project.settings.sessionTimeoutMs,
        resumeMode: false,
      });

      const { session, stopReason, outputLines, filesChanged } = runResult;

      // 4. Verification gate
      let verification = await this.verification.runGate(
        this.cfg.verificationPolicy, worktree ?? project.path,
      );

      // 5. On success — checkpoint + handoff
      if (stopReason === 'COMPLETED' && verification.passed) {
        const gitCommit = await this.git.commit(
          worktree ?? project.path,
          `orch: ${agentId} — ${task.name} [PASS]`,
        );

        const handoff = this.handoffEng.generateHandoff(
          session, task,
          { lines: outputLines, exitReason: stopReason, duration: runResult.durationMs },
          gitCommit, filesChanged, verification,
        );

        const handoffCount = await this.db.countHandoffs(task.masterId);
        const handoffPath  = await this.handoffEng.saveHandoff(
          project.path, handoff, handoffCount + 1,
        );

        const cpId = await this.db.insertCheckpoint({
          sessionId:    session.id,
          gitCommit,
          handoffPath,
          filesChanged: filesChanged.length,
          canRollback:  true,
        });

        this.eventBus.emit('CHECKPOINT_CREATED', {
          checkpointId: cpId,
          sessionId:    session.id,
          gitCommit,
          filesChanged: filesChanged.length,
        });
        this.eventBus.emit('HANDOFF_GENERATED', {
          checkpointId: cpId,
          handoffPath,
          summary: this.handoffEng.toSummary(handoff),
        });

        // Update CodeGraph
        this.contextEng.invalidate(task.id);
        await this.codegraph.update(project.path, filesChanged);
        this.eventBus.emit('CODEGRAPH_UPDATED', {
          projectPath:    project.path,
          symbolsIndexed: filesChanged.length * 10,
          duration:       100,
        });

        await this.router.learnFromResult(agentId, task.type, true, runResult.durationMs);
        return true;
      }

      // 6. Determine recovery strategy
      const action = await this.recovery.handleExitReason({
        task, session, stopReason,
        attempt: ++attempt, maxAttempts,
        lastVerification: verification,
        failedAgents,
      });

      switch (action.strategy) {
        case 'SWITCH_AGENT':
          failedAgents.add(agentId);
          if (action.targetAgent) { /* router will select it next loop */ }
          break;

        case 'DISPATCH_DEBUG':
          await this.runDebugAgent(task, project, verification, worktree);
          break;

        case 'RETRY_SAME':
          failedAgents.delete(agentId); // keep same agent
          break;

        case 'ASK_USER':
          // Pause until user resumes via UI
          this.paused = true;
          await this.eventBus.waitFor('USER_INTERVENTION', p => p.taskId === task.id, 30 * 60_000)
            .catch(() => { this.abortController.abort(); });
          this.paused = false;
          break;

        case 'SKIP_TASK':
          return false;
      }

      await this.router.learnFromResult(agentId, task.type, false, runResult.durationMs);
    }

    return false;
  }

  /** Dispatch a dedicated debug agent to fix failing tests */
  private async runDebugAgent(
    task:         Task,
    project:      ProjectMeta,
    verification: any,
    worktree:     string | null,
  ): Promise<void> {
    const debugAgentId = await this.router.selectBest(
      { ...task, name: `Debug: ${task.name}`, type: 'debug' },
      { projectLanguage: project.language },
    );
    const adapter = this.router.getAdapter(debugAgentId)!;
    const ctx     = await this.contextEng.buildContextPackage(
      task, debugAgentId, project, adapter.capabilities,
    );

    // Inject failing test info into context
    const debugTask = {
      ...task,
      name:        `Fix failing tests for: ${task.name}`,
      description: `${task.description}\n\nFailing tests:\n${verification?.unitTests?.errors?.join('\n') ?? ''}`,
    };

    await this.runner.run(adapter, debugTask, ctx, {
      worktree, maxTokens: 40_000, timeoutMs: 10 * 60_000, resumeMode: false,
    });
  }

  // ─── Setup ────────────────────────────────────────────────────

  private registerAdapters(): void {
    this.router.registerAdapter(new ClaudeAdapter());
    this.router.registerAdapter(new CodexAdapter());
    this.router.registerAdapter(new GeminiAdapter());
  }
}
