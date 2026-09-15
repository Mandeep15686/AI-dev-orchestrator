// apps/desktop/src/pages/Settings.tsx
import { useState } from 'react';
import type { VerificationPolicy } from '@ai-orch/protocol';

interface SettingsState {
  verificationPolicy: VerificationPolicy;
  maxRetries:         number;
  sessionTimeoutMins: number;
  maxTokensK:         number;
  enableParallel:     boolean;
  codegraphEnabled:   boolean;
  autoCommit:         boolean;
  workflowDir:        string;
}

const DEFAULTS: SettingsState = {
  verificationPolicy: 'normal',
  maxRetries:         3,
  sessionTimeoutMins: 30,
  maxTokensK:         80,
  enableParallel:     true,
  codegraphEnabled:   true,
  autoCommit:         true,
  workflowDir:        '.ai-orchestrator',
};

export default function Settings() {
  const [cfg, setCfg] = useState<SettingsState>(DEFAULTS);
  const [saved, setSaved] = useState(false);

  const update = <K extends keyof SettingsState>(key: K, val: SettingsState[K]) => {
    setCfg(c => ({ ...c, [key]: val }));
    setSaved(false);
  };

  const handleSave = () => {
    localStorage.setItem('orch-settings', JSON.stringify(cfg));
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div style={{ padding: '1.5rem', overflowY: 'auto', height: '100%', maxWidth: 640 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem' }}>
        <div>
          <h2 style={{ fontSize: '1.1rem', fontWeight: 700 }}>Settings</h2>
          <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: '.3rem' }}>Global orchestrator configuration</p>
        </div>
        <button className="btn btn-primary" onClick={handleSave}>
          {saved ? '✅ Saved' : 'Save'}
        </button>
      </div>

      {/* Verification */}
      <Section title="Verification Policy" subtitle="Controls which checks run after each agent session">
        <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap' }}>
          {(['fast', 'normal', 'strict'] as VerificationPolicy[]).map(p => (
            <PolicyCard key={p} value={p} selected={cfg.verificationPolicy === p} onSelect={() => update('verificationPolicy', p)} />
          ))}
        </div>
      </Section>

      {/* Retry */}
      <Section title="Failure Recovery" subtitle="How the orchestrator handles agent failures">
        <FieldRow label="Max retries per task">
          <NumberInput value={cfg.maxRetries} min={1} max={10} onChange={v => update('maxRetries', v)} />
        </FieldRow>
      </Section>

      {/* Session limits */}
      <Section title="Session Limits" subtitle="Per-agent session resource limits">
        <FieldRow label="Session timeout (minutes)">
          <NumberInput value={cfg.sessionTimeoutMins} min={5} max={120} onChange={v => update('sessionTimeoutMins', v)} />
        </FieldRow>
        <FieldRow label="Max tokens per session (K)">
          <NumberInput value={cfg.maxTokensK} min={10} max={500} onChange={v => update('maxTokensK', v)} />
        </FieldRow>
      </Section>

      {/* Features */}
      <Section title="Features" subtitle="Enable or disable orchestrator capabilities">
        <ToggleRow label="Parallel execution (Git worktrees)" value={cfg.enableParallel} onChange={v => update('enableParallel', v)}
          desc="Run independent tasks simultaneously in isolated worktrees" />
        <ToggleRow label="CodeGraph integration" value={cfg.codegraphEnabled} onChange={v => update('codegraphEnabled', v)}
          desc="Build local AST index for smarter context assembly (requires codegraph CLI)" />
        <ToggleRow label="Auto-commit after each session" value={cfg.autoCommit} onChange={v => update('autoCommit', v)}
          desc="Create a Git checkpoint after every successful agent session" />
      </Section>

      {/* Paths */}
      <Section title="Paths" subtitle="Where the orchestrator stores its state">
        <FieldRow label="Orchestrator directory">
          <input className="code-input" value={cfg.workflowDir} onChange={e => update('workflowDir', e.target.value)}
            style={{ width: '100%', fontSize: 12 }} />
        </FieldRow>
        <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: '.3rem' }}>
          Relative to each project root. Contains state.json, handoffs/, decisions.md, and run logs.
        </div>
      </Section>

      {/* Danger zone */}
      <Section title="Danger Zone" subtitle="Irreversible actions" danger>
        <div style={{ display: 'flex', gap: '.5rem' }}>
          <button className="btn btn-danger" style={{ fontSize: 12 }}>Clear all metrics</button>
          <button className="btn btn-danger" style={{ fontSize: 12 }}>Reset all settings</button>
        </div>
      </Section>
    </div>
  );
}

