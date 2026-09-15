// apps/desktop/src/pages/Dashboard.tsx
import { useState }     from 'react';
import { useWorkflowStore, useAgentStore, useEventStore } from '../store';
import AgentStatusBar   from '../components/AgentStatusBar';
import TaskProgressList from '../components/TaskProgressList';
import AgentOutputStream from '../components/AgentOutputStream';
import GitStatusPanel   from '../components/GitStatusPanel';
import type { WorkflowStatus } from '../store';

const STATUS_COLORS: Record<WorkflowStatus, string> = {
  idle:      'var(--muted)',
  planning:  'var(--blue)',
  running:   'var(--green)',
  paused:    'var(--amber)',
  completed: 'var(--green)',
  failed:    'var(--red)',
};

export default function Dashboard() {
  const [goalInput, setGoalInput]   = useState('');
  const status      = useWorkflowStore(s => s.status);
  const tasks       = useWorkflowStore(s => s.tasks);
  const completed   = useWorkflowStore(s => s.completedTasks);
  const failed      = useWorkflowStore(s => s.failedTasks);
  const checkpoints = useWorkflowStore(s => s.checkpoints);
  const setStatus   = useWorkflowStore(s => s.setStatus);
  const setGoal     = useWorkflowStore(s => s.setGoal);
  const reset       = useWorkflowStore(s => s.reset);
  const agents      = useAgentStore(s => s.agents);
  const logs        = useEventStore(s => s.logs);

  const activeAgents = Object.values(agents).filter(a => a.session !== null);

  const handleStart = () => {
    if (!goalInput.trim()) return;
    setGoal(goalInput);
    setStatus('planning');
    // In real app: invoke orchestrator via Tauri IPC
  };

  const handlePause  = () => setStatus('paused');
  const handleResume = () => setStatus('running');
  const handleStop   = () => { reset(); };

  return (
    <div style={{ display: 'grid', gridTemplateRows: 'auto 1fr', height: '100%', gap: '1rem', padding: '1.5rem' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h1 style={{ fontFamily: 'var(--mono)', fontSize: '1.1rem', fontWeight: 700, letterSpacing: '-.02em' }}>
            Orchestrator
          </h1>
          <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem', marginTop: '.3rem' }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: STATUS_COLORS[status], display: 'inline-block' }} />
            <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: STATUS_COLORS[status], textTransform: 'uppercase', letterSpacing: '.1em' }}>{status}</span>
            {checkpoints.length > 0 && (
              <span style={{ fontSize: 11, color: 'var(--muted)' }}>· {checkpoints.length} checkpoint{checkpoints.length !== 1 ? 's' : ''}</span>
            )}
          </div>
        </div>

        {/* Controls */}
        <div style={{ display: 'flex', gap: '.5rem' }}>
          {status === 'idle' ? (
            <button className="btn btn-primary" onClick={handleStart} disabled={!goalInput.trim()}>
              ▶ Start
            </button>
          ) : status === 'running' ? (
            <>
              <button className="btn btn-ghost" onClick={handlePause}>⏸ Pause</button>
              <button className="btn btn-danger" onClick={handleStop}>⏹ Stop</button>
            </>
          ) : status === 'paused' ? (
            <>
              <button className="btn btn-primary" onClick={handleResume}>▶ Resume</button>
              <button className="btn btn-danger" onClick={handleStop}>⏹ Stop</button>
            </>
          ) : (
            <button className="btn btn-ghost" onClick={() => reset()}>↺ New Task</button>
          )}
        </div>
      </div>

      {/* Goal input */}
      {status === 'idle' && (
        <div className="card" style={{ padding: '1.2rem' }}>
          <label style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: '.5rem', letterSpacing: '.08em' }}>
            DESCRIBE YOUR GOAL
          </label>
          <textarea
            className="code-input"
            placeholder="e.g. Build a complete authentication system with JWT, refresh tokens, and a React login page"
            value={goalInput}
            onChange={e => setGoalInput(e.target.value)}
            rows={3}
            style={{ width: '100%', resize: 'vertical' }}
          />
          <div style={{ marginTop: '.5rem', fontSize: 12, color: 'var(--muted)' }}>
            The orchestrator will decompose this into tasks and assign the best agent to each one.
          </div>
        </div>
      )}

      {/* Main content when running */}
      {status !== 'idle' && (
        <div style={{ display: 'grid', gridTemplateColumns: '300px 1fr', gap: '1rem', overflow: 'hidden' }}>
          {/* Left: task list + agents */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', overflow: 'auto' }}>
            <AgentStatusBar agents={activeAgents} />
            <TaskProgressList tasks={tasks} completed={completed} failed={failed} />
            <GitStatusPanel />
          </div>

          {/* Right: live output */}
          <div className="card" style={{ overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: '.6rem 1rem', borderBottom: '1px solid var(--border)', fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--muted)', letterSpacing: '.1em' }}>
              AGENT OUTPUT STREAM
            </div>
            <AgentOutputStream logs={logs} />
          </div>
        </div>
      )}
    </div>
  );
}
