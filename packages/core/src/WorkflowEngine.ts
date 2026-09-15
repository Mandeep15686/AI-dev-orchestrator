// ═══════════════════════════════════════════════════════════════
// packages/core/src/WorkflowEngine.ts
// Executes a Workflow definition (nodes + edges) by advancing
// state one step at a time, evaluating conditions on edges,
// and enforcing max-iteration guards on loops.
// ═══════════════════════════════════════════════════════════════

import type {
  Workflow, WorkflowNode, WorkflowEdge, WorkflowState,
  WorkflowNodeType, VerificationResult, Task,
} from '@ai-orch/protocol';
import type { TypedEventBus }  from './EventBus.js';
import type { Database }       from '../storage/Database.js';

export interface StepResult {
  nodeId:    string;
  nodeType:  WorkflowNodeType;
  passed:    boolean;
  message?:  string;
  nextNodes: string[];
}

export interface WorkflowExecutionContext {
  workflowRunId:   string;
  lastVerification: VerificationResult | null;
  iterationCounts:  Map<string, number>;
  completedNodeIds: Set<string>;
}

const MAX_ITERATIONS_PER_NODE = 5;

export class WorkflowEngine {
  constructor(
    private eventBus: TypedEventBus,
    private db:       Database,
  ) {}

  // ─── Load ─────────────────────────────────────────────────────

  async loadWorkflow(workflowId: string): Promise<Workflow> {
    const row = await this.db.getWorkflow(workflowId);
    if (!row) throw new Error(`Workflow not found: ${workflowId}`);
    return row;
  }

  createState(workflowRunId: string, workflow: Workflow): WorkflowState {
    const startNode = workflow.nodes.find(n => n.type === 'start');
    if (!startNode) throw new Error('Workflow has no start node');
    return {
      workflowId:      workflow.id,
      currentNodeId:   startNode.id,
      completedNodes:  [],
      failedNodes:     [],
      activeSessionId: null,
    };
  }

  // ─── Step ─────────────────────────────────────────────────────

  /**
   * Given the current workflow state and the result of the last step,
   * compute the next node to execute and return an updated state.
   */
  advance(
    workflow: Workflow,
    state:    WorkflowState,
    ctx:      WorkflowExecutionContext,
    lastPassed: boolean,
  ): WorkflowState {
    const currentId = state.currentNodeId;
    if (!currentId) return state;

    const current = workflow.nodes.find(n => n.id === currentId);
    if (!current) throw new Error(`Node not found: ${currentId}`);

    // Mark current node completed or failed
    const updatedCompleted = lastPassed
      ? [...state.completedNodes, currentId]
      : state.completedNodes;
    const updatedFailed = !lastPassed
      ? [...state.failedNodes, currentId]
      : state.failedNodes;

    // Find matching outbound edges
    const outEdges = workflow.edges.filter(e => e.source === currentId);
    const nextEdge = this.selectEdge(outEdges, lastPassed, ctx);

    if (!nextEdge) {
      // No valid edge → workflow ends
      return {
        ...state,
        currentNodeId:  null,
        completedNodes: updatedCompleted,
        failedNodes:    updatedFailed,
      };
    }

    const nextId = nextEdge.target;

    // Iteration guard — prevent infinite loops
    const count = ctx.iterationCounts.get(nextId) ?? 0;
    if (count >= MAX_ITERATIONS_PER_NODE) {
      console.warn(`[WorkflowEngine] Node ${nextId} exceeded max iterations (${MAX_ITERATIONS_PER_NODE})`);
      return {
        ...state,
        currentNodeId:  null,
        completedNodes: updatedCompleted,
        failedNodes:    [...updatedFailed, nextId],
      };
    }
    ctx.iterationCounts.set(nextId, count + 1);

    const total = workflow.nodes.length;
    const step  = updatedCompleted.length;
    this.eventBus.emit('WORKFLOW_STEP', {
      workflowRunId: ctx.workflowRunId,
      step,
      total,
      nodeId: nextId,
    });

    return {
      ...state,
      currentNodeId:  nextId,
      completedNodes: updatedCompleted,
      failedNodes:    updatedFailed,
    };
  }

