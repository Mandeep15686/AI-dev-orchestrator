// packages/core/src/__tests__/ContextEngine.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ContextEngine } from '../ContextEngine.js';
import type { Task, ProjectMeta, AgentCapabilities } from '@ai-orch/protocol';

const caps: AgentCapabilities = {
  interfaces: ['cli'], strengths: [], weaknesses: [], bestFor: [],
  languages: ['typescript'], supportsParallel: true, supportsResume: false,
  supportsStreaming: true, supportsWorktrees: true, maxContextTokens: 128_000,
};

const project: ProjectMeta = {
  id: 'p1', name: 'My App', path: '/tmp/test',
  gitRemote: null, language: 'typescript',
  settings: {
    verificationPolicy: 'normal', maxRetries: 3,
    sessionTimeoutMs: 30_000, maxTokensPerSession: 80_000,
    enableParallel: true, codegraphEnabled: true, preferredAgents: [],
  },
  createdAt: new Date().toISOString(),
};

const task: Task = {
  id: 't1', masterId: 'run1', name: 'Build auth API', description: 'JWT endpoints',
  type: 'backend', dependencies: [], agentHint: null,
  priority: 2, status: 'pending', createdAt: new Date().toISOString(),
};

const mockGit: any = {
  status: vi.fn().mockResolvedValue({
    branch: 'main', commit: 'abc123def456', dirty: true,
    files: [{ path: 'src/auth.ts', status: 'modified' }],
  }),
  log: vi.fn().mockResolvedValue([
    { oid: 'abc123', message: 'feat: add login', author: 'dev', time: Date.now() / 1000 },
  ]),
  diff: vi.fn().mockResolvedValue('--- a/src/auth.ts\n+++ b/src/auth.ts\n@@ -1 +1 @@\n-old\n+new'),
};

const mockCodegraph: any = {
  query: vi.fn().mockResolvedValue({
    symbols: [
      { name: 'AuthService', kind: 'class', filePath: 'src/auth.ts', line: 1 },
      { name: 'login', kind: 'function', filePath: 'src/auth.ts', line: 10 },
    ],
    dependencies: [], callPaths: [],
  }),
};

const mockDb: any = {
  getHandoffSummaries:  vi.fn().mockResolvedValue([]),
  getLastVerification:  vi.fn().mockResolvedValue(null),
};

describe('ContextEngine', () => {
  let engine: ContextEngine;

  beforeEach(() => {
    engine = new ContextEngine(mockDb, mockGit, mockCodegraph);
    vi.clearAllMocks();
  });

  describe('buildContextPackage', () => {
    it('returns a complete ContextPackage with all layers', async () => {
      const pkg = await engine.buildContextPackage(task, 'claude', project, caps);

      expect(pkg.task).toMatchObject({ id: 't1' });
      expect(pkg.project).toMatchObject({ id: 'p1' });
      expect(pkg.gitContext.branch).toBe('main');
      expect(pkg.gitContext.commit).toBe('abc123def456');
      expect(typeof pkg.tokenEstimate).toBe('number');
      expect(pkg.tokenEstimate).toBeGreaterThan(0);
    });

    it('includes git diff', async () => {
      const pkg = await engine.buildContextPackage(task, 'claude', project, caps);
      expect(pkg.gitContext.diff).toContain('src/auth.ts');
    });

    it('includes CodeGraph symbols when enabled', async () => {
      const pkg = await engine.buildContextPackage(task, 'claude', project, caps);
      expect(pkg.codeContext.symbols.length).toBeGreaterThan(0);
      expect(pkg.codeContext.symbols[0]!.name).toBe('AuthService');
    });

    it('skips CodeGraph when disabled in project settings', async () => {
      const disabledProject = {
        ...project,
        settings: { ...project.settings, codegraphEnabled: false },
      };
      await engine.buildContextPackage(task, 'claude', disabledProject, caps);
      expect(mockCodegraph.query).not.toHaveBeenCalled();
    });

    it('loads handoff history from DB', async () => {
      const summary = {
        checkpointId: 'cp1', agentId: 'codex', taskId: 't1',
        gitCommit: 'abc', exitReason: 'COMPLETED' as const,
        completed: ['User model'], remaining: [], decisions: [],
        testsPass: true, timestamp: new Date().toISOString(),
      };
      mockDb.getHandoffSummaries.mockResolvedValueOnce([summary]);
      const pkg = await engine.buildContextPackage(task, 'claude', project, caps);
      expect(pkg.handoffHistory).toHaveLength(1);
      expect(pkg.handoffHistory[0]!.agentId).toBe('codex');
    });

    it('includes last test status when available', async () => {
      const fakeVerification = {
        policy: 'normal', passed: true,
        build: { passed: true, output: '', duration: 0 },
        lint:  { passed: true, output: '', duration: 0 },
        unitTests: { passed: 5, failed: 0, skipped: 0, duration: 1000, errors: [], suites: [] },
        intTests: null, security: null, duration: 1000,
      };
      mockDb.getLastVerification.mockResolvedValueOnce(fakeVerification);
      const pkg = await engine.buildContextPackage(task, 'claude', project, caps);
      expect(pkg.testStatus).not.toBeNull();
      expect(pkg.testStatus?.unitTests.passed).toBe(5);
    });
  });

  describe('cache', () => {
    it('returns cached result on repeated call', async () => {
      await engine.buildContextPackage(task, 'claude', project, caps);
      await engine.buildContextPackage(task, 'claude', project, caps);
      // Git should be called only once — second call hits cache
      expect(mockGit.status).toHaveBeenCalledTimes(1);
    });

    it('invalidate() clears cache for specific task', async () => {
      await engine.buildContextPackage(task, 'claude', project, caps);
      engine.invalidate('t1');
      await engine.buildContextPackage(task, 'claude', project, caps);
      expect(mockGit.status).toHaveBeenCalledTimes(2);
    });

    it('invalidate() with no arg clears all cached entries', async () => {
      await engine.buildContextPackage(task, 'claude', project, caps);
      engine.invalidate();
      await engine.buildContextPackage(task, 'claude', project, caps);
      expect(mockGit.status).toHaveBeenCalledTimes(2);
    });
  });

  describe('token budget', () => {
    it('tokenEstimate is within 65% of maxContextTokens', async () => {
      const pkg = await engine.buildContextPackage(task, 'claude', project, caps);
      expect(pkg.tokenEstimate).toBeLessThan(caps.maxContextTokens * 0.65);
    });
  });
});
