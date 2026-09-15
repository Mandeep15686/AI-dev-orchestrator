// apps/desktop/src/store/index.ts
import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import type {
  ProjectMeta, AgentId, AgentDetectionResult,
  AgentSession, Checkpoint, Workflow, Task,
} from '@ai-orch/protocol';

// ─── Project Store ────────────────────────────────────────────
interface ProjectStore {
  projects:      ProjectMeta[];
  activeProject: ProjectMeta | null;
  setProjects:   (p: ProjectMeta[]) => void;
  setActive:     (p: ProjectMeta | null) => void;
  addProject:    (p: ProjectMeta) => void;
  updateProject: (id: string, p: Partial<ProjectMeta>) => void;
}

export const useProjectStore = create<ProjectStore>()(set => ({
  projects:      [],
  activeProject: null,
  setProjects:   (projects)        => set({ projects }),
  setActive:     (activeProject)   => set({ activeProject }),
  addProject:    (p)               => set(s => ({ projects: [p, ...s.projects] })),
  updateProject: (id, patch)       => set(s => ({
    projects: s.projects.map(p => p.id === id ? { ...p, ...patch } : p),
    activeProject: s.activeProject?.id === id ? { ...s.activeProject, ...patch } : s.activeProject,
  })),
}));

// ─── Agent Store ──────────────────────────────────────────────
interface AgentInfo {
  id:        AgentId;
  label:     string;
  detection: AgentDetectionResult | null;
  session:   AgentSession | null;
}

interface AgentStore {
  agents:        Record<string, AgentInfo>;
  activeAgentId: AgentId | null;
  setDetection:  (id: AgentId, d: AgentDetectionResult) => void;
  setSession:    (id: AgentId, s: AgentSession | null) => void;
  setActive:     (id: AgentId | null) => void;
}

const DEFAULT_AGENTS: Record<string, AgentInfo> = {
  claude: { id: 'claude', label: 'Claude Code',  detection: null, session: null },
  codex:  { id: 'codex',  label: 'Codex',        detection: null, session: null },
  cursor: { id: 'cursor', label: 'Cursor',        detection: null, session: null },
  gemini: { id: 'gemini', label: 'Gemini',        detection: null, session: null },
};

export const useAgentStore = create<AgentStore>()(set => ({
  agents:        DEFAULT_AGENTS,
  activeAgentId: null,
  setDetection:  (id, d) => set(s => ({ agents: { ...s.agents, [id]: { ...s.agents[id]!, detection: d } } })),
  setSession:    (id, session) => set(s => ({ agents: { ...s.agents, [id]: { ...s.agents[id]!, session } } })),
  setActive:     (activeAgentId) => set({ activeAgentId }),
}));

// ─── Workflow Store ───────────────────────────────────────────
export type WorkflowStatus = 'idle' | 'planning' | 'running' | 'paused' | 'completed' | 'failed';

interface WorkflowStore {
  status:          WorkflowStatus;
  currentTask:     Task | null;
  tasks:           Task[];
  completedTasks:  string[];
  failedTasks:     string[];
  checkpoints:     Checkpoint[];
  activeWorkflow:  Workflow | null;
  goal:            string;
  setStatus:       (s: WorkflowStatus) => void;
  setCurrentTask:  (t: Task | null) => void;
  setTasks:        (ts: Task[]) => void;
  completeTask:    (id: string) => void;
  failTask:        (id: string) => void;
  addCheckpoint:   (c: Checkpoint) => void;
  setGoal:         (g: string) => void;
  setWorkflow:     (w: Workflow | null) => void;
  reset:           () => void;
}

export const useWorkflowStore = create<WorkflowStore>()(
  subscribeWithSelector(set => ({
    status:          'idle',
    currentTask:     null,
    tasks:           [],
    completedTasks:  [],
    failedTasks:     [],
    checkpoints:     [],
    activeWorkflow:  null,
    goal:            '',
    setStatus:       (status)         => set({ status }),
    setCurrentTask:  (currentTask)    => set({ currentTask }),
    setTasks:        (tasks)          => set({ tasks }),
    completeTask:    (id)             => set(s => ({ completedTasks: [...s.completedTasks, id] })),
    failTask:        (id)             => set(s => ({ failedTasks:    [...s.failedTasks,    id] })),
    addCheckpoint:   (c)              => set(s => ({ checkpoints: [c, ...s.checkpoints].slice(0, 200) })),
    setGoal:         (goal)           => set({ goal }),
    setWorkflow:     (activeWorkflow) => set({ activeWorkflow }),
    reset: () => set({
      status: 'idle', currentTask: null, tasks: [],
      completedTasks: [], failedTasks: [], checkpoints: [], goal: '',
    }),
  }))
);

// ─── Event / Log Store ────────────────────────────────────────
export interface LogEntry {
  id:        string;
  sessionId: string;
  agentId:   string;
  chunk:     string;
  isError:   boolean;
  ts:        number;
}

interface EventStore {
  logs:          LogEntry[];
  permRequests:  Array<{ sessionId: string; command: string; risk: string }>;
  addLog:        (entry: LogEntry) => void;
  clearLogs:     () => void;
  addPermReq:    (r: EventStore['permRequests'][0]) => void;
  removePermReq: (sessionId: string) => void;
}

export const useEventStore = create<EventStore>()(set => ({
  logs:         [],
  permRequests: [],
  addLog:       (entry) => set(s => ({ logs: [...s.logs.slice(-3000), entry] })),
  clearLogs:    ()      => set({ logs: [] }),
  addPermReq:   (r)     => set(s => ({ permRequests: [...s.permRequests, r] })),
  removePermReq:(sid)   => set(s => ({ permRequests: s.permRequests.filter(r => r.sessionId !== sid) })),
}));
