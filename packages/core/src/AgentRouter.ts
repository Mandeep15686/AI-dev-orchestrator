// ═══════════════════════════════════════════════════════════════
// packages/core/src/AgentRouter.ts
// Selects the best available agent for a given task
// using a weighted scoring model + learned metrics
// ═══════════════════════════════════════════════════════════════

import type { AgentId, Task, TaskType } from '@ai-orch/protocol';
import type { AgentAdapter } from '../agents/shared/src/AgentAdapter.js';
import type { Database } from '../storage/Database.js';

export interface AgentScore {
  agentId:   AgentId;
  total:     number;  // 0.0–1.0
  breakdown: {
    taskTypeMatch:   number;  // weight 0.30
    availability:    number;  // weight 0.20
    quotaRemaining:  number;  // weight 0.15
    historicSuccess: number;  // weight 0.20
    languageMatch:   number;  // weight 0.10
    latency:         number;  // weight 0.05
  };
  available: boolean;
}

export interface RouterOptions {
  excludeAgents?: AgentId[];
  forceAgent?:    AgentId;
  projectLanguage?: string;
}

export class AgentRouter {
  private adapters = new Map<AgentId, AgentAdapter>();
  private quotas   = new Map<AgentId, { used: number; limit: number; resetsAt: Date }>();

  constructor(private db: Database) {}

  registerAdapter(adapter: AgentAdapter): void {
    this.adapters.set(adapter.id, adapter);
  }

  async selectBest(task: Task, opts: RouterOptions = {}): Promise<AgentId> {
    if (opts.forceAgent) return opts.forceAgent;

    const scores = await Promise.all(
      [...this.adapters.values()]
        .filter(a => !opts.excludeAgents?.includes(a.id))
        .map(a => this.scoreAgent(a, task, opts.projectLanguage ?? 'typescript'))
    );

    const available = scores.filter(s => s.available);
    if (available.length === 0) throw new Error('No available agents for task: ' + task.name);

    available.sort((a, b) => b.total - a.total);
    const best = available[0]!;
    return best.agentId;
  }

  async scoreAgent(adapter: AgentAdapter, task: Task, language: string): Promise<AgentScore> {
    const caps    = adapter.capabilities;
    const metrics = await this.db.getAgentMetrics(adapter.id, task.type);
    const det     = await adapter.detect().catch(() => null);

    const available = det?.status === 'available';
    const quota     = this.getQuotaFraction(adapter.id);

    const taskTypeMatch  = caps.bestFor.includes(task.type) ? 1.0
                          : caps.strengths.some(s => s.includes(task.type)) ? 0.6 : 0.3;
    const availability   = available ? 1.0 : 0.0;
    const quotaRemaining = quota;
    const historicSuccess = metrics?.success_rate ?? 0.7;
    const languageMatch  = caps.languages.includes(language.toLowerCase()) ? 1.0 : 0.5;
    const latency        = 1 - this.normalize(metrics?.avg_duration_ms ?? 60_000, 0, 300_000);

    const weightedTotal =
      taskTypeMatch   * 0.30 +
      availability    * 0.20 +
      quotaRemaining  * 0.15 +
      historicSuccess * 0.20 +
      languageMatch   * 0.10 +
      latency         * 0.05;
    const total = available ? weightedTotal : 0;

    return {
      agentId: adapter.id,
      total,
      available,
      breakdown: { taskTypeMatch, availability, quotaRemaining, historicSuccess, languageMatch, latency },
    };
  }

  async learnFromResult(agentId: AgentId, taskType: TaskType, success: boolean, durationMs: number): Promise<void> {
    await this.db.upsertAgentMetrics(agentId, taskType, success, durationMs);
  }

  getAdapter(id: AgentId): AgentAdapter | undefined {
    return this.adapters.get(id);
  }

  getAll(): AgentAdapter[] {
    return [...this.adapters.values()];
  }

  private getQuotaFraction(agentId: AgentId): number {
    const q = this.quotas.get(agentId);
    if (!q) return 1.0;
    if (q.resetsAt < new Date()) { this.quotas.delete(agentId); return 1.0; }
    return 1 - (q.used / q.limit);
  }

  recordRateLimit(agentId: AgentId, resetsInMs = 60_000): void {
    this.quotas.set(agentId, {
      used:     1, limit: 1,
      resetsAt: new Date(Date.now() + resetsInMs),
    });
  }

  private normalize(value: number, min: number, max: number): number {
    return Math.max(0, Math.min(1, (value - min) / (max - min)));
  }
}
