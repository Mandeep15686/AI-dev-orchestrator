// apps/desktop/src/components/GitStatusPanel.tsx
import { useEffect, useState } from 'react';
import { useProjectStore, useWorkflowStore } from '../store';
import { tauriGit } from '../lib/tauri';
import type { GitStatusResult } from '../lib/tauri';

export default function GitStatusPanel() {
  const activeProject = useProjectStore(s => s.activeProject);
  const checkpoints   = useWorkflowStore(s => s.checkpoints);
  const [status, setStatus] = useState<GitStatusResult | null>(null);

  useEffect(() => {
    if (!activeProject) return;
    const load = () =>
      tauriGit.status(activeProject.path)
        .then(setStatus)
        .catch(() => null);
    load();
    const id = setInterval(load, 5000);
    return () => clearInterval(id);
  }, [activeProject]);

  const branch  = status?.branch ?? '—';
  const commit  = status?.commit.slice(0, 7) ?? '—';
  const dirty   = status?.dirty ?? false;
  const changes = status?.files.length ?? 0;

  return (
    <div className="card" style={{ padding: '.7rem 1rem' }}>
      <div style={{
        fontFamily: 'var(--mono)', fontSize: 10,
        color: 'var(--muted)', letterSpacing: '.1em', marginBottom: '.5rem',
      }}>
        GIT STATUS
      </div>

      <Row label="Branch"      value={branch}                color="var(--cyan)" />
      <Row label="Commit"      value={commit}                color="var(--muted)" />
      <Row label="Changes"     value={dirty ? `${changes} files` : 'clean'} color={dirty ? 'var(--amber)' : 'var(--green)'} />
      <Row label="Checkpoints" value={String(checkpoints.length)} color="var(--blue)" />
    </div>
  );
}

function Row({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '.2rem 0' }}>
      <span style={{ fontSize: 11, color: 'var(--muted)' }}>{label}</span>
      <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color }}>{value}</span>
    </div>
  );
}
