import crypto from 'crypto';

const defaultId = () => {
  try {
    return crypto.randomUUID();
  } catch (_error) {
    return `job_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  }
};

export default class JobQueue {
  constructor(options = {}) {
    this.logger = options.logger || console;
    this.auditLogger = options.auditLogger || null;
    this.concurrency = Number.isFinite(Number(options.concurrency))
      ? Math.max(1, Number(options.concurrency))
      : 2;
    this.retryAttempts = Number.isFinite(Number(options.retryAttempts))
      ? Math.max(0, Number(options.retryAttempts))
      : 2;
    this.retryBaseMs = Number.isFinite(Number(options.retryBaseMs))
      ? Math.max(50, Number(options.retryBaseMs))
      : 500;
    this.retryMaxMs = Number.isFinite(Number(options.retryMaxMs))
      ? Math.max(this.retryBaseMs, Number(options.retryMaxMs))
      : 10_000;
    this.maxQueueSize = Number.isFinite(Number(options.maxQueueSize))
      ? Math.max(10, Number(options.maxQueueSize))
      : 5000;
    this.deadLetterMax = Number.isFinite(Number(options.deadLetterMax))
      ? Math.max(10, Number(options.deadLetterMax))
      : 200;

    this.handlers = new Map();
    this.pending = [];
    this.inFlight = new Map();
    this.deadLetter = [];
    this.running = false;
    this.processing = false;
  }

  registerHandler(type, handler) {
    if (!type || typeof handler !== 'function') {
      return false;
    }
    this.handlers.set(String(type), handler);
    return true;
  }

  enqueue(type, payload = {}, options = {}) {
    if (!type) {
      return null;
    }
    if (this.pending.length >= this.maxQueueSize) {
      this.logger?.warn?.({ type }, 'JobQueue overflow - dropping job');
      this.auditLogger?.record?.('job_queue.drop', { type, reason: 'queue_overflow' });
      return null;
    }

    const job = {
      id: options.id || defaultId(),
      type: String(type),
      payload,
      status: 'queued',
      createdAt: Date.now(),
      runAt: Number.isFinite(options.runAt) ? Number(options.runAt) : Date.now(),
      attempts: 0,
      maxAttempts: Number.isFinite(options.maxAttempts)
        ? Math.max(0, Number(options.maxAttempts))
        : this.retryAttempts,
      lastError: null
    };

    this.pending.push(job);
    this.pending.sort((a, b) => a.runAt - b.runAt);
    this.auditLogger?.record?.('job_queue.enqueued', {
      jobId: job.id,
      type: job.type,
      runAt: job.runAt
    });
    this.schedule();
    return job;
  }

  start() {
    if (this.running) {
      return;
    }
    this.running = true;
    this.schedule();
  }

  stop() {
    this.running = false;
  }

  schedule() {
    if (!this.running || this.processing) {
      return;
    }
    this.processing = true;
    setImmediate(() => {
      this.processing = false;
      void this.processNext();
    });
  }

  async processNext() {
    if (!this.running) {
      return;
    }

    while (this.inFlight.size < this.concurrency && this.pending.length > 0) {
      const now = Date.now();
      const next = this.pending[0];
      if (!next || next.runAt > now) {
        break;
      }
      this.pending.shift();
      this.executeJob(next);
    }

    if (this.pending.length > 0) {
      const delay = Math.max(50, this.pending[0].runAt - Date.now());
      setTimeout(() => this.schedule(), delay);
    }
  }

  async executeJob(job) {
    if (!job) {
      return;
    }
    const handler = this.handlers.get(job.type);
    if (!handler) {
      job.status = 'failed';
      job.lastError = `No handler registered for ${job.type}`;
      this.moveToDeadLetter(job);
      return;
    }

    job.status = 'running';
    job.attempts += 1;
    this.inFlight.set(job.id, job);
    this.auditLogger?.record?.('job_queue.started', {
      jobId: job.id,
      type: job.type,
      attempt: job.attempts
    });

    try {
      const result = await handler(job.payload, job);
      job.status = 'completed';
      job.completedAt = Date.now();
      job.result = result ?? null;
      this.auditLogger?.record?.('job_queue.completed', {
        jobId: job.id,
        type: job.type,
        durationMs: job.completedAt - job.createdAt
      });
    } catch (error) {
      job.status = 'failed';
      job.lastError = error?.message || 'Job failed';
      this.auditLogger?.record?.('job_queue.failed', {
        jobId: job.id,
        type: job.type,
        attempt: job.attempts,
        error: job.lastError
      });

      if (job.attempts <= job.maxAttempts) {
        const delay = Math.min(this.retryMaxMs, this.retryBaseMs * Math.pow(2, job.attempts - 1));
        job.status = 'queued';
        job.runAt = Date.now() + delay;
        this.pending.push(job);
        this.pending.sort((a, b) => a.runAt - b.runAt);
      } else {
        this.moveToDeadLetter(job);
      }
    } finally {
      this.inFlight.delete(job.id);
      this.schedule();
    }
  }

  moveToDeadLetter(job) {
    job.status = 'dead';
    job.deadAt = Date.now();
    this.deadLetter.push(job);
    if (this.deadLetter.length > this.deadLetterMax) {
      this.deadLetter.splice(0, this.deadLetter.length - this.deadLetterMax);
    }
    this.auditLogger?.record?.('job_queue.dead_letter', {
      jobId: job.id,
      type: job.type,
      error: job.lastError || null
    });
  }

  getStats() {
    return {
      running: this.running,
      pending: this.pending.length,
      inFlight: this.inFlight.size,
      deadLetter: this.deadLetter.length,
      concurrency: this.concurrency
    };
  }
}
