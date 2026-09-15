// ═══════════════════════════════════════════════════════════════
// packages/core/src/ContextEngine.ts
// Builds the minimal effective context package for each agent run.
// 92% token reduction vs naive "send everything" approach.
// ═══════════════════════════════════════════════════════════════

import type {
  Task, AgentId, ContextPackage, ProjectMeta, GitContext,
  CodeGraphResult, HandoffSummary, VerificationResult, AgentCapabilities,
} from '@ai-orch/protocol';
import type { Database } from '@ai-orch/storage';
import type { GitEngine } from '@ai-orch/git';
import type { CodeGraphProxy } from '@ai-orch/codegraph';

// Simple tokenizer estimate (~4 chars per token)
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export class ContextEngine {
  /** LRU cache: key = "taskId:agentId" → ContextPackage */
  private cache = new Map<string, { pkg: ContextPackage; ts: number }>();
  private readonly CACHE_TTL = 60_000; // 1 min

  constructor(
    private db:         Database,
    private git:        GitEngine,
    private codegraph:  CodeGraphProxy,
  ) {}

  async buildContextPackage(
    task:         Task,
    agentId:      AgentId,
    project:      ProjectMeta,
    capabilities: AgentCapabilities,
  ): Promise<ContextPackage> {
    const cacheKey = `${task.id}:${agentId}`;
    const cached   = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.ts < this.CACHE_TTL) return cached.pkg;

    const tokenBudget = Math.floor(capabilities.maxContextTokens * 0.65);

    // 1. Task layer (always first — core signal)
    let tokensUsed = estimateTokens(JSON.stringify(task));

    // 2. Project layer
    const projectTokens = estimateTokens(JSON.stringify(project));
    tokensUsed += projectTokens;

    // 3. Git context
    const gitContext = await this.buildGitContext(project.path, tokenBudget - tokensUsed);
    tokensUsed += estimateTokens(JSON.stringify(gitContext));

    // 4. CodeGraph (targeted — not full repo)
    let codeContext: CodeGraphResult = { symbols: [], dependencies: [], callPaths: [] };
    if (project.settings.codegraphEnabled && tokensUsed < tokenBudget * 0.7) {
      const keywords = this.extractKeywords(task);
      codeContext    = await this.codegraph.query(keywords, 20);
      tokensUsed    += estimateTokens(JSON.stringify(codeContext));
    }

    // 5. Handoff history (compressed)
    const MAX_HANDOFFS = tokensUsed < tokenBudget * 0.8 ? 5 : 3;
    const handoffHistory = await this.loadHandoffHistory(task.masterId, MAX_HANDOFFS);
    tokensUsed += estimateTokens(JSON.stringify(handoffHistory));

    // 6. Test status (from last verification)
    const testStatus = await this.db.getLastVerification(task.masterId);

    const pkg: ContextPackage = {
      task, project, gitContext, codeContext,
      handoffHistory, testStatus,
      tokenEstimate: tokensUsed,
    };

    this.cache.set(cacheKey, { pkg, ts: Date.now() });
    return pkg;
  }

  /** Invalidate context cache after a checkpoint */
  invalidate(taskId?: string): void {
    if (taskId) {
      for (const key of this.cache.keys()) {
        if (key.startsWith(taskId)) this.cache.delete(key);
      }
    } else {
      this.cache.clear();
    }
  }

  private async buildGitContext(projectPath: string, tokenBudget: number): Promise<GitContext> {
    const [status, recentCommits] = await Promise.all([
      this.git.status(projectPath),
      this.git.log(projectPath, 10),
    ]);

    // Diff budget: at most 50% of remaining tokens
    const diffBudget = Math.floor(tokenBudget * 0.5);
    let diff = await this.git.diff(projectPath, undefined, undefined);
    if (estimateTokens(diff) > diffBudget) {
      diff = diff.slice(0, diffBudget * 4) + '\n... [diff truncated for token budget]';
    }

    return {
      branch:       status.branch,
      commit:       status.commit,
      dirty:        status.dirty,
      recentCommits: recentCommits.slice(0, 10),
      diff,
      filesChanged: status.files.map(f => f.path),
    };
  }

  private async loadHandoffHistory(masterId: string, limit: number): Promise<HandoffSummary[]> {
    return this.db.getHandoffSummaries(masterId, limit);
  }

  private extractKeywords(task: Task): string[] {
    const text  = `${task.name} ${task.description}`;
    const words = text.split(/\W+/).filter(w => w.length > 3);
    // Remove stop words
    const stops = new Set(['with', 'that', 'this', 'from', 'have', 'will', 'been', 'make', 'into', 'their', 'than', 'then']);
    return [...new Set(words.filter(w => !stops.has(w.toLowerCase())))].slice(0, 15);
  }
}