  // ─── Node resolution ──────────────────────────────────────────

  /**
   * Resolve the Task (if any) for the current workflow node.
   * Returns null for structural nodes (start, end, test, parallel, merge).
   */
  resolveTask(node: WorkflowNode, allTasks: Task[]): Task | null {
    if (node.type !== 'agent') return null;
    if (!node.taskId) return null;
    return allTasks.find(t => t.id === node.taskId) ?? null;
  }

  isTerminal(node: WorkflowNode): boolean {
    return node.type === 'end';
  }

  isStructural(node: WorkflowNode): boolean {
    return ['start', 'end', 'parallel', 'merge'].includes(node.type);
  }

  // ─── Edge selection ───────────────────────────────────────────

  private selectEdge(
    edges:      WorkflowEdge[],
    lastPassed: boolean,
    ctx:        WorkflowExecutionContext,
  ): WorkflowEdge | null {
    if (edges.length === 0) return null;

    // Conditional edges: pass / fail
    const passEdge = edges.find(e => e.condition === 'pass');
    const failEdge = edges.find(e => e.condition === 'fail');
    const anyEdge  = edges.find(e => !e.condition || e.condition === 'any');

    if (passEdge && lastPassed) return passEdge;
    if (failEdge && !lastPassed) return failEdge;
    if (anyEdge) return anyEdge;

    // If multiple edges with no condition, take the first
    return edges[0] ?? null;
  }

  // ─── Parallel node handling ───────────────────────────────────

  /**
   * For a 'parallel' node, return all downstream agent nodes that
   * should be launched concurrently.
   */
  getParallelBranches(node: WorkflowNode, workflow: Workflow): WorkflowNode[] {
    if (node.type !== 'parallel') return [];
    const outEdges = workflow.edges.filter(e => e.source === node.id);
    return outEdges
      .map(e => workflow.nodes.find(n => n.id === e.target))
      .filter((n): n is WorkflowNode => !!n);
  }

  /**
   * Find the 'merge' node that follows a parallel split.
   */
  getMergeNode(parallelNode: WorkflowNode, workflow: Workflow): WorkflowNode | null {
    // BFS from parallel branches to find the convergence node
    const branches = this.getParallelBranches(parallelNode, workflow);
    for (const branch of branches) {
      const next = workflow.edges
        .filter(e => e.source === branch.id)
        .map(e => workflow.nodes.find(n => n.id === e.target))
        .find(n => n?.type === 'merge');
      if (next) return next;
    }
    return null;
  }

  // ─── Condition evaluation ─────────────────────────────────────

  evaluateCondition(
    condition: string,
    ctx: WorkflowExecutionContext,
  ): boolean {
    // Simple DSL: "tests.failed == 0", "build.passed == true"
    const last = ctx.lastVerification;
    if (!last) return true;

    if (condition === 'tests.passed')    return last.unitTests.failed === 0;
    if (condition === 'tests.failed')    return last.unitTests.failed > 0;
    if (condition === 'build.passed')    return last.build.passed;
    if (condition === 'build.failed')    return !last.build.passed;
    if (condition === 'all.passed')      return last.passed;
    if (condition === 'any.failed')      return !last.passed;

    // Numeric: "tests.failed < 3"
    const numMatch = condition.match(/tests\.failed\s*([<>=!]+)\s*(\d+)/);
    if (numMatch) {
      const op = numMatch[1]!;
      const n  = parseInt(numMatch[2]!, 10);
      const f  = last.unitTests.failed;
      if (op === '<')  return f < n;
      if (op === '<=') return f <= n;
      if (op === '>')  return f > n;
      if (op === '>=') return f >= n;
      if (op === '==') return f === n;
      if (op === '!=') return f !== n;
    }

    // Default: unknown condition → pass
    return true;
  }

  // ─── Persist state ────────────────────────────────────────────

  async saveState(workflowRunId: string, state: WorkflowState): Promise<void> {
    await this.db.updateWorkflowRun(workflowRunId, {
      status: state.currentNodeId ? 'running' : 'completed',
    });
  }
}
