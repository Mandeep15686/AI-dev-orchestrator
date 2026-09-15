// apps/desktop/src/components/AgentOutputStream.tsx
import { useRef, useEffect } from 'react';
import type { LogEntry }     from '../store';

interface Props { logs: LogEntry[] }

const SPECIAL_RE = /TASK_COMPLETED|CHECKPOINT|HANDOFF|DECISION|✅|❌|⚠️/;

export default function AgentOutputStream({ logs }: Props) {
  const ref    = useRef<HTMLDivElement>(null);
  const recent = logs.slice(-500);

  useEffect(() => {
    if (ref.current) {
      ref.current.scrollTop = ref.current.scrollHeight;
    }
  }, [logs.length]);

  return (
    <div
      ref={ref}
      style={{
        flex: 1, overflowY: 'auto', padding: '1rem',
        fontFamily: 'var(--mono)', fontSize: 12, lineHeight: 1.75,
      }}
    >
      {recent.length === 0 ? (
        <div style={{ color: 'var(--muted)', paddingTop: '1rem', textAlign: 'center' }}>
          <div style={{ fontSize: '1.5rem', opacity: .3, marginBottom: '.5rem' }}>◈</div>
          Waiting for agent output…
        </div>
      ) : (
        recent.map(l => {
          const isSpecial = SPECIAL_RE.test(l.chunk);
          const color = l.isError
            ? '#fca5a5'
            : isSpecial
              ? '#6ee7b7'
              : '#cdd9e5';

          return (
            <div
              key={l.id}
              style={{
                color,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-all',
                paddingLeft: isSpecial ? 8 : 0,
                borderLeft: isSpecial ? '2px solid #10B981' : '2px solid transparent',
                marginBottom: isSpecial ? 2 : 0,
              }}
            >
              {l.chunk}
            </div>
          );
        })
      )}
    </div>
  );
}
