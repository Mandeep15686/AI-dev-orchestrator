// apps/desktop/src/pages/WorkflowEditor.tsx
// Full visual workflow editor — requires: npm install reactflow
import { useCallback, useState } from 'react';
import { useWorkflowStore } from '../store';
import type { Workflow, WorkflowNode, WorkflowEdge } from '@ai-orch/protocol';

const AGENT_COLORS: Record<string, string> = {
  claude: '#7C3AED', codex: '#2563EB', cursor: '#06C8D8', gemini: '#10B981',
};

const NODE_ICONS: Record<string, string> = {
  start:     '▶',
  end:       '⏹',
  agent:     '◈',
  test:      '✓',
  condition: '◆',
  parallel:  '⫸',
  merge:     '⫷',
};

// ─── Custom node renderers (for ReactFlow) ────────────────────
export function AgentNode({ data }: { data: { agentId: string; label: string } }) {
  const color = AGENT_COLORS[data.agentId] ?? 'var(--blue)';
  return (
    <div style={{
      background: `${color}12`, border: `1px solid ${color}60`,
      borderRadius: 8, padding: '.6rem .9rem', minWidth: 140,
    }}>
      <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color, letterSpacing: '.08em' }}>AGENT</div>
      <div style={{ fontWeight: 600, fontSize: 12, marginTop: .2 }}>{data.label}</div>
      <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--muted)', marginTop: .2 }}>{data.agentId}</div>
    </div>
  );
}

export function TestNode({ data }: { data: { policy: string } }) {
  const color = data.policy === 'strict' ? '#7C3AED' : data.policy === 'normal' ? '#2563EB' : '#10B981';
  return (
    <div style={{ background: `${color}12`, border: `1px solid ${color}60`, borderRadius: 8, padding: '.5rem .8rem', minWidth: 120 }}>
      <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color, letterSpacing: '.08em' }}>TEST GATE</div>
      <div style={{ fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 600, color }}>{data.policy.toUpperCase()}</div>
    </div>
  );
}

// ─── Template library ─────────────────────────────────────────
const TEMPLATES: Array<{ name: string; description: string; workflow: Workflow }> = [
  {
    name: 'Sequential: Codex → Claude',
    description: 'Codex implements, Claude reviews and tests',
    workflow: {
      id: 'tpl-1', name: 'Sequential: Codex → Claude',
      nodes: [
        { id: 'n1', type: 'start',     label: 'Start',        position: { x: 100, y: 100 } },
        { id: 'n2', type: 'agent',     label: 'Implement',    agentId: 'codex',  position: { x: 260, y: 100 } },
        { id: 'n3', type: 'test',      label: 'Test Gate',    policy: 'normal',  position: { x: 420, y: 100 } },
        { id: 'n4', type: 'agent',     label: 'Review',       agentId: 'claude', position: { x: 580, y: 100 } },
        { id: 'n5', type: 'end',       label: 'Done',         position: { x: 740, y: 100 } },
      ],
      edges: [
        { id: 'e1', source: 'n1', target: 'n2' },
        { id: 'e2', source: 'n2', target: 'n3' },
        { id: 'e3', source: 'n3', target: 'n4', label: 'pass', condition: 'pass' },
        { id: 'e4', source: 'n3', target: 'n2', label: 'fail', condition: 'fail' },
        { id: 'e5', source: 'n4', target: 'n5' },
      ],
    },
  },
  {
    name: 'Parallel: Backend + Frontend',
    description: 'Claude handles backend, Cursor handles frontend simultaneously',
    workflow: {
      id: 'tpl-2', name: 'Parallel: Backend + Frontend',
      nodes: [
        { id: 'n1', type: 'start',    label: 'Start',    position: { x: 100, y: 200 } },
        { id: 'n2', type: 'parallel', label: 'Parallel', position: { x: 260, y: 200 } },
        { id: 'n3', type: 'agent',    label: 'Backend',  agentId: 'claude', position: { x: 420, y: 100 } },
        { id: 'n4', type: 'agent',    label: 'Frontend', agentId: 'cursor', position: { x: 420, y: 300 } },
        { id: 'n5', type: 'merge',    label: 'Merge',    position: { x: 580, y: 200 } },
        { id: 'n6', type: 'test',     label: 'Test',     policy: 'strict', position: { x: 740, y: 200 } },
        { id: 'n7', type: 'end',      label: 'Done',     position: { x: 900, y: 200 } },
      ],
      edges: [
        { id: 'e1', source: 'n1', target: 'n2' },
        { id: 'e2', source: 'n2', target: 'n3' },
        { id: 'e3', source: 'n2', target: 'n4' },
        { id: 'e4', source: 'n3', target: 'n5' },
        { id: 'e5', source: 'n4', target: 'n5' },
        { id: 'e6', source: 'n5', target: 'n6' },
        { id: 'e7', source: 'n6', target: 'n7', condition: 'pass' },
      ],
    },
  },
];

