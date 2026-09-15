// apps/desktop/src/components/Sidebar.tsx
import type { WorkflowStatus } from '../store';
import { useWorkflowStore, useAgentStore } from '../store';

type Page = 'dashboard' | 'workflow' | 'logs' | 'history' | 'agents' | 'settings';

const NAV_ITEMS: { id: Page; icon: string; label: string }[] = [
  { id: 'dashboard', icon: '⬡',  label: 'Dashboard' },
  { id: 'workflow',  icon: '⊕',  label: 'Workflow' },
  { id: 'logs',      icon: '≡',  label: 'Logs' },
  { id: 'history',   icon: '◷',  label: 'History' },
  { id: 'agents',    icon: '◈',  label: 'Agents' },
  { id: 'settings',  icon: '⚙',  label: 'Settings' },
];

export default function Sidebar({ current, onNavigate }: { current: Page; onNavigate: (p: Page) => void }) {
  const status    = useWorkflowStore(s => s.status);
  const checkpts  = useWorkflowStore(s => s.checkpoints);
  const agents    = useAgentStore(s => s.agents);
  const activeAgt = Object.values(agents).filter(a => a.session !== null);

  return (
    <aside style={{
      width: 56, background: 'var(--surface)', borderRight: '1px solid var(--border)',
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      padding: '.5rem 0', gap: 2, flexShrink: 0,
    }}>
      {/* Logo */}
      <div style={{ width: 36, height: 36, borderRadius: 8, background: 'linear-gradient(135deg,#2563EB,#7C3AED)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, marginBottom: '.5rem' }}>
        ◬
      </div>

      {NAV_ITEMS.map(item => (
        <button key={item.id} onClick={() => onNavigate(item.id)}
          title={item.label}
          style={{
            width: 40, height: 40, borderRadius: 8, border: 'none', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16,
            background: current === item.id ? 'rgba(37,99,235,.15)' : 'transparent',
            color: current === item.id ? 'var(--blue)' : 'var(--muted)',
            position: 'relative', transition: 'background .1s, color .1s',
          }}>
          {item.icon}
          {/* Badge for log page */}
          {item.id === 'history' && checkpts.length > 0 && (
            <span style={{ position: 'absolute', top: 4, right: 4, width: 8, height: 8, borderRadius: '50%', background: 'var(--green)', fontSize: 7, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff' }}>
              {checkpts.length > 9 ? '9+' : checkpts.length}
            </span>
          )}
        </button>
      ))}

      {/* Status dot */}
      <div style={{ marginTop: 'auto', marginBottom: '.5rem' }}>
        <StatusIndicator status={status} agents={activeAgt.length} />
      </div>
    </aside>
  );
}

function StatusIndicator({ status, agents }: { status: WorkflowStatus; agents: number }) {
  const colors: Record<WorkflowStatus, string> = { idle: '#475569', planning: '#2563EB', running: '#10B981', paused: '#F59E0B', completed: '#10B981', failed: '#EF4444' };
  return (
    <div title={`${status}${agents > 0 ? ` · ${agents} agent${agents > 1 ? 's' : ''} active` : ''}`}
      style={{ width: 8, height: 8, borderRadius: '50%', background: colors[status], boxShadow: status === 'running' ? `0 0 8px ${colors[status]}` : 'none' }} />
  );
}


// ─── AgentStatusBar ──────────────────────────────────────────
// apps/desktop/src/components/AgentStatusBar.tsx

export function AgentStatusBar({ agents }: { agents: Array<{ id: string; label: string; session: any }> }) {
  if (agents.length === 0) return null;
  const colors: Record<string, string> = { claude: '#7C3AED', codex: '#2563EB', cursor: '#06C8D8', gemini: '#10B981' };
  return (
    <div className="card" style={{ padding: '.7rem 1rem' }}>
      <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--muted)', letterSpacing: '.1em', marginBottom: '.5rem' }}>ACTIVE AGENTS</div>
      {agents.map(a => (
        <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: '.5rem', padding: '.3rem 0' }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: colors[a.id] ?? '#64748B', boxShadow: `0 0 5px ${colors[a.id] ?? '#64748B'}`, flexShrink: 0 }} />
          <span style={{ fontSize: 12, fontFamily: 'var(--mono)', color: colors[a.id] ?? 'var(--text)' }}>{a.label}</span>
          <span style={{ fontSize: 10, color: 'var(--muted)', marginLeft: 'auto' }}>running</span>
        </div>
      ))}
    </div>
  );
}


// ─── TaskProgressList ─────────────────────────────────────────
// apps/desktop/src/components/TaskProgressList.tsx
import type { Task } from '@ai-orch/protocol';

