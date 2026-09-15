// ═══════════════════════════════════════════════════════════════
// packages/core/src/ProjectInitializer.ts
// Bootstraps the .ai-orchestrator/ directory in a user project.
// Creates all required state files, detects language, and
// registers the project in the orchestrator DB.
// ═══════════════════════════════════════════════════════════════

import { mkdir, writeFile, readFile, access } from 'node:fs/promises';
import { join, basename }  from 'node:path';
import { randomUUID }      from 'node:crypto';
import type { ProjectMeta, ProjectSettings, VerificationPolicy } from '@ai-orch/protocol';
import type { Database } from '@ai-orch/storage';

const DIR = '.ai-orchestrator';

interface InitOptions {
  name?:               string;
  language?:           string;
  verificationPolicy?: VerificationPolicy;
  codegraphEnabled?:   boolean;
}

export class ProjectInitializer {
  constructor(private db: Database) {}

  // ─── Main entry ───────────────────────────────────────────────

  async init(projectPath: string, opts: InitOptions = {}): Promise<ProjectMeta> {
    const orcDir  = join(projectPath, DIR);
    await mkdir(orcDir, { recursive: true });

    const language = opts.language ?? await this.detectLanguage(projectPath);
    const name     = opts.name     ?? basename(projectPath);
    const id       = randomUUID();

    const settings: ProjectSettings = {
      verificationPolicy:  opts.verificationPolicy ?? 'normal',
      maxRetries:          3,
      sessionTimeoutMs:    30 * 60_000,
      maxTokensPerSession: 80_000,
      enableParallel:      true,
      codegraphEnabled:    opts.codegraphEnabled ?? true,
      preferredAgents:     [],
    };

    const meta: ProjectMeta = {
      id, name, path: projectPath,
      gitRemote:  await this.detectGitRemote(projectPath),
      language,
      settings,
      createdAt: new Date().toISOString(),
    };

    // Write all directory files
    await Promise.all([
      this.writeJson(join(orcDir, 'project.json'), meta),
      this.writeJson(join(orcDir, 'state.json'), {
        status: 'idle', activeWorkflowRunId: null, lastCheckpoint: null,
      }),
      this.writeJson(join(orcDir, 'workflow.json'), { nodes: [], edges: [] }),
      this.writeText(join(orcDir, 'task.md'),       this.taskMdTemplate(name)),
      this.writeText(join(orcDir, 'decisions.md'),  this.decisionsMdTemplate(name)),
      this.ensureDir(join(orcDir, 'handoffs')),
      this.ensureDir(join(orcDir, 'runs')),
      this.ensureDir(join(orcDir, 'logs')),
      this.writeJson(join(orcDir, 'agents', 'claude.json'),  { runs: [] }),
      this.writeJson(join(orcDir, 'agents', 'codex.json'),   { runs: [] }),
      this.writeJson(join(orcDir, 'agents', 'cursor.json'),  { runs: [] }),
      this.writeJson(join(orcDir, 'agents', 'gemini.json'),  { runs: [] }),
    ]);

    // Append .ai-orchestrator to .gitignore? No — we WANT to track it.
    // Append runs/ and logs/ which are large.
    await this.appendGitignore(projectPath, [
      `${DIR}/runs/`,
      `${DIR}/logs/`,
    ]);

    // Register in DB
    this.db.insertProject({
      id, name, path: projectPath,
      language,
      settings: JSON.stringify(settings),
      ...(meta.gitRemote === null ? {} : { gitRemote: meta.gitRemote }),
    });

    return meta;
  }

  // ─── Read existing project ────────────────────────────────────

  async load(projectPath: string): Promise<ProjectMeta | null> {
    const metaPath = join(projectPath, DIR, 'project.json');
    try {
      const raw = await readFile(metaPath, 'utf8');
      return JSON.parse(raw) as ProjectMeta;
    } catch {
      return null;
    }
  }

