// ═══════════════════════════════════════════════════════════════
// packages/security/src/PermissionManager.ts
// Intercepts every agent command. Enforces allowlist/blocklist.
// Escalates high-risk commands to user approval via EventBus.
// ═══════════════════════════════════════════════════════════════

import type {
  AgentId, TaskType, RiskLevel, PermissionDecision,
  AgentPermissions,
} from '@ai-orch/protocol';
import type { Database } from '../../storage/src/Database.js';

// Commands that are ALWAYS blocked — no override
const HARDCODED_BLOCKED = new Set([
  'sudo', 'su', 'passwd',
  'shutdown', 'reboot', 'halt', 'poweroff',
  'mkfs', 'fdisk', 'dd',
  'chmod 777', 'chown root',
  'visudo', 'crontab',
]);

// High-risk patterns requiring user approval
const HIGH_RISK_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /rm\s+-rf?\s+[~/]/, reason: 'Recursive delete in home/root directory' },
  { pattern: /rm\s+-rf?\s+\/[a-z]/, reason: 'Recursive delete from filesystem root' },
  { pattern: /git\s+push/, reason: 'Pushing to remote repository' },
  { pattern: /git\s+reset\s+--hard\s+HEAD~[2-9]/, reason: 'Multi-commit hard reset' },
  { pattern: /curl.*\|\s*(bash|sh)/, reason: 'Piping remote content to shell' },
  { pattern: /wget.*\|\s*(bash|sh)/, reason: 'Piping remote content to shell' },
  { pattern: /npm\s+publish/, reason: 'Publishing to npm registry' },
  { pattern: /docker\s+push/, reason: 'Pushing Docker image' },
  { pattern: /kubectl\s+delete/, reason: 'Deleting Kubernetes resources' },
  { pattern: /aws\s+(?:s3\s+rm|ec2\s+terminate)/, reason: 'Destructive AWS operation' },
  { pattern: /DROP\s+(?:TABLE|DATABASE)/i, reason: 'Destructive SQL operation' },
  { pattern: /DELETE\s+FROM\s+\w+\s*;?$/i, reason: 'Unqualified DELETE (no WHERE clause)' },
];

// Medium-risk patterns (log but auto-allow)
const MEDIUM_RISK_PATTERNS: RegExp[] = [
  /rm\s+-r?f?\s+\./,
  /git\s+stash\s+drop/,
  /npm\s+(?:uninstall|remove)/,
  /docker\s+(?:rm|rmi)/,
];

export type PermissionCheckResult =
  | { allowed: true }
  | { allowed: false; reason: string; risk: RiskLevel; requiresApproval: boolean };

// Store for user decisions (allow-all grants)
const userGrants = new Map<string, PermissionDecision>();

export class PermissionManager {
  constructor(private db: Database) {}

  /**
   * Check if a command should be allowed.
   * Returns immediately if auto-allowed/denied.
   * Returns requiresApproval=true for commands needing UI confirmation.
   */
  checkCommand(
    command: string,
    agentId: AgentId,
    taskType: TaskType,
    projectPath: string,
  ): PermissionCheckResult {
    const cmd = command.trim();

    // 1. Hardcoded blocklist — never allowed
    for (const blocked of HARDCODED_BLOCKED) {
      if (cmd.startsWith(blocked) || cmd.includes(` ${blocked} `)) {
        return { allowed: false, reason: `Command "${blocked}" is always blocked`, risk: 'critical', requiresApproval: false };
      }
    }

    // 2. Path escape check — no access outside project dir
    if (this.escapesProjectDir(cmd, projectPath)) {
      return { allowed: false, reason: 'Command accesses path outside project directory', risk: 'critical', requiresApproval: false };
    }

    // 3. Check user-granted always-allow
    const grantKey = `${agentId}:${cmd}`;
    if (userGrants.get(grantKey) === 'always_allow') return { allowed: true };

    // 4. High-risk patterns — require user approval
    for (const { pattern, reason } of HIGH_RISK_PATTERNS) {
      if (pattern.test(cmd)) {
        return { allowed: false, reason, risk: 'high', requiresApproval: true };
      }
    }

    // 5. Medium-risk — log and auto-allow
    for (const pattern of MEDIUM_RISK_PATTERNS) {
      if (pattern.test(cmd)) {
        this.logDecision(agentId, cmd, 'allow', 'medium');
        return { allowed: true };
      }
    }

    // 6. Check agent-specific allowlist from DB (sync approach)
    const allowed = this.isInAllowlist(agentId, taskType, cmd);
    if (!allowed) {
      return { allowed: false, reason: `Command not in allowlist for ${agentId}/${taskType}`, risk: 'low', requiresApproval: true };
    }

    this.logDecision(agentId, cmd, 'allow', 'low');
    return { allowed: true };
  }

  /** Record a user decision for a command */
  recordUserDecision(agentId: AgentId, command: string, decision: PermissionDecision): void {
    if (decision === 'always_allow') {
      userGrants.set(`${agentId}:${command}`, 'always_allow');
    }
    this.logDecision(agentId, command, decision, 'high');
  }

  /** Get permissions config for an agent */
  getPermissions(agentId: AgentId, taskType: TaskType): AgentPermissions {
    return {
      agentId, taskType,
      allowFsRead:  true,
      allowFsWrite: true,
      allowNetwork: true,
      allowedCmds:  this.defaultAllowlist(taskType),
      blockedCmds:  [...HARDCODED_BLOCKED],
    };
  }

  private isInAllowlist(agentId: AgentId, taskType: TaskType, cmd: string): boolean {
    const allowlist = this.defaultAllowlist(taskType);
    const cmdBase   = cmd.split(' ')[0]?.toLowerCase() ?? '';
    return allowlist.some(allowed => cmdBase === allowed || cmd.startsWith(allowed + ' '));
  }

  private defaultAllowlist(taskType: TaskType): string[] {
    const base = [
      'npm', 'npx', 'pnpm', 'yarn', 'node',
      'git add', 'git commit', 'git status', 'git diff',
      'git checkout', 'git branch', 'git log', 'git stash',
      'git worktree', 'git merge', 'git rebase',
      'cargo', 'rustc', 'rust-analyzer',
      'python', 'pip', 'pytest',
      'go', 'flutter', 'dart',
      'cat', 'ls', 'find', 'grep', 'sed', 'awk',
      'mkdir', 'cp', 'mv', 'touch',
      'echo', 'printf', 'tee',
      'which', 'env', 'printenv',
    ];

    if (taskType === 'devops') {
      base.push('docker', 'kubectl', 'helm', 'terraform', 'aws', 'gcloud');
    }
    if (taskType === 'database') {
      base.push('psql', 'mysql', 'sqlite3', 'mongosh');
    }
    return base;
  }

  private escapesProjectDir(cmd: string, projectPath: string): boolean {
    // Simple heuristic: detect common patterns of path traversal
    return /(?:\/etc\/|\/root\/|~\/\.ssh|~\/\.aws|~\/\.gnupg)/.test(cmd);
  }

  private logDecision(agentId: string, cmd: string, decision: string, risk: string): void {
    // Fire-and-forget audit log
    this.db.insertEvent('PERMISSION_DECISION', { agentId, cmd, decision, risk, ts: Date.now() }).catch(() => {});
  }
}