export function TaskProgressList({ tasks, completed, failed }: { tasks: Task[]; completed: string[]; failed: string[] }) {
  if (tasks.length === 0) return null;
  return (
    <div className="card" style={{ padding: '.7rem 1rem' }}>
      <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--muted)', letterSpacing: '.1em', marginBottom: '.5rem' }}>
        TASKS · {completed.length}/{tasks.length}
      </div>
      {tasks.map(task => {
        const isDone   = completed.includes(task.id);
        const isFailed = failed.includes(task.id);
        const isActive = !isDone && !isFailed && task.status === 'running';
        return (
          <div key={task.id} style={{ display: 'flex', alignItems: 'center', gap: '.5rem', padding: '.35rem 0', borderBottom: '1px solid var(--border)' }}>
            <span style={{ fontSize: 12, flexShrink: 0 }}>
              {isDone ? '✅' : isFailed ? '❌' : isActive ? '⟳' : '⬜'}
            </span>
            <span style={{ fontSize: 12, color: isDone ? 'var(--green)' : isFailed ? 'var(--red)' : isActive ? 'var(--text)' : 'var(--muted)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {task.name}
            </span>
            {task.agentHint && (
              <span style={{ fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--dim)' }}>{task.agentHint}</span>
            )}
          </div>
        );
      })}
    </div>
  );
}


// ─── AgentOutputStream ───────────────────────────────────────
// apps/desktop/src/components/AgentOutputStream.tsx
import { useRef, useEffect } from 'react';
import type { LogEntry } from '../store';

export function AgentOutputStream({ logs }: { logs: LogEntry[] }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { ref.current?.scrollTo({ top: ref.current.scrollHeight, behavior: 'smooth' }); }, [logs.length]);
  const recent = logs.slice(-500);
  return (
    <div ref={ref} style={{ flex: 1, overflowY: 'auto', padding: '1rem', fontFamily: 'var(--mono)', fontSize: 12, lineHeight: 1.7 }}>
      {recent.length === 0 ? (
        <div style={{ color: 'var(--muted)', paddingTop: '1rem' }}>Agent output will appear here…</div>
      ) : (
        recent.map(l => (
          <div key={l.id} style={{ color: l.isError ? '#fca5a5' : /TASK_COMPLETED|✅/.test(l.chunk) ? '#6ee7b7' : '#cdd9e5', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
            {l.chunk}
          </div>
        ))
      )}
    </div>
  );
}


// ─── GitStatusPanel ──────────────────────────────────────────
// apps/desktop/src/components/GitStatusPanel.tsx
export function GitStatusPanel() {
  // In real app: query via tauriGit.status()
  return (
    <div className="card" style={{ padding: '.7rem 1rem' }}>
      <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--muted)', letterSpacing: '.1em', marginBottom: '.5rem' }}>GIT STATUS</div>
      <div style={{ fontSize: 12, display: 'flex', flexDirection: 'column', gap: '.3rem' }}>
        <StatusRow label="Branch" value="main" color="var(--cyan)" />
        <StatusRow label="Last commit" value="Ready" color="var(--green)" />
        <StatusRow label="Checkpoints" value="0" color="var(--blue)" />
      </div>
    </div>
  );
}

function StatusRow({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
      <span style={{ color: 'var(--muted)' }}>{label}</span>
      <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color }}>{value}</span>
    </div>
  );
}


// ─── PermissionDialog ────────────────────────────────────────
// apps/desktop/src/components/PermissionDialog.tsx
import { useEventStore } from '../store';

const RISK_COLORS: Record<string, string> = { low: '#10B981', medium: '#F59E0B', high: '#EF4444', critical: '#EF4444' };

export function PermissionDialog({ request }: { request: { sessionId: string; command: string; risk: string } }) {
  const removePermReq = useEventStore(s => s.removePermReq);

  const handleDecision = (decision: 'allow' | 'deny' | 'always_allow') => {
    // In real app: send decision to orchestrator via IPC
    console.log('Permission decision:', request.sessionId, decision);
    removePermReq(request.sessionId);
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,.7)', backdropFilter: 'blur(4px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
    }}>
      <div className="card" style={{ width: 480, padding: '1.5rem', border: `1px solid ${RISK_COLORS[request.risk] ?? 'var(--border)'}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '.75rem', marginBottom: '1rem' }}>
          <span style={{ fontSize: '1.5rem' }}>⚠️</span>
          <div>
            <div style={{ fontWeight: 700, fontSize: '.95rem' }}>Permission Request</div>
            <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: RISK_COLORS[request.risk] ?? 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.08em' }}>
              {request.risk} risk
            </div>
          </div>
        </div>

        <div style={{ marginBottom: '1rem' }}>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: '.4rem' }}>An agent wants to run:</div>
          <code style={{
            display: 'block', background: '#080D18', border: '1px solid var(--border)',
            borderRadius: 6, padding: '.6rem .8rem', fontFamily: 'var(--mono)', fontSize: 12,
            color: '#fcd34d', wordBreak: 'break-all',
          }}>
            {request.command}
          </code>
        </div>

        <div style={{ display: 'flex', gap: '.5rem' }}>
          <button className="btn btn-danger" onClick={() => handleDecision('deny')} style={{ flex: 1 }}>
            ✕ Deny
          </button>
          <button className="btn btn-ghost" onClick={() => handleDecision('always_allow')} style={{ flex: 1 }}>
            Always allow
          </button>
          <button className="btn btn-primary" onClick={() => handleDecision('allow')} style={{ flex: 1 }}>
            ✓ Allow once
          </button>
        </div>
      </div>
    </div>
  );
}


// ─── WorkflowEditor placeholder ──────────────────────────────
export function WorkflowEditorPage() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: '1rem', color: 'var(--muted)' }}>
      <div style={{ fontSize: '2.5rem' }}>⊕</div>
      <div style={{ fontFamily: 'var(--mono)', fontSize: 13 }}>Visual Workflow Editor</div>
      <div style={{ fontSize: 12, textAlign: 'center', maxWidth: 400 }}>
        Drag-and-drop workflow builder powered by React Flow. Nodes: Agent, Test Gate, Condition, Parallel, Merge.
        <br /><br />
        Install <code style={{ fontFamily: 'var(--mono)', fontSize: 11 }}>reactflow</code> and see <code style={{ fontFamily: 'var(--mono)', fontSize: 11 }}>WorkflowEditor.tsx</code> for the full implementation.
      </div>
    </div>
  );
}
