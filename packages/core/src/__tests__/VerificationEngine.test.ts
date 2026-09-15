// packages/core/src/__tests__/VerificationEngine.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { VerificationEngine } from '../VerificationEngine.js';

// Mock exec at module level
vi.mock('node:child_process', () => ({
  exec: vi.fn(),
}));
vi.mock('node:fs/promises', () => ({
  readFile: vi.fn().mockRejectedValue(new Error('not found')),
}));

import { exec } from 'node:child_process';
import { readFile } from 'node:fs/promises';

const mockExec = vi.mocked(exec);

function makeExecSuccess(stdout = '') {
  return (_cmd: string, _opts: any, cb?: Function) => {
    if (cb) cb(null, { stdout, stderr: '' });
    return {} as any;
  };
}

function makeExecFail(stderr = 'Error: build failed') {
  return (_cmd: string, _opts: any, cb?: Function) => {
    if (cb) {
      const err: any = new Error('Command failed');
      err.stdout = '';
      err.stderr = stderr;
      cb(err, { stdout: '', stderr });
    }
    return {} as any;
  };
}

describe('VerificationEngine', () => {
  let engine: VerificationEngine;

  beforeEach(() => {
    engine = new VerificationEngine();
    vi.clearAllMocks();
    vi.mocked(readFile).mockResolvedValue(
      JSON.stringify({ devDependencies: { typescript: '^5.0.0' } }) as any,
    );
  });

  describe('language detection', () => {
    it('detects typescript from package.json', async () => {
      vi.mocked(readFile).mockResolvedValueOnce(
        JSON.stringify({ devDependencies: { typescript: '^5.0.0' } }) as any,
      );
      // Just run a fast gate to trigger language detection
      mockExec.mockImplementation(makeExecSuccess() as any);
      const result = await engine.runGate('fast', '/fake/project');
      expect(result.policy).toBe('fast');
    });
  });

  describe('runGate — fast policy', () => {
    it('runs build and lint only (no tests)', async () => {
      mockExec.mockImplementation(makeExecSuccess() as any);
      const result = await engine.runGate('fast', '/fake/project');
      expect(result.policy).toBe('fast');
      expect(result.intTests).toBeNull();
      expect(result.security).toBeNull();
    });

    it('returns passed=true when all gates pass', async () => {
      mockExec.mockImplementation(makeExecSuccess() as any);
      const result = await engine.runGate('fast', '/fake/project');
      expect(result.passed).toBe(true);
      expect(result.build.passed).toBe(true);
      expect(result.lint.passed).toBe(true);
    });

    it('returns passed=false when build fails', async () => {
      mockExec
        .mockImplementationOnce(makeExecFail('tsc: error TS2345') as any) // build fails
        .mockImplementation(makeExecSuccess() as any); // lint passes
      const result = await engine.runGate('fast', '/fake/project');
      expect(result.passed).toBe(false);
      expect(result.build.passed).toBe(false);
    });
  });

  describe('runGate — normal policy', () => {
    it('includes unit tests', async () => {
      mockExec.mockImplementation(makeExecSuccess('Tests: 5 passed') as any);
      const result = await engine.runGate('normal', '/fake/project');
      expect(result.unitTests).toBeDefined();
    });

    it('parses Jest test results correctly', async () => {
      const jestOutput = 'Tests: 12 passed, 2 failed, 1 skipped';
      mockExec.mockImplementation(makeExecSuccess(jestOutput) as any);
      const result = await engine.runGate('normal', '/fake/project');
      expect(result.unitTests.passed).toBe(12);
      expect(result.unitTests.failed).toBe(2);
      expect(result.unitTests.skipped).toBe(1);
    });

    it('marks passed=false when unit tests fail', async () => {
      mockExec
        .mockImplementationOnce(makeExecSuccess() as any) // build
        .mockImplementationOnce(makeExecSuccess() as any) // lint
        .mockImplementationOnce(makeExecFail('Tests: 0 passed, 3 failed') as any); // unit tests
      const result = await engine.runGate('normal', '/fake/project');
      expect(result.passed).toBe(false);
    });
  });

  describe('runGate — strict policy', () => {
    it('runs integration tests and security scan', async () => {
      mockExec.mockImplementation(makeExecSuccess() as any);
      const result = await engine.runGate('strict', '/fake/project');
      expect(result.intTests).not.toBeNull();
      expect(result.security).not.toBeNull();
    });
  });

  describe('duration', () => {
    it('records total duration in ms', async () => {
      mockExec.mockImplementation(makeExecSuccess() as any);
      const result = await engine.runGate('fast', '/fake/project');
      expect(typeof result.duration).toBe('number');
      expect(result.duration).toBeGreaterThanOrEqual(0);
    });
  });
});
