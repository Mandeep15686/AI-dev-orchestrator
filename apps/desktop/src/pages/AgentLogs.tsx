// apps/desktop/src/pages/AgentLogs.tsx
import { useRef, useEffect, useState } from 'react';
import { useEventStore, useAgentStore } from '../store';
import type { LogEntry } from '../store';

const AGENT_COLORS: Record<string, string> = {
  claude: '#7C3AED', codex: '#2563EB', cursor: '#06C8D8', gemini: '#10B981',
};

export default function AgentLogs() {
  const logs      = useEventStore(s => s.logs);
  const clearLogs = useEventStore(s => s.clearLogs);
  const agents    = useAgentStore(s => s.agents);

  const [filterAgent, setFilterAgent] = useState<string>('all');
  const [filterText,  setFilterText]  = useState('');
  const [autoScroll,  setAutoScroll]  = useState(true);
  const [showErrors,  setShowErrors]  = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (autoScroll) bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs.length, autoScroll]);

  const filtered = logs.filter(l => {
    if (filterAgent !== 'all' && !l.sessionId.startsWith(filterAgent)) return false;
    if (showErrors && !l.isError) return false;
    if (filterText && !l.chunk.toLowerCase().includes(filterText.toLowerCase())) return false;
    return true;
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem', padding: '.6rem 1rem', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
        <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--muted)', letterSpacing: '.1em', marginRight: '.5rem' }}>LOGS</span>

        {/* Agent filter */}
        <select value={filterAgent} onChange={e => setFilterAgent(e.target.value)}
          style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 4, padding: '.2rem .5rem', fontSize: 12, fontFamily: 'var(--mono)' }}>
          <option value="all">All agents</option>
          {Object.values(agents).map(a => <option key={a.id} value={a.id}>{a.label}</option>)}
        </select>

        {/* Text filter */}
        <input
          placeholder="Filter output…"
          value={filterText}
          onChange={e => setFilterText(e.target.value)}
          className="code-input"
          style={{ flex: 1, fontSize: 12, padding: '.2rem .6rem' }}
        />

        {/* Toggles */}
        <label style={{ display: 'flex', alignItems: 'center', gap: '.3rem', fontSize: 12, cursor: 'pointer', userSelect: 'none' }}>
          <input type="checkbox" checked={showErrors} onChange={e => setShowErrors(e.target.checked)} />
          <span style={{ color: 'var(--muted)' }}>Errors only</span>
        </label>

        <label style={{ display: 'flex', alignItems: 'center', gap: '.3rem', fontSize: 12, cursor: 'pointer', userSelect: 'none' }}>
          <input type="checkbox" checked={autoScroll} onChange={e => setAutoScroll(e.target.checked)} />
          <span style={{ color: 'var(--muted)' }}>Auto-scroll</span>
        </label>

        <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--muted)', marginLeft: 'auto' }}>
          {filtered.length}/{logs.length} lines
        </span>

        <button className="btn btn-ghost" style={{ fontSize: 11 }} onClick={clearLogs}>Clear</button>
      </div>

      {/* Log output */}
      <div style={{
        flex: 1, overflowY: 'auto', overflowX: 'auto',
        background: '#080D18', fontFamily: 'var(--mono)',
        fontSize: 12, lineHeight: 1.7, padding: '1rem',
      }}>
        {filtered.length === 0 ? (
          <div style={{ color: 'var(--muted)', paddingTop: '2rem', textAlign: 'center' }}>
            {logs.length === 0 ? 'Waiting for agent output…' : 'No lines match filter'}
          </div>
        ) : (
          filtered.map(log => <LogLine key={log.id} log={log} />)
        )}
        <div ref={bottomRef} />
      </div>

      {/* Stats bar */}
      <div style={{ display: 'flex', gap: '1.5rem', padding: '.4rem 1rem', borderTop: '1px solid var(--border)', fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--muted)', flexShrink: 0 }}>
        <span>Total: {logs.length}</span>
        <span style={{ color: '#fca5a5' }}>Errors: {logs.filter(l => l.isError).length}</span>
        {Object.entries(AGENT_COLORS).map(([id, color]) => {
          const cnt = logs.filter(l => l.sessionId.startsWith(id)).length;
          if (!cnt) return null;
          return <span key={id} style={{ color }}>{id}: {cnt}</span>;
        })}
      </div>
    </div>
  );
}

function LogLine({ log }: { log: LogEntry }) {
  const agentId = Object.keys(AGENT_COLORS).find(id => log.sessionId.startsWith(id)) ?? '';
  const color   = AGENT_COLORS[agentId] ?? 'var(--muted)';
  const isSpecial = /TASK_COMPLETED|CHECKPOINT|HANDOFF|✅|❌/.test(log.chunk);

  return (
    <div style={{
      display: 'flex', gap: '.75rem', padding: '1px 0',
      background: isSpecial ? 'rgba(16,185,129,.04)' : undefined,
      borderLeft: isSpecial ? '2px solid #10B981' : '2px solid transparent',
      paddingLeft: isSpecial ? 6 : 0,
    }}>
      {/* Agent badge */}
      {agentId && (
        <span style={{ color, flexShrink: 0, fontSize: 10, paddingTop: 1, minWidth: 48 }}>
          [{agentId.slice(0, 6)}]
        </span>
      )}

      {/* Timestamp */}
      <span style={{ color: 'var(--dim)', flexShrink: 0, fontSize: 10, paddingTop: 1 }}>
        {new Date(log.ts).toTimeString().slice(0, 8)}
      </span>

      {/* Content */}
      <span style={{ color: log.isError ? '#fca5a5' : isSpecial ? '#6ee7b7' : '#cdd9e5', wordBreak: 'break-all', whiteSpace: 'pre-wrap' }}>
        {log.chunk}
      </span>
    </div>
  );
}
