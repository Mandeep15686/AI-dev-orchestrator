// ═══════════════════════════════════════════════════════════════
// apps/desktop/src/lib/tauri.ts
// Typed wrappers for all Tauri commands + event listeners.
// NEVER call invoke() or listen() outside this file.
// ═══════════════════════════════════════════════════════════════

import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type {
  AgentId, AgentSession, ProjectMeta,
} from '@ai-orch/protocol';

// ─── Git ──────────────────────────────────────────────────────
export interface GitStatusResult {
  branch: string; commit: string; dirty: boolean;
  files: Array<{ path: string; status: string }>;
}
export interface GitCommit { oid: string; message: string; author: string; time: number; }

export const tauriGit = {
  status:          (path: string)                         => invoke<GitStatusResult>('git_status',          { projectPath: path }),
  diff:            (path: string, from?: string, to?: string) => invoke<string>('git_diff',          { projectPath: path, from: from ?? null, to: to ?? null }),
  commit:          (path: string, message: string)         => invoke<string>('git_commit',            { projectPath: path, message }),
  log:             (path: string, limit = 20)              => invoke<GitCommit[]>('git_log',           { projectPath: path, limit }),
  createWorktree:  (path: string, branch: string, wt: string) => invoke<void>('git_create_worktree', { projectPath: path, branch, worktreePath: wt }),
  deleteWorktree:  (path: string, wt: string)              => invoke<void>('git_delete_worktree',     { projectPath: path, worktreePath: wt }),
  rollback:        (path: string, commit: string)          => invoke<void>('git_rollback',             { projectPath: path, commit }),
};

// ─── Process ──────────────────────────────────────────────────
export interface SpawnOptions {
  program: string; args: string[]; cwd: string;
  env: Record<string, string>; session_id: string;
}
export interface ProcessInfo { session_id: string; pid: number; program: string; status: string; }

export const tauriProcess = {
  spawn:  (opts: SpawnOptions)                    => invoke<ProcessInfo>('spawn_agent_process', { opts }),
  kill:   (sessionId: string)                     => invoke<void>('kill_agent_process',         { sessionId }),
  send:   (sessionId: string, data: string)       => invoke<void>('send_to_process',             { sessionId, data }),
  list:   ()                                      => invoke<ProcessInfo[]>('list_processes'),
};

// ─── Credentials ──────────────────────────────────────────────
export const tauriKeychain = {
  store:  (service: string, key: string, value: string) => invoke<void>('store_credential',  { service, key, value }),
  get:    (service: string, key: string)                => invoke<string>('get_credential',  { service, key }),
  delete: (service: string, key: string)                => invoke<void>('delete_credential', { service, key }),
  has:    (service: string, key: string)                => invoke<boolean>('has_credential', { service, key }),
};

// ─── Database ─────────────────────────────────────────────────
export interface QueryResult { columns: string[]; rows: unknown[][]; }

export const tauriDb = {
  query:   (sql: string, params: unknown[] = []) => invoke<QueryResult>('db_query',   { sql, params }),
  execute: (sql: string, params: unknown[] = []) => invoke<number>('db_execute',      { sql, params }),
};

// ─── Filesystem ───────────────────────────────────────────────
export const tauriFs = {
  read:      (path: string)                      => invoke<string>('read_file',  { path }),
  write:     (path: string, content: string)     => invoke<void>('write_file',   { path, content }),
  list:      (path: string)                      => invoke<string[]>('list_dir', { path }),
  ensure:    (path: string)                      => invoke<void>('ensure_dir',   { path }),
  exists:    (path: string)                      => invoke<boolean>('file_exists',{ path }),
};

// ─── Event Listeners ──────────────────────────────────────────
export interface AgentOutputEvent   { session_id: string; chunk: string; is_error: boolean; }
export interface FileChangedEvent   { session_id: string; path: string; change_type: string; }
export interface CheckpointEvent    { checkpoint_id: string; session_id: string; git_commit: string; files_changed: number; }
export interface PermissionReqEvent { session_id: string; command: string; risk: string; }

export const tauriEvents = {
  onAgentOutput:   (cb: (e: AgentOutputEvent) => void):   Promise<UnlistenFn> => listen('agent_output',        e => cb(e.payload as AgentOutputEvent)),
  onFileChanged:   (cb: (e: FileChangedEvent) => void):   Promise<UnlistenFn> => listen('file_changed',        e => cb(e.payload as FileChangedEvent)),
  onCheckpoint:    (cb: (e: CheckpointEvent) => void):    Promise<UnlistenFn> => listen('checkpoint_created',   e => cb(e.payload as CheckpointEvent)),
  onPermRequest:   (cb: (e: PermissionReqEvent) => void): Promise<UnlistenFn> => listen('permission_request',   e => cb(e.payload as PermissionReqEvent)),
  onWorkflowStep:  (cb: (e: { step: number; total: number; node_id: string }) => void): Promise<UnlistenFn> => listen('workflow_step', e => cb(e.payload as any)),
  onWorkflowDone:  (cb: (e: { total_time: number; checkpoints: number }) => void):      Promise<UnlistenFn> => listen('workflow_done', e => cb(e.payload as any)),
  onAgentSelected: (cb: (e: { agent_id: AgentId; task_id: string; score: number }) => void): Promise<UnlistenFn> => listen('agent_selected', e => cb(e.payload as any)),
};
