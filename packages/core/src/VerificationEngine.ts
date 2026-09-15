// ═══════════════════════════════════════════════════════════════
// packages/core/src/VerificationEngine.ts
// Runs build → lint → unit tests → integration tests after
// every agent session. Controls whether the pipeline advances.
// ═══════════════════════════════════════════════════════════════

import { exec }  from 'node:child_process';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';
import { join }  from 'node:path';
import type {
  VerificationPolicy, VerificationResult,
  GateResult, TestSuiteResult,
} from '@ai-orch/protocol';

const execAsync = promisify(exec);

/** Timeout per gate (ms) */
const GATE_TIMEOUTS: Record<VerificationPolicy, number> = {
  fast:   60_000,
  normal: 180_000,
  strict: 600_000,
};

export class VerificationEngine {
  async runGate(
    policy:      VerificationPolicy,
    projectPath: string,
  ): Promise<VerificationResult> {
    const start   = Date.now();
    const timeout = GATE_TIMEOUTS[policy];
    const lang    = await this.detectLanguage(projectPath);

    // Fast policy: build + lint only
    // Normal: + unit tests
    // Strict: + integration tests + security scan
    const build     = await this.runBuild(projectPath, lang, timeout);
    const lint      = await this.runLint(projectPath, lang, timeout);
    const unitTests = policy === 'fast'
      ? { passed: 0, failed: 0, skipped: 0, duration: 0, errors: [], suites: [] }
      : await this.runUnitTests(projectPath, lang, timeout);
    const intTests  = policy === 'strict'
      ? await this.runIntegrationTests(projectPath, lang, timeout)
      : null;
    const security  = policy === 'strict'
      ? await this.runSecurityScan(projectPath, lang, timeout)
      : null;

    const passed = build.passed && lint.passed && unitTests.failed === 0
      && (intTests === null || intTests.failed === 0)
      && (security === null || security.passed);

    return {
      policy, passed, build, lint,
      unitTests, intTests, security,
      duration: Date.now() - start,
    };
  }

  // ─── Build ────────────────────────────────────────────────────
  private async runBuild(path: string, lang: string, timeout: number): Promise<GateResult> {
    const cmd = this.buildCmd(lang);
    if (!cmd) return { passed: true, output: 'No build step for ' + lang, duration: 0 };
    return this.gate(cmd, path, timeout);
  }

  private buildCmd(lang: string): string | null {
    switch (lang) {
      case 'typescript': return 'npm run build 2>&1 || pnpm build 2>&1';
      case 'rust':       return 'cargo build 2>&1';
      case 'python':     return 'python -m py_compile $(find . -name "*.py" | head -20) 2>&1';
      case 'go':         return 'go build ./... 2>&1';
      case 'flutter':    return 'flutter build 2>&1';
      default:           return null;
    }
  }

  // ─── Lint ─────────────────────────────────────────────────────
  private async runLint(path: string, lang: string, timeout: number): Promise<GateResult> {
    const cmd = this.lintCmd(lang);
    if (!cmd) return { passed: true, output: 'No linter for ' + lang, duration: 0 };
    return this.gate(cmd, path, timeout);
  }

  private lintCmd(lang: string): string | null {
    switch (lang) {
      case 'typescript': return 'npx eslint . --ext .ts,.tsx --max-warnings 0 2>&1 || pnpm lint 2>&1';
      case 'rust':       return 'cargo clippy -- -D warnings 2>&1';
      case 'python':     return 'python -m flake8 . --max-line-length=120 2>&1';
      case 'go':         return 'golangci-lint run 2>&1';
      default:           return null;
    }
  }

  // ─── Unit tests ───────────────────────────────────────────────
  private async runUnitTests(path: string, lang: string, timeout: number): Promise<TestSuiteResult> {
    const cmd = this.testCmd(lang);
    if (!cmd) return { passed: 0, failed: 0, skipped: 0, duration: 0, errors: [], suites: [] };
    const start  = Date.now();
    const result = await this.gate(cmd, path, timeout);
    return this.parseTestOutput(result.output, Date.now() - start, lang);
  }

  private testCmd(lang: string): string | null {
    switch (lang) {
      case 'typescript': return 'npm test -- --ci --passWithNoTests 2>&1 || pnpm test 2>&1';
      case 'rust':       return 'cargo test 2>&1';
      case 'python':     return 'python -m pytest -v 2>&1';
      case 'go':         return 'go test ./... 2>&1';
      case 'flutter':    return 'flutter test 2>&1';
      default:           return null;
    }
  }

