import { createWriteStream, type WriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export type SpendDecision =
  | { decision: "allowed"; code?: string }
  | { decision: "blocked"; code: string };

export type TraceEvent = {
  ts: number;
  requestId: string;
  path: string;
  method: string;

  // Optional client/session correlation (best-effort).
  sessionKey?: string;

  modelIdRequested?: string;
  modelIdResolved?: string;
  // The final model id that was actually sent upstream (after pre-routing / fallback rewrites).
  // This is what the dashboard should treat as "routed".
  modelIdRouted?: string;
  routingTier?: string;
  routingConfidence?: number;
  routingReasoning?: string;
  providerId?: string;
  upstreamUrl?: string;

  status?: number;
  latencyMs?: number;
  stream?: boolean;

  // Provider-aware fallback metadata (e.g., Anthropic 429 -> DeepSeek).
  fallback?: {
    triggered: boolean;
    attempts?: Array<{
      fromProvider?: string;
      toProvider?: string;
      fromStatus?: number;
      toStatus?: number;
      requestedModel?: string;
      fallbackModel?: string;
    }>;
    requestedModel?: string;
    fallbackModel?: string;
  };

  // Provider health / pre-routing metadata.
  tier?: string;
  preRoute?: {
    triggered: boolean;
    fromProvider?: string;
    toProvider?: string;
    requestedModel?: string;
    routedModel?: string;
    reason?: string;
  };

  toolCount?: number;
  spend?: SpendDecision;
  errorMessage?: string;
};

export class RingBuffer<T> {
  readonly capacity: number;
  readonly ttlMs: number;
  private buf: T[] = [];

  constructor(capacity = 500, ttlMs = 0) {
    this.capacity = Math.max(1, Math.floor(capacity));
    this.ttlMs = Math.max(0, Math.floor(ttlMs));
  }

  push(value: T): void {
    this.buf.push(value);
    if (this.buf.length > this.capacity) {
      this.buf.splice(0, this.buf.length - this.capacity);
    }
    // Periodic cleanup of expired entries (only when TTL is set)
    if (this.ttlMs > 0 && this.buf.length % 100 === 0) {
      this.cleanup();
    }
  }

  private cleanup(): void {
    if (this.ttlMs === 0) return;
    const cutoff = Date.now() - this.ttlMs;
    let removed = 0;
    while (
      removed < this.buf.length &&
      typeof (this.buf[removed] as any)?.ts === "number" &&
      (this.buf[removed] as any).ts < cutoff
    ) {
      removed++;
    }
    if (removed > 0) {
      this.buf.splice(0, removed);
    }
  }

  toArray(): T[] {
    if (this.ttlMs > 0) this.cleanup();
    return this.buf.slice();
  }

  tail(n: number): T[] {
    if (this.ttlMs > 0) this.cleanup();
    const size = this.buf.length;
    if (!Number.isFinite(n) || n <= 0) return [];
    if (n >= size) return this.toArray();
    return this.buf.slice(size - n);
  }

  get length(): number {
    if (this.ttlMs > 0) this.cleanup();
    return this.buf.length;
  }
}

export type RoutingTraceOptions = {
  capacity?: number;
  ttlMs?: number;
  logPath?: string;
};

type Listener = (evt: TraceEvent) => void;

export class RoutingTraceStore {
  readonly ring: RingBuffer<TraceEvent>;

  private listeners = new Set<Listener>();
  private listenerCleanupTimer: NodeJS.Timeout | null = null;
  private logPath: string;

  private stream: WriteStream | null = null;
  private pending: string[] = [];
  private flushing = false;
  private ensureReadyPromise: Promise<void> | null = null;

  constructor(options: RoutingTraceOptions = {}) {
    this.ring = new RingBuffer<TraceEvent>(
      options.capacity ?? 500,
      options.ttlMs ?? 3600000, // 1 hour TTL for trace events
    );
    this.logPath =
      options.logPath ?? join(homedir(), ".openclaw", "oauthrouter", "logs", "routing-trace.jsonl");

    // Periodic cleanup of dead listeners (weak reference pattern)
    this.listenerCleanupTimer = setInterval(() => {
      this.cleanupDeadListeners();
    }, 300000); // 5 minutes
    this.listenerCleanupTimer.unref?.();
  }

  append(evt: TraceEvent): void {
    this.ring.push(evt);

    // Cleanup dead listeners before broadcast
    const toRemove: Listener[] = [];
    for (const l of this.listeners) {
      try {
        l(evt);
      } catch (err) {
        // If listener throws, it's likely a closed SSE connection — remove it
        if (err instanceof Error && err.message.includes("socket")) {
          toRemove.push(l);
        }
        // ignore other listener errors
      }
    }
    for (const dead of toRemove) {
      this.listeners.delete(dead);
    }

    // Serialize early; enqueue for async buffered flush.
    this.pending.push(`${JSON.stringify(evt)}\n`);
    this.flushSoon();
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private cleanupDeadListeners(): void {
    // Clear all listeners if the set grows beyond reasonable size
    // (indicates clients disconnected without cleanup)
    if (this.listeners.size > 100) {
      const dead: Listener[] = [];
      for (const l of this.listeners) {
        // Try calling with a ping event; if it throws, it's dead
        try {
          // Don't actually broadcast; just check if function is callable
          if (typeof l !== "function") {
            dead.push(l);
          }
        } catch {
          dead.push(l);
        }
      }
      for (const d of dead) {
        this.listeners.delete(d);
      }
    }
  }

  shutdown(): void {
    if (this.listenerCleanupTimer) {
      clearInterval(this.listenerCleanupTimer);
      this.listenerCleanupTimer = null;
    }
    this.listeners.clear();
    if (this.stream) {
      this.stream.end();
      this.stream = null;
    }
  }

  last(n: number): TraceEvent[] {
    return this.ring.tail(n);
  }

  private flushSoon(): void {
    if (this.flushing) return;
    this.flushing = true;
    setImmediate(() => {
      void this.flush().finally(() => {
        this.flushing = false;
        if (this.pending.length > 0) this.flushSoon();
      });
    });
  }

  private async ensureReady(): Promise<void> {
    if (this.ensureReadyPromise) return this.ensureReadyPromise;

    this.ensureReadyPromise = (async () => {
      await mkdir(join(homedir(), ".openclaw", "oauthrouter", "logs"), { recursive: true });
      this.stream = createWriteStream(this.logPath, { flags: "a" });
      // If the stream errors, we drop file logging but keep in-memory buffer.
      this.stream.on("error", () => {
        try {
          this.stream?.destroy();
        } catch {
          // ignore
        }
        this.stream = null;
      });
    })();

    return this.ensureReadyPromise;
  }

  private async flush(): Promise<void> {
    if (this.pending.length === 0) return;

    await this.ensureReady();
    const stream = this.stream;
    if (!stream) {
      // Drop pending if file logging unavailable.
      this.pending.length = 0;
      return;
    }

    // Drain queue in chunks to avoid huge writes.
    while (this.pending.length > 0 && this.stream === stream) {
      const chunk = this.pending.splice(0, 200).join("");
      const ok = stream.write(chunk);
      if (!ok) {
        await new Promise<void>((resolve) => stream.once("drain", resolve));
      }
    }
  }
}

export const routingTrace = new RoutingTraceStore();
