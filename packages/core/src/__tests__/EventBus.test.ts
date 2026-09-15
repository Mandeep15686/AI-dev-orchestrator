// packages/core/src/__tests__/EventBus.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TypedEventBus } from '../EventBus.js';

describe('TypedEventBus', () => {
  let bus: TypedEventBus;
  const mockDb: any = { insertEvent: vi.fn().mockResolvedValue(undefined) };

  beforeEach(() => {
    bus = new TypedEventBus({ db: mockDb });
    vi.clearAllMocks();
  });

  describe('on / emit', () => {
    it('calls registered handler when event is emitted', () => {
      const handler = vi.fn();
      bus.on('AGENT_STARTED', handler);
      bus.emit('AGENT_STARTED', {
        sessionId: 's1', agentId: 'claude', taskId: 't1',
        worktree: null, pid: 1234,
      });
      expect(handler).toHaveBeenCalledOnce();
      expect(handler).toHaveBeenCalledWith(expect.objectContaining({ agentId: 'claude' }));
    });

    it('does not call handler after off()', () => {
      const handler = vi.fn();
      const unsub = bus.on('AGENT_STOPPED', handler);
      unsub(); // unsubscribe
      bus.emit('AGENT_STOPPED', { sessionId: 's1', reason: 'COMPLETED', duration: 100, tokensUsed: 500 });
      expect(handler).not.toHaveBeenCalled();
    });

    it('calls multiple handlers for the same event', () => {
      const h1 = vi.fn(), h2 = vi.fn();
      bus.on('FILE_CHANGED', h1);
      bus.on('FILE_CHANGED', h2);
      bus.emit('FILE_CHANGED', { sessionId: 's1', path: 'src/x.ts', changeType: 'modified' });
      expect(h1).toHaveBeenCalledOnce();
      expect(h2).toHaveBeenCalledOnce();
    });
  });

  describe('once', () => {
    it('fires exactly once then stops', () => {
      const handler = vi.fn();
      bus.once('TASK_COMPLETED', handler);
      const payload = { taskId: 't1', checkpointId: 'cp1', duration: 1000 };
      bus.emit('TASK_COMPLETED', payload);
      bus.emit('TASK_COMPLETED', payload);
      expect(handler).toHaveBeenCalledOnce();
    });
  });

  describe('waitFor', () => {
    it('resolves when matching event is emitted', async () => {
      const promise = bus.waitFor('CHECKPOINT_CREATED', p => p.sessionId === 's-match', 5000);
      bus.emit('CHECKPOINT_CREATED', { checkpointId: 'cp1', sessionId: 's-other',  gitCommit: 'abc', filesChanged: 2 });
      bus.emit('CHECKPOINT_CREATED', { checkpointId: 'cp2', sessionId: 's-match',  gitCommit: 'def', filesChanged: 5 });
      const result = await promise;
      expect(result.checkpointId).toBe('cp2');
      expect(result.filesChanged).toBe(5);
    });

    it('rejects after timeout if no matching event', async () => {
      await expect(
        bus.waitFor('WORKFLOW_DONE', () => true, 50)
      ).rejects.toThrow('Timeout');
    });
  });

  describe('DB persistence', () => {
    it('calls db.insertEvent for every emitted event', () => {
      bus.emit('AGENT_SELECTED', { taskId: 't1', agentId: 'claude', score: 0.9, reason: 'best match' });
      bus.emit('AGENT_SELECTED', { taskId: 't2', agentId: 'codex',  score: 0.7, reason: 'available' });
      // insertEvent is async and fire-and-forget, so give microtasks a tick
      return new Promise<void>(resolve => {
        setTimeout(() => {
          expect(mockDb.insertEvent).toHaveBeenCalledTimes(2);
          resolve();
        }, 10);
      });
    });

    it('does not throw if db is not provided', () => {
      const busNoDb = new TypedEventBus();
      expect(() => busNoDb.emit('TASK_STARTED', { taskId: 't1', workflowRunId: 'run1' })).not.toThrow();
    });
  });

  describe('Tauri bridge', () => {
    it('calls tauriEmitter for each event', () => {
      const emitter = vi.fn();
      const busWithTauri = new TypedEventBus({ tauriEmitter: emitter });
      busWithTauri.emit('RECOVERY_STARTED', { sessionId: 's1', reason: 'RATE_LIMITED', attempt: 1, maxAttempts: 3 });
      expect(emitter).toHaveBeenCalledWith('RECOVERY_STARTED', expect.any(Object));
    });
  });
});
