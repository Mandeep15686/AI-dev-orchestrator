// packages/core/src/__tests__/AgentRouter.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AgentRouter } from '../AgentRouter.js';
import type { AgentAdapter } from '../../agents/shared/src/AgentAdapter.js';
import type { AgentCapabilities, AgentDetectionResult, Task } from '@ai-orch/protocol';

// ─── Mock adapter factory ────────────────────────────────────
function makeAdapter(id: string, opts: Partial<AgentCapabilities> = {}): AgentAdapter {
  const caps: AgentCapabilities = {
    interfaces:        ['cli'],
    strengths:         opts.strengths         ?? [],
    weaknesses:        [],
    bestFor:           opts.bestFor           ?? [],
    languages:         opts.languages         ?? ['typescript'],
    supportsParallel:  opts.supportsParallel  ?? true,
    supportsResume:    false,
    supportsStreaming: true,
    supportsWorktrees: true,
    maxContextTokens:  128_000,
  };

  return {
    id,
    capabilities: caps,
    detect: vi.fn().mockResolvedValue({
      available: true, version: '1.0', cliPath: '/usr/bin/' + id,
      authStatus: 'authenticated', status: 'available',
    } as AgentDetectionResult),
    startSession:  vi.fn(),
    resumeSession: vi.fn(),
    sendPrompt:    vi.fn(),
    streamEvents:  vi.fn(),
    waitForStop:   vi.fn(),
    stop:          vi.fn(),
    buildSystemPrompt: vi.fn().mockReturnValue('prompt'),
  } as unknown as AgentAdapter;
}

// ─── Mock database ────────────────────────────────────────────
const mockDb = {
  getAgentMetrics:    vi.fn().mockResolvedValue(null),
  upsertAgentMetrics: vi.fn().mockResolvedValue(undefined),
} as any;

// ─── Task fixture ─────────────────────────────────────────────
const backendTask: Task = {
  id: 't1', masterId: 'run1', name: 'Build API', description: '',
  type: 'backend', dependencies: [], agentHint: null,
  priority: 2, status: 'pending', createdAt: new Date().toISOString(),
};
const frontendTask: Task = { ...backendTask, id: 't2', name: 'Build UI', type: 'frontend' };
const debugTask:    Task = { ...backendTask, id: 't3', name: 'Fix bug',  type: 'debug' };

// ─── Tests ────────────────────────────────────────────────────
describe('AgentRouter', () => {
  let router: AgentRouter;
  let claudeAdapter: AgentAdapter;
  let codexAdapter:  AgentAdapter;
  let cursorAdapter: AgentAdapter;

  beforeEach(() => {
    router = new AgentRouter(mockDb);

    claudeAdapter = makeAdapter('claude', {
      strengths: ['reasoning', 'architecture', 'review', 'debugging'],
      bestFor:   ['backend', 'debug', 'review', 'testing'],
      languages: ['typescript', 'python', 'rust'],
    });
    codexAdapter = makeAdapter('codex', {
      strengths: ['implementation', 'refactoring'],
      bestFor:   ['backend', 'database', 'general'],
      languages: ['typescript', 'javascript', 'python'],
    });
    cursorAdapter = makeAdapter('cursor', {
      strengths: ['frontend', 'UI', 'styling'],
      bestFor:   ['frontend', 'refactor'],
      languages: ['typescript', 'javascript', 'css'],
    });

    router.registerAdapter(claudeAdapter);
    router.registerAdapter(codexAdapter);
    router.registerAdapter(cursorAdapter);
  });

  describe('selectBest', () => {
    it('prefers Claude for backend tasks (highest bestFor match + reasoning strength)', async () => {
      const chosen = await router.selectBest(backendTask, { projectLanguage: 'typescript' });
      expect(['claude', 'codex']).toContain(chosen); // both match backend
    });

    it('prefers Cursor for frontend tasks', async () => {
      const chosen = await router.selectBest(frontendTask, { projectLanguage: 'typescript' });
      expect(chosen).toBe('cursor');
    });

    it('respects forceAgent override', async () => {
      const chosen = await router.selectBest(frontendTask, { forceAgent: 'claude' });
      expect(chosen).toBe('claude');
    });

    it('excludes rate-limited agents', async () => {
      router.recordRateLimit('claude', 60_000);
      const chosen = await router.selectBest(backendTask, { excludeAgents: ['claude'] });
      expect(chosen).not.toBe('claude');
    });

    it('throws when all agents are excluded', async () => {
      await expect(
        router.selectBest(backendTask, { excludeAgents: ['claude', 'codex', 'cursor'] })
      ).rejects.toThrow('No available agents');
    });

    it('marks unavailable agent as score 0', async () => {
      vi.mocked(claudeAdapter.detect).mockResolvedValueOnce({
        available: false, version: null, cliPath: null, authStatus: 'unknown', status: 'unavailable',
      });
      const score = await router.scoreAgent(claudeAdapter, backendTask, 'typescript');
      expect(score.available).toBe(false);
      expect(score.total).toBe(0);
    });
  });

  describe('scoreAgent', () => {
    it('gives higher score for language match', async () => {
      const tsScore = await router.scoreAgent(claudeAdapter, backendTask, 'typescript');
      const goScore = await router.scoreAgent(claudeAdapter, backendTask, 'go');
      expect(tsScore.total).toBeGreaterThan(goScore.total);
    });

    it('score breakdown sums correctly', async () => {
      const score = await router.scoreAgent(claudeAdapter, backendTask, 'typescript');
      const { taskTypeMatch, availability, quotaRemaining, historicSuccess, languageMatch, latency } = score.breakdown;
      const manual = taskTypeMatch*0.30 + availability*0.20 + quotaRemaining*0.15 + historicSuccess*0.20 + languageMatch*0.10 + latency*0.05;
      expect(score.total).toBeCloseTo(manual, 5);
    });

    it('uses historic success rate from DB when available', async () => {
      vi.mocked(mockDb.getAgentMetrics).mockResolvedValueOnce({ success_rate: 0.95, avg_duration_ms: 30_000 });
      const score = await router.scoreAgent(claudeAdapter, backendTask, 'typescript');
      expect(score.breakdown.historicSuccess).toBe(0.95);
    });
  });

  describe('learnFromResult', () => {
    it('calls db.upsertAgentMetrics with correct params', async () => {
      await router.learnFromResult('claude', 'backend', true, 45_000);
      expect(mockDb.upsertAgentMetrics).toHaveBeenCalledWith('claude', 'backend', true, 45_000);
    });
  });

  describe('recordRateLimit', () => {
    it('temporarily marks agent as quota-exhausted', async () => {
      router.recordRateLimit('codex', 5_000);
      const score = await router.scoreAgent(codexAdapter, backendTask, 'typescript');
      expect(score.breakdown.quotaRemaining).toBe(0);
    });
  });
});
