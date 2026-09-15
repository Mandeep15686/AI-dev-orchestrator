// apps/desktop/src/pages/AgentManager.tsx
import { useState, useEffect } from 'react';
import { useAgentStore } from '../store';
import { tauriKeychain } from '../lib/tauri';
import type { AgentId } from '@ai-orch/protocol';

interface AgentConfig {
  id:       AgentId;
  label:    string;
  icon:     string;
  color:    string;
  cliName:  string;
  docsUrl:  string;
  keyName:  string;
  keyLabel: string;
}

const AGENT_CONFIGS: AgentConfig[] = [
  { id: 'claude', label: 'Claude Code',  icon: '🤖', color: '#7C3AED', cliName: 'claude', docsUrl: 'https://docs.anthropic.com/claude-code', keyName: 'ANTHROPIC_API_KEY',   keyLabel: 'Anthropic API Key' },
  { id: 'codex',  label: 'OpenAI Codex', icon: '💡', color: '#10B981', cliName: 'codex',  docsUrl: 'https://platform.openai.com/docs',       keyName: 'OPENAI_API_KEY',      keyLabel: 'OpenAI API Key' },
  { id: 'cursor', label: 'Cursor',        icon: '✏️', color: '#06C8D8', cliName: 'cursor', docsUrl: 'https://cursor.sh/docs',                  keyName: 'CURSOR_API_KEY',      keyLabel: 'Cursor API Key' },
  { id: 'gemini', label: 'Gemini',        icon: '✨', color: '#F59E0B', cliName: 'gemini', docsUrl: 'https://ai.google.dev/',                  keyName: 'GEMINI_API_KEY',      keyLabel: 'Google AI API Key' },
];

