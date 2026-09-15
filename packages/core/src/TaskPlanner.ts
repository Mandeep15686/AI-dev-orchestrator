// ═══════════════════════════════════════════════════════════════
// packages/core/src/TaskPlanner.ts
// Converts a user goal into a dependency-aware DAG of Tasks
// ═══════════════════════════════════════════════════════════════

import { randomUUID } from 'node:crypto';
import type { Task, MasterTask, TaskType, WorkflowRunId, AgentId } from '@ai-orch/protocol';

export interface DAGNode<T> {
  data:     T;
  children: DAGNode<T>[];
  parents:  DAGNode<T>[];
}

export interface TaskDAG {
  nodes:    Map<string, Task>;
  edges:    Map<string, string[]>; // taskId → [dependsOnTaskId]
  roots:    string[];              // tasks with no dependencies
  leaves:   string[];              // tasks with no dependents
}

export interface DecompositionResult {
  masterTask: MasterTask;
  tasks:      Task[];
  dag:        TaskDAG;
}

export class TaskPlanner {
  /**
   * Build a DAG from a user-provided goal string.
   * Uses simple keyword extraction + a predefined decomposition strategy.
   * In production this should call an LLM for intelligent decomposition.
   */
  async plan(
    goal: string,
    projectId: string,
    projectLanguage: string,
  ): Promise<DecompositionResult> {
    const masterId = randomUUID() as WorkflowRunId;
    const masterTask: MasterTask = {
      id:       masterId,
      projectId,
      goal,
      acceptanceCriteria: this.inferCriteria(goal),
      tags:               this.extractTags(goal),
    };

    const tasks = this.decompose(goal, masterId, projectLanguage);
    const dag   = this.buildDAG(tasks);

    return { masterTask, tasks, dag };
  }

  /** Decompose goal into subtasks with dependency hints */
  private decompose(goal: string, masterId: string, lang: string): Task[] {
    const lower = goal.toLowerCase();
    const tasks: Task[] = [];
    const now = new Date().toISOString();

    // Strategy: detect common patterns and build appropriate task sets
    if (this.mentionsAuth(lower)) {
      tasks.push(...this.authTasks(masterId, lang, now));
    } else if (this.mentionsAPI(lower)) {
      tasks.push(...this.apiTasks(masterId, lang, now));
    } else if (this.mentionsFrontend(lower)) {
      tasks.push(...this.frontendTasks(masterId, lang, now));
    } else if (this.mentionsTesting(lower)) {
      tasks.push(...this.testingTasks(masterId, lang, now));
    } else {
      // Generic single task
      tasks.push({
        id:           randomUUID(),
        masterId,
        name:         goal,
        description:  goal,
        type:         this.inferTaskType(lower),
        dependencies: [],
        agentHint:    null,
        priority:     2,
        status:       'pending',
        createdAt:    now,
      });
    }

    return tasks;
  }

  private buildDAG(tasks: Task[]): TaskDAG {
    const nodes = new Map<string, Task>();
    const edges = new Map<string, string[]>();

    for (const task of tasks) {
      nodes.set(task.id, task);
      edges.set(task.id, task.dependencies);
    }

    const roots  = tasks.filter(t => t.dependencies.length === 0).map(t => t.id);
    const leafIds = new Set(tasks.map(t => t.id));
    for (const deps of edges.values()) {
      for (const d of deps) leafIds.delete(d);
    }
    const leaves = [...leafIds];

    return { nodes, edges, roots, leaves };
  }

  /** Return tasks whose dependencies are all in completedIds */
  getReady(dag: TaskDAG, completedIds: Set<string>): Task[] {
    const ready: Task[] = [];
    for (const [id, task] of dag.nodes) {
      if (completedIds.has(id)) continue;
      if (task.status !== 'pending' && task.status !== 'ready') continue;
      const depsOk = task.dependencies.every(d => completedIds.has(d));
      if (depsOk) ready.push(task);
    }
    return ready;
  }

  topologicalOrder(dag: TaskDAG): string[] {
    const visited  = new Set<string>();
    const result:  string[] = [];

    const visit = (id: string) => {
      if (visited.has(id)) return;
      visited.add(id);
      for (const dep of dag.edges.get(id) ?? []) visit(dep);
      result.push(id);
    };

    for (const id of dag.nodes.keys()) visit(id);
    return result.reverse();
  }

  // ─── Pattern detectors ────────────────────────────────────────
  private mentionsAuth(s: string)     { return /\b(auth|login|jwt|token|session|oauth|password)\b/.test(s); }
  private mentionsAPI(s: string)      { return /\b(api|endpoint|route|rest|graphql|controller)\b/.test(s); }
  private mentionsFrontend(s: string) { return /\b(ui|frontend|component|page|form|style|css|react)\b/.test(s); }
  private mentionsTesting(s: string)  { return /\b(test|spec|coverage|e2e|unit|integration)\b/.test(s); }

