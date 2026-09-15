// packages/core/src/__tests__/WorkflowEngine.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WorkflowEngine, type WorkflowExecutionContext } from '../WorkflowEngine.js';
import type { Workflow, VerificationResult } from '@ai-orch/protocol';

const mockDb: any = {
  getWorkflow:    vi.fn(),
  updateWorkflowRun: vi.fn(),
  insertEvent:    vi.fn().mockResolvedValue(undefined),
};
const mockBus: any = {
  emit: vi.fn(),
  on:   vi.fn(),
};

// ─── Fixtures ─────────────────────────────────────────────────

function linearWorkflow(): Workflow {
  return {
    id: 'wf1', name: 'Linear',
    nodes: [
      { id: 'n-start',  type: 'start',     label: 'Start',   position: { x: 0,   y: 0 } },
      { id: 'n-agent1', type: 'agent',      label: 'Codex',   agentId: 'codex',  taskId: 't1', position: { x: 200, y: 0 } },
      { id: 'n-test',   type: 'test',       label: 'Test',    policy: 'normal',  position: { x: 400, y: 0 } },
      { id: 'n-agent2', type: 'agent',      label: 'Claude',  agentId: 'claude', taskId: 't2', position: { x: 600, y: 0 } },
      { id: 'n-end',    type: 'end',        label: 'Done',    position: { x: 800, y: 0 } },
    ],
    edges: [
      { id: 'e1', source: 'n-start',  target: 'n-agent1' },
      { id: 'e2', source: 'n-agent1', target: 'n-test' },
      { id: 'e3', source: 'n-test',   target: 'n-agent2', condition: 'pass' },
      { id: 'e4', source: 'n-test',   target: 'n-agent1', condition: 'fail' },
      { id: 'e5', source: 'n-agent2', target: 'n-end' },
    ],
  };
}

function branchingWorkflow(): Workflow {
  return {
    id: 'wf2', name: 'Branching',
    nodes: [
      { id: 'n-start', type: 'start',     label: 'Start', position: { x: 0,   y: 0 } },
      { id: 'n-agent', type: 'agent',      label: 'Agent', agentId: 'claude', taskId: 't1', position: { x: 200, y: 0 } },
      { id: 'n-cond',  type: 'condition',  label: 'Check', condition: 'tests.passed', position: { x: 400, y: 0 } },
      { id: 'n-pass',  type: 'end',        label: 'Done',  position: { x: 600, y: 0 } },
      { id: 'n-fail',  type: 'agent',      label: 'Debug', agentId: 'claude', taskId: 't2', position: { x: 600, y: 100 } },
    ],
    edges: [
      { id: 'e1', source: 'n-start', target: 'n-agent' },
      { id: 'e2', source: 'n-agent', target: 'n-cond' },
      { id: 'e3', source: 'n-cond',  target: 'n-pass', condition: 'pass' },
      { id: 'e4', source: 'n-cond',  target: 'n-fail', condition: 'fail' },
    ],
  };
}

