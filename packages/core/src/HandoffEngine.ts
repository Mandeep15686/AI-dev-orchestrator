// ═══════════════════════════════════════════════════════════════
// packages/core/src/HandoffEngine.ts
// Distils an agent session into a structured HandoffJSON.
// This is the core of context preservation between agents.
// ═══════════════════════════════════════════════════════════════

import { writeFile, mkdir } from 'node:fs/promises';
import { join }             from 'node:path';
import type {
  AgentSession, HandoffJSON, HandoffSummary, StopReason,
  VerificationResult, Task, AgentId,
} from '@ai-orch/protocol';

export interface RawSessionOutput {
  lines:      string[];
  exitReason: StopReason;
  duration:   number;
}

export class HandoffEngine {
  /**
   * Generate a structured HandoffJSON from a completed agent session.
   * Parses agent output to extract completed items, remaining work,
   * architectural decisions, and known issues.
   */
  generateHandoff(
    session:    AgentSession,
    task:       Task,
    raw:        RawSessionOutput,
    gitCommit:  string,
    filesModified: string[],
    verification: VerificationResult,
  ): HandoffJSON {
    const text = raw.lines.join('\n');

    return {
      version:       '1.0',
      task:          task.name,
      taskId:        task.id,
      agent:         session.agentId,
      gitCommit,
      exitReason:    raw.exitReason,
      completed:     this.extractCompleted(text),
      remaining:     this.extractRemaining(text, task),
      filesModified,
      tests: {
        passed:  verification.unitTests.passed,
        failed:  verification.unitTests.failed,
        suites:  verification.unitTests.suites,
        errors:  verification.unitTests.errors,
      },
      knownIssues:   this.extractKnownIssues(text),
      decisions:     this.extractDecisions(text),
      timestamp:     new Date().toISOString(),
    };
  }

  /** Save handoff JSON to .ai-orchestrator/handoffs/ */
  async saveHandoff(projectPath: string, handoff: HandoffJSON, index: number): Promise<string> {
    const dir  = join(projectPath, '.ai-orchestrator', 'handoffs');
    await mkdir(dir, { recursive: true });
    const path = join(dir, `${String(index).padStart(4, '0')}-${handoff.agent}-${Date.now()}.json`);
    await writeFile(path, JSON.stringify(handoff, null, 2), 'utf8');
    return path;
  }

  /** Build the continuation prompt for the next agent */
  buildNextPrompt(handoff: HandoffJSON, task: Task, agentId: AgentId): string {
    const completedStr = handoff.completed.length > 0
      ? `Completed by ${handoff.agent}:\n${handoff.completed.map(c => `  ✅ ${c}`).join('\n')}`
      : 'No prior work on this task.';

    const remainingStr = handoff.remaining.length > 0
      ? `Still needed:\n${handoff.remaining.map(r => `  ⬜ ${r}`).join('\n')}`
      : 'All items completed.';

    const decisionsStr = handoff.decisions.length > 0
      ? `\nArchitectural decisions already made (do NOT change these):\n${handoff.decisions.map(d => `  • ${d}`).join('\n')}`
      : '';

    const issuesStr = handoff.knownIssues.length > 0
      ? `\nKnown issues to be aware of:\n${handoff.knownIssues.map(i => `  ⚠️ ${i}`).join('\n')}`
      : '';

    const testStr = handoff.tests.failed > 0
      ? `\n⚠️ ${handoff.tests.failed} test(s) are currently failing: ${handoff.tests.errors.slice(0, 3).join(', ')}`
      : `\n✅ All ${handoff.tests.passed} tests passing`;

    return `## Handoff from ${handoff.agent} → ${agentId}

Previous agent: **${handoff.agent}** stopped at commit \`${handoff.gitCommit.slice(0, 8)}\`
Reason: ${handoff.exitReason}

${completedStr}

${remainingStr}
${decisionsStr}
${issuesStr}
${testStr}

## Your Assignment
Continue working on: **${task.name}**
${task.description}

Files touched by previous agent: ${handoff.filesModified.slice(0, 10).join(', ')}

Pick up exactly where the previous agent left off. Do not re-implement anything already marked completed.
`;
  }

  toSummary(handoff: HandoffJSON): HandoffSummary {
    return {
      checkpointId: handoff.gitCommit,
      agentId:      handoff.agent,
      taskId:       handoff.taskId,
      gitCommit:    handoff.gitCommit,
      exitReason:   handoff.exitReason,
      completed:    handoff.completed,
      remaining:    handoff.remaining,
      decisions:    handoff.decisions,
      testsPass:    handoff.tests.failed === 0,
      timestamp:    handoff.timestamp,
    };
  }

  // ─── Text extraction helpers ───────────────────────────────────

  private extractCompleted(text: string): string[] {
    const results: string[] = [];
    // Pattern: "Created X", "Implemented Y", "Added Z", "Fixed W"
    const patterns = [
      /(?:✅|COMPLETED?|created?|implemented?|added?|fixed?|wrote?|built?)\s*:?\s*([^\n.!?]{10,80})/gi,
      /^[+-]\s+(?:created?|implemented?|added?)\s+(.+)$/gim,
    ];
    for (const pat of patterns) {
      let m: RegExpExecArray | null;
      while ((m = pat.exec(text)) !== null) {
        const item = m[1]!.trim();
        if (item.length > 5 && !results.includes(item)) results.push(item);
      }
    }
    return results.slice(0, 15);
  }

  private extractRemaining(text: string, task: Task): string[] {
    const results: string[] = [];
    const patterns = [
      /(?:TODO|FIXME|still need|remaining|not yet|⬜)\s*:?\s*([^\n.!?]{10,80})/gi,
      /(?:next step|still to do)\s*:?\s*([^\n.!?]{10,80})/gi,
    ];
    for (const pat of patterns) {
      let m: RegExpExecArray | null;
      while ((m = pat.exec(text)) !== null) {
        const item = m[1]!.trim();
        if (item.length > 5 && !results.includes(item)) results.push(item);
      }
    }
    // If no remaining items found, use original task description as fallback
    if (results.length === 0 && text.includes('NEEDS_INPUT')) {
      results.push(`Task incomplete — needs user input: ${task.description}`);
    }
    return results.slice(0, 10);
  }

  private extractDecisions(text: string): string[] {
    const results: string[] = [];
    const patterns = [
      /(?:DECISION|decided?|chose?|using|approach)\s*:?\s*([^\n.!?]{10,120})/gi,
      /(?:I've chosen|we'll use|architecture)\s*:?\s*([^\n.!?]{10,120})/gi,
    ];
    for (const pat of patterns) {
      let m: RegExpExecArray | null;
      while ((m = pat.exec(text)) !== null) {
        const item = m[1]!.trim();
        if (item.length > 10 && !results.includes(item)) results.push(item);
      }
    }
    return results.slice(0, 8);
  }

  private extractKnownIssues(text: string): string[] {
    const results: string[] = [];
    const patterns = [
      /(?:KNOWN.ISSUE|WARNING|⚠️|NOTE|caveat|gotcha)\s*:?\s*([^\n.!?]{10,120})/gi,
      /(?:be aware|watch out|careful|issue)\s*:?\s*([^\n.!?]{10,120})/gi,
    ];
    for (const pat of patterns) {
      let m: RegExpExecArray | null;
      while ((m = pat.exec(text)) !== null) {
        const item = m[1]!.trim();
        if (item.length > 10 && !results.includes(item)) results.push(item);
      }
    }
    return results.slice(0, 5);
  }
}
