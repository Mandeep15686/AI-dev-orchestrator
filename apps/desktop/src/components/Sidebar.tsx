// apps/desktop/src/components/Sidebar.tsx
import { useWorkflowStore, useAgentStore } from '../store';
import type { WorkflowStatus } from '../store';

export type Page = 'dashboard' | 'workflow' | 'logs' | 'history' | 'agents' | 'settings';

interface NavItem { id: Page; icon: string; label: string }

const NAV: NavItem[] = [
  { id: 'dashboard', icon: '⬡',  label: 'Dashboard' },
  { id: 'workflow',  icon: '⊕',  label: 'Workflow'  },
  { id: 'logs',      icon: '≡',  label: 'Logs'      },
  { id: 'history',   icon: '◷',  label: 'History'   },
  { id: 'agents',    icon: '◈',  label: 'Agents'    },
  { id: 'settings',  icon: '⚙',  label: 'Settings'  },
];

const STATUS_COLORS: Record<WorkflowStatus, string> = {
  idle: '#475569', planning: '#2563EB', running: '#10B981',
  paused: '#F59E0B', completed: '#10B981', failed: '#EF4444',
};

interface SidebarProps {
  current:    Page;
  onNavigate: (p: Page) => void;
}

export default function Sidebar({ current, onNavigate }: SidebarProps) {
  const status     = useWorkflowStore(s => s.status);
  const checkpts   = useWorkflowStore(s => s.checkpoints);
  const agents     = useAgentStore(s => s.agents);
  const activeAgts = Object.values(agents).filter(a => a.session !== null).length;

  return (
    <aside style={{
      width: 56, background: 'var(--surface)',
      borderRight: '1px solid var(--border)',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', padding: '.5rem 0',
      gap: 2, flexShrink: 0,
    }}>
      {/* Logo mark */}
      <div style={{
        width: 34, height: 34, borderRadius: 8, marginBottom: '.5rem',
        background: 'linear-gradient(135deg, #2563EB, #7C3AED)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 16, color: '#fff', fontWeight: 700, flexShrink: 0,
      }}>
        ◬
      </div>

      {/* Nav items */}
      {NAV.map(item => {
        const isActive = current === item.id;
        const hasBadge = item.id === 'history' && checkpts.length > 0;
        return (
          <button
            key={item.id}
            title={item.label}
            onClick={() => onNavigate(item.id)}
            style={{
              width: 40, height: 40, borderRadius: 8,
              border: 'none', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 16, position: 'relative',
              background: isActive ? 'rgba(37,99,235,.15)' : 'transparent',
              color:      isActive ? '#2563EB' : '#64748B',
              transition: 'background .1s, color .1s',
            }}
          >
            {item.icon}
            {hasBadge && (
              <span style={{
                position: 'absolute', top: 5, right: 5,
                width: 14, height: 14, borderRadius: '50%',
                background: '#10B981', fontSize: 8,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: '#fff', fontWeight: 700,
              }}>
                {checkpts.length > 9 ? '9+' : checkpts.length}
              </span>
            )}
          </button>
        );
      })}

      {/* Bottom status */}
      <div style={{ marginTop: 'auto', marginBottom: '.5rem', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
        {activeAgts > 0 && (
          <span style={{
            fontFamily: 'var(--mono)', fontSize: 9, color: '#10B981',
            background: 'rgba(16,185,129,.12)', borderRadius: 3,
            padding: '1px 4px',
          }}>
            {activeAgts}
          </span>
        )}
        <div
          title={`Status: ${status}`}
          style={{
            width: 8, height: 8, borderRadius: '50%',
            background: STATUS_COLORS[status],
            boxShadow: status === 'running' ? `0 0 6px ${STATUS_COLORS[status]}` : 'none',
          }}
        />
      </div>
    </aside>
  );
}
