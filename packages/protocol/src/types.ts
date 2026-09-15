// ═══════════════════════════════════════════════════════════════
// packages/protocol/src/types.ts
// Single source of truth for all domain types shared across packages
// ═══════════════════════════════════════════════════════════════

// ─── IDs ──────────────────────────────────────────────────────
export type AgentId       = 'codex' | 'claude' | 'cursor' | 'gemini' | string;
export type TaskId        = string;
export type SessionId     = string;
export type CheckpointId  = string;
export type ProjectId     = string;
export type WorkflowRunId = string;

// ─── Task ─────────────────────────────────────────────────────
export type TaskType =
  | 'backend' | 'frontend' | 'database' | 'testing'
  | 'review'  | 'refactor' | 'debug'    | 'documentation'
  | 'security'| 'devops'   | 'general';

export type TaskStatus =
  | 'pending' | 'ready' | 'running' | 'completed' | 'failed' | 'skipped';

export interface Task {
  id:           TaskId;
  masterId:     WorkflowRunId;
  name:         string;
  description:  string;
  type:         TaskType;
  dependencies: TaskId[];
  agentHint:    AgentId | null;
  priority:     1 | 2 | 3;
  status:       TaskStatus;
  createdAt:    string;
}

export interface MasterTask {
  id:                 WorkflowRunId;
  projectId:          ProjectId;
  goal:               string;
  acceptanceCriteria: string[];
  tags:               string[];
}

// ─── Agent ────────────────────────────────────────────────────
export type AgentInterface = 'cli' | 'acp' | 'sdk' | 'rest';

export interface AgentCapabilities {
  interfaces:           AgentInterface[];
  strengths:            string[];
  weaknesses:           string[];
  bestFor:              TaskType[];
  languages:            string[];
  supportsParallel:     boolean;
  supportsResume:       boolean;
  supportsStreaming:    boolean;
  supportsWorktrees:    boolean;
  maxContextTokens:     number;
}

export type AgentStatus = 'available' | 'unavailable' | 'rate_limited' | 'error';

export interface AgentDetectionResult {
  available:  boolean;
  version:    string | null;
  cliPath:    string | null;
  authStatus: 'authenticated' | 'not_authenticated' | 'unknown';
  status:     AgentStatus;
  error?:     string;
}

export type SessionStatus =
  | 'starting' | 'running' | 'completing' | 'stopped' | 'crashed';

export interface AgentSession {
  id:          SessionId;
  agentId:     AgentId;
  taskId:      TaskId;
  pid:         number | null;
  worktree:    string | null;
  startedAt:   string;
  status:      SessionStatus;
  tokensUsed:  number;
}

export interface SessionOptions {
  worktree:     string | null;
  maxTokens:    number;
  timeoutMs:    number;
  resumeMode:   boolean;
}

// ─── Stop Reasons ─────────────────────────────────────────────
export type StopReason =
  | 'COMPLETED'    | 'RATE_LIMITED'   | 'TOKEN_LIMIT'
  | 'TIMEOUT'      | 'STUCK'          | 'CRASH'
  | 'TEST_FAILURE' | 'NEEDS_INPUT'    | 'USER_STOPPED'
  | 'AUTH_ERROR'   | 'PARTIAL';

// ─── Context ──────────────────────────────────────────────────
export interface GitContext {
  branch:         string;
  commit:         string;
  dirty:          boolean;
  recentCommits:  GitCommitInfo[];
  diff:           string;
  filesChanged:   string[];
}

export interface GitCommitInfo {
  oid:     string;
  message: string;
  author:  string;
  time:    number;
}

export interface CodeGraphResult {
  symbols:      CodeSymbol[];
  dependencies: DepEdge[];
  callPaths:    CallPath[];
}

export interface CodeSymbol {
  name:     string;
  kind:     'function' | 'class' | 'interface' | 'type' | 'variable' | 'module';
  filePath: string;
  line:     number;
  docstring?: string;
}

export interface DepEdge { from: string; to: string; type: string; }
export interface CallPath { from: string; to: string[]; }

export interface HandoffSummary {
  checkpointId: CheckpointId;
  agentId:      AgentId;
  taskId:       TaskId;
  gitCommit:    string;
  exitReason:   StopReason;
  completed:    string[];
  remaining:    string[];
  decisions:    string[];
  testsPass:    boolean;
  timestamp:    string;
}

