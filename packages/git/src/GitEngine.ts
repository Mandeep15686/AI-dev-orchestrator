// ═══════════════════════════════════════════════════════════════
// packages/git/src/GitEngine.ts
// TypeScript wrapper calling Tauri Rust commands for all Git ops.
// Runs as sidecar → communicates via JSON-RPC to Tauri.
// ═══════════════════════════════════════════════════════════════

import { exec }         from 'node:child_process';
import { promisify }    from 'node:util';
import { writeFile, mkdir } from 'node:fs/promises';
import { join }         from 'node:path';
import type { GitCommitInfo } from '@ai-orch/protocol';

const execAsync = promisify(exec);

export interface GitStatusResult {
  branch:  string;
  commit:  string;
  dirty:   boolean;
  files:   Array<{ path: string; status: string }>;
}

export interface WorktreeHandle {
  path:   string;
  branch: string;
  commit: string;
}

export class GitEngine {
  /** Current status of the working tree */
  async status(projectPath: string): Promise<GitStatusResult> {
    const [branchOut, commitOut, statusOut] = await Promise.all([
      execAsync('git rev-parse --abbrev-ref HEAD', { cwd: projectPath }).then(r => r.stdout.trim()).catch(() => 'HEAD'),
      execAsync('git rev-parse HEAD', { cwd: projectPath }).then(r => r.stdout.trim()).catch(() => ''),
      execAsync('git status --porcelain', { cwd: projectPath }).then(r => r.stdout).catch(() => ''),
    ]);

    const files = statusOut.trim().split('\n').filter(Boolean).map(line => ({
      status: this.parseStatus(line.slice(0, 2).trim()),
      path:   line.slice(3).trim(),
    }));

    return { branch: branchOut, commit: commitOut, dirty: files.length > 0, files };
  }

  /** Get git diff */
  async diff(projectPath: string, from?: string, to?: string): Promise<string> {
    const args = from && to ? `${from}..${to}` : from ? `${from}` : '';
    const cmd  = `git diff ${args} --unified=3`;
    const { stdout } = await execAsync(cmd, { cwd: projectPath, maxBuffer: 5_000_000 });
    return stdout;
  }

  /** Commit all staged + unstaged changes */
  async commit(projectPath: string, message: string): Promise<string> {
    await execAsync('git add -A', { cwd: projectPath });
    const { stdout } = await execAsync(`git commit -m ${JSON.stringify(message)} --allow-empty`, { cwd: projectPath });
    const match = stdout.match(/\[.*? ([a-f0-9]+)\]/);
    if (!match) {
      const { stdout: rev } = await execAsync('git rev-parse HEAD', { cwd: projectPath });
      return rev.trim();
    }
    return match[1]!;
  }

  /** Get commit log */
  async log(projectPath: string, limit = 20): Promise<GitCommitInfo[]> {
    const fmt = '--format=%H|||%s|||%an|||%ct';
    const { stdout } = await execAsync(`git log ${fmt} -${limit}`, { cwd: projectPath }).catch(() => ({ stdout: '' }));
    return stdout.trim().split('\n').filter(Boolean).map(line => {
      const [oid, message, author, time] = line.split('|||');
      return { oid: oid!, message: message!, author: author!, time: Number(time!) };
    });
  }

  /** Create an isolated worktree for parallel execution */
  async createWorktree(projectPath: string, branch: string): Promise<WorktreeHandle> {
    const wtPath = join(projectPath, '..', `.orch-wt-${branch.replace(/\//g, '-')}`);
    await execAsync(`git worktree add -b ${branch} ${wtPath}`, { cwd: projectPath });
    const { stdout: commit } = await execAsync('git rev-parse HEAD', { cwd: wtPath });
    return { path: wtPath, branch, commit: commit.trim() };
  }

  /** Merge a worktree branch back into main */
  async mergeWorktree(projectPath: string, branch: string, target: string): Promise<boolean> {
    try {
      await execAsync(`git checkout ${target}`, { cwd: projectPath });
      await execAsync(`git merge --no-ff ${branch} -m "orch: merge ${branch} → ${target}"`, {
        cwd: projectPath, env: { ...process.env, GIT_MERGE_AUTOEDIT: 'no' },
      });
      return true;
    } catch {
      return false; // has conflicts
    }
  }

  /** Delete a worktree */
  async deleteWorktree(projectPath: string, worktreePath: string): Promise<void> {
    await execAsync(`git worktree remove --force ${worktreePath}`, { cwd: projectPath }).catch(() => {});
  }

  /** Hard-reset to a specific commit */
  async rollback(projectPath: string, commit: string): Promise<void> {
    await execAsync(`git reset --hard ${commit}`, { cwd: projectPath });
  }

  /** Write orchestrator state file */
  async writeOrchestratorState(projectPath: string, state: Record<string, unknown>): Promise<void> {
    const dir = join(projectPath, '.ai-orchestrator');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'state.json'), JSON.stringify(state, null, 2), 'utf8');
  }

  /** Append to decisions log */
  async appendDecision(projectPath: string, decision: string): Promise<void> {
    const dir = join(projectPath, '.ai-orchestrator');
    await mkdir(dir, { recursive: true });
    const line = `\n- [${new Date().toISOString()}] ${decision}`;
    const { appendFile } = await import('node:fs/promises');
    await appendFile(join(dir, 'decisions.md'), line, 'utf8');
  }

  private parseStatus(code: string): string {
    if (code === '??' || code === 'A')  return 'added';
    if (code === 'D')                   return 'deleted';
    if (code === 'R')                   return 'renamed';
    return 'modified';
  }
}
