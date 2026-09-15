// ═══════════════════════════════════════════════════════════════
// packages/storage/src/Database.ts
// All orchestration metadata — fully typed SQLite via better-sqlite3
// ═══════════════════════════════════════════════════════════════

import BetterSqlite3 from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { runMigrations } from './migrations.js';
import type {
  AgentId, TaskType, VerificationResult, HandoffSummary,
  Workflow, ProjectMeta,
} from '@ai-orch/protocol';

export class Database {
  private db: BetterSqlite3.Database;

  constructor(dbPath: string) {
    this.db = new BetterSqlite3(dbPath);
    runMigrations(this.db);
  }

  // ─── Projects ────────────────────────────────────────────────

  insertProject(p: {
    id?: string; name: string; path: string;
    language: string; gitRemote?: string; settings?: string;
  }): string {
    const id = p.id ?? randomUUID();
    this.db.prepare(`
      INSERT OR REPLACE INTO projects (id, name, path, git_remote, language, settings)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, p.name, p.path, p.gitRemote ?? null, p.language, p.settings ?? '{}');
    return id;
  }

  getProject(id: string): ProjectMeta | undefined {
    const row = this.db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as any;
    return row ? this.rowToProject(row) : undefined;
  }

  getProjectByPath(path: string): ProjectMeta | undefined {
    const row = this.db.prepare('SELECT * FROM projects WHERE path = ?').get(path) as any;
    return row ? this.rowToProject(row) : undefined;
  }

  listProjects(): ProjectMeta[] {
    return (this.db.prepare('SELECT * FROM projects ORDER BY created_at DESC').all() as any[])
      .map(r => this.rowToProject(r));
  }

  private rowToProject(row: any): ProjectMeta {
    return {
      id:        row.id,
      name:      row.name,
      path:      row.path,
      gitRemote: row.git_remote ?? null,
      language:  row.language,
      settings:  JSON.parse(row.settings ?? '{}'),
      createdAt: row.created_at,
    };
  }

  // ─── Saved Workflows ─────────────────────────────────────────

  async getWorkflow(workflowId: string): Promise<Workflow | null> {
    const row = this.db.prepare(
      'SELECT definition FROM saved_workflows WHERE id = ?'
    ).get(workflowId) as { definition: string } | undefined;
    if (!row) return null;
    return JSON.parse(row.definition) as Workflow;
  }

  saveWorkflow(projectId: string, workflow: Workflow): string {
    const existing = this.db.prepare(
      'SELECT id FROM saved_workflows WHERE id = ?'
    ).get(workflow.id);

    if (existing) {
      this.db.prepare(`
        UPDATE saved_workflows SET name = ?, definition = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(workflow.name, JSON.stringify(workflow), workflow.id);
    } else {
      this.db.prepare(`
        INSERT INTO saved_workflows (id, project_id, name, definition)
        VALUES (?, ?, ?, ?)
      `).run(workflow.id, projectId, workflow.name, JSON.stringify(workflow));
    }
    return workflow.id;
  }

  listWorkflows(projectId: string): Array<{ id: string; name: string; createdAt: string }> {
    return (this.db.prepare(
      'SELECT id, name, created_at FROM saved_workflows WHERE project_id = ? ORDER BY updated_at DESC'
    ).all(projectId) as any[]).map(r => ({
      id: r.id, name: r.name, createdAt: r.created_at,
    }));
  }

  // ─── Workflow Runs ───────────────────────────────────────────

