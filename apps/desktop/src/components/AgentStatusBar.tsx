// apps/desktop/src/components/AgentStatusBar.tsx
const COLORS: Record<string, string> = {
  claude: '#7C3AED', codex: '#2563EB', cursor: '#06C8D8', gemini: '#10B981',
};

interface AgentInfo { id: string; label: string; session: unknown }

export default function AgentStatusBar({ agents }: { agents: AgentInfo[] }) {
  if (agents.length === 0) return null;

  return (
    <div className="card" style={{ padding: '.7rem 1rem' }}>
      <div style={{
        fontFamily: 'var(--mono)', fontSize: 10,
        color: 'var(--muted)', letterSpacing: '.1em', marginBottom: '.5rem',
      }}>
        ACTIVE AGENTS
      </div>
      {agents.map(a => {
        const color = COLORS[a.id] ?? '#64748B';
        return (
          <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: '.5rem', padding: '.3rem 0' }}>
            {/* Pulsing dot */}
            <span style={{
              width: 7, height: 7, borderRadius: '50%',
              background: color,
              boxShadow: `0 0 5px ${color}`,
              flexShrink: 0,
              animation: 'pulse 2s infinite',
            }} />
            <span style={{ fontSize: 12, fontFamily: 'var(--mono)', color }}>{a.label}</span>
            <span style={{ fontSize: 10, color: 'var(--muted)', marginLeft: 'auto' }}>running</span>
          </div>
        );
      })}
      <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.4} }`}</style>
    </div>
  );
}
