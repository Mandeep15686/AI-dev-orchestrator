// apps/desktop/src/App.tsx
import { useEffect, useState } from 'react';
import { tauriEvents }          from './lib/tauri';
import { useEventStore, useWorkflowStore, useAgentStore, useProjectStore } from './store';

import Sidebar            from './components/Sidebar';
import PermissionDialog   from './components/PermissionDialog';
import Dashboard          from './pages/Dashboard';
import WorkflowEditor     from './pages/WorkflowEditor';
import AgentLogs          from './pages/AgentLogs';
import CheckpointTimeline from './pages/CheckpointTimeline';
import AgentManager       from './pages/AgentManager';
import Settings           from './pages/Settings';
import ProjectSelector    from './components/ProjectSelector';

import type { Page }      from './components/Sidebar';
import './App.css';

export default function App() {
  const [page, setPage]   = useState<Page>('dashboard');
  const addLog            = useEventStore(s => s.addLog);
  const addPermReq        = useEventStore(s => s.addPermReq);
  const addCheckpt        = useWorkflowStore(s => s.addCheckpoint);
  const setStatus         = useWorkflowStore(s => s.setStatus);
  const permReqs          = useEventStore(s => s.permRequests);
  const activeProject     = useProjectStore(s => s.activeProject);

  useEffect(() => {
    const unsubs: Array<() => void> = [];

    tauriEvents.onAgentOutput(ev => {
      addLog({
        id: `${ev.session_id}-${Date.now()}`,
        sessionId: ev.session_id,
        agentId:   ev.session_id.split('-')[0] ?? '',
        chunk:     ev.chunk,
        isError:   ev.is_error,
        ts:        Date.now(),
      });
    }).then(u => unsubs.push(u));

    tauriEvents.onCheckpoint(ev => {
      addCheckpt({
        id: ev.checkpoint_id, sessionId: ev.session_id, gitCommit: ev.git_commit,
        handoffPath: '', filesChanged: ev.files_changed,
        verification: { policy: 'normal', passed: true,
          build: { passed: true, output: '', duration: 0 }, lint: { passed: true, output: '', duration: 0 },
          unitTests: { passed: 0, failed: 0, skipped: 0, duration: 0, errors: [], suites: [] },
          intTests: null, security: null, duration: 0 },
        canRollback: true, createdAt: new Date().toISOString(),
      });
    }).then(u => unsubs.push(u));

    tauriEvents.onPermRequest(ev => addPermReq({ sessionId: ev.session_id, command: ev.command, risk: ev.risk })).then(u => unsubs.push(u));
    tauriEvents.onWorkflowDone(() => setStatus('completed')).then(u => unsubs.push(u));

    return () => unsubs.forEach(fn => fn());
  }, []);

  const PAGES: Record<Page, JSX.Element> = {
    dashboard: <Dashboard />,
    workflow:  <WorkflowEditor />,
    logs:      <AgentLogs />,
    history:   <CheckpointTimeline />,
    agents:    <AgentManager />,
    settings:  <Settings />,
  };

  return (
    <div className="app-root">
      <Sidebar current={page} onNavigate={setPage} />
      <main className="app-main">
        {!activeProject && page === 'dashboard' ? <ProjectSelector /> : PAGES[page]}
      </main>
      {permReqs.length > 0 && <PermissionDialog request={permReqs[0]!} />}
    </div>
  );
}
