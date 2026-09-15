// packages/core/src/__tests__/AgentAdapter.test.ts
// Tests for the BaseAgentAdapter helpers shared by all adapters
import { describe, it, expect } from 'vitest';
import { BaseAgentAdapter }     from '../../agents/shared/src/AgentAdapter.js';
import type {
  AgentCapabilities, AgentDetectionResult,
  AgentSession, AgentEvent, Task, ContextPackage, SessionOptions, StopReason,
} from '@ai-orch/protocol';

// Minimal concrete subclass for testing the base helpers
class TestAdapter extends BaseAgentAdapter {
  readonly id = 'test';
  readonly capabilities: AgentCapabilities = {
    interfaces: ['cli'], strengths: [], weaknesses: [], bestFor: [],
    languages: ['typescript'], supportsParallel: true, supportsResume: false,
    supportsStreaming: true, supportsWorktrees: true, maxContextTokens: 128_000,
  };
  detect = async (): Promise<AgentDetectionResult> => ({ available: true, version: '1.0', cliPath: '/bin/test', authStatus: 'authenticated', status: 'available' });
  startSession  = async (_t: Task, _c: ContextPackage, _o: SessionOptions): Promise<AgentSession> => { throw new Error('not implemented'); };
  resumeSession = async (_s: AgentSession, _c: ContextPackage): Promise<AgentSession> => { throw new Error('not implemented'); };
  sendPrompt    = async (): Promise<void> => {};
  streamEvents  = async function*(): AsyncGenerator<AgentEvent> {};
  waitForStop   = async (): Promise<StopReason> => 'COMPLETED';
  stop          = async (): Promise<void> => {};
}

const adapter = new TestAdapter();

const mockTask: Task = {
  id: 't1', masterId: 'run1', name: 'Build Auth', description: 'JWT auth',
  type: 'backend', dependencies: [], agentHint: null,
  priority: 2, status: 'pending', createdAt: new Date().toISOString(),
};

const mockCtx: ContextPackage = {
  task: mockTask,
  project: {
    id: 'p1', name: 'My App', path: '/tmp/myapp',
    gitRemote: null, language: 'typescript',
    settings: { verificationPolicy: 'normal', maxRetries: 3, sessionTimeoutMs: 30000, maxTokensPerSession: 80000, enableParallel: true, codegraphEnabled: true, preferredAgents: [] },
    createdAt: new Date().toISOString(),
  },
  gitContext: {
    branch: 'main', commit: 'abc123', dirty: true,
    recentCommits: [{ oid: 'abc123', message: 'feat: init', author: 'dev', time: Date.now() / 1000 }],
    diff: '--- a/src/auth.ts\n+++ b/src/auth.ts\n', filesChanged: ['src/auth.ts'],
  },
  codeContext: {
    symbols:      [{ name: 'AuthService', kind: 'class', filePath: 'src/auth.ts', line: 1 }],
    dependencies: [],
    callPaths:    [],
  },
  handoffHistory: [],
  testStatus:     null,
  tokenEstimate:  1200,
};

