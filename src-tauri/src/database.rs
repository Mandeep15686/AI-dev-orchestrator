use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::{path::Path, sync::{Arc, Mutex}};
use tauri::command;

pub struct DbState(pub Arc<Mutex<Connection>>);

impl DbState {
    pub fn new(path: &Path) -> Self {
        let conn = Connection::open(path).expect("open db");
        Self(Arc::new(Mutex::new(conn)))
    }
}

pub fn init_db(path: &Path) -> anyhow::Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let conn = Connection::open(path)?;
    conn.execute_batch(SCHEMA)?;
    Ok(())
}

const SCHEMA: &str = r#"
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS projects (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    path        TEXT NOT NULL UNIQUE,
    git_remote  TEXT,
    language    TEXT,
    settings    TEXT DEFAULT '{}',
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS agents (
    id              TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    cli_path        TEXT,
    version         TEXT,
    interface_type  TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'unknown',
    capabilities    TEXT DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS workflow_runs (
    id           TEXT PRIMARY KEY,
    project_id   TEXT NOT NULL REFERENCES projects(id),
    master_task  TEXT NOT NULL,
    workflow     TEXT DEFAULT '{}',
    status       TEXT NOT NULL DEFAULT 'pending',
    started_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
    ended_at     DATETIME
);

CREATE TABLE IF NOT EXISTS tasks (
    id              TEXT PRIMARY KEY,
    workflow_run_id TEXT NOT NULL REFERENCES workflow_runs(id),
    name            TEXT NOT NULL,
    type            TEXT NOT NULL,
    description     TEXT,
    deps            TEXT DEFAULT '[]',
    agent_hint      TEXT,
    status          TEXT NOT NULL DEFAULT 'pending',
    priority        INTEGER DEFAULT 2
);

CREATE TABLE IF NOT EXISTS agent_sessions (
    id             TEXT PRIMARY KEY,
    task_id        TEXT NOT NULL REFERENCES tasks(id),
    agent_id       TEXT NOT NULL REFERENCES agents(id),
    worktree_path  TEXT,
    pid            INTEGER,
    status         TEXT NOT NULL DEFAULT 'starting',
    exit_reason    TEXT,
    git_before     TEXT,
    git_after      TEXT,
    tokens_used    INTEGER DEFAULT 0,
    started_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
    ended_at       DATETIME
);

CREATE TABLE IF NOT EXISTS checkpoints (
    id           TEXT PRIMARY KEY,
    session_id   TEXT NOT NULL REFERENCES agent_sessions(id),
    git_commit   TEXT NOT NULL,
    handoff_path TEXT,
    files_changed INTEGER DEFAULT 0,
    can_rollback  INTEGER DEFAULT 1,
    created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS test_runs (
    id                   TEXT PRIMARY KEY,
    checkpoint_id        TEXT NOT NULL REFERENCES checkpoints(id),
    policy               TEXT NOT NULL,
    build_passed         INTEGER DEFAULT 0,
    lint_passed          INTEGER DEFAULT 0,
    unit_passed          INTEGER DEFAULT 0,
    unit_failed          INTEGER DEFAULT 0,
    integration_passed   INTEGER DEFAULT 0,
    integration_failed   INTEGER DEFAULT 0,
    duration_ms          INTEGER DEFAULT 0,
    errors               TEXT DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS agent_metrics (
    id              TEXT PRIMARY KEY,
    agent_id        TEXT NOT NULL REFERENCES agents(id),
    task_type       TEXT NOT NULL,
    success_rate    REAL DEFAULT 0.7,
    avg_duration_ms INTEGER DEFAULT 60000,
    avg_tokens      INTEGER DEFAULT 0,
    sample_count    INTEGER DEFAULT 0,
    updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(agent_id, task_type)
);

CREATE TABLE IF NOT EXISTS events (
    id           TEXT PRIMARY KEY,
    session_id   TEXT,
    type         TEXT NOT NULL,
    payload      TEXT DEFAULT '{}',
    timestamp    DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS permissions (
    id           TEXT PRIMARY KEY,
    agent_id     TEXT NOT NULL REFERENCES agents(id),
    task_type    TEXT NOT NULL,
    allow_fs_read  INTEGER DEFAULT 1,
    allow_fs_write INTEGER DEFAULT 1,
    allow_network  INTEGER DEFAULT 1,
    allowed_cmds TEXT DEFAULT '["npm","pnpm","yarn","cargo","flutter","git","python","pip"]',
    blocked_cmds TEXT DEFAULT '["sudo","rm -rf /","shutdown","reboot"]',
    UNIQUE(agent_id, task_type)
);

CREATE INDEX IF NOT EXISTS idx_sessions_task   ON agent_sessions(task_id);
CREATE INDEX IF NOT EXISTS idx_checkpoints_ses ON checkpoints(session_id);
CREATE INDEX IF NOT EXISTS idx_events_ts       ON events(timestamp);
CREATE INDEX IF NOT EXISTS idx_events_ses      ON events(session_id);
"#;

// ─── Commands ─────────────────────────────────────────────────────────────────

#[derive(Serialize, Deserialize)]
pub struct QueryResult {
    pub columns: Vec<String>,
    pub rows:    Vec<Vec<serde_json::Value>>,
}

#[command]
pub fn db_query(
    sql: String,
    params: Vec<serde_json::Value>,
    state: tauri::State<'_, DbState>,
) -> Result<QueryResult, String> {
    let conn = state.0.lock().unwrap();
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let columns: Vec<String> = stmt.column_names().iter().map(|s| s.to_string()).collect();

    let rows: Vec<Vec<serde_json::Value>> = stmt
        .query_map(rusqlite::params_from_iter(params.iter().map(json_to_rusqlite)), |row| {
            let mut r = Vec::new();
            for i in 0..columns.len() {
                let v: rusqlite::types::Value = row.get(i)?;
                r.push(rusqlite_to_json(v));
            }
            Ok(r)
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    Ok(QueryResult { columns, rows })
}

#[command]
pub fn db_execute(
    sql: String,
    params: Vec<serde_json::Value>,
    state: tauri::State<'_, DbState>,
) -> Result<usize, String> {
    let conn = state.0.lock().unwrap();
    conn.execute(&sql, rusqlite::params_from_iter(params.iter().map(json_to_rusqlite)))
        .map_err(|e| e.to_string())
}

fn json_to_rusqlite(v: &serde_json::Value) -> Box<dyn rusqlite::ToSql> {
    match v {
        serde_json::Value::Null    => Box::new(Option::<String>::None),
        serde_json::Value::Bool(b) => Box::new(*b as i64),
        serde_json::Value::Number(n) => {
            if let Some(i) = n.as_i64() { Box::new(i) }
            else { Box::new(n.as_f64().unwrap_or(0.0)) }
        }
        serde_json::Value::String(s) => Box::new(s.clone()),
        v => Box::new(v.to_string()),
    }
}

fn rusqlite_to_json(v: rusqlite::types::Value) -> serde_json::Value {
    match v {
        rusqlite::types::Value::Null    => serde_json::Value::Null,
        rusqlite::types::Value::Integer(i) => serde_json::json!(i),
        rusqlite::types::Value::Real(f)    => serde_json::json!(f),
        rusqlite::types::Value::Text(s)    => serde_json::json!(s),
        rusqlite::types::Value::Blob(b)    => serde_json::json!(b),
    }
}
