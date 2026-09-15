// apps/desktop/src/pages/CheckpointTimeline.tsx
import { useState } from 'react';
import { useWorkflowStore } from '../store';
import { tauriGit } from '../lib/tauri';
import type { Checkpoint } from '@ai-orch/protocol';

const AGENT_COLORS: Record<string, string> = {
  claude: '#7C3AED',
  codex:  '#2563EB',
  cursor: '#06C8D8',
  gemini: '#10B981',
};

export default function CheckpointTimeline() {
  const checkpoints   = useWorkflowStore(s => s.checkpoints);
  const activeProject = null as any; // useProjectStore
  const [expanded,  setExpanded]  = useState<string | null>(null);
  const [diffText,  setDiffText]  = useState<Record<string, string>>({});
  const [rolling,   setRolling]   = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState<string | null>(null);

  const loadDiff = async (cp: Checkpoint) => {
    if (diffText[cp.id]) { setExpanded(cp.id); return; }
    if (!activeProject) return;
    try {
      const diff = await tauriGit.diff(activeProject.path, `${cp.gitCommit}^`, cp.gitCommit);
      setDiffText(d => ({ ...d, [cp.id]: diff || '(no changes)' }));
      setExpanded(cp.id);
    } catch { setDiffText(d => ({ ...d, [cp.id]: 'Error loading diff' })); }
  };

  const handleRollback = async (cp: Checkpoint) => {
    if (confirmed !== cp.id) { setConfirmed(cp.id); return; }
    if (!activeProject || !cp.canRollback) return;
    setRolling(cp.id);
    try { await tauriGit.rollback(activeProject.path, cp.gitCommit); }
    finally { setRolling(null); setConfirmed(null); }
  };

  if (checkpoints.length === 0) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: '1rem', color: 'var(--muted)' }}>
        <div style={{ fontSize: '2.5rem' }}>🏁</div>
        <div style={{ fontFamily: 'var(--mono)', fontSize: 13 }}>No checkpoints yet</div>
        <div style={{ fontSize: 12 }}>Checkpoints are created after each successful agent session.</div>
      </div>
    );
  }

  return (
    <div style={{ padding: '1.5rem', overflowY: 'auto', height: '100%' }}>
      <div style={{ marginBottom: '1.5rem' }}>
        <h2 style={{ fontSize: '1.1rem', fontWeight: 700, letterSpacing: '-.01em' }}>Checkpoint Timeline</h2>
        <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: '.3rem' }}>
          {checkpoints.length} checkpoint{checkpoints.length !== 1 ? 's' : ''} · Every checkpoint is rollback-safe
        </p>
      </div>

      <div style={{ position: 'relative', paddingLeft: '2rem' }}>
        {/* Vertical line */}
        <div style={{ position: 'absolute', left: 11, top: 0, bottom: 0, width: 2, background: 'var(--border)' }} />

        {checkpoints.map((cp, i) => {
          const agentId  = cp.sessionId.split('-')[0] ?? 'unknown';
          const color    = AGENT_COLORS[agentId] ?? 'var(--muted)';
          const isExpanded = expanded === cp.id;
          const diff     = diffText[cp.id];

          return (
            <div key={cp.id} style={{ marginBottom: '1.5rem', position: 'relative' }}>
              {/* Dot */}
              <div style={{
                position: 'absolute', left: -25, top: 4,
                width: 14, height: 14, borderRadius: '50%',
                background: color, border: '2px solid var(--bg)',
                boxShadow: `0 0 0 3px ${color}33`,
              }} />

              {/* Card */}
              <div className="card" style={{ borderLeft: `3px solid ${color}` }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '1rem' }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem', marginBottom: '.3rem' }}>
                      <span style={{ fontFamily: 'var(--mono)', fontSize: 10, fontWeight: 700, color, textTransform: 'uppercase', letterSpacing: '.08em' }}>{agentId}</span>
                      <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--muted)' }}>{cp.gitCommit.slice(0, 8)}</span>
                      {i === 0 && <span className="badge bd-green">LATEST</span>}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                      {cp.filesChanged} file{cp.filesChanged !== 1 ? 's' : ''} changed ·{' '}
                      {cp.verification.unitTests.passed} tests passing ·{' '}
                      {new Date(cp.createdAt).toLocaleTimeString()}
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: '.4rem', flexShrink: 0 }}>
                    <button className="btn btn-ghost" style={{ fontSize: 11, padding: '.25rem .6rem' }}
                      onClick={() => isExpanded ? setExpanded(null) : loadDiff(cp)}>
                      {isExpanded ? '▲ Hide diff' : '▼ Show diff'}
                    </button>
                    {cp.canRollback && (
                      <button
                        className={`btn ${confirmed === cp.id ? 'btn-danger' : 'btn-ghost'}`}
                        style={{ fontSize: 11, padding: '.25rem .6rem' }}
                        onClick={() => handleRollback(cp)}
                        disabled={!!rolling}
                      >
                        {rolling === cp.id ? '...' : confirmed === cp.id ? '⚠ Confirm rollback' : '↺ Rollback'}
                      </button>
                    )}
                  </div>
                </div>

                {/* Test bar */}
                <div style={{ marginTop: '.6rem', display: 'flex', gap: '.4rem', flexWrap: 'wrap' }}>
                  <Pill label={`Build: ${cp.verification.build.passed ? '✅' : '❌'}`} color={cp.verification.build.passed ? 'green' : 'red'} />
                  <Pill label={`Lint: ${cp.verification.lint.passed ? '✅' : '❌'}`} color={cp.verification.lint.passed ? 'green' : 'red'} />
                  <Pill label={`Tests: ${cp.verification.unitTests.passed}✅ ${cp.verification.unitTests.failed}❌`}
                    color={cp.verification.unitTests.failed > 0 ? 'red' : 'green'} />
                </div>

                {/* Diff viewer */}
                {isExpanded && (
                  <div style={{ marginTop: '.8rem' }}>
                    <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--muted)', letterSpacing: '.08em', marginBottom: '.4rem' }}>GIT DIFF</div>
                    <DiffViewer content={diff ?? 'Loading...'} />
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Pill({ label, color }: { label: string; color: 'green' | 'red' | 'blue' }) {
  const colors = { green: { bg: 'rgba(16,185,129,.1)', text: '#6ee7b7' }, red: { bg: 'rgba(239,68,68,.1)', text: '#fca5a5' }, blue: { bg: 'rgba(37,99,235,.1)', text: '#93c5fd' } };
  return (
    <span style={{ fontFamily: 'var(--mono)', fontSize: 10, padding: '2px 7px', borderRadius: 3, background: colors[color].bg, color: colors[color].text }}>
      {label}
    </span>
  );
}

function DiffViewer({ content }: { content: string }) {
  return (
    <div style={{ background: '#080D18', border: '1px solid var(--border)', borderRadius: 6, padding: '1rem', fontFamily: 'var(--mono)', fontSize: 11, lineHeight: 1.7, maxHeight: 400, overflowY: 'auto', overflowX: 'auto', whiteSpace: 'pre' }}>
      {content.split('\n').map((line, i) => (
        <div key={i} style={{ color: line.startsWith('+') ? '#6ee7b7' : line.startsWith('-') ? '#fca5a5' : line.startsWith('@@') ? '#93c5fd' : '#8b949e' }}>
          {line}
        </div>
      ))}
    </div>
  );
}
