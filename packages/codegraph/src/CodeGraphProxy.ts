// ═══════════════════════════════════════════════════════════════
// packages/codegraph/src/CodeGraphProxy.ts
// Wraps CodeGraph's MCP server for local code intelligence.
// Builds AST-derived symbol index; queries it during context build.
// ═══════════════════════════════════════════════════════════════

import { exec }    from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import { join }    from 'node:path';
import type { CodeGraphResult, CodeSymbol, DepEdge } from '@ai-orch/protocol';

const execAsync = promisify(exec);

interface CachedQuery {
  result: CodeGraphResult;
  ts:     number;
}

const CACHE_TTL = 60_000;    // 1 minute
const MAX_CACHE = 50;

export class CodeGraphProxy {
  private cache    = new Map<string, CachedQuery>();
  private indexed  = new Set<string>(); // indexed project paths
  private available = false;

  // ─── Lifecycle ────────────────────────────────────────────────

  /** Init CodeGraph index for a project. Idempotent. */
  async init(projectPath: string): Promise<void> {
    if (this.indexed.has(projectPath)) return;

    // Check if codegraph CLI is installed
    const cg = await execAsync('which codegraph 2>/dev/null || echo ""').then(r => r.stdout.trim()).catch(() => '');
    if (!cg) {
      console.warn('[CodeGraph] codegraph CLI not found — using fallback grep search');
      this.available = false;
      return;
    }

    const indexDir = join(projectPath, '.codegraph');
    if (!existsSync(indexDir)) {
      try {
        await execAsync('codegraph init', { cwd: projectPath, timeout: 60_000 });
        console.info('[CodeGraph] Index built for', projectPath);
      } catch (err) {
        console.warn('[CodeGraph] Init failed, using fallback:', err);
        this.available = false;
        return;
      }
    }

    this.available = true;
    this.indexed.add(projectPath);
  }

  /** Incrementally update index after agent changes files */
  async update(projectPath: string, changedFiles: string[]): Promise<void> {
    if (!this.available || changedFiles.length === 0) return;

    // Invalidate cache entries for changed files
    for (const [key] of this.cache) {
      for (const file of changedFiles) {
        if (key.includes(file)) { this.cache.delete(key); break; }
      }
    }

    try {
      const files = changedFiles.map(f => JSON.stringify(f)).join(' ');
      await execAsync(`codegraph update ${files}`, { cwd: projectPath, timeout: 30_000 });
    } catch {
      // Fallback: full re-index on next query
      this.indexed.delete(projectPath);
    }
  }

  // ─── Query ────────────────────────────────────────────────────

  /**
   * Query for symbols relevant to given keywords.
   * Returns at most `maxSymbols` results.
   */
  async query(keywords: string[], maxSymbols = 20): Promise<CodeGraphResult> {
    const cacheKey = keywords.sort().join(',') + ':' + maxSymbols;
    const cached   = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.result;

    let result: CodeGraphResult;

    if (this.available) {
      result = await this.queryCodeGraph(keywords, maxSymbols);
    } else {
      result = await this.fallbackGrepSearch(keywords, maxSymbols);
    }

    // LRU eviction
    if (this.cache.size >= MAX_CACHE) {
      const oldest = [...this.cache.entries()].sort((a, b) => a[1].ts - b[1].ts)[0];
      if (oldest) this.cache.delete(oldest[0]);
    }
    this.cache.set(cacheKey, { result, ts: Date.now() });
    return result;
  }

  /** Get dependencies of a specific symbol */
  async getDependencies(symbolName: string): Promise<DepEdge[]> {
    if (!this.available) return [];
    try {
      const { stdout } = await execAsync(`codegraph deps ${JSON.stringify(symbolName)} --format json`, { timeout: 10_000 });
      return JSON.parse(stdout) as DepEdge[];
    } catch {
      return [];
    }
  }

  // ─── Implementations ──────────────────────────────────────────

  private async queryCodeGraph(keywords: string[], maxSymbols: number): Promise<CodeGraphResult> {
    try {
      const query = keywords.join(' ');
      const { stdout } = await execAsync(
        `codegraph search ${JSON.stringify(query)} --limit ${maxSymbols} --format json`,
        { timeout: 10_000 },
      );
      const data = JSON.parse(stdout) as { symbols?: CodeSymbol[]; dependencies?: DepEdge[] };
      return {
        symbols:      data.symbols      ?? [],
        dependencies: data.dependencies ?? [],
        callPaths:    [],
      };
    } catch {
      return this.fallbackGrepSearch(keywords, maxSymbols);
    }
  }

  /**
   * Grep-based fallback when CodeGraph is unavailable.
   * Extracts function/class/type definitions matching keywords.
   */
  private async fallbackGrepSearch(keywords: string[], maxSymbols: number): Promise<CodeGraphResult> {
    const symbols: CodeSymbol[] = [];
    const patterns = keywords.map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');

    try {
      const { stdout } = await execAsync(
        `grep -rn --include="*.ts" --include="*.tsx" --include="*.js" --include="*.py" --include="*.rs" ` +
        `-E "(export\\s+(function|class|const|type|interface)|def |fn |pub fn ).*\\b(${patterns})\\b" . ` +
        `--max-count=${maxSymbols * 2} 2>/dev/null || true`,
        { timeout: 10_000 },
      );

      const lines = stdout.trim().split('\n').filter(Boolean);
      for (const line of lines.slice(0, maxSymbols)) {
        const match = line.match(/^([^:]+):(\d+):\s*(.+)$/);
        if (!match) continue;
        const [, filePath, lineNo, content] = match;
        const kindMatch  = content?.match(/\b(function|class|interface|type|const|fn|def)\b/);
        const nameMatch  = content?.match(/\b(?:function|class|interface|type|const|fn|def)\s+(\w+)/);
        symbols.push({
          name:     nameMatch?.[1] ?? 'unknown',
          kind:     this.mapKind(kindMatch?.[1] ?? 'function'),
          filePath: filePath!,
          line:     parseInt(lineNo!, 10),
        });
      }
    } catch { /* silent */ }

    return { symbols, dependencies: [], callPaths: [] };
  }

  private mapKind(kw: string): CodeSymbol['kind'] {
    const map: Record<string, CodeSymbol['kind']> = {
      function: 'function', fn: 'function', def: 'function',
      class: 'class', interface: 'interface', type: 'type', const: 'variable',
    };
    return map[kw] ?? 'function';
  }
}
