// apps/desktop/src/components/ProjectSelector.tsx
import { useState, useEffect } from 'react';
import { useProjectStore }     from '../store';
import { tauriDb }             from '../lib/tauri';
import type { ProjectMeta }    from '@ai-orch/protocol';

export default function ProjectSelector() {
  const { projects, setProjects, setActive, addProject, activeProject } = useProjectStore();
  const [pathInput,  setPathInput]  = useState('');
  const [nameInput,  setNameInput]  = useState('');
  const [importing,  setImporting]  = useState(false);
  const [showForm,   setShowForm]   = useState(false);
  const [error,      setError]      = useState('');

  useEffect(() => { loadProjects(); }, []);

  const loadProjects = async () => {
    try {
      const result = await tauriDb.query('SELECT * FROM projects ORDER BY created_at DESC');
      const loaded: ProjectMeta[] = result.rows.map(row => ({
        id:        String(row[0]),
        name:      String(row[1]),
        path:      String(row[2]),
        gitRemote: row[3] ? String(row[3]) : null,
        language:  String(row[4] ?? 'unknown'),
        settings:  JSON.parse(String(row[5] ?? '{}')),
        createdAt: String(row[6]),
      }));
      setProjects(loaded);
    } catch { /* no projects yet */ }
  };

  const handleImport = async () => {
    if (!pathInput.trim()) { setError('Please enter a project path'); return; }
    setImporting(true);
    setError('');
    try {
      // In real app: call orchestrator/initProject via IPC
      const id = crypto.randomUUID();
      const project: ProjectMeta = {
        id,
        name:      nameInput.trim() || pathInput.split('/').pop() || 'Project',
        path:      pathInput.trim(),
        gitRemote: null,
        language:  'typescript',
        settings: {
          verificationPolicy: 'normal', maxRetries: 3,
          sessionTimeoutMs: 30 * 60_000, maxTokensPerSession: 80_000,
          enableParallel: true, codegraphEnabled: true, preferredAgents: [],
        },
        createdAt: new Date().toISOString(),
      };
      await tauriDb.execute(
        'INSERT INTO projects (id,name,path,language,settings) VALUES (?,?,?,?,?)',
        [id, project.name, project.path, project.language, JSON.stringify(project.settings)],
      );
      addProject(project);
      setActive(project);
      setShowForm(false);
      setPathInput('');
      setNameInput('');
    } catch (err) {
      setError(String(err));
    } finally {
      setImporting(false);
    }
  };

  return (
    <div style={{ padding: '1.5rem', overflowY: 'auto', height: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem' }}>
        <div>
          <h2 style={{ fontSize: '1.1rem', fontWeight: 700 }}>Projects</h2>
          <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: '.3rem' }}>
            Select a project or import a new one
          </p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowForm(f => !f)}>
          {showForm ? '✕ Cancel' : '+ Import Project'}
        </button>
      </div>

      {/* Import form */}
      {showForm && (
        <div className="card" style={{ marginBottom: '1.5rem', borderColor: 'rgba(37,99,235,.3)' }}>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--blue)', letterSpacing: '.1em', marginBottom: '1rem' }}>
            IMPORT PROJECT
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '.7rem' }}>
            <div>
              <label style={{ fontSize: 12, color: 'var(--muted)', display: 'block', marginBottom: '.3rem' }}>
                Project path *
              </label>
              <input
                className="code-input"
                placeholder="/Users/you/projects/my-app"
                value={pathInput}
                onChange={e => setPathInput(e.target.value)}
                style={{ width: '100%' }}
              />
            </div>
            <div>
              <label style={{ fontSize: 12, color: 'var(--muted)', display: 'block', marginBottom: '.3rem' }}>
                Display name (optional)
              </label>
              <input
                className="code-input"
                placeholder="My App"
                value={nameInput}
                onChange={e => setNameInput(e.target.value)}
                style={{ width: '100%' }}
              />
            </div>
            {error && <p style={{ fontSize: 12, color: 'var(--red)' }}>{error}</p>}
            <button className="btn btn-primary" onClick={handleImport} disabled={importing}>
              {importing ? '⟳ Importing…' : 'Import'}
            </button>
          </div>
        </div>
      )}

      {/* Project list */}
      {projects.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '3rem 0', color: 'var(--muted)' }}>
          <div style={{ fontSize: '2rem', marginBottom: '.5rem', opacity: .4 }}>⬡</div>
          <div style={{ fontSize: 13 }}>No projects yet — import one above</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '.75rem' }}>
          {projects.map(p => (
            <button
              key={p.id}
              onClick={() => setActive(p)}
              style={{
                background: activeProject?.id === p.id ? 'rgba(37,99,235,.08)' : 'var(--surface)',
                border: `1px solid ${activeProject?.id === p.id ? 'rgba(37,99,235,.4)' : 'var(--border)'}`,
                borderRadius: 9, padding: '.85rem 1.1rem',
                cursor: 'pointer', textAlign: 'left', color: 'var(--text)',
                width: '100%', transition: 'border-color .1s',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontWeight: 600, fontSize: '.9rem' }}>{p.name}</span>
                <span style={{
                  fontFamily: 'var(--mono)', fontSize: 9, padding: '2px 6px', borderRadius: 3,
                  background: 'rgba(6,200,216,.1)', color: 'var(--cyan)',
                }}>
                  {p.language}
                </span>
              </div>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--muted)', marginTop: '.3rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {p.path}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