  async exists(projectPath: string): Promise<boolean> {
    try {
      await access(join(projectPath, DIR, 'project.json'));
      return true;
    } catch {
      return false;
    }
  }

  // ─── State helpers ────────────────────────────────────────────

  async readState(projectPath: string): Promise<Record<string, unknown>> {
    try {
      const raw = await readFile(join(projectPath, DIR, 'state.json'), 'utf8');
      return JSON.parse(raw);
    } catch { return {}; }
  }

  async writeState(projectPath: string, state: Record<string, unknown>): Promise<void> {
    await this.writeJson(join(projectPath, DIR, 'state.json'), state);
  }

  // ─── Language detection ───────────────────────────────────────

  async detectLanguage(projectPath: string): Promise<string> {
    const checks: Array<[string, string]> = [
      ['package.json',    'typescript'],
      ['Cargo.toml',      'rust'],
      ['go.mod',          'go'],
      ['pubspec.yaml',    'flutter'],
      ['requirements.txt','python'],
      ['pyproject.toml',  'python'],
      ['pom.xml',         'java'],
      ['build.gradle',    'java'],
    ];

    for (const [file, lang] of checks) {
      try {
        const content = await readFile(join(projectPath, file), 'utf8');
        // Extra check for TS vs JS
        if (file === 'package.json') {
          const pkg = JSON.parse(content);
          const hasTsc = pkg.devDependencies?.typescript || pkg.dependencies?.typescript;
          return hasTsc ? 'typescript' : 'javascript';
        }
        return lang;
      } catch { /* continue */ }
    }
    return 'unknown';
  }

  private async detectGitRemote(projectPath: string): Promise<string | null> {
    try {
      const { exec } = await import('node:child_process');
      const { promisify } = await import('node:util');
      const execAsync = promisify(exec);
      const { stdout } = await execAsync('git remote get-url origin', { cwd: projectPath });
      return stdout.trim() || null;
    } catch { return null; }
  }

  // ─── File helpers ─────────────────────────────────────────────

  private async writeJson(path: string, data: unknown): Promise<void> {
    await mkdir(join(path, '..'), { recursive: true });
    await writeFile(path, JSON.stringify(data, null, 2), 'utf8');
  }

  private async writeText(path: string, text: string): Promise<void> {
    try { await access(path); } catch {
      await writeFile(path, text, 'utf8');
    }
  }

  private async ensureDir(path: string): Promise<void> {
    await mkdir(path, { recursive: true });
  }

  private async appendGitignore(projectPath: string, patterns: string[]): Promise<void> {
    const giPath = join(projectPath, '.gitignore');
    try {
      const existing = await readFile(giPath, 'utf8');
      const toAdd    = patterns.filter(p => !existing.includes(p));
      if (toAdd.length > 0) {
        const { appendFile } = await import('node:fs/promises');
        await appendFile(giPath, '\n# AI Dev Orchestrator\n' + toAdd.join('\n') + '\n', 'utf8');
      }
    } catch {
      await writeFile(giPath, '# AI Dev Orchestrator\n' + patterns.join('\n') + '\n', 'utf8');
    }
  }

  // ─── Templates ────────────────────────────────────────────────

  private taskMdTemplate(name: string): string {
    return `# ${name} — Orchestration Task

## Current Goal
<!-- Describe what you want to build or fix -->

## Acceptance Criteria
- [ ] Feature is fully implemented
- [ ] All tests pass
- [ ] No lint errors
- [ ] Code is reviewed

## Context
<!-- Any important context the agents need -->

## Constraints
<!-- Things agents must NOT do (e.g. don't change the DB schema) -->
`;
  }

  private decisionsMdTemplate(name: string): string {
    return `# ${name} — Architectural Decisions

This file tracks key decisions made during the orchestration run.
Do NOT change decisions already made unless there is a strong reason.

## Decision Log
<!-- Entries are auto-appended by the HandoffEngine -->
`;
  }
}
