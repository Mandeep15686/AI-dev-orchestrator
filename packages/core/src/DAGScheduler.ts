// ═══════════════════════════════════════════════════════════════
// packages/core/src/DAGScheduler.ts
// Executes a Task DAG respecting dependency order.
// Runs independent tasks concurrently via Git worktrees.
// ═══════════════════════════════════════════════════════════════

import type { Task, TaskId } from '@ai-orch/protocol';
import type { TaskDAG }       from './TaskPlanner.js';
import type { TypedEventBus } from './EventBus.js';
import type { GitEngine }     from '@ai-orch/git';

export interface SchedulerTask {
  task:      Task;
  worktree?: string;
}

export type TaskExecutor = (task: Task, worktree: string | null) => Promise<'success' | 'failure'>;

export class DAGScheduler {
  private completed = new Set<TaskId>();
  private failed    = new Set<TaskId>();
  private running   = new Map<TaskId, Promise<void>>();

  constructor(
    private eventBus:  TypedEventBus,
    private git:       GitEngine,
    private projectPath: string,
  ) {}

  /**
   * Execute the full DAG using the given executor.
   * Runs independent tasks in parallel where possible.
   */
  async execute(dag: TaskDAG, executor: TaskExecutor): Promise<{ success: TaskId[]; failed: TaskId[] }> {
    this.completed.clear();
    this.failed.clear();
    this.running.clear();

    while (true) {
      const ready = this.getReady(dag);
      if (ready.length === 0 && this.running.size === 0) break;

      // Dispatch all ready tasks concurrently
      for (const task of ready) {
        if (this.running.has(task.id)) continue;

        const promise = this.runTask(task, dag, executor);
        this.running.set(task.id, promise);
      }

      // Wait for at least one to finish
      if (this.running.size > 0) {
        await Promise.race(this.running.values());
      }
    }

    return {
      success: [...this.completed],
      failed:  [...this.failed],
    };
  }

  private async runTask(task: Task, dag: TaskDAG, executor: TaskExecutor): Promise<void> {
    // Create an isolated worktree for this task if it can run in parallel
    let worktree: string | null = null;
    const siblings = this.getReadySiblings(task, dag);
    const needsWorktree = siblings.length > 1;

    if (needsWorktree) {
      const branch = `agent/${task.agentHint ?? 'orch'}-${task.id.slice(0, 8)}`;
      const wt = await this.git.createWorktree(this.projectPath, branch).catch(() => null);
      if (wt) {
        worktree = wt.path;
        this.eventBus.emit('WORKTREE_CREATED', { branch, path: wt.path });
      }
    }

    this.eventBus.emit('TASK_STARTED', { taskId: task.id, workflowRunId: task.masterId });

    try {
      const result = await executor(task, worktree);
      if (result === 'success') {
        this.completed.add(task.id);
        this.eventBus.emit('TASK_COMPLETED', {
          taskId:       task.id,
          checkpointId: `cp-${task.id}`,
          duration:     0,
        });

        // Merge worktree back to main if it was isolated
        if (worktree && needsWorktree) {
          const branch = `agent/${task.agentHint ?? 'orch'}-${task.id.slice(0, 8)}`;
          const clean  = await this.git.mergeWorktree(this.projectPath, branch, 'main');
          this.eventBus.emit('WORKTREE_MERGED', {
            branch, target: 'main', conflictsResolved: clean ? 0 : 1,
          });
          await this.git.deleteWorktree(this.projectPath, worktree);
          this.eventBus.emit('WORKTREE_DELETED', { branch, path: worktree });
        }
      } else {
        this.failed.add(task.id);
        this.eventBus.emit('TASK_FAILED', {
          taskId:        task.id,
          reason:        'executor returned failure',
          lastSessionId: null,
        });
      }
    } catch (err) {
      this.failed.add(task.id);
      this.eventBus.emit('TASK_FAILED', {
        taskId:        task.id,
        reason:        String(err),
        lastSessionId: null,
      });
    } finally {
      this.running.delete(task.id);
    }
  }

  /** Tasks whose all dependencies are completed and haven't started yet */
  private getReady(dag: TaskDAG): Task[] {
    return [...dag.nodes.values()].filter(task => {
      if (this.completed.has(task.id)) return false;
      if (this.failed.has(task.id))    return false;
      if (this.running.has(task.id))   return false;
      // Skip tasks that depend on failed tasks
      if (task.dependencies.some(d => this.failed.has(d))) {
        this.failed.add(task.id);
        return false;
      }
      return task.dependencies.every(d => this.completed.has(d));
    });
  }

  /** Tasks that would be ready at the same time (for parallel detection) */
  private getReadySiblings(task: Task, dag: TaskDAG): Task[] {
    return this.getReady(dag).filter(t => t.id !== task.id);
  }

  /** Topological sort for sequential fallback */
  topologicalOrder(dag: TaskDAG): Task[] {
    const visited = new Set<TaskId>();
    const result:  Task[] = [];

    const visit = (id: TaskId) => {
      if (visited.has(id)) return;
      visited.add(id);
      const task = dag.nodes.get(id);
      if (!task) return;
      for (const dep of task.dependencies) visit(dep);
      result.push(task);
    };

    for (const id of dag.nodes.keys()) visit(id);
    return result;
  }
}
