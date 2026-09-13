type Job = {
  id: string;
  name: string;
  run: () => Promise<void>;
  enqueuedAt: number;
  nextRunAt: number;
  attempts: number;
  maxAttempts: number;
  timeoutMs: number;
  lastError?: string;
};

const queue: Job[] = [];
let active = 0;
const MAX_CONCURRENCY = Math.max(1, Number(process.env.JOB_QUEUE_CONCURRENCY || 2) || 2);
const MAX_QUEUE_SIZE = Math.max(100, Number(process.env.JOB_QUEUE_MAX_SIZE || 5000) || 5000);
const DEFAULT_MAX_ATTEMPTS = Math.max(1, Number(process.env.JOB_QUEUE_MAX_ATTEMPTS || 3) || 3);
const DEFAULT_TIMEOUT_MS = Math.max(5_000, Number(process.env.JOB_QUEUE_TIMEOUT_MS || 30_000) || 30_000);
const BACKOFF_BASE_MS = Math.max(250, Number(process.env.JOB_QUEUE_RETRY_BASE_MS || 1000) || 1000);
const BACKOFF_MAX_MS = Math.max(BACKOFF_BASE_MS, Number(process.env.JOB_QUEUE_RETRY_MAX_MS || 60_000) || 60_000);

const stats = {
  enqueued: 0,
  started: 0,
  completed: 0,
  retried: 0,
  failed: 0,
  dropped: 0,
  timedOut: 0,
};

let wakeTimer: NodeJS.Timeout | null = null;
class JobTimeoutError extends Error {}

function nextJobId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function raceWithTimeout<T>(promise: Promise<T>, timeoutMs: number) {
  let timer: NodeJS.Timeout | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new JobTimeoutError(`job timed out after ${timeoutMs}ms`)), timeoutMs);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function computeBackoffMs(attempt: number) {
  const exp = Math.max(0, attempt - 1);
  const raw = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * Math.pow(2, exp));
  const jitter = Math.floor(Math.random() * Math.max(1, Math.floor(raw * 0.2)));
  return raw + jitter;
}

function sortQueueByNextRun() {
  queue.sort((a, b) => a.nextRunAt - b.nextRunAt);
}

function getNextRunnableIndex(nowMs: number) {
  for (let i = 0; i < queue.length; i += 1) {
    if (queue[i].nextRunAt <= nowMs) return i;
  }
  return -1;
}

function scheduleWakeIfNeeded() {
  if (wakeTimer) {
    clearTimeout(wakeTimer);
    wakeTimer = null;
  }
  if (queue.length === 0) return;
  sortQueueByNextRun();
  const next = queue[0];
  const delayMs = Math.max(1, next.nextRunAt - Date.now());
  wakeTimer = setTimeout(() => {
    wakeTimer = null;
    void pumpQueue();
  }, delayMs);
}

async function pumpQueue() {
  while (active < MAX_CONCURRENCY && queue.length > 0) {
    const nowMs = Date.now();
    const index = getNextRunnableIndex(nowMs);
    if (index < 0) {
      scheduleWakeIfNeeded();
      return;
    }

    const [job] = queue.splice(index, 1);
    if (!job) return;
    active += 1;
    stats.started += 1;
    job.attempts += 1;

    void (async () => {
      // Keep ownership of this execution after a timeout. Promise.race cannot
      // cancel work; retrying while it still runs can duplicate its effects.
      const execution = Promise.resolve().then(() => job.run());
      try {
        await raceWithTimeout(execution, job.timeoutMs);
        stats.completed += 1;
      } catch (error) {
        const message = String((error as any)?.message || error || "job_failed");
        job.lastError = message;
        const timedOut = error instanceof JobTimeoutError;
        if (timedOut) {
          stats.timedOut += 1;
          console.warn(`[jobs] ${job.name} exceeded its timeout; waiting for the original execution without retrying`);
          try { await execution; stats.completed += 1; }
          catch { stats.failed += 1; }
          return;
        }

        if (job.attempts < job.maxAttempts) {
          const backoffMs = computeBackoffMs(job.attempts);
          job.nextRunAt = Date.now() + backoffMs;
          queue.push(job);
          stats.retried += 1;
          console.warn(
            `[jobs] ${job.name} failed attempt ${job.attempts}/${job.maxAttempts}, retrying in ${backoffMs}ms: ${message}`,
          );
        } else {
          stats.failed += 1;
          console.warn(
            `[jobs] ${job.name} failed permanently after ${job.attempts} attempts: ${message}`,
          );
        }
      } finally {
        active -= 1;
        setImmediate(() => {
          void pumpQueue();
        });
      }
    })();
  }

  if (queue.length > 0) scheduleWakeIfNeeded();
}

export function enqueueInProcessJob(
  name: string,
  run: () => Promise<void>,
  options?: { maxAttempts?: number; timeoutMs?: number },
) {
  if (queue.length >= MAX_QUEUE_SIZE) {
    stats.dropped += 1;
    console.warn(`[jobs] dropping ${name} - queue is full (${MAX_QUEUE_SIZE})`);
    return null;
  }

  const job: Job = {
    id: nextJobId(),
    name,
    run,
    enqueuedAt: Date.now(),
    nextRunAt: Date.now(),
    attempts: 0,
    maxAttempts: Math.max(1, Number(options?.maxAttempts || DEFAULT_MAX_ATTEMPTS) || DEFAULT_MAX_ATTEMPTS),
    timeoutMs: Math.max(1_000, Number(options?.timeoutMs || DEFAULT_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS),
  };
  stats.enqueued += 1;
  queue.push(job);
  setImmediate(() => {
    void pumpQueue();
  });
  return job.id;
}

export function getJobQueueStats() {
  const nowMs = Date.now();
  const oldestQueuedAgeMs =
    queue.length > 0
      ? Math.max(
          0,
          nowMs -
            queue.reduce(
              (min, j) => (j.enqueuedAt < min ? j.enqueuedAt : min),
              queue[0].enqueuedAt,
            ),
        )
      : 0;

  return {
    queued: queue.length,
    active,
    maxConcurrency: MAX_CONCURRENCY,
    maxQueueSize: MAX_QUEUE_SIZE,
    oldestQueuedAgeMs,
    totals: { ...stats },
  };
}