export default function WorkflowEditor() {
  const [selected, setSelected] = useState<string | null>(null);
  const setWorkflow = useWorkflowStore(s => s.setWorkflow);

  const applyTemplate = (tpl: typeof TEMPLATES[0]) => {
    setWorkflow(tpl.workflow);
    setSelected(tpl.workflow.id);
  };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '260px 1fr', height: '100%', overflow: 'hidden' }}>
      {/* Sidebar: templates + node palette */}
      <div style={{ borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column', overflow: 'auto', padding: '1rem' }}>
        <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--muted)', letterSpacing: '.1em', marginBottom: '.75rem' }}>TEMPLATES</div>
        {TEMPLATES.map(tpl => (
          <button key={tpl.workflow.id} onClick={() => applyTemplate(tpl)}
            style={{
              background: selected === tpl.workflow.id ? 'rgba(37,99,235,.1)' : 'var(--surface)',
              border: `1px solid ${selected === tpl.workflow.id ? 'var(--blue)' : 'var(--border)'}`,
              borderRadius: 7, padding: '.6rem .8rem', marginBottom: '.5rem',
              cursor: 'pointer', textAlign: 'left', color: 'var(--text)',
            }}>
            <div style={{ fontSize: 12, fontWeight: 600 }}>{tpl.name}</div>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: .2 }}>{tpl.description}</div>
          </button>
        ))}

        <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--muted)', letterSpacing: '.1em', margin: '1rem 0 .5rem' }}>NODE TYPES</div>
        {Object.entries(NODE_ICONS).map(([type, icon]) => (
          <div key={type} style={{ display: 'flex', alignItems: 'center', gap: '.5rem', padding: '.3rem 0', fontSize: 12 }}>
            <span style={{ fontFamily: 'var(--mono)', fontSize: 13 }}>{icon}</span>
            <span style={{ color: 'var(--muted)', textTransform: 'capitalize' }}>{type}</span>
          </div>
        ))}
      </div>

      {/* Canvas */}
      <WorkflowCanvas />
    </div>
  );
}

function WorkflowCanvas() {
  const workflow = useWorkflowStore(s => s.activeWorkflow);

  if (!workflow) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: '1rem', color: 'var(--muted)' }}>
        <div style={{ fontSize: '2.5rem', opacity: .4 }}>⊕</div>
        <div style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>Select a template or create a custom workflow</div>
        <div style={{ fontSize: 11, textAlign: 'center', maxWidth: 320 }}>
          In production: connect <code style={{ fontFamily: 'var(--mono)' }}>reactflow</code> here for a full drag-and-drop canvas
        </div>
      </div>
    );
  }

  return (
    <div style={{ position: 'relative', overflow: 'auto', padding: '2rem' }}>
      <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}>
        {workflow.edges.map(edge => {
          const src = workflow.nodes.find(n => n.id === edge.source);
          const tgt = workflow.nodes.find(n => n.id === edge.target);
          if (!src || !tgt) return null;
          const x1 = src.position.x + 70, y1 = src.position.y + 28;
          const x2 = tgt.position.x,      y2 = tgt.position.y + 28;
          const cx  = (x1 + x2) / 2;
          const color = edge.condition === 'fail' ? '#EF4444' : edge.condition === 'pass' ? '#10B981' : '#334155';
          return (
            <g key={edge.id}>
              <path d={`M ${x1} ${y1} C ${cx} ${y1} ${cx} ${y2} ${x2} ${y2}`}
                stroke={color} strokeWidth={1.5} fill="none" strokeDasharray={edge.condition === 'fail' ? '4 3' : undefined} />
              {edge.label && <text x={cx} y={(y1 + y2) / 2 - 4} fill={color} fontSize={9} fontFamily="var(--mono)" textAnchor="middle">{edge.label}</text>}
            </g>
          );
        })}
      </svg>
      {workflow.nodes.map(node => (
        <WorkflowNodeCard key={node.id} node={node} />
      ))}
    </div>
  );
}

function WorkflowNodeCard({ node }: { node: WorkflowNode }) {
  const icon  = NODE_ICONS[node.type] ?? '◇';
  const color = node.type === 'agent' ? (AGENT_COLORS[node.agentId ?? ''] ?? 'var(--blue)') : node.type === 'end' ? '#10B981' : node.type === 'start' ? '#10B981' : 'var(--muted)';
  return (
    <div style={{
      position: 'absolute',
      left: node.position.x + 32, top: node.position.y + 32,
      background: `${color}12`, border: `1px solid ${color}50`,
      borderRadius: 8, padding: '.5rem .8rem', minWidth: 120, cursor: 'default',
      userSelect: 'none',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '.4rem' }}>
        <span style={{ fontFamily: 'var(--mono)', color, fontSize: 13 }}>{icon}</span>
        <div>
          <div style={{ fontSize: 12, fontWeight: 600 }}>{node.label}</div>
          {node.agentId && <div style={{ fontFamily: 'var(--mono)', fontSize: 9, color }}>{node.agentId}</div>}
          {node.policy  && <div style={{ fontFamily: 'var(--mono)', fontSize: 9, color }}>{node.policy}</div>}
        </div>
      </div>
    </div>
  );
}