export interface ContextPackage {
  task:           Task;
  project:        ProjectMeta;
  gitContext:     GitContext;
  codeContext:    CodeGraphResult;
  handoffHistory: HandoffSummary[];
  testStatus:     VerificationResult | null;
  tokenEstimate:  number;
}

// ─── Handoff ──────────────────────────────────────────────────
export interface HandoffJSON {
  version:       '1.0';
  task:          string;
  taskId:        TaskId;
  agent:         AgentId;
  gitCommit:     string;
  exitReason:    StopReason;
  completed:     string[];
  remaining:     string[];
  filesModified: string[];
  tests: {
    passed:  number;
    failed:  number;
    suites:  string[];
    errors:  string[];
  };
  knownIssues:   string[];
  decisions:     string[];
  timestamp:     string;
}

// ─── Verification ─────────────────────────────────────────────
export type VerificationPolicy = 'fast' | 'normal' | 'strict';

export interface GateResult {
  passed:   boolean;
  output:   string;
  duration: number;
}

export interface TestSuiteResult {
  passed:   number;
  failed:   number;
  skipped:  number;
  duration: number;
  errors:   string[];
  suites:   string[];
}

export interface VerificationResult {
  policy:    VerificationPolicy;
  passed:    boolean;
  build:     GateResult;
  lint:      GateResult;
  unitTests: TestSuiteResult;
  intTests:  TestSuiteResult | null;
  security:  GateResult       | null;
  duration:  number;
}

// ─── Checkpoint ───────────────────────────────────────────────
export interface Checkpoint {
  id:           CheckpointId;
  sessionId:    SessionId;
  gitCommit:    string;
  handoffPath:  string;
  filesChanged: number;
  verification: VerificationResult;
  canRollback:  boolean;
  createdAt:    string;
}

// ─── Workflow ─────────────────────────────────────────────────
export type WorkflowNodeType =
  | 'start' | 'end' | 'agent' | 'test' | 'condition' | 'parallel' | 'merge';

export interface WorkflowNode {
  id:       string;
  type:     WorkflowNodeType;
  label:    string;
  agentId?: AgentId;
  taskId?:  TaskId;
  policy?:  VerificationPolicy;
  condition?: string;
  position: { x: number; y: number };
}

export interface WorkflowEdge {
  id:        string;
  source:    string;
  target:    string;
  label?:    string;
  condition?: 'pass' | 'fail' | 'any';
}

export interface Workflow {
  id:    string;
  name:  string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}

export interface WorkflowState {
  workflowId:      string;
  currentNodeId:   string | null;
  completedNodes:  string[];
  failedNodes:     string[];
  activeSessionId: SessionId | null;
}

// ─── Project ──────────────────────────────────────────────────
export interface ProjectMeta {
  id:         ProjectId;
  name:       string;
  path:       string;
  gitRemote:  string | null;
  language:   string;
  settings:   ProjectSettings;
  createdAt:  string;
}

export interface ProjectSettings {
  verificationPolicy: VerificationPolicy;
  maxRetries:         number;
  sessionTimeoutMs:   number;
  maxTokensPerSession: number;
  enableParallel:     boolean;
  codegraphEnabled:   boolean;
  preferredAgents:    AgentId[];
}

// ─── Agent Events ─────────────────────────────────────────────
export type AgentEventType =
  | 'output' | 'file_changed' | 'command_executed'
  | 'progress' | 'stop' | 'error';

export interface AgentEvent {
  type:      AgentEventType;
  sessionId: SessionId;
  timestamp: string;
  data:      Record<string, unknown>;
}

// ─── Recovery ─────────────────────────────────────────────────
export type RecoveryStrategy =
  | 'SWITCH_AGENT' | 'RETRY_SAME' | 'DISPATCH_DEBUG'
  | 'ASK_USER'     | 'ROLLBACK'   | 'SKIP_TASK';

export interface RecoveryAction {
  strategy:    RecoveryStrategy;
  targetAgent?: AgentId;
  message?:    string;
  attempt:     number;
  maxAttempts: number;
}

// ─── Permissions ──────────────────────────────────────────────
export interface AgentPermissions {
  agentId:       AgentId;
  taskType:      TaskType;
  allowFsRead:   boolean;
  allowFsWrite:  boolean;
  allowNetwork:  boolean;
  allowedCmds:   string[];
  blockedCmds:   string[];
}

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

export interface PermissionRequest {
  sessionId: SessionId;
  command:   string;
  risk:      RiskLevel;
  reason:    string;
}

export type PermissionDecision = 'allow' | 'deny' | 'always_allow';
