// packages/storage/src/migrations.ts
// All database migrations in version order.
// Run automatically on startup if schema version is behind.

export const MIGRATIONS: Array<{ version: number; sql: string }> = [
  {
    version: 1,
    sql: `
      -- Core schema (initial)
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;

      CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL);
      INSERT OR IGNORE INTO schema_version VALUES (0);

      CREATE TABLE IF NOT EXISTS projects (
        id          TEXT PRIMARY KEY,
        name        TEXT NOT NULL,
        path        TEXT NOT NULL UNIQUE,
        git_remote  TEXT,
        language    TEXT NOT NULL DEFAULT 'unknown',
        settings    TEXT NOT NULL DEFAULT '{}',
        created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS agents (
        id              TEXT PRIMARY KEY,
        name            TEXT NOT NULL,
        cli_path        TEXT,
        version         TEXT,
        interface_type  TEXT NOT NULL DEFAULT 'cli',
        status          TEXT NOT NULL DEFAULT 'unknown',
        capabilities    TEXT NOT NULL DEFAULT '{}'
      );

      CREATE TABLE IF NOT EXISTS workflow_runs (
        id           TEXT PRIMARY KEY,
        project_id   TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        master_task  TEXT NOT NULL,
        workflow     TEXT NOT NULL DEFAULT '{}',
        status       TEXT NOT NULL DEFAULT 'pending',
        started_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
        ended_at     DATETIME
      );

      CREATE TABLE IF NOT EXISTS tasks (
        id              TEXT PRIMARY KEY,
        workflow_run_id TEXT NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
        name            TEXT NOT NULL,
        type            TEXT NOT NULL,
        description     TEXT,
        deps            TEXT NOT NULL DEFAULT '[]',
        agent_hint      TEXT,
        status          TEXT NOT NULL DEFAULT 'pending',
        priority        INTEGER NOT NULL DEFAULT 2
      );

      CREATE TABLE IF NOT EXISTS agent_sessions (
        id             TEXT PRIMARY KEY,
        task_id        TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        agent_id       TEXT NOT NULL,
        worktree_path  TEXT,
        pid            INTEGER,
        status         TEXT NOT NULL DEFAULT 'starting',
        exit_reason    TEXT,
        git_before     TEXT,
        git_after      TEXT,
        tokens_used    INTEGER NOT NULL DEFAULT 0,
        started_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
        ended_at       DATETIME
      );

      CREATE TABLE IF NOT EXISTS checkpoints (
        id            TEXT PRIMARY KEY,
        session_id    TEXT NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
        git_commit    TEXT NOT NULL,
        handoff_path  TEXT,
        files_changed INTEGER NOT NULL DEFAULT 0,
        can_rollback  INTEGER NOT NULL DEFAULT 1,
        created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS test_runs (
        id                   TEXT PRIMARY KEY,
        checkpoint_id        TEXT NOT NULL REFERENCES checkpoints(id) ON DELETE CASCADE,
        policy               TEXT NOT NULL,
        build_passed         INTEGER NOT NULL DEFAULT 0,
        lint_passed          INTEGER NOT NULL DEFAULT 0,
        unit_passed          INTEGER NOT NULL DEFAULT 0,
        unit_failed          INTEGER NOT NULL DEFAULT 0,
        integration_passed   INTEGER NOT NULL DEFAULT 0,
        integration_failed   INTEGER NOT NULL DEFAULT 0,
        duration_ms          INTEGER NOT NULL DEFAULT 0,
        errors               TEXT NOT NULL DEFAULT '[]'
      );

      CREATE TABLE IF NOT EXISTS agent_metrics (
        id              TEXT PRIMARY KEY,
        agent_id        TEXT NOT NULL,
        task_type       TEXT NOT NULL,
        success_rate    REAL NOT NULL DEFAULT 0.7,
        avg_duration_ms INTEGER NOT NULL DEFAULT 60000,
        avg_tokens      INTEGER NOT NULL DEFAULT 0,
        sample_count    INTEGER NOT NULL DEFAULT 0,
        updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(agent_id, task_type)
      );

      CREATE TABLE IF NOT EXISTS events (
        id          TEXT PRIMARY KEY,
        session_id  TEXT,
        type        TEXT NOT NULL,
        payload     TEXT NOT NULL DEFAULT '{}',
        timestamp   DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS permissions (
        id            TEXT PRIMARY KEY,
        agent_id      TEXT NOT NULL,
        task_type     TEXT NOT NULL,
        allow_fs_read   INTEGER NOT NULL DEFAULT 1,
        allow_fs_write  INTEGER NOT NULL DEFAULT 1,
        allow_network   INTEGER NOT NULL DEFAULT 1,
        allowed_cmds  TEXT NOT NULL DEFAULT '[]',
        blocked_cmds  TEXT NOT NULL DEFAULT '[]',
        UNIQUE(agent_id, task_type)
      );

      CREATE TABLE IF NOT EXISTS saved_workflows (
        id         TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        name       TEXT NOT NULL,
        definition TEXT NOT NULL DEFAULT '{"nodes":[],"edges":[]}',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      -- Indexes
      CREATE INDEX IF NOT EXISTS idx_sessions_task      ON agent_sessions(task_id);
      CREATE INDEX IF NOT EXISTS idx_sessions_agent     ON agent_sessions(agent_id);
      CREATE INDEX IF NOT EXISTS idx_checkpoints_ses    ON checkpoints(session_id);
      CREATE INDEX IF NOT EXISTS idx_test_runs_cp       ON test_runs(checkpoint_id);
      CREATE INDEX IF NOT EXISTS idx_events_type        ON events(type);
      CREATE INDEX IF NOT EXISTS idx_events_timestamp   ON events(timestamp);
      CREATE INDEX IF NOT EXISTS idx_metrics_agent_type ON agent_metrics(agent_id, task_type);
      CREATE INDEX IF NOT EXISTS idx_tasks_workflow     ON tasks(workflow_run_id);
      CREATE INDEX IF NOT EXISTS idx_runs_project       ON workflow_runs(project_id);

      UPDATE schema_version SET version = 1;
    `,
  },
];

export function runMigrations(db: import('better-sqlite3').Database): void {
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // Ensure schema_version table exists
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL);
    INSERT OR IGNORE INTO schema_version VALUES (0);
  `);

  const current = (db.prepare('SELECT version FROM schema_version').get() as { version: number }).version;

  for (const migration of MIGRATIONS) {
    if (migration.version > current) {
      db.exec(migration.sql);
      console.info(`[DB] Applied migration v${migration.version}`);
    }
  }
}
