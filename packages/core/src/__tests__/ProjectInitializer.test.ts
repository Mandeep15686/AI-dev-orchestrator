// packages/core/src/__tests__/ProjectInitializer.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('node:fs/promises', () => ({
  mkdir:      vi.fn().mockResolvedValue(undefined),
  writeFile:  vi.fn().mockResolvedValue(undefined),
  readFile:   vi.fn().mockRejectedValue(new Error('not found')),
  appendFile: vi.fn().mockResolvedValue(undefined),
  access:     vi.fn().mockRejectedValue(new Error('not found')),
}));

vi.mock('node:child_process', () => ({
  exec: vi.fn((_cmd, _opts, cb) => cb(new Error('no git'))),
}));

import * as fsPromises from 'node:fs/promises';
import { ProjectInitializer } from '../ProjectInitializer.js';

const mockDb: any = {
  insertProject: vi.fn().mockReturnValue('proj-id'),
};

describe('ProjectInitializer', () => {
  let init: ProjectInitializer;

  beforeEach(() => {
    init = new ProjectInitializer(mockDb);
    vi.clearAllMocks();
    // default: all file ops succeed
    vi.mocked(fsPromises.mkdir).mockResolvedValue(undefined as any);
    vi.mocked(fsPromises.writeFile).mockResolvedValue(undefined as any);
    vi.mocked(fsPromises.readFile).mockRejectedValue(new Error('not found'));
    vi.mocked(fsPromises.appendFile).mockResolvedValue(undefined as any);
    vi.mocked(fsPromises.access).mockRejectedValue(new Error('not found'));
  });

  describe('init', () => {
    it('creates .ai-orchestrator directory structure', async () => {
      const meta = await init.init('/tmp/my-project', { name: 'My Project' });

      expect(fsPromises.mkdir).toHaveBeenCalledWith(
        expect.stringContaining('.ai-orchestrator'),
        expect.objectContaining({ recursive: true }),
      );
    });

    it('returns ProjectMeta with correct name and path', async () => {
      const meta = await init.init('/tmp/my-app', { name: 'My App' });
      expect(meta.name).toBe('My App');
      expect(meta.path).toBe('/tmp/my-app');
      expect(meta.id).toBeTruthy();
    });

    it('uses basename of path when name not provided', async () => {
      const meta = await init.init('/tmp/cool-project');
      expect(meta.name).toBe('cool-project');
    });

    it('applies custom verification policy', async () => {
      const meta = await init.init('/tmp/p', { verificationPolicy: 'strict' });
      expect(meta.settings.verificationPolicy).toBe('strict');
    });

    it('registers project in the database', async () => {
      await init.init('/tmp/p');
      expect(mockDb.insertProject).toHaveBeenCalledOnce();
    });

    it('writes project.json file', async () => {
      await init.init('/tmp/p', { name: 'Test' });
      const calls = vi.mocked(fsPromises.writeFile).mock.calls;
      const projectJson = calls.find(([path]) => String(path).endsWith('project.json'));
      expect(projectJson).toBeDefined();
      // Verify content is valid JSON with expected structure
      const content = JSON.parse(String(projectJson![1]));
      expect(content.name).toBe('Test');
      expect(content.path).toBe('/tmp/p');
    });

    it('writes decisions.md and task.md templates', async () => {
      await init.init('/tmp/p', { name: 'Test' });
      const calls = vi.mocked(fsPromises.writeFile).mock.calls;
      const files  = calls.map(([path]) => String(path).split('/').pop());
      expect(files).toContain('decisions.md');
      expect(files).toContain('task.md');
    });
  });

  describe('detectLanguage', () => {
    it('detects TypeScript from package.json with typescript dep', async () => {
      vi.mocked(fsPromises.readFile).mockResolvedValueOnce(
        JSON.stringify({ devDependencies: { typescript: '^5.0.0' } }) as any
      );
      const lang = await init.detectLanguage('/tmp/p');
      expect(lang).toBe('typescript');
    });

    it('detects JavaScript from package.json without typescript', async () => {
      vi.mocked(fsPromises.readFile).mockResolvedValueOnce(
        JSON.stringify({ name: 'my-app' }) as any
      );
      const lang = await init.detectLanguage('/tmp/p');
      expect(lang).toBe('javascript');
    });

    it('detects Rust from Cargo.toml', async () => {
      vi.mocked(fsPromises.readFile)
        .mockRejectedValueOnce(new Error('no pkg.json'))
        .mockResolvedValueOnce('[package]\nname = "mylib"\n' as any);
      const lang = await init.detectLanguage('/tmp/p');
      expect(lang).toBe('rust');
    });

    it('detects Go from go.mod', async () => {
      vi.mocked(fsPromises.readFile)
        .mockRejectedValueOnce(new Error('no pkg'))
        .mockRejectedValueOnce(new Error('no cargo'))
        .mockResolvedValueOnce('module myapp\n' as any);
      const lang = await init.detectLanguage('/tmp/p');
      expect(lang).toBe('go');
    });

    it('returns "unknown" when no recognisable files found', async () => {
      vi.mocked(fsPromises.readFile).mockRejectedValue(new Error('not found'));
      const lang = await init.detectLanguage('/tmp/p');
      expect(lang).toBe('unknown');
    });
  });

  describe('exists', () => {
    it('returns false when project.json does not exist', async () => {
      vi.mocked(fsPromises.access).mockRejectedValue(new Error('not found'));
      expect(await init.exists('/tmp/p')).toBe(false);
    });

    it('returns true when project.json exists', async () => {
      vi.mocked(fsPromises.access).mockResolvedValue(undefined as any);
      expect(await init.exists('/tmp/p')).toBe(true);
    });
  });

  describe('load', () => {
    it('returns null when project.json does not exist', async () => {
      vi.mocked(fsPromises.readFile).mockRejectedValue(new Error('not found'));
      const meta = await init.load('/tmp/p');
      expect(meta).toBeNull();
    });

    it('parses and returns ProjectMeta when file exists', async () => {
      const data = {
        id: 'abc', name: 'Test', path: '/tmp/p',
        gitRemote: null, language: 'typescript',
        settings: { verificationPolicy: 'normal' },
        createdAt: new Date().toISOString(),
      };
      vi.mocked(fsPromises.readFile).mockResolvedValueOnce(JSON.stringify(data) as any);
      const meta = await init.load('/tmp/p');
      expect(meta?.id).toBe('abc');
      expect(meta?.name).toBe('Test');
    });
  });
});
