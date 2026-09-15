// apps/desktop/src/components/TaskProgressList.tsx
import type { Task } from '@ai-orch/protocol';

interface Props { tasks: Task[]; completed: string[]; failed: string[] }

export default function TaskProgressList({ tasks, completed, failed }: Props) {
  if (tasks.length === 0) return null;

  return (
    <div className="card" style={{ padding: '.7rem 1rem' }}>
      <div style={{
        fontFamily: 'var(--mono)', fontSize: 10,
        color: 'var(--muted)', letterSpacing: '.1em', marginBottom: '.5rem',
      }}>
        TASKS · {completed.length}/{tasks.length}
      </div>

      {/* Progress bar */}
      <div style={{ height: 3, background: 'var(--border)', borderRadius: 2, marginBottom: '.6rem', overflow: 'hidden' }}>
        <div style={{
          height: '100%', borderRadius: 2,
          background: 'linear-gradient(90deg, #10B981, #06C8D8)',
          width: `${tasks.length ? (completed.length / tasks.length) * 100 : 0}%`,
          transition: 'width .4s ease',
        }} />
      </div>

      {tasks.map(task => {
        const isDone   = completed.includes(task.id);
        const isFailed = failed.includes(task.id);
        const isActive = !isDone && !isFailed && task.status === 'running';

        return (
          <div key={task.id} style={{
            display: 'flex', alignItems: 'center', gap: '.5rem',
            padding: '.3rem 0', borderBottom: '1px solid var(--border)',
          }}>
            <span style={{ fontSize: 11, flexShrink: 0 }}>
              {isDone ? '✅' : isFailed ? '❌' : isActive ? '⟳' : '⬜'}
            </span>
            <span style={{
              fontSize: 12, flex: 1,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              color: isDone ? 'var(--green)' : isFailed ? 'var(--red)' : isActive ? 'var(--text)' : 'var(--muted)',
            }}>
              {task.name}
            </span>
            {task.agentHint && (
              <span style={{ fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--dim)', flexShrink: 0 }}>
                {task.agentHint}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