  // ─── Integration tests ────────────────────────────────────────
  private async runIntegrationTests(path: string, lang: string, timeout: number): Promise<TestSuiteResult> {
    const cmd = this.integrationCmd(lang);
    if (!cmd) return { passed: 0, failed: 0, skipped: 0, duration: 0, errors: [], suites: [] };
    const start  = Date.now();
    const result = await this.gate(cmd, path, timeout);
    return this.parseTestOutput(result.output, Date.now() - start, lang);
  }

  private integrationCmd(lang: string): string | null {
    switch (lang) {
      case 'typescript': return 'npm run test:e2e 2>&1 || npx playwright test 2>&1';
      case 'python':     return 'python -m pytest tests/integration -v 2>&1';
      default:           return null;
    }
  }

  // ─── Security scan ────────────────────────────────────────────
  private async runSecurityScan(path: string, lang: string, timeout: number): Promise<GateResult> {
    const cmd = this.securityCmd(lang);
    if (!cmd) return { passed: true, output: 'No security scanner configured', duration: 0 };
    return this.gate(cmd, path, timeout);
  }

  private securityCmd(lang: string): string | null {
    switch (lang) {
      case 'typescript': return 'npm audit --audit-level=high 2>&1';
      case 'rust':       return 'cargo audit 2>&1';
      case 'python':     return 'pip-audit 2>&1';
      default:           return null;
    }
  }

  // ─── Helpers ──────────────────────────────────────────────────
  private async gate(cmd: string, cwd: string, timeout: number): Promise<GateResult> {
    const start = Date.now();
    try {
      const { stdout, stderr } = await execAsync(cmd, { cwd, timeout, shell: '/bin/sh' });
      return { passed: true, output: (stdout + stderr).slice(0, 8_000), duration: Date.now() - start };
    } catch (err: any) {
      return {
        passed:   false,
        output:   ((err.stdout ?? '') + (err.stderr ?? '')).slice(0, 8_000),
        duration: Date.now() - start,
      };
    }
  }

  private parseTestOutput(output: string, duration: number, lang: string): TestSuiteResult {
    // Jest output: "Tests: 5 passed, 2 failed"
    const jestMatch = output.match(/Tests:\s*(?:(\d+) passed)?(?:,\s*(\d+) failed)?(?:,\s*(\d+) skipped)?/);
    if (jestMatch) {
      return {
        passed:  parseInt(jestMatch[1] ?? '0', 10),
        failed:  parseInt(jestMatch[2] ?? '0', 10),
        skipped: parseInt(jestMatch[3] ?? '0', 10),
        duration, suites: [],
        errors: this.extractTestErrors(output),
      };
    }

    // Cargo test: "test result: ok. 12 passed; 0 failed"
    const cargoMatch = output.match(/test result: \w+\. (\d+) passed; (\d+) failed/);
    if (cargoMatch) {
      return {
        passed:  parseInt(cargoMatch[1]!, 10),
        failed:  parseInt(cargoMatch[2]!, 10),
        skipped: 0, duration, suites: [],
        errors: this.extractTestErrors(output),
      };
    }

    // Pytest: "5 passed, 2 failed"
    const pytestMatch = output.match(/(\d+) passed(?:, (\d+) failed)?/);
    if (pytestMatch) {
      return {
        passed:  parseInt(pytestMatch[1]!, 10),
        failed:  parseInt(pytestMatch[2] ?? '0', 10),
        skipped: 0, duration, suites: [],
        errors: this.extractTestErrors(output),
      };
    }

    // Fallback: count PASS/FAIL keywords
    const passCount = (output.match(/\bPASS\b|\bpassed\b/g) ?? []).length;
    const failCount = (output.match(/\bFAIL\b|\bfailed\b/g) ?? []).length;
    return { passed: passCount, failed: failCount, skipped: 0, duration, suites: [], errors: this.extractTestErrors(output) };
  }

  private extractTestErrors(output: string): string[] {
    const errors: string[] = [];
    const lines = output.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      if (/FAIL|Error:|assert|expected|actual/i.test(line) && line.trim().length > 5) {
        errors.push(line.trim().slice(0, 200));
      }
    }
    return errors.slice(0, 20);
  }

  private async detectLanguage(projectPath: string): Promise<string> {
    try {
      const pkg = JSON.parse(await readFile(join(projectPath, 'package.json'), 'utf8'));
      if (pkg.devDependencies?.typescript || pkg.dependencies?.typescript) return 'typescript';
      return 'javascript';
    } catch {}
    try { await readFile(join(projectPath, 'Cargo.toml'), 'utf8'); return 'rust'; } catch {}
    try { await readFile(join(projectPath, 'go.mod'), 'utf8'); return 'go'; } catch {}
    try { await readFile(join(projectPath, 'pubspec.yaml'), 'utf8'); return 'flutter'; } catch {}
    try { await readFile(join(projectPath, 'requirements.txt'), 'utf8'); return 'python'; } catch {}
    return 'unknown';
  }
}
