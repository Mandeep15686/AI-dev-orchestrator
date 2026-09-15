// packages/core/src/__tests__/orchestration.integration.test.ts
// Full pipeline integration test — mocks agents but runs real subsystem logic
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AgentAdapter } from '../../agents/shared/src/AgentAdapter.js';
import type {
  AgentCapabilities, AgentDetectionResult, Task,
  ContextPackage, AgentSession, AgentEvent, StopReason,
} from '@ai-orch/protocol';

// ─── Stub adapters ────────────────────────────────────────────
function makeStubAdapter(id: string, exitReason: StopReason = 'COMPLETED'): AgentAdapter {
  const session: AgentSession = {
    id:        `${id}-session`, agentId: id as any, taskId: 't1',
    pid:       9999, worktree: null,
    startedAt: new Date().toISOString(),
    status:    'running', tokensUsed: 1000,
  };

  async function* mockStream(): AsyncGenerator<AgentEvent> {
    yield { type: 'output', sessionId: session.id, timestamp: new Date().toISOString(), data: { raw: 'Starting work…' } };
    yield { type: 'file_changed', sessionId: session.id, timestamp: new Date().toISOString(), data: { path: 'src/index.ts', changeType: 'modified' } };
    if (exitReason === 'COMPLETED') {
      yield { type: 'output', sessionId: session.id, timestamp: new Date().toISOString(), data: { raw: 'TASK_COMPLETED: All done' } };
    }
  }

  const caps: AgentCapabilities = {
    interfaces: ['cli'], strengths: ['backend'], weaknesses: [], bestFor: ['backend', 'general'],
    languages: ['typescript'], supportsParallel: true, supportsResume: false,
    supportsStreaming: true, supportsWorktrees: true, maxContextTokens: 128_000,
  };

  return {
    id, capabilities: caps,
    detect: vi.fn().mockResolvedValue({ available: true, version: '1.0', cliPath: '/usr/bin/' + id, authStatus: 'authenticated', status: 'available' } as AgentDetectionResult),
    startSession:  vi.fn().mockResolvedValue(session),
    resumeSession: vi.fn().mockResolvedValue(session),
    sendPrompt:    vi.fn().mockResolvedValue(undefined),
    streamEvents:  vi.fn().mockReturnValue(mockStream()),
    waitForStop:   vi.fn().mockResolvedValue(exitReason),
    stop:          vi.fn().mockResolvedValue(undefined),
    buildSystemPrompt: vi.fn().mockReturnValue('mock prompt'),
  } as unknown as AgentAdapter;
}

// ─── Integration test ─────────────────────────────────────────
describe('Orchestration pipeline (integration)', () => {
  it('selects an agent and runs a task successfully', async () => {
    const { AgentRouter }    = await import('../AgentRouter.js');
    const { AgentRunner }    = await import('../AgentRunner.js');
    const { TypedEventBus }  = await import('../EventBus.js');
    const { PermissionManager } = await import('../../security/src/PermissionManager.js');

    const mockDb: any = {
      getAgentMetrics:    vi.fn().mockResolvedValue(null),
      upsertAgentMetrics: vi.fn().mockResolvedValue(undefined),
      insertAgentSession: vi.fn().mockResolvedValue('session-db-id'),
      updateAgentSession: vi.fn().mockResolvedValue(undefined),
      insertEvent:        vi.fn().mockResolvedValue(undefined),
    };

    const bus     = new TypedEventBus({ db: mockDb });
    const pm      = new PermissionManager(mockDb);
    const router  = new AgentRouter(mockDb);
    const runner  = new AgentRunner(bus, mockDb, pm);

    const stubAdapter = makeStubAdapter('claude', 'COMPLETED');
    router.registerAdapter(stubAdapter);

    const task: Task = {
      id: 't1', masterId: 'run1', name: 'Test task', description: 'Test',
      type: 'backend', dependencies: [], agentHint: null,
      priority: 2, status: 'pending', createdAt: new Date().toISOString(),
    };

    // Verify agent selection works
    const chosen = await router.selectBest(task, { projectLanguage: 'typescript' });
    expect(chosen).toBe('claude');

    // Collect emitted events
    const emitted: string[] = [];
    bus.on('AGENT_STARTED', () => emitted.push('AGENT_STARTED'));
    bus.on('AGENT_OUTPUT',  () => emitted.push('AGENT_OUTPUT'));
    bus.on('FILE_CHANGED',  () => emitted.push('FILE_CHANGED'));
    bus.on('AGENT_STOPPED', () => emitted.push('AGENT_STOPPED'));

    const ctx: ContextPackage = {
      task, project: { id: 'p1', name: 'Test', path: '/tmp/test', gitRemote: null, language: 'typescript', settings: { verificationPolicy: 'fast', maxRetries: 3, sessionTimeoutMs: 30000, maxTokensPerSession: 80000, enableParallel: false, codegraphEnabled: false, preferredAgents: [] }, createdAt: new Date().toISOString() },
      gitContext: { branch: 'main', commit: 'abc123', dirty: false, recentCommits: [], diff: '', filesChanged: [] },
      codeContext: { symbols: [], dependencies: [], callPaths: [] },
      handoffHistory: [], testStatus: null, tokenEstimate: 500,
    };

    const result = await runner.run(
      stubAdapter, task, ctx,
      { worktree: null, maxTokens: 80_000, timeoutMs: 30_000, resumeMode: false },
    );

    expect(result.stopReason).toBe('COMPLETED');
    expect(result.outputLines.length).toBeGreaterThan(0);
    expect(result.filesChanged).toContain('src/index.ts');
    expect(emitted).toContain('AGENT_STARTED');
    expect(emitted).toContain('AGENT_STOPPED');
  });
});
