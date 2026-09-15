// packages/core/src/__tests__/DAGScheduler.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DAGScheduler } from '../DAGScheduler.js';
import type { TaskDAG } from '../TaskPlanner.js';
import type { Task } from '@ai-orch/protocol';

const mockBus: any = { emit: vi.fn() };
const mockGit: any = {
  createWorktree: vi.fn().mockResolvedValue({ path: '/tmp/wt', branch: 'test', commit: 'abc' }),
  mergeWorktree:  vi.fn().mockResolvedValue(true),
  deleteWorktree: vi.fn().mockResolvedValue(undefined),
};

const NOW = new Date().toISOString();

function makeTask(id: string, deps: string[] = [], type = 'backend'): Task {
  return {
    id, masterId: 'run1', name: `Task ${id}`,
    description: '', type: type as any,
    dependencies: deps, agentHint: null,
    priority: 2, status: 'pending', createdAt: NOW,
  };
}

function buildDAG(tasks: Task[]): TaskDAG {
  const nodes = new Map(tasks.map(t => [t.id, t]));
  const edges = new Map(tasks.map(t => [t.id, t.dependencies]));
  const roots  = tasks.filter(t => t.dependencies.length === 0).map(t => t.id);
  const leafSet = new Set(tasks.map(t => t.id));
  for (const deps of edges.values()) for (const d of deps) leafSet.delete(d);
  return { nodes, edges, roots, leaves: [...leafSet] };
}

describe('DAGScheduler', () => {
  let scheduler: DAGScheduler;

  beforeEach(() => {
    scheduler = new DAGScheduler(mockBus, mockGit, '/tmp/project');
    vi.clearAllMocks();
  });

  describe('execute — linear DAG', () => {
    it('runs all tasks in dependency order', async () => {
      const order: string[] = [];
      const t1 = makeTask('t1');
      const t2 = makeTask('t2', ['t1']);
      const t3 = makeTask('t3', ['t2']);
      const dag = buildDAG([t1, t2, t3]);

      const executor = vi.fn().mockImplementation(async (task: Task) => {
        order.push(task.id);
        return 'success';
      });

      const result = await scheduler.execute(dag, executor);

      expect(result.success).toContain('t1');
      expect(result.success).toContain('t2');
      expect(result.success).toContain('t3');
      expect(result.failed).toHaveLength(0);
      // t1 must run before t2, t2 before t3
      expect(order.indexOf('t1')).toBeLessThan(order.indexOf('t2'));
      expect(order.indexOf('t2')).toBeLessThan(order.indexOf('t3'));
    });

    it('marks all tasks successful when executor returns success', async () => {
      const dag = buildDAG([makeTask('t1'), makeTask('t2', ['t1'])]);
      const executor = vi.fn().mockResolvedValue('success');
      const result = await scheduler.execute(dag, executor);
      expect(result.success).toHaveLength(2);
      expect(result.failed).toHaveLength(0);
    });

    it('marks task failed when executor returns failure', async () => {
      const dag = buildDAG([makeTask('t1')]);
      const executor = vi.fn().mockResolvedValue('failure');
      const result = await scheduler.execute(dag, executor);
      expect(result.failed).toContain('t1');
      expect(result.success).toHaveLength(0);
    });
  });

  describe('execute — parallel DAG', () => {
    it('runs independent tasks concurrently (both dispatched before either finishes)', async () => {
      const startTimes: Record<string, number> = {};
      const t1 = makeTask('t1');
      const t2 = makeTask('t2');  // also independent — no deps
      const t3 = makeTask('t3', ['t1', 't2']);
      const dag = buildDAG([t1, t2, t3]);

      const executor = vi.fn().mockImplementation(async (task: Task) => {
        startTimes[task.id] = Date.now();
        await new Promise(r => setTimeout(r, 30));
        return 'success';
      });

      await scheduler.execute(dag, executor);

      // t1 and t2 should have started at nearly the same time (within 20ms)
      const gap = Math.abs((startTimes['t1'] ?? 0) - (startTimes['t2'] ?? 0));
      expect(gap).toBeLessThan(20);

      // t3 must start after both t1 and t2
      expect(startTimes['t3']!).toBeGreaterThanOrEqual(startTimes['t1']! + 25);
      expect(startTimes['t3']!).toBeGreaterThanOrEqual(startTimes['t2']! + 25);
    });

    it('skips downstream tasks when upstream fails', async () => {
      const t1 = makeTask('t1');       // root — will fail
      const t2 = makeTask('t2', ['t1']); // depends on t1
      const dag = buildDAG([t1, t2]);

      const executor = vi.fn()
        .mockImplementationOnce(async () => 'failure') // t1 fails
        .mockResolvedValue('success');                  // t2 never runs

      const result = await scheduler.execute(dag, executor);
      expect(result.failed).toContain('t1');
      // t2 should be auto-failed (blocked) without calling executor
      expect(executor).toHaveBeenCalledTimes(1);
    });
  });

  describe('execute — events', () => {
    it('emits TASK_STARTED for each task', async () => {
      const dag = buildDAG([makeTask('t1'), makeTask('t2', ['t1'])]);
      const executor = vi.fn().mockResolvedValue('success');
      await scheduler.execute(dag, executor);
      const taskStartedCalls = vi.mocked(mockBus.emit).mock.calls
        .filter((call: unknown[]) => call[0] === 'TASK_STARTED');
      expect(taskStartedCalls).toHaveLength(2);
    });

    it('emits TASK_COMPLETED for successful tasks', async () => {
      const dag = buildDAG([makeTask('t1')]);
      const executor = vi.fn().mockResolvedValue('success');
      await scheduler.execute(dag, executor);
      expect(mockBus.emit).toHaveBeenCalledWith('TASK_COMPLETED', expect.objectContaining({ taskId: 't1' }));
    });

    it('emits TASK_FAILED for failed tasks', async () => {
      const dag = buildDAG([makeTask('t1')]);
      const executor = vi.fn().mockResolvedValue('failure');
      await scheduler.execute(dag, executor);
      expect(mockBus.emit).toHaveBeenCalledWith('TASK_FAILED', expect.objectContaining({ taskId: 't1' }));
    });
  });

  describe('topologicalOrder', () => {
    it('returns all tasks in valid topological order', () => {
      const t1 = makeTask('t1');
      const t2 = makeTask('t2', ['t1']);
      const t3 = makeTask('t3', ['t1']);
      const t4 = makeTask('t4', ['t2', 't3']);
      const dag = buildDAG([t1, t2, t3, t4]);

      const order = scheduler.topologicalOrder(dag);
      const pos   = new Map(order.map((t, i) => [t.id, i]));

      expect(order).toHaveLength(4);
      expect(pos.get('t1')!).toBeLessThan(pos.get('t2')!);
      expect(pos.get('t1')!).toBeLessThan(pos.get('t3')!);
      expect(pos.get('t2')!).toBeLessThan(pos.get('t4')!);
      expect(pos.get('t3')!).toBeLessThan(pos.get('t4')!);
    });

    it('handles single-node DAG', () => {
      const dag = buildDAG([makeTask('t1')]);
      const order = scheduler.topologicalOrder(dag);
      expect(order).toHaveLength(1);
      expect(order[0]!.id).toBe('t1');
    });
  });
});