function Section({ title, subtitle, children, danger }: { title: string; subtitle: string; children: React.ReactNode; danger?: boolean }) {
  return (
    <div style={{ marginBottom: '2rem' }}>
      <div style={{ marginBottom: '.75rem' }}>
        <h3 style={{ fontSize: '.9rem', fontWeight: 600, color: danger ? 'var(--red)' : 'var(--text)' }}>{title}</h3>
        <p style={{ fontSize: 11, color: 'var(--muted)', marginTop: '.2rem' }}>{subtitle}</p>
      </div>
      <div className="card" style={{ borderColor: danger ? 'rgba(239,68,68,.3)' : undefined }}>
        {children}
      </div>
    </div>
  );
}

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '.5rem 0', borderBottom: '1px solid var(--border)' }}>
      <span style={{ fontSize: 13 }}>{label}</span>
      {children}
    </div>
  );
}

function ToggleRow({ label, value, onChange, desc }: { label: string; value: boolean; onChange: (v: boolean) => void; desc: string }) {
  return (
    <div style={{ padding: '.6rem 0', borderBottom: '1px solid var(--border)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 13 }}>{label}</span>
        <button
          onClick={() => onChange(!value)}
          style={{
            width: 40, height: 22, borderRadius: 11, border: 'none', cursor: 'pointer',
            background: value ? 'var(--green)' : 'var(--border)',
            position: 'relative', transition: 'background .2s', flexShrink: 0,
          }}>
          <span style={{
            position: 'absolute', top: 3, left: value ? 21 : 3,
            width: 16, height: 16, borderRadius: '50%', background: '#fff',
            transition: 'left .2s',
          }} />
        </button>
      </div>
      <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: '.25rem' }}>{desc}</div>
    </div>
  );
}

function NumberInput({ value, min, max, onChange }: { value: number; min: number; max: number; onChange: (v: number) => void }) {
  return (
    <input type="number" value={value} min={min} max={max}
      onChange={e => onChange(Number(e.target.value))}
      className="code-input"
      style={{ width: 80, textAlign: 'right', fontSize: 13 }} />
  );
}

function PolicyCard({ value, selected, onSelect }: { value: VerificationPolicy; selected: boolean; onSelect: () => void }) {
  const info: Record<VerificationPolicy, { label: string; desc: string; color: string }> = {
    fast:   { label: 'Fast',   desc: 'Build + lint only',          color: '#10B981' },
    normal: { label: 'Normal', desc: '+ Unit tests',               color: '#2563EB' },
    strict: { label: 'Strict', desc: '+ Integration + security',   color: '#7C3AED' },
  };
  const { label, desc, color } = info[value];
  return (
    <button onClick={onSelect} style={{
      flex: 1, background: selected ? `${color}18` : 'var(--panel)',
      border: `1px solid ${selected ? color : 'var(--border)'}`,
      borderRadius: 7, padding: '.6rem .8rem', cursor: 'pointer',
      textAlign: 'left', color: 'var(--text)',
    }}>
      <div style={{ fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 700, color: selected ? color : 'var(--muted)' }}>{label.toUpperCase()}</div>
      <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: '.2rem' }}>{desc}</div>
    </button>
  );
}
