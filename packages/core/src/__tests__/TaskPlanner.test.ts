// packages/core/src/__tests__/TaskPlanner.test.ts
import { beforeEach, describe, it, expect } from 'vitest';
import { TaskPlanner } from '../TaskPlanner.js';

describe('TaskPlanner', () => {
  let planner: TaskPlanner;

  beforeEach(() => {
    planner = new TaskPlanner();
  });

  describe('plan', () => {
    it('returns a MasterTask, tasks array, and DAG', async () => {
      const result = await planner.plan('Build an auth system', 'proj1', 'typescript');
      expect(result.masterTask).toBeDefined();
      expect(result.masterTask.goal).toBe('Build an auth system');
      expect(result.masterTask.projectId).toBe('proj1');
      expect(Array.isArray(result.tasks)).toBe(true);
      expect(result.tasks.length).toBeGreaterThan(0);
      expect(result.dag.nodes.size).toBe(result.tasks.length);
    });

    it('decomposes auth goals into multiple tasks', async () => {
      const result = await planner.plan('Build authentication with JWT and login form', 'proj1', 'typescript');
      expect(result.tasks.length).toBeGreaterThanOrEqual(3);
    });

    it('assigns correct task types for auth goal', async () => {
      const result = await planner.plan('Implement user authentication with JWT', 'proj1', 'typescript');
      const types = result.tasks.map(t => t.type);
      expect(types).toContain('backend');
    });

    it('respects dependency ordering in DAG', async () => {
      const result = await planner.plan('Build auth system with login page', 'proj1', 'typescript');
      for (const task of result.tasks) {
        for (const depId of task.dependencies) {
          expect(result.dag.nodes.has(depId)).toBe(true);
        }
      }
    });

    it('all tasks have required fields', async () => {
      const result = await planner.plan('Create REST API', 'proj1', 'typescript');
      for (const task of result.tasks) {
        expect(task.id).toBeTruthy();
        expect(task.masterId).toBe(result.masterTask.id);
        expect(task.name).toBeTruthy();
        expect(task.type).toBeTruthy();
        expect(typeof task.priority).toBe('number');
        expect(task.status).toBe('pending');
      }
    });

    it('identifies roots (tasks with no dependencies)', async () => {
      const result = await planner.plan('Build auth system', 'proj1', 'typescript');
      expect(result.dag.roots.length).toBeGreaterThan(0);
      for (const rootId of result.dag.roots) {
        const task = result.dag.nodes.get(rootId);
        expect(task?.dependencies.length).toBe(0);
      }
    });
  });

  describe('getReady', () => {
    it('returns tasks with all deps satisfied', async () => {
      const result = await planner.plan('Build auth system', 'proj1', 'typescript');
      const completed = new Set<string>();
      const ready = planner.getReady(result.dag, completed);
      // Initially only root tasks (no deps) are ready
      for (const task of ready) {
        expect(task.dependencies.length).toBe(0);
      }
    });

    it('unlocks dependent tasks when deps complete', async () => {
      const result = await planner.plan('Build auth API with tests', 'proj1', 'typescript');
      const completed = new Set<string>(result.dag.roots);

      const secondRound = planner.getReady(result.dag, completed);
      // Second-round tasks should have deps all in completed
      for (const task of secondRound) {
        expect(task.dependencies.every(d => completed.has(d))).toBe(true);
      }
    });
  });

  describe('topologicalOrder', () => {
    it('returns all tasks in a valid topological order', async () => {
      const result = await planner.plan('Build auth system', 'proj1', 'typescript');
      const order = planner.topologicalOrder(result.dag);
      expect(order.length).toBe(result.tasks.length);

      // For each task, all its deps must appear before it in the order
      const position = new Map(order.map((id, i) => [id, i]));
      for (const task of result.tasks) {
        for (const dep of task.dependencies) {
          expect(position.get(dep)!).toBeLessThan(position.get(task.id)!);
        }
      }
    });
  });
});