export default function AgentManager() {
  const { agents, setDetection } = useAgentStore();
  const [keyInputs,  setKeyInputs]  = useState<Record<AgentId, string>>({} as any);
  const [savedKeys,  setSavedKeys]  = useState<Record<AgentId, boolean>>({} as any);
  const [detecting,  setDetecting]  = useState<Record<AgentId, boolean>>({} as any);
  const [showKey,    setShowKey]    = useState<Record<AgentId, boolean>>({} as any);

  useEffect(() => {
    // Check which keys are already saved
    Promise.all(
      AGENT_CONFIGS.map(async cfg => {
        const has = await tauriKeychain.has(cfg.id, 'api_key').catch(() => false);
        setSavedKeys(s => ({ ...s, [cfg.id]: has }));
      })
    );
  }, []);

  const handleDetect = async (cfg: AgentConfig) => {
    setDetecting(d => ({ ...d, [cfg.id]: true }));
    try {
      // Simulate detection — real app would invoke adapter.detect()
      await new Promise(r => setTimeout(r, 1200));
      setDetection(cfg.id, {
        available:  true, version: '1.0.0', cliPath: `/usr/local/bin/${cfg.cliName}`,
        authStatus: savedKeys[cfg.id] ? 'authenticated' : 'not_authenticated',
        status:     savedKeys[cfg.id] ? 'available' : 'unavailable',
      });
    } catch {
      setDetection(cfg.id, { available: false, version: null, cliPath: null, authStatus: 'unknown', status: 'unavailable' });
    } finally {
      setDetecting(d => ({ ...d, [cfg.id]: false }));
    }
  };

  const handleSaveKey = async (cfg: AgentConfig) => {
    const key = keyInputs[cfg.id];
    if (!key?.trim()) return;
    await tauriKeychain.store(cfg.id, 'api_key', key.trim());
    setSavedKeys(s => ({ ...s, [cfg.id]: true }));
    setKeyInputs(i => ({ ...i, [cfg.id]: '' }));
  };

  const handleDeleteKey = async (cfg: AgentConfig) => {
    await tauriKeychain.delete(cfg.id, 'api_key');
    setSavedKeys(s => ({ ...s, [cfg.id]: false }));
    setDetection(cfg.id, { available: false, version: null, cliPath: null, authStatus: 'not_authenticated', status: 'unavailable' });
  };

  return (
    <div style={{ padding: '1.5rem', overflowY: 'auto', height: '100%' }}>
      <div style={{ marginBottom: '1.5rem' }}>
        <h2 style={{ fontSize: '1.1rem', fontWeight: 700 }}>Agent Manager</h2>
        <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: '.3rem' }}>
          Connect and configure AI agents. Credentials are stored in your OS keychain — never on disk.
        </p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        {AGENT_CONFIGS.map(cfg => {
          const agent   = agents[cfg.id];
          const det     = agent?.detection;
          const avail   = det?.status === 'available';
          const loading = detecting[cfg.id];
          const hasSavedKey = savedKeys[cfg.id];

          return (
            <div key={cfg.id} className="card" style={{ borderLeft: `3px solid ${cfg.color}` }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '.75rem' }}>
                  <span style={{ fontSize: '1.5rem' }}>{cfg.icon}</span>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '.95rem' }}>{cfg.label}</div>
                    <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--muted)' }}>
                      CLI: <code>{cfg.cliName}</code>
                      {det?.version && <span> · v{det.version}</span>}
                      {det?.cliPath && <span> · {det.cliPath}</span>}
                    </div>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem' }}>
                  <StatusDot status={avail ? 'available' : det ? 'unavailable' : 'unknown'} />
                  <button
                    className="btn btn-ghost"
                    style={{ fontSize: 11 }}
                    onClick={() => handleDetect(cfg)}
                    disabled={loading}
                  >
                    {loading ? '⟳ Detecting…' : '⟳ Detect'}
                  </button>
                  <a href={cfg.docsUrl} target="_blank" rel="noreferrer"
                    style={{ fontSize: 11, color: 'var(--muted)', textDecoration: 'none' }}>
                    Docs ↗
                  </a>
                </div>
              </div>

              {/* Credential section */}
              <div style={{ background: 'rgba(0,0,0,.25)', borderRadius: 6, padding: '.75rem 1rem' }}>
                <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--muted)', marginBottom: '.5rem', letterSpacing: '.08em' }}>
                  {cfg.keyLabel.toUpperCase()} · {hasSavedKey ? '🔒 SAVED IN KEYCHAIN' : '⚠ NOT CONFIGURED'}
                </div>
                {hasSavedKey ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem' }}>
                    <span style={{ fontFamily: 'var(--mono)', fontSize: 12, color: '#6ee7b7' }}>••••••••••••••••</span>
                    <button className="btn btn-danger" style={{ fontSize: 11, padding: '.2rem .5rem' }} onClick={() => handleDeleteKey(cfg)}>
                      Remove
                    </button>
                  </div>
                ) : (
                  <div style={{ display: 'flex', gap: '.5rem' }}>
                    <input
                      type={showKey[cfg.id] ? 'text' : 'password'}
                      placeholder={`Enter ${cfg.keyLabel}…`}
                      value={keyInputs[cfg.id] ?? ''}
                      onChange={e => setKeyInputs(k => ({ ...k, [cfg.id]: e.target.value }))}
                      className="code-input"
                      style={{ flex: 1, fontSize: 12 }}
                    />
                    <button className="btn btn-ghost" style={{ fontSize: 11, padding: '.25rem .5rem' }}
                      onClick={() => setShowKey(s => ({ ...s, [cfg.id]: !s[cfg.id] }))}>
                      {showKey[cfg.id] ? '🙈' : '👁'}
                    </button>
                    <button className="btn btn-primary" style={{ fontSize: 11 }} onClick={() => handleSaveKey(cfg)}>
                      Save
                    </button>
                  </div>
                )}
              </div>

              {/* Capabilities */}
              <div style={{ marginTop: '.75rem', display: 'flex', flexWrap: 'wrap', gap: '.3rem' }}>
                {getCapabilities(cfg.id).map(cap => (
                  <span key={cap} style={{ fontFamily: 'var(--mono)', fontSize: 9, padding: '2px 6px', borderRadius: 3, background: `${cfg.color}18`, color: cfg.color, border: `1px solid ${cfg.color}30` }}>
                    {cap}
                  </span>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function StatusDot({ status }: { status: 'available' | 'unavailable' | 'unknown' }) {
  const colors = { available: '#10B981', unavailable: '#EF4444', unknown: '#64748B' };
  const labels = { available: 'Available', unavailable: 'Unavailable', unknown: 'Not detected' };
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '.3rem' }}>
      <span style={{ width: 7, height: 7, borderRadius: '50%', background: colors[status], display: 'inline-block', boxShadow: status === 'available' ? `0 0 6px ${colors[status]}` : 'none' }} />
      <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: colors[status] }}>{labels[status]}</span>
    </div>
  );
}

function getCapabilities(id: AgentId): string[] {
  const map: Record<string, string[]> = {
    claude: ['reasoning', 'architecture', 'review', 'testing', 'debugging', 'docs', 'resume-session'],
    codex:  ['implementation', 'refactoring', 'algorithms', 'fast-edits'],
    cursor: ['frontend', 'UI', 'autocomplete', 'acp-protocol', 'parallel'],
    gemini: ['research', 'documentation', 'testing-strategy', '1M-context'],
  };
  return map[id] ?? [];
}