  async insertWorkflowRun(r: {
    projectId: string; masterTask: string; workflow: string; status: string;
  }): Promise<string> {
    const id = randomUUID();
    this.db.prepare(`
      INSERT INTO workflow_runs (id, project_id, master_task, workflow, status)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, r.projectId, r.masterTask, r.workflow, r.status);
    return id;
  }

  updateWorkflowRun(id: string, fields: { status?: string; ended_at?: string }): void {
    const sets: string[] = [];
    const vals: unknown[] = [];
    if (fields.status)   { sets.push('status = ?');   vals.push(fields.status); }
    if (fields.ended_at) { sets.push('ended_at = ?'); vals.push(fields.ended_at); }
    if (!sets.length) return;
    vals.push(id);
    this.db.prepare(`UPDATE workflow_runs SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
  }

  getWorkflowRun(id: string): Record<string, unknown> | undefined {
    return this.db.prepare('SELECT * FROM workflow_runs WHERE id = ?').get(id) as any;
  }

  listWorkflowRuns(projectId: string, limit = 20): Record<string, unknown>[] {
    return this.db.prepare(
      'SELECT * FROM workflow_runs WHERE project_id = ? ORDER BY started_at DESC LIMIT ?'
    ).all(projectId, limit) as any[];
  }

  // ─── Tasks ───────────────────────────────────────────────────

  async insertTasks(tasks: Array<{
    id: string; workflowRunId: string; name: string; type: string;
    description: string; deps: string[]; agentHint: string | null; priority: number;
  }>): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT INTO tasks (id, workflow_run_id, name, type, description, deps, agent_hint, status, priority)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)
    `);
    const insertMany = this.db.transaction((ts: typeof tasks) => {
      for (const t of ts) {
        stmt.run(t.id, t.workflowRunId, t.name, t.type,
          t.description, JSON.stringify(t.deps), t.agentHint, t.priority);
      }
    });
    insertMany(tasks);
  }

  updateTaskStatus(id: string, status: string): void {
    this.db.prepare('UPDATE tasks SET status = ? WHERE id = ?').run(status, id);
  }

  getTasksForRun(workflowRunId: string): Record<string, unknown>[] {
    return this.db.prepare(
      'SELECT * FROM tasks WHERE workflow_run_id = ? ORDER BY priority ASC'
    ).all(workflowRunId) as any[];
  }

  // ─── Agent Sessions ──────────────────────────────────────────

  async insertAgentSession(s: {
    agentId: string; taskId: string; worktreePath: string | null;
    status: string; git_before?: string;
  }): Promise<string> {
    const id = randomUUID();
    this.db.prepare(`
      INSERT INTO agent_sessions (id, task_id, agent_id, worktree_path, status, git_before)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, s.taskId, s.agentId, s.worktreePath, s.status, s.git_before ?? null);
    return id;
  }

  updateAgentSession(id: string, fields: {
    pid?: number | null; status?: string; exit_reason?: string;
    ended_at?: string; tokens_used?: number; git_after?: string;
  }): void {
    const sets: string[] = [];
    const vals: unknown[] = [];
    const map: Record<string, string> = {
      pid: 'pid', status: 'status', exit_reason: 'exit_reason',
      ended_at: 'ended_at', tokens_used: 'tokens_used', git_after: 'git_after',
    };
    for (const [key, col] of Object.entries(map)) {
      if ((fields as any)[key] !== undefined) {
        sets.push(`${col} = ?`);
        vals.push((fields as any)[key]);
      }
    }
    if (!sets.length) return;
    vals.push(id);
    this.db.prepare(`UPDATE agent_sessions SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
  }

  getSessionsForTask(taskId: string): Record<string, unknown>[] {
    return this.db.prepare(
      'SELECT * FROM agent_sessions WHERE task_id = ? ORDER BY started_at ASC'
    ).all(taskId) as any[];
  }

  // ─── Checkpoints ─────────────────────────────────────────────

  async insertCheckpoint(c: {
    sessionId: string; gitCommit: string; handoffPath: string;
    filesChanged: number; canRollback: boolean;
  }): Promise<string> {
    const id = randomUUID();
    this.db.prepare(`
      INSERT INTO checkpoints (id, session_id, git_commit, handoff_path, files_changed, can_rollback)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, c.sessionId, c.gitCommit, c.handoffPath, c.filesChanged, c.canRollback ? 1 : 0);
    return id;
  }

  async countCheckpoints(workflowRunId: string): Promise<number> {
    const row = this.db.prepare(`
      SELECT COUNT(*) AS n FROM checkpoints cp
      JOIN agent_sessions s ON s.id = cp.session_id
      JOIN tasks t          ON t.id = s.task_id
      WHERE t.workflow_run_id = ?
    `).get(workflowRunId) as { n: number };
    return row?.n ?? 0;
  }

  async getLastGoodCheckpoint(workflowRunId: string): Promise<{ git_commit: string; id: string } | null> {
    return this.db.prepare(`
      SELECT cp.id, cp.git_commit FROM checkpoints cp
      JOIN agent_sessions s ON s.id = cp.session_id
      JOIN tasks t          ON t.id = s.task_id
      LEFT JOIN test_runs tr ON tr.checkpoint_id = cp.id
      WHERE t.workflow_run_id = ?
        AND (tr.unit_failed = 0 OR tr.id IS NULL)
        AND cp.can_rollback = 1
      ORDER BY cp.created_at DESC LIMIT 1
    `).get(workflowRunId) as { git_commit: string; id: string } | null;
  }

  listCheckpoints(workflowRunId: string): Record<string, unknown>[] {
    return this.db.prepare(`
      SELECT cp.*, s.agent_id, t.name AS task_name
      FROM checkpoints cp
      JOIN agent_sessions s ON s.id = cp.session_id
      JOIN tasks t          ON t.id = s.task_id
      WHERE t.workflow_run_id = ?
      ORDER BY cp.created_at DESC
    `).all(workflowRunId) as any[];
  }

  // ─── Test Runs ───────────────────────────────────────────────

  async insertTestRun(tr: {
    checkpointId: string; policy: string; buildPassed: boolean; lintPassed: boolean;
    unitPassed: number; unitFailed: number; integrationPassed: number;
    integrationFailed: number; durationMs: number; errors: string[];
  }): Promise<string> {
    const id = randomUUID();
    this.db.prepare(`
      INSERT INTO test_runs
        (id, checkpoint_id, policy, build_passed, lint_passed,
         unit_passed, unit_failed, integration_passed, integration_failed,
         duration_ms, errors)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, tr.checkpointId, tr.policy,
      tr.buildPassed ? 1 : 0, tr.lintPassed ? 1 : 0,
      tr.unitPassed, tr.unitFailed,
      tr.integrationPassed, tr.integrationFailed,
      tr.durationMs, JSON.stringify(tr.errors),
    );
    return id;
  }

  async getLastVerification(workflowRunId: string): Promise<VerificationResult | null> {
    const row = this.db.prepare(`
      SELECT tr.* FROM test_runs tr
      JOIN checkpoints cp ON cp.id = tr.checkpoint_id
      JOIN agent_sessions s ON s.id = cp.session_id
      JOIN tasks t ON t.id = s.task_id
      WHERE t.workflow_run_id = ?
      ORDER BY cp.created_at DESC LIMIT 1
    `).get(workflowRunId) as Record<string, number | string> | null;

    if (!row) return null;

    return {
      policy: (row['policy'] as any) ?? 'normal',
      passed: Number(row['unit_failed']) === 0 && Boolean(row['build_passed']),
      build:  { passed: Boolean(row['build_passed']), output: '', duration: 0 },
      lint:   { passed: Boolean(row['lint_passed']),  output: '', duration: 0 },
      unitTests: {
        passed:  Number(row['unit_passed']),
        failed:  Number(row['unit_failed']),
        skipped: 0,
        duration: Number(row['duration_ms']),
        errors:  JSON.parse(String(row['errors'] ?? '[]')),
        suites:  [],
      },
      intTests: null, security: null,
      duration: Number(row['duration_ms']),
    };
  }

  // ─── Agent Metrics ───────────────────────────────────────────

  async getAgentMetrics(
    agentId: AgentId,
    taskType: TaskType,
  ): Promise<{ success_rate: number; avg_duration_ms: number } | null> {
    return this.db.prepare(
      'SELECT success_rate, avg_duration_ms FROM agent_metrics WHERE agent_id = ? AND task_type = ?'
    ).get(agentId, taskType) as { success_rate: number; avg_duration_ms: number } | null;
  }

  async upsertAgentMetrics(
    agentId: AgentId,
    taskType: TaskType,
    success: boolean,
    durationMs: number,
  ): Promise<void> {
    const existing = this.db.prepare(
      'SELECT success_rate, avg_duration_ms, sample_count FROM agent_metrics WHERE agent_id = ? AND task_type = ?'
    ).get(agentId, taskType) as { success_rate: number; avg_duration_ms: number; sample_count: number } | null;

    if (existing) {
      const n       = existing.sample_count;
      const newRate = (existing.success_rate * n + (success ? 1 : 0)) / (n + 1);
      const newDur  = (existing.avg_duration_ms * n + durationMs) / (n + 1);
      this.db.prepare(`
        UPDATE agent_metrics
        SET success_rate = ?, avg_duration_ms = ?, sample_count = sample_count + 1,
            updated_at = CURRENT_TIMESTAMP
        WHERE agent_id = ? AND task_type = ?
      `).run(newRate, Math.round(newDur), agentId, taskType);
    } else {
      this.db.prepare(`
        INSERT INTO agent_metrics (id, agent_id, task_type, success_rate, avg_duration_ms, sample_count)
        VALUES (?, ?, ?, ?, ?, 1)
      `).run(randomUUID(), agentId, taskType, success ? 1.0 : 0.0, durationMs);
    }
  }

  getAgentLeaderboard(): Record<string, unknown>[] {
    return this.db.prepare(`
      SELECT a.agent_id, a.task_type,
             ROUND(a.success_rate * 100, 1) AS success_pct,
             ROUND(a.avg_duration_ms / 60000.0, 1) AS avg_minutes,
             a.sample_count
      FROM agent_metrics a
      ORDER BY a.task_type, a.success_rate DESC
    `).all() as any[];
  }

  // ─── Handoffs ────────────────────────────────────────────────

  async getHandoffSummaries(workflowRunId: string, limit: number): Promise<HandoffSummary[]> {
    const rows = this.db.prepare(`
      SELECT cp.id, cp.git_commit, cp.handoff_path,
             s.agent_id, s.task_id, s.exit_reason,
             cp.created_at
      FROM checkpoints cp
      JOIN agent_sessions s ON s.id = cp.session_id
      JOIN tasks t          ON t.id = s.task_id
      WHERE t.workflow_run_id = ?
      ORDER BY cp.created_at DESC LIMIT ?
    `).all(workflowRunId, limit) as Array<Record<string, string>>;

    return rows.map(r => ({
      checkpointId: r['id']!,
      agentId:      r['agent_id']! as AgentId,
      taskId:       r['task_id']!,
      gitCommit:    r['git_commit']!,
      exitReason:   (r['exit_reason'] ?? 'COMPLETED') as any,
      completed:    [],
      remaining:    [],
      decisions:    [],
      testsPass:    true,
      timestamp:    r['created_at']!,
    }));
  }

  async countHandoffs(workflowRunId: string): Promise<number> {
    return this.countCheckpoints(workflowRunId);
  }

  // ─── Events ──────────────────────────────────────────────────

  async insertEvent(type: string, payload: unknown): Promise<void> {
    this.db.prepare(
      'INSERT INTO events (id, type, payload) VALUES (?, ?, ?)'
    ).run(randomUUID(), type, JSON.stringify(payload));
  }

  async getEventsForRun(
    workflowRunId: string,
  ): Promise<Array<{ type: string; payload: unknown }>> {
    const rows = this.db.prepare(`
      SELECT e.type, e.payload FROM events e
      JOIN agent_sessions s ON s.id = e.session_id
      JOIN tasks t          ON t.id = s.task_id
      WHERE t.workflow_run_id = ?
      ORDER BY e.timestamp ASC
    `).all(workflowRunId) as Array<{ type: string; payload: string }>;
    return rows.map(r => ({ type: r.type, payload: JSON.parse(r.payload) }));
  }

  getRecentEvents(limit = 100): Array<{ type: string; payload: unknown; timestamp: string }> {
    return (this.db.prepare(
      'SELECT type, payload, timestamp FROM events ORDER BY timestamp DESC LIMIT ?'
    ).all(limit) as any[]).map(r => ({
      type: r.type, payload: JSON.parse(r.payload), timestamp: r.timestamp,
    }));
  }

  // ─── Permissions ─────────────────────────────────────────────

  getPermissions(agentId: string, taskType: string): Record<string, unknown> | null {
    return this.db.prepare(
      'SELECT * FROM permissions WHERE agent_id = ? AND task_type = ?'
    ).get(agentId, taskType) as any ?? null;
  }

  upsertPermissions(p: {
    agentId: string; taskType: string; allowFsRead: boolean; allowFsWrite: boolean;
    allowNetwork: boolean; allowedCmds: string[]; blockedCmds: string[];
  }): void {
    const existing = this.getPermissions(p.agentId, p.taskType);
    if (existing) {
      this.db.prepare(`
        UPDATE permissions
        SET allow_fs_read=?, allow_fs_write=?, allow_network=?, allowed_cmds=?, blocked_cmds=?
        WHERE agent_id=? AND task_type=?
      `).run(
        p.allowFsRead ? 1 : 0, p.allowFsWrite ? 1 : 0, p.allowNetwork ? 1 : 0,
        JSON.stringify(p.allowedCmds), JSON.stringify(p.blockedCmds),
        p.agentId, p.taskType,
      );
    } else {
      this.db.prepare(`
        INSERT INTO permissions
          (id, agent_id, task_type, allow_fs_read, allow_fs_write, allow_network, allowed_cmds, blocked_cmds)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        randomUUID(), p.agentId, p.taskType,
        p.allowFsRead ? 1 : 0, p.allowFsWrite ? 1 : 0, p.allowNetwork ? 1 : 0,
        JSON.stringify(p.allowedCmds), JSON.stringify(p.blockedCmds),
      );
    }
  }

  // ─── Stats / Dashboard ───────────────────────────────────────

  getDashboardStats(projectId: string): {
    totalRuns: number; totalCheckpoints: number;
    successRate: number; avgDurationMin: number;
  } {
    const runs = this.db.prepare(
      "SELECT COUNT(*) AS n, SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) AS ok FROM workflow_runs WHERE project_id = ?"
    ).get(projectId) as { n: number; ok: number };

    const cps = this.db.prepare(`
      SELECT COUNT(*) AS n FROM checkpoints cp
      JOIN agent_sessions s ON s.id = cp.session_id
      JOIN tasks t ON t.id = s.task_id
      JOIN workflow_runs wr ON wr.id = t.workflow_run_id
      WHERE wr.project_id = ?
    `).get(projectId) as { n: number };

    return {
      totalRuns:      runs?.n ?? 0,
      totalCheckpoints: cps?.n ?? 0,
      successRate:    runs?.n ? (runs.ok / runs.n) : 0,
      avgDurationMin: 0,
    };
  }

  // ─── Maintenance ─────────────────────────────────────────────

  vacuum(): void {
    this.db.exec('VACUUM');
  }

  close(): void {
    this.db.close();
  }
}