function makeCtx(overrides: Partial<WorkflowExecutionContext> = {}): WorkflowExecutionContext {
  return {
    workflowRunId:    'run1',
    lastVerification: null,
    iterationCounts:  new Map(),
    completedNodeIds: new Set(),
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────

describe('WorkflowEngine', () => {
  let engine: WorkflowEngine;

  beforeEach(() => {
    engine = new WorkflowEngine(mockBus, mockDb);
    vi.clearAllMocks();
  });

  describe('createState', () => {
    it('sets currentNodeId to the start node', () => {
      const wf    = linearWorkflow();
      const state = engine.createState('run1', wf);
      expect(state.currentNodeId).toBe('n-start');
      expect(state.completedNodes).toEqual([]);
      expect(state.failedNodes).toEqual([]);
    });

    it('throws when workflow has no start node', () => {
      const wf = linearWorkflow();
      wf.nodes = wf.nodes.filter(n => n.type !== 'start');
      expect(() => engine.createState('run1', wf)).toThrow('no start node');
    });
  });

  describe('advance — unconditional edges', () => {
    it('moves from start → first agent on success', () => {
      const wf  = linearWorkflow();
      const ctx = makeCtx();
      let state = engine.createState('run1', wf);

      state = engine.advance(wf, state, ctx, true);
      expect(state.currentNodeId).toBe('n-agent1');
      expect(state.completedNodes).toContain('n-start');
    });

    it('marks node as completed when passed=true', () => {
      const wf  = linearWorkflow();
      const ctx = makeCtx();
      let state = engine.createState('run1', wf);

      state = engine.advance(wf, state, ctx, true);
      expect(state.completedNodes).toContain('n-start');
      expect(state.failedNodes).not.toContain('n-start');
    });

    it('marks node as failed when passed=false', () => {
      const wf  = linearWorkflow();
      const ctx = makeCtx();
      let state = engine.createState('run1', wf);

      state = engine.advance(wf, state, ctx, false);
      expect(state.failedNodes).toContain('n-start');
    });
  });

  describe('advance — conditional edges', () => {
    it('follows pass edge when lastPassed=true', () => {
      const wf  = linearWorkflow();
      const ctx = makeCtx();
      // Fast-forward to test node
      let state = engine.createState('run1', wf);
      state = { ...state, currentNodeId: 'n-test' };

      state = engine.advance(wf, state, ctx, true);
      expect(state.currentNodeId).toBe('n-agent2'); // pass edge
    });

    it('follows fail edge when lastPassed=false (retry loop)', () => {
      const wf  = linearWorkflow();
      const ctx = makeCtx();
      let state = engine.createState('run1', wf);
      state = { ...state, currentNodeId: 'n-test' };

      state = engine.advance(wf, state, ctx, false);
      expect(state.currentNodeId).toBe('n-agent1'); // fail → retry
    });
  });

  describe('iteration guard', () => {
    it('stops a retry loop after MAX_ITERATIONS', () => {
      const wf  = linearWorkflow();
      const ctx = makeCtx();
      // Pre-set iteration count at limit
      ctx.iterationCounts.set('n-agent1', 5);
      let state = engine.createState('run1', wf);
      state = { ...state, currentNodeId: 'n-test' };

      state = engine.advance(wf, state, ctx, false); // would retry n-agent1
      // Should terminate instead of looping forever
      expect(state.currentNodeId).toBeNull();
    });
  });

  describe('terminal nodes', () => {
    it('returns currentNodeId=null when reaching end node with no outbound edges', () => {
      const wf  = linearWorkflow();
      const ctx = makeCtx();
      let state = engine.createState('run1', wf);
      state = { ...state, currentNodeId: 'n-end' };

      state = engine.advance(wf, state, ctx, true);
      expect(state.currentNodeId).toBeNull();
    });

    it('isTerminal returns true for end nodes', () => {
      const endNode = linearWorkflow().nodes.find(n => n.type === 'end')!;
      expect(engine.isTerminal(endNode)).toBe(true);
    });

    it('isTerminal returns false for agent nodes', () => {
      const agentNode = linearWorkflow().nodes.find(n => n.type === 'agent')!;
      expect(engine.isTerminal(agentNode)).toBe(false);
    });
  });

  describe('isStructural', () => {
    it('returns true for start/end/parallel/merge', () => {
      const wf = linearWorkflow();
      const start = wf.nodes.find(n => n.type === 'start')!;
      const end   = wf.nodes.find(n => n.type === 'end')!;
      expect(engine.isStructural(start)).toBe(true);
      expect(engine.isStructural(end)).toBe(true);
    });

    it('returns false for agent/test nodes', () => {
      const wf   = linearWorkflow();
      const agent = wf.nodes.find(n => n.type === 'agent')!;
      const test  = wf.nodes.find(n => n.type === 'test')!;
      expect(engine.isStructural(agent)).toBe(false);
      expect(engine.isStructural(test)).toBe(false);
    });
  });

  describe('evaluateCondition', () => {
    const passedVerification: VerificationResult = {
      policy: 'normal', passed: true,
      build: { passed: true, output: '', duration: 0 },
      lint:  { passed: true, output: '', duration: 0 },
      unitTests: { passed: 12, failed: 0, skipped: 0, duration: 5000, errors: [], suites: [] },
      intTests: null, security: null, duration: 5000,
    };

    const failedVerification: VerificationResult = {
      ...passedVerification,
      passed: false,
      unitTests: { passed: 8, failed: 4, skipped: 0, duration: 5000, errors: ['AssertionError'], suites: [] },
    };

    it('"tests.passed" → true when 0 failures', () => {
      const ctx = makeCtx({ lastVerification: passedVerification });
      expect(engine.evaluateCondition('tests.passed', ctx)).toBe(true);
    });

    it('"tests.passed" → false when failures exist', () => {
      const ctx = makeCtx({ lastVerification: failedVerification });
      expect(engine.evaluateCondition('tests.passed', ctx)).toBe(false);
    });

    it('"tests.failed < 3" → true when 0 failures', () => {
      const ctx = makeCtx({ lastVerification: passedVerification });
      expect(engine.evaluateCondition('tests.failed < 3', ctx)).toBe(true);
    });

    it('"tests.failed < 3" → false when 4 failures', () => {
      const ctx = makeCtx({ lastVerification: failedVerification });
      expect(engine.evaluateCondition('tests.failed < 3', ctx)).toBe(false);
    });

    it('"all.passed" → true when verification passed', () => {
      const ctx = makeCtx({ lastVerification: passedVerification });
      expect(engine.evaluateCondition('all.passed', ctx)).toBe(true);
    });

    it('returns true for unknown condition (safe default)', () => {
      const ctx = makeCtx({ lastVerification: passedVerification });
      expect(engine.evaluateCondition('some.unknown.condition', ctx)).toBe(true);
    });

    it('returns true when no verification available', () => {
      const ctx = makeCtx({ lastVerification: null });
      expect(engine.evaluateCondition('tests.passed', ctx)).toBe(true);
    });
  });

  describe('events', () => {
    it('emits WORKFLOW_STEP on each advance', () => {
      const wf  = linearWorkflow();
      const ctx = makeCtx();
      let state = engine.createState('run1', wf);
      engine.advance(wf, state, ctx, true);
      expect(mockBus.emit).toHaveBeenCalledWith('WORKFLOW_STEP', expect.objectContaining({
        workflowRunId: 'run1',
      }));
    });
  });
});
