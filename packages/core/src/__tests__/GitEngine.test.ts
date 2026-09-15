// packages/core/src/__tests__/GitEngine.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock node:child_process at module level
vi.mock('node:child_process', () => ({
  exec: vi.fn(),
}));
vi.mock('node:fs/promises', () => ({
  writeFile:  vi.fn().mockResolvedValue(undefined),
  mkdir:      vi.fn().mockResolvedValue(undefined),
  appendFile: vi.fn().mockResolvedValue(undefined),
}));

import { exec } from 'node:child_process';
import { GitEngine } from '@ai-orch/git';

const mockExec = vi.mocked(exec);

// Helper: make exec resolve with given stdout
function execOk(stdout = '') {
  return (_: any, __: any, cb: any) => { cb(null, { stdout, stderr: '' }); return {} as any; };
}
function execFail(stderr = 'error') {
  return (_: any, __: any, cb: any) => {
    const e: any = new Error('Command failed');
    e.stdout = ''; e.stderr = stderr;
    cb(e);
    return {} as any;
  };
}

const PROJECT = '/tmp/test-project';

describe('GitEngine', () => {
  let git: GitEngine;

  beforeEach(() => {
    git = new GitEngine();
    vi.clearAllMocks();
  });

  describe('status', () => {
    it('returns branch, commit, and file list', async () => {
      mockExec
        .mockImplementationOnce(execOk('main\n')    as any)
        .mockImplementationOnce(execOk('abc123def\n') as any)
        .mockImplementationOnce(execOk(' M src/auth.ts\n?? src/new.ts\n') as any);

      const result = await git.status(PROJECT);
      expect(result.branch).toBe('main');
      expect(result.commit).toBe('abc123def');
      expect(result.dirty).toBe(true);
      expect(result.files).toHaveLength(2);
    });

    it('reports dirty=false when working tree is clean', async () => {
      mockExec
        .mockImplementationOnce(execOk('main\n') as any)
        .mockImplementationOnce(execOk('abc123\n') as any)
        .mockImplementationOnce(execOk('') as any);

      const result = await git.status(PROJECT);
      expect(result.dirty).toBe(false);
      expect(result.files).toHaveLength(0);
    });

    it('classifies file statuses correctly', async () => {
      mockExec
        .mockImplementationOnce(execOk('main\n') as any)
        .mockImplementationOnce(execOk('abc\n')  as any)
        .mockImplementationOnce(execOk(
          ' M modified.ts\n A added.ts\n D deleted.ts\n?? untracked.ts\n'
        ) as any);

      const result = await git.status(PROJECT);
      const byPath = Object.fromEntries(result.files.map(f => [f.path, f.status]));
      expect(byPath['modified.ts']).toBe('modified');
      expect(byPath['added.ts']).toBe('added');
      expect(byPath['deleted.ts']).toBe('deleted');
      expect(byPath['untracked.ts']).toBe('untracked');
    });
  });

  describe('diff', () => {
    it('returns diff output as string', async () => {
      const diffOutput = '--- a/src/auth.ts\n+++ b/src/auth.ts\n@@ -1 +1 @@\n-old\n+new\n';
      mockExec.mockImplementation(execOk(diffOutput) as any);

      const result = await git.diff(PROJECT);
      expect(result).toBe(diffOutput);
    });

    it('accepts from/to commit range', async () => {
      mockExec.mockImplementation(execOk('diff output\n') as any);
      await git.diff(PROJECT, 'HEAD~3', 'HEAD');
      // Verify the exec call included the range
      expect(mockExec).toHaveBeenCalledWith(
        expect.stringContaining('HEAD~3..HEAD'),
        expect.any(Object),
        expect.any(Function),
      );
    });
  });

  describe('commit', () => {
    it('stages all files and commits with given message', async () => {
      mockExec
        .mockImplementationOnce(execOk('') as any)                           // git add -A
        .mockImplementationOnce(execOk('[main abc1234] feat: auth\n') as any); // git commit

      const oid = await git.commit(PROJECT, 'feat: auth');
      expect(oid).toBe('abc1234');
    });

    it('falls back to git rev-parse HEAD if commit output unparseable', async () => {
      mockExec
        .mockImplementationOnce(execOk('') as any)
        .mockImplementationOnce(execOk('something weird\n') as any)
        .mockImplementationOnce(execOk('deadbeef1234\n') as any);

      const oid = await git.commit(PROJECT, 'feat: x');
      expect(oid).toBe('deadbeef1234');
    });
  });

  describe('log', () => {
    it('parses git log output into GitCommitInfo array', async () => {
      const raw = 'abc123|||feat: auth|||Alice|||1718000000\ndef456|||fix: bug|||Bob|||1718001000\n';
      mockExec.mockImplementation(execOk(raw) as any);

      const commits = await git.log(PROJECT, 5);
      expect(commits).toHaveLength(2);
      expect(commits[0]).toMatchObject({
        oid:     'abc123',
        message: 'feat: auth',
        author:  'Alice',
        time:    1718000000,
      });
    });

    it('returns empty array on git error', async () => {
      mockExec.mockImplementation(execFail('not a git repo') as any);
      const commits = await git.log(PROJECT, 5);
      expect(commits).toEqual([]);
    });
  });

  describe('createWorktree', () => {
    it('runs git worktree add and returns WorktreeHandle', async () => {
      mockExec
        .mockImplementationOnce(execOk('') as any)          // git worktree add
        .mockImplementationOnce(execOk('wt-commit\n') as any); // git rev-parse HEAD in worktree

      const wt = await git.createWorktree(PROJECT, 'agent/codex-t1');
      expect(wt.branch).toBe('agent/codex-t1');
      expect(wt.commit).toBe('wt-commit');
      expect(wt.path).toContain('codex');
    });
  });

  describe('mergeWorktree', () => {
    it('returns true on clean merge', async () => {
      mockExec
        .mockImplementationOnce(execOk('') as any)  // git checkout
        .mockImplementationOnce(execOk('') as any); // git merge

      const clean = await git.mergeWorktree(PROJECT, 'agent/claude-t2', 'main');
      expect(clean).toBe(true);
    });

    it('returns false when merge has conflicts', async () => {
      mockExec
        .mockImplementationOnce(execOk('') as any)
        .mockImplementationOnce(execFail('CONFLICT') as any);

      const clean = await git.mergeWorktree(PROJECT, 'agent/cursor-t3', 'main');
      expect(clean).toBe(false);
    });
  });

  describe('rollback', () => {
    it('calls git reset --hard with commit hash', async () => {
      mockExec.mockImplementation(execOk('') as any);
      await git.rollback(PROJECT, 'abc123');
      expect(mockExec).toHaveBeenCalledWith(
        expect.stringContaining('abc123'),
        expect.any(Object),
        expect.any(Function),
      );
    });
  });
});