describe('BaseAgentAdapter', () => {
  describe('buildSystemPrompt', () => {
    it('includes task name and description', () => {
      const prompt = adapter.buildSystemPrompt(mockTask, mockCtx);
      expect(prompt).toContain('Build Auth');
      expect(prompt).toContain('JWT auth');
    });

    it('includes project name', () => {
      const prompt = adapter.buildSystemPrompt(mockTask, mockCtx);
      expect(prompt).toContain('My App');
    });

    it('includes git branch and commit', () => {
      const prompt = adapter.buildSystemPrompt(mockTask, mockCtx);
      expect(prompt).toContain('main');
      expect(prompt).toContain('abc123');
    });

    it('includes CodeGraph symbols', () => {
      const prompt = adapter.buildSystemPrompt(mockTask, mockCtx);
      expect(prompt).toContain('AuthService');
    });

    it('includes handoff history when present', () => {
      const ctxWithHandoff = {
        ...mockCtx,
        handoffHistory: [{
          checkpointId: 'cp1', agentId: 'codex' as const, taskId: 't1',
          gitCommit: 'def456', exitReason: 'RATE_LIMITED' as const,
          completed: ['User model created'], remaining: ['JWT middleware'],
          decisions: ['bcrypt cost=12'], testsPass: true,
          timestamp: new Date().toISOString(),
        }],
      };
      const prompt = adapter.buildSystemPrompt(mockTask, ctxWithHandoff);
      expect(prompt).toContain('codex');
      expect(prompt).toContain('User model created');
      expect(prompt).toContain('JWT middleware');
    });

    it('includes test status when available', () => {
      const ctxWithTests = {
        ...mockCtx,
        testStatus: {
          policy: 'normal' as const, passed: true,
          build: { passed: true, output: '', duration: 0 },
          lint:  { passed: true, output: '', duration: 0 },
          unitTests: { passed: 12, failed: 2, skipped: 0, duration: 3000, errors: [], suites: [] },
          intTests: null, security: null, duration: 3000,
        },
      };
      const prompt = adapter.buildSystemPrompt(mockTask, ctxWithTests);
      expect(prompt).toContain('12');
      expect(prompt).toContain('2');
    });

    it('includes TASK_COMPLETED instruction', () => {
      const prompt = adapter.buildSystemPrompt(mockTask, mockCtx);
      expect(prompt).toContain('TASK_COMPLETED');
    });

    it('returns a string longer than 200 characters', () => {
      const prompt = adapter.buildSystemPrompt(mockTask, mockCtx);
      expect(prompt.length).toBeGreaterThan(200);
    });
  });

  describe('detectStopSignal (protected, tested via subclass)', () => {
    class ExposedAdapter extends TestAdapter {
      publicDetect(line: string) { return this.detectStopSignal(line); }
    }
    const exp = new ExposedAdapter();

    it('returns COMPLETED for TASK_COMPLETED output', () => {
      expect(exp.publicDetect('TASK_COMPLETED: all done')).toBe('COMPLETED');
    });

    it('returns RATE_LIMITED for rate limit messages', () => {
      expect(exp.publicDetect('Error: rate limit exceeded, please wait')).toBe('RATE_LIMITED');
    });

    it('returns TOKEN_LIMIT for context-full messages', () => {
      expect(exp.publicDetect('context window is full, token limit reached')).toBe('TOKEN_LIMIT');
    });

    it('returns NEEDS_INPUT for NEEDS_INPUT output', () => {
      expect(exp.publicDetect('NEEDS_INPUT: please specify the database schema')).toBe('NEEDS_INPUT');
    });

    it('returns null for normal output', () => {
      expect(exp.publicDetect('Creating user model...')).toBeNull();
      expect(exp.publicDetect('src/auth.ts written')).toBeNull();
    });
  });

  describe('detectFileChange (protected, tested via subclass)', () => {
    class ExposedAdapter extends TestAdapter {
      publicDetectFile(line: string) { return this.detectFileChange(line, 'session-1'); }
    }
    const exp = new ExposedAdapter();

    it('detects created files', () => {
      const result = exp.publicDetectFile('Created src/auth.ts successfully');
      expect(result).not.toBeNull();
      expect(result?.changeType).toBe('added');
      expect(result?.path).toContain('auth.ts');
    });

    it('detects modified files', () => {
      const result = exp.publicDetectFile('Modified src/user.ts with bcrypt');
      expect(result).not.toBeNull();
      expect(result?.changeType).toBe('modified');
    });

    it('detects deleted files', () => {
      const result = exp.publicDetectFile('Deleted old/legacy.ts');
      expect(result).not.toBeNull();
      expect(result?.changeType).toBe('deleted');
    });

    it('returns null for non-file lines', () => {
      expect(exp.publicDetectFile('Starting the auth implementation...')).toBeNull();
      expect(exp.publicDetectFile('Running tests...')).toBeNull();
    });
  });
});