  private inferTaskType(s: string): TaskType {
    if (this.mentionsAuth(s))     return 'backend';
    if (this.mentionsAPI(s))      return 'backend';
    if (this.mentionsFrontend(s)) return 'frontend';
    if (this.mentionsTesting(s))  return 'testing';
    if (/\b(db|database|schema|migration|model)\b/.test(s)) return 'database';
    if (/\b(doc|readme|comment)\b/.test(s)) return 'documentation';
    if (/\b(refactor|clean|extract|rename)\b/.test(s)) return 'refactor';
    return 'general';
  }

  private inferCriteria(goal: string): string[] {
    return [
      `All features described in "${goal}" are implemented`,
      'All tests pass',
      'No lint errors',
      'Code is committed and checkpointed',
    ];
  }

  private extractTags(goal: string): string[] {
    const tags: string[] = [];
    const lower = goal.toLowerCase();
    if (this.mentionsAuth(lower))     tags.push('auth', 'backend');
    if (this.mentionsAPI(lower))      tags.push('api', 'backend');
    if (this.mentionsFrontend(lower)) tags.push('frontend', 'ui');
    if (this.mentionsTesting(lower))  tags.push('testing');
    return [...new Set(tags)];
  }

  // ─── Task templates ──────────────────────────────────────────
  private authTasks(masterId: string, lang: string, now: string): Task[] {
    const t1 = randomUUID(); const t2 = randomUUID();
    const t3 = randomUUID(); const t4 = randomUUID(); const t5 = randomUUID();
    return [
      { id: t1, masterId, name: 'User model & DB migration', description: 'Create User model with password hashing', type: 'database', dependencies: [], agentHint: 'codex', priority: 1, status: 'pending', createdAt: now },
      { id: t2, masterId, name: 'Auth API + JWT middleware',  description: 'Login, logout, register endpoints with JWT', type: 'backend', dependencies: [t1], agentHint: 'claude', priority: 1, status: 'pending', createdAt: now },
      { id: t3, masterId, name: 'Refresh token system',      description: 'Refresh token endpoint and storage', type: 'backend', dependencies: [t2], agentHint: 'codex', priority: 2, status: 'pending', createdAt: now },
      { id: t4, masterId, name: 'Frontend login/register UI', description: 'Login and register forms with state management', type: 'frontend', dependencies: [t2], agentHint: 'cursor', priority: 2, status: 'pending', createdAt: now },
      { id: t5, masterId, name: 'Auth integration tests',    description: 'E2E tests for entire auth flow', type: 'testing', dependencies: [t3, t4], agentHint: 'claude', priority: 3, status: 'pending', createdAt: now },
    ];
  }

  private apiTasks(masterId: string, lang: string, now: string): Task[] {
    const t1 = randomUUID(); const t2 = randomUUID(); const t3 = randomUUID();
    return [
      { id: t1, masterId, name: 'Data models & validation', description: 'Define models and validation schemas', type: 'database', dependencies: [], agentHint: 'codex', priority: 1, status: 'pending', createdAt: now },
      { id: t2, masterId, name: 'API routes & controllers', description: 'CRUD endpoints with proper error handling', type: 'backend', dependencies: [t1], agentHint: 'claude', priority: 2, status: 'pending', createdAt: now },
      { id: t3, masterId, name: 'API test suite', description: 'Unit + integration tests for all endpoints', type: 'testing', dependencies: [t2], agentHint: 'gemini', priority: 3, status: 'pending', createdAt: now },
    ];
  }

  private frontendTasks(masterId: string, lang: string, now: string): Task[] {
    const t1 = randomUUID(); const t2 = randomUUID(); const t3 = randomUUID();
    return [
      { id: t1, masterId, name: 'Component architecture', description: 'Define component tree and shared types', type: 'frontend', dependencies: [], agentHint: 'claude', priority: 1, status: 'pending', createdAt: now },
      { id: t2, masterId, name: 'UI components implementation', description: 'Build and style all UI components', type: 'frontend', dependencies: [t1], agentHint: 'cursor', priority: 2, status: 'pending', createdAt: now },
      { id: t3, masterId, name: 'Component tests', description: 'Unit tests for all components', type: 'testing', dependencies: [t2], agentHint: 'claude', priority: 3, status: 'pending', createdAt: now },
    ];
  }

  private testingTasks(masterId: string, lang: string, now: string): Task[] {
    const t1 = randomUUID(); const t2 = randomUUID();
    return [
      { id: t1, masterId, name: 'Unit test suite', description: 'Comprehensive unit tests', type: 'testing', dependencies: [], agentHint: 'gemini', priority: 1, status: 'pending', createdAt: now },
      { id: t2, masterId, name: 'Integration tests', description: 'End-to-end integration tests', type: 'testing', dependencies: [t1], agentHint: 'claude', priority: 2, status: 'pending', createdAt: now },
    ];
  }
}
