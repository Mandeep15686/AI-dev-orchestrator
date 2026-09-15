// ═══════════════════════════════════════════════════════════════
// packages/core/src/EventBus.ts
// Typed pub/sub hub — decouples all orchestration subsystems
// ═══════════════════════════════════════════════════════════════

import { EventEmitter } from 'node:events';
import type { OrchestratorEvent, EventPayloadMap } from '@ai-orch/protocol';
import type { Database } from '@ai-orch/storage';

type Handler<E extends OrchestratorEvent> = (payload: EventPayloadMap[E]) => unknown;

export class TypedEventBus {
  private ee              = new EventEmitter();
  private tauriEmitter?:  (event: string, payload: unknown) => void;
  private db?:            Database;

  constructor(opts?: {
    tauriEmitter?: (event: string, payload: unknown) => void;
    db?: Database;
  }) {
    if (opts?.tauriEmitter) this.tauriEmitter = opts.tauriEmitter;
    if (opts?.db) this.db = opts.db;
    this.ee.setMaxListeners(50);
  }

  emit<E extends OrchestratorEvent>(event: E, payload: EventPayloadMap[E]): void {
    // 1. In-process subscribers
    this.ee.emit(event, payload);

    // 2. Bridge to Tauri/UI
    this.tauriEmitter?.(event, payload);

    // 3. Persist to event log (fire-and-forget)
    this.persistEvent(event, payload);
  }

  on<E extends OrchestratorEvent>(event: E, handler: Handler<E>): () => void {
    this.ee.on(event, handler as (...args: unknown[]) => void);
    return () => this.ee.off(event, handler as (...args: unknown[]) => void);
  }

  once<E extends OrchestratorEvent>(event: E, handler: Handler<E>): void {
    this.ee.once(event, handler as (...args: unknown[]) => void);
  }

  off<E extends OrchestratorEvent>(event: E, handler: Handler<E>): void {
    this.ee.off(event, handler as (...args: unknown[]) => void);
  }

  /** Wait for a specific event (with optional timeout) */
  waitFor<E extends OrchestratorEvent>(
    event: E,
    predicate: (p: EventPayloadMap[E]) => boolean = () => true,
    timeoutMs = 30_000,
  ): Promise<EventPayloadMap[E]> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.ee.off(event, handler);
        reject(new Error(`Timeout waiting for ${event}`));
      }, timeoutMs);

      const handler = (payload: EventPayloadMap[E]) => {
        if (!predicate(payload)) return;
        clearTimeout(timer);
        this.ee.off(event, handler as (...args: unknown[]) => void);
        resolve(payload);
      };

      this.ee.on(event, handler as (...args: unknown[]) => void);
    });
  }

  /** Replay events from DB for a given workflow run */
  async replay(workflowRunId: string, delayMs = 50): Promise<void> {
    if (!this.db) return;
    const events = await this.db.getEventsForRun(workflowRunId);
    for (const ev of events) {
      await new Promise(r => setTimeout(r, delayMs));
      this.ee.emit(ev.type, ev.payload);
    }
  }

  private persistEvent(event: string, payload: unknown): void {
    if (!this.db) return;
    this.db.insertEvent(event, payload).catch((err: unknown) => {
      console.error('[EventBus] DB persist error:', err);
    });
  }
}

// Singleton for the orchestration sidecar
export const eventBus = new TypedEventBus();
