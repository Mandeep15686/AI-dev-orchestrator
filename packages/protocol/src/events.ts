// ═══════════════════════════════════════════════════════════════
// packages/protocol/src/events.ts
// Complete typed event catalog for the orchestration event bus
// ═══════════════════════════════════════════════════════════════

import type {
  AgentId, SessionId, TaskId, CheckpointId, WorkflowRunId,
  StopReason, VerificationResult, HandoffSummary, RecoveryAction,
  RiskLevel, PermissionDecision,
} from './types.js';

// ─── Event Payload Map ────────────────────────────────────────
export interface EventPayloadMap {
  // Agent lifecycle
  AGENT_SELECTED:      { taskId: TaskId; agentId: AgentId; score: number; reason: string };
  AGENT_STARTED:       { sessionId: SessionId; agentId: AgentId; taskId: TaskId; worktree: string | null; pid: number };
  AGENT_OUTPUT:        { sessionId: SessionId; chunk: string; isError: boolean; timestamp: string };
  FILE_CHANGED:        { sessionId: SessionId; path: string; changeType: 'added' | 'modified' | 'deleted' };
  AGENT_STOPPED:       { sessionId: SessionId; reason: StopReason; duration: number; tokensUsed: number };
  AGENT_FAILED:        { sessionId: SessionId; reason: StopReason; error: string | null };
  AGENT_RESUMED:       { sessionId: SessionId; previousSessionId: SessionId };

  // Verification
  VERIFICATION_STARTED: { sessionId: SessionId; policy: string };
  VERIFICATION_PASSED:  { sessionId: SessionId; result: VerificationResult };
  VERIFICATION_FAILED:  { sessionId: SessionId; result: VerificationResult; failures: string[] };

  // Checkpoints & Handoffs
  CHECKPOINT_CREATED:  { checkpointId: CheckpointId; sessionId: SessionId; gitCommit: string; filesChanged: number };
  HANDOFF_GENERATED:   { checkpointId: CheckpointId; handoffPath: string; summary: HandoffSummary };

  // Context
  CONTEXT_BUILT:       { taskId: TaskId; agentId: AgentId; tokenEstimate: number; sources: string[] };

  // Recovery
  RECOVERY_STARTED:    { sessionId: SessionId; reason: StopReason; attempt: number; maxAttempts: number };
  RECOVERY_SWITCHING:  { fromAgent: AgentId; toAgent: AgentId; reason: string };
  RECOVERY_RETRYING:   { sessionId: SessionId; attempt: number };
  RECOVERY_ESCALATED:  { taskId: TaskId; failures: VerificationResult[]; message: string };

  // Tasks & Workflow
  TASK_STARTED:        { taskId: TaskId; workflowRunId: WorkflowRunId };
  TASK_COMPLETED:      { taskId: TaskId; checkpointId: CheckpointId; duration: number };
  TASK_FAILED:         { taskId: TaskId; reason: string; lastSessionId: SessionId | null };
  WORKFLOW_STEP:       { workflowRunId: WorkflowRunId; step: number; total: number; nodeId: string };
  WORKFLOW_DONE:       { workflowRunId: WorkflowRunId; totalTime: number; checkpoints: number };

  // Permissions
  PERMISSION_REQUEST:  { sessionId: SessionId; command: string; risk: RiskLevel };
  PERMISSION_GRANTED:  { sessionId: SessionId; command: string; decision: PermissionDecision };
  PERMISSION_DENIED:   { sessionId: SessionId; command: string };

  // User prompts
  USER_INTERVENTION:   { taskId: TaskId; message: string; context: string; resumeToken: string };
  USER_PROMPT_NEEDED:  { sessionId: SessionId; question: string; options: string[] | null };

  // Infrastructure
  CODEGRAPH_UPDATED:   { projectPath: string; symbolsIndexed: number; duration: number };
  WORKTREE_CREATED:    { branch: string; path: string };
  WORKTREE_MERGED:     { branch: string; target: string; conflictsResolved: number };
  WORKTREE_DELETED:    { branch: string; path: string };
  DB_ERROR:            { operation: string; error: string };
}

export type OrchestratorEvent = keyof EventPayloadMap;
