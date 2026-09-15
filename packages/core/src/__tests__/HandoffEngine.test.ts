// packages/core/src/__tests__/HandoffEngine.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HandoffEngine } from '../HandoffEngine.js';
import type { AgentSession, Task, VerificationResult } from '@ai-orch/protocol';

const mockSession: AgentSession = {
  id: 'claude-1234', agentId: 'claude', taskId: 't1',
  pid: 1234, worktree: null,
  startedAt: new Date().toISOString(),
  status: 'stopped', tokensUsed: 15_000,
};

const mockTask: Task = {
  id: 't1', masterId: 'run1',
  name: 'Implement auth API', description: 'JWT auth endpoints',
  type: 'backend', dependencies: [], agentHint: 'claude',
  priority: 1, status: 'running', createdAt: new Date().toISOString(),
};

const mockVerification: VerificationResult = {
  policy: 'normal', passed: true,
  build: { passed: true, output: '', duration: 2000 },
  lint:  { passed: true, output: '', duration: 500 },
  unitTests: { passed: 12, failed: 0, skipped: 0, duration: 5000, errors: [], suites: ['auth.test.ts'] },
  intTests: null, security: null, duration: 7500,
};

describe('HandoffEngine', () => {
  let engine: HandoffEngine;

  beforeEach(() => {
    engine = new HandoffEngine();
  });

  describe('generateHandoff', () => {
    it('produces a valid HandoffJSON with correct version', () => {
      const raw = {
        lines: [
          'Created login endpoint POST /auth/login',
          'Implemented JWT token signing',
          'TASK_COMPLETED: Auth API implemented',
        ],
        exitReason: 'COMPLETED' as const,
        duration: 120_000,
      };

      const handoff = engine.generateHandoff(
        mockSession, mockTask, raw,
        'abc1234', ['src/auth.ts', 'src/middleware.ts'], mockVerification,
      );

      expect(handoff.version).toBe('1.0');
      expect(handoff.agent).toBe('claude');
      expect(handoff.taskId).toBe('t1');
      expect(handoff.gitCommit).toBe('abc1234');
      expect(handoff.exitReason).toBe('COMPLETED');
      expect(handoff.filesModified).toEqual(['src/auth.ts', 'src/middleware.ts']);
      expect(handoff.tests.passed).toBe(12);
      expect(handoff.tests.failed).toBe(0);
    });

    it('extracts completed items from agent output', () => {
      const raw = {
        lines: [
          'Created the User model with bcrypt hashing',
          'Added JWT middleware for token validation',
          'Implemented refresh token rotation logic',
        ],
        exitReason: 'COMPLETED' as const,
        duration: 60_000,
      };

      const handoff = engine.generateHandoff(
        mockSession, mockTask, raw, 'abc', [], mockVerification,
      );

      expect(handoff.completed.length).toBeGreaterThan(0);
    });

    it('extracts architectural decisions', () => {
      const raw = {
        lines: [
          'DECISION: Used bcrypt with cost factor 12 for password hashing',
          'DECISION: Storing JWT in httpOnly cookies instead of localStorage',
        ],
        exitReason: 'COMPLETED' as const,
        duration: 90_000,
      };

      const handoff = engine.generateHandoff(
        mockSession, mockTask, raw, 'abc', [], mockVerification,
      );

      expect(handoff.decisions.length).toBeGreaterThan(0);
      expect(handoff.decisions.some(d => /bcrypt/i.test(d))).toBe(true);
    });

    it('extracts known issues', () => {
      const raw = {
        lines: ['KNOWN ISSUE: Refresh token cleanup job not implemented yet'],
        exitReason: 'PARTIAL' as const,
        duration: 30_000,
      };
      const handoff = engine.generateHandoff(
        mockSession, mockTask, raw, 'abc', [], mockVerification,
      );
      expect(handoff.knownIssues.length).toBeGreaterThan(0);
    });

    it('includes timestamp as valid ISO string', () => {
      const raw = { lines: [], exitReason: 'COMPLETED' as const, duration: 1000 };
      const handoff = engine.generateHandoff(mockSession, mockTask, raw, 'abc', [], mockVerification);
      expect(() => new Date(handoff.timestamp)).not.toThrow();
      expect(new Date(handoff.timestamp).getFullYear()).toBeGreaterThan(2020);
    });
  });

  describe('toSummary', () => {
    it('converts HandoffJSON to HandoffSummary correctly', () => {
      const raw = { lines: [], exitReason: 'COMPLETED' as const, duration: 0 };
      const handoff = engine.generateHandoff(mockSession, mockTask, raw, 'xyz789', [], mockVerification);
      const summary = engine.toSummary(handoff);

      expect(summary.agentId).toBe('claude');
      expect(summary.gitCommit).toBe('xyz789');
      expect(summary.testsPass).toBe(true);
      expect(summary.exitReason).toBe('COMPLETED');
    });
  });

  describe('buildNextPrompt', () => {
    it('includes previous agent name and commit', () => {
      const raw = { lines: [], exitReason: 'RATE_LIMITED' as const, duration: 0 };
      const handoff = engine.generateHandoff(mockSession, mockTask, raw, 'dead1234', [], mockVerification);
      const prompt = engine.buildNextPrompt(handoff, mockTask, 'codex');

      expect(prompt).toContain('claude');
      expect(prompt).toContain('dead123');
      expect(prompt).toContain('RATE_LIMITED');
    });

    it('includes remaining items when present', () => {
      const raw = {
        lines: ['TODO: Add refresh token endpoint'],
        exitReason: 'RATE_LIMITED' as const,
        duration: 0,
      };
      const handoff = engine.generateHandoff(mockSession, mockTask, raw, 'abc', [], mockVerification);
      const prompt = engine.buildNextPrompt(handoff, mockTask, 'codex');
      expect(prompt.length).toBeGreaterThan(100);
    });
  });
});
