// packages/core/src/__tests__/FailureRecovery.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FailureRecovery } from '../FailureRecovery.js';
import type { Task, AgentSession, VerificationResult } from '@ai-orch/protocol';

const mockBus: any  = { emit: vi.fn() };
const mockDb: any   = { insertEvent: vi.fn().mockResolvedValue(undefined) };
const mockRouter: any = {
  selectBest:       vi.fn().mockResolvedValue('claude'),
  recordRateLimit:  vi.fn(),
};

const task: Task = {
  id: 't1', masterId: 'run1', name: 'Build API', description: '',
  type: 'backend', dependencies: [], agentHint: null,
  priority: 2, status: 'running', createdAt: new Date().toISOString(),
};

const session: AgentSession = {
  id: 'codex-session-1', agentId: 'codex', taskId: 't1',
  pid: 1234, worktree: null, startedAt: new Date().toISOString(),
  status: 'stopped', tokensUsed: 20_000,
};

const passedVerification: VerificationResult = {
  policy: 'normal', passed: true,
  build: { passed: true, output: '', duration: 0 },
  lint:  { passed: true, output: '', duration: 0 },
  unitTests: { passed: 10, failed: 0, skipped: 0, duration: 3000, errors: [], suites: [] },
  intTests: null, security: null, duration: 3000,
};

const failedVerification: VerificationResult = {
  ...passedVerification,
  passed: false,
  unitTests: { passed: 7, failed: 3, skipped: 0, duration: 3000, errors: ['TypeError: x is undefined'], suites: [] },
};

function makeCtx(overrides = {}) {
  return {
    task, session, attempt: 1, maxAttempts: 3,
    lastVerification: null, failedAgents: new Set<string>(),
    ...overrides,
  };
}

describe('FailureRecovery', () => {
  let recovery: FailureRecovery;

  beforeEach(() => {
    recovery = new FailureRecovery(mockBus, mockRouter, mockDb);
    vi.clearAllMocks();
    mockRouter.selectBest.mockResolvedValue('claude');
  });

  describe('RATE_LIMITED', () => {
    it('switches to another agent when rate-limited', async () => {
      const ctx = makeCtx({ stopReason: 'RATE_LIMITED' });
      const action = await recovery.handleExitReason({ ...ctx, stopReason: 'RATE_LIMITED' });
      expect(action.strategy).toBe('SWITCH_AGENT');
      expect(action.targetAgent).toBe('claude');
      expect(mockRouter.recordRateLimit).toHaveBeenCalledWith('codex', expect.any(Number));
    });

    it('escalates to user when no alternative agent available', async () => {
      mockRouter.selectBest.mockRejectedValueOnce(new Error('No available agents'));
      const action = await recovery.handleExitReason({
        ...makeCtx(), stopReason: 'RATE_LIMITED',
        failedAgents: new Set(['codex', 'claude', 'cursor', 'gemini']),
      });
      expect(action.strategy).toBe('ASK_USER');
    });
  });

  describe('TEST_FAILURE', () => {
    it('dispatches debug agent on first test failure', async () => {
      const action = await recovery.handleExitReason({
        ...makeCtx({ lastVerification: failedVerification }),
        stopReason: 'TEST_FAILURE', attempt: 1,
      });
      expect(action.strategy).toBe('DISPATCH_DEBUG');
    });

    it('escalates to user after max retries', async () => {
      const action = await recovery.handleExitReason({
        ...makeCtx({ lastVerification: failedVerification }),
        stopReason: 'TEST_FAILURE', attempt: 3, maxAttempts: 3,
      });
      expect(action.strategy).toBe('ASK_USER');
    });

    it('emits RECOVERY_ESCALATED when max retries exceeded', async () => {
      await recovery.handleExitReason({
        ...makeCtx(), stopReason: 'TEST_FAILURE', attempt: 3, maxAttempts: 3,
      });
      expect(mockBus.emit).toHaveBeenCalledWith('RECOVERY_ESCALATED', expect.objectContaining({
        taskId: 't1',
      }));
    });
  });

  describe('STUCK', () => {
    it('asks user for clarification on first stuck', async () => {
      const action = await recovery.handleExitReason({
        ...makeCtx(), stopReason: 'STUCK', attempt: 1,
      });
      expect(action.strategy).toBe('ASK_USER');
    });

    it('escalates if stuck repeatedly', async () => {
      const action = await recovery.handleExitReason({
        ...makeCtx(), stopReason: 'STUCK', attempt: 2, maxAttempts: 3,
      });
      expect(action.strategy).toBe('ASK_USER');
    });
  });

  describe('CRASH', () => {
    it('switches agent after crash', async () => {
      const action = await recovery.handleExitReason({
        ...makeCtx(), stopReason: 'CRASH',
      });
      expect(['SWITCH_AGENT', 'RETRY_SAME']).toContain(action.strategy);
    });

    it('retries same agent when no alternative exists', async () => {
      mockRouter.selectBest.mockRejectedValueOnce(new Error('No available agents'));
      const action = await recovery.handleExitReason({
        ...makeCtx(), stopReason: 'CRASH',
        failedAgents: new Set(['codex', 'claude', 'cursor']),
      });
      expect(action.strategy).toBe('RETRY_SAME');
    });
  });

  describe('NEEDS_INPUT', () => {
    it('emits USER_PROMPT_NEEDED and returns ASK_USER', async () => {
      const action = await recovery.handleExitReason({
        ...makeCtx(), stopReason: 'NEEDS_INPUT',
      });
      expect(action.strategy).toBe('ASK_USER');
      expect(mockBus.emit).toHaveBeenCalledWith('USER_PROMPT_NEEDED', expect.objectContaining({
        sessionId: 'codex-session-1',
      }));
    });
  });

  describe('AUTH_ERROR', () => {
    it('prompts user to reconfigure credentials', async () => {
      const action = await recovery.handleExitReason({
        ...makeCtx(), stopReason: 'AUTH_ERROR',
      });
      expect(action.strategy).toBe('ASK_USER');
      expect(action.message).toMatch(/auth/i);
    });
  });

  describe('USER_STOPPED', () => {
    it('returns ASK_USER without escalation events', async () => {
      const action = await recovery.handleExitReason({
        ...makeCtx(), stopReason: 'USER_STOPPED',
      });
      expect(action.strategy).toBe('ASK_USER');
    });
  });

  describe('RECOVERY_STARTED event', () => {
    it('always emits RECOVERY_STARTED regardless of reason', async () => {
      for (const reason of ['RATE_LIMITED', 'CRASH', 'STUCK', 'TEST_FAILURE'] as const) {
        vi.clearAllMocks();
        await recovery.handleExitReason({ ...makeCtx(), stopReason: reason });
        expect(mockBus.emit).toHaveBeenCalledWith('RECOVERY_STARTED', expect.objectContaining({
          reason,
          sessionId: 'codex-session-1',
        }));
      }
    });
  });
});
