// apps/desktop/src/components/PermissionDialog.tsx
import { useEventStore } from '../store';

interface PermReq { sessionId: string; command: string; risk: string }

const RISK_META: Record<string, { color: string; icon: string; label: string }> = {
  low:      { color: '#10B981', icon: 'ℹ',  label: 'LOW RISK' },
  medium:   { color: '#F59E0B', icon: '⚠',  label: 'MEDIUM RISK' },
  high:     { color: '#EF4444', icon: '⚠',  label: 'HIGH RISK' },
  critical: { color: '#EF4444', icon: '🛑', label: 'CRITICAL' },
};

export default function PermissionDialog({ request }: { request: PermReq }) {
  const removePermReq = useEventStore(s => s.removePermReq);
  const risk          = RISK_META[request.risk] ?? RISK_META.medium!;

  const handle = (decision: 'allow' | 'deny' | 'always_allow') => {
    // Real: send to orchestrator via Tauri IPC
    console.info('[PermissionDialog]', request.sessionId, decision);
    removePermReq(request.sessionId);
  };

  return (
    <div style={{
      position: 'fixed', inset: 0,
      background: 'rgba(0,0,0,.75)',
      backdropFilter: 'blur(6px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 9999,
    }}>
      <div className="card" style={{
        width: 500, maxWidth: '90vw',
        padding: '1.5rem',
        border: `1px solid ${risk.color}40`,
        boxShadow: `0 0 40px ${risk.color}20`,
      }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '.75rem', marginBottom: '1.2rem' }}>
          <span style={{ fontSize: '1.8rem' }}>{risk.icon}</span>
          <div>
            <div style={{ fontWeight: 700, fontSize: '1rem' }}>Permission Required</div>
            <div style={{
              fontFamily: 'var(--mono)', fontSize: 10,
              color: risk.color, letterSpacing: '.1em',
            }}>
              {risk.label}
            </div>
          </div>
        </div>

        {/* Session badge */}
        <div style={{ marginBottom: '.8rem', fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--muted)' }}>
          Session: <span style={{ color: 'var(--text)' }}>{request.sessionId}</span>
        </div>

        {/* Command */}
        <div style={{ marginBottom: '1.2rem' }}>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: '.4rem' }}>
            An agent wants to run:
          </div>
          <code style={{
            display: 'block',
            background: '#080D18',
            border: '1px solid var(--border)',
            borderLeft: `3px solid ${risk.color}`,
            borderRadius: 6, padding: '.7rem .9rem',
            fontFamily: 'var(--mono)', fontSize: 13,
            color: '#fcd34d', wordBreak: 'break-all',
            lineHeight: 1.6,
          }}>
            {request.command}
          </code>
        </div>

        {/* Buttons */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '.5rem' }}>
          <button
            className="btn btn-danger"
            onClick={() => handle('deny')}
            style={{ fontSize: 12 }}
          >
            ✕ Deny
          </button>
          <button
            className="btn btn-ghost"
            onClick={() => handle('always_allow')}
            style={{ fontSize: 12 }}
          >
            ∞ Always allow
          </button>
          <button
            className="btn btn-primary"
            onClick={() => handle('allow')}
            style={{ fontSize: 12 }}
          >
            ✓ Allow once
          </button>
        </div>

        <div style={{ marginTop: '.75rem', fontSize: 11, color: 'var(--muted)', textAlign: 'center' }}>
          "Always allow" saves this decision for the current session only
        </div>
      </div>
    </div>
  );
}
