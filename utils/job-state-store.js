// job-state-store.js
// Durable job metadata store for queue and execution lifecycle.

import fs from 'fs';

export class JobStateStore {
  constructor(filePath, options = {}) {
    this.filePath = filePath;
    this.maxEntries = Number.isFinite(options.maxEntries) ? options.maxEntries : 5000;
    this.jobs = [];
    this.loaded = false;
  }

  load() {
    if (this.loaded) return;
    this.loaded = true;
    try {
      if (!fs.existsSync(this.filePath)) {
        this.jobs = [];
        return;
      }
      const raw = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
      const list = Array.isArray(raw?.jobs) ? raw.jobs : [];
      this.jobs = list
        .filter((entry) => entry && entry.id)
        .sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0));
    } catch (err) {
      console.error('[JobStateStore] Failed to load state file', err);
      this.jobs = [];
    }
  }

  save() {
    this.jobs = this.jobs
      .sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0))
      .slice(0, this.maxEntries);
    const payload = {
      schemaVersion: 1,
      updatedAt: Date.now(),
      jobs: this.jobs
    };
    fs.writeFileSync(this.filePath, JSON.stringify(payload, null, 2), 'utf8');
  }

  findIndex(jobId) {
    return this.jobs.findIndex((entry) => entry.id === jobId);
  }

  upsert(entry) {
    const now = Date.now();
    const normalized = {
      ...entry,
      updatedAt: entry.updatedAt || now
    };
    const index = this.findIndex(normalized.id);
    if (index >= 0) {
      this.jobs[index] = {
        ...this.jobs[index],
        ...normalized,
        updatedAt: now
      };
    } else {
      this.jobs.unshift({
        ...normalized,
        updatedAt: now
      });
    }
    this.save();
  }

  markInFlightAsInterrupted() {
    let changed = false;
    const now = Date.now();
    this.jobs = this.jobs.map((entry) => {
      if (entry.state !== 'queued' && entry.state !== 'running') {
        return entry;
      }
      changed = true;
      return {
        ...entry,
        state: 'interrupted',
        interruptedAt: now,
        finishedAt: entry.finishedAt || now,
        error: entry.error || 'Server restarted before job completed',
        updatedAt: now
      };
    });
    if (changed) {
      this.save();
    }
  }

  recordEnqueued(job, meta = {}) {
    if (!job?.id) return;
    const now = Date.now();
    this.upsert({
      id: job.id,
      tool: job.tool,
      laneId: job.laneId,
      state: 'queued',
      createdAt: job.createdAt || now,
      queuedAt: now,
      optionsSummary: meta.optionsSummary || null,
      queueSize: meta.queueSize ?? null,
      laneQueueSize: meta.laneQueueSize ?? null
    });
  }

  recordStarted(job, meta = {}) {
    if (!job?.id) return;
    const now = Date.now();
    this.upsert({
      id: job.id,
      tool: job.tool,
      laneId: job.laneId,
      state: 'running',
      startedAt: job.startedAt || now,
      runningGlobal: meta.runningGlobal ?? null,
      runningInLane: meta.runningInLane ?? null
    });
  }

  recordFinished(job) {
    if (!job?.id) return;
    const now = Date.now();
    this.upsert({
      id: job.id,
      tool: job.tool,
      laneId: job.laneId,
      state: job.status === 'failed' ? 'failed' : 'completed',
      finishedAt: job.finishedAt || now,
      error: job.error || null
    });
  }

  recordCancelled(job) {
    if (!job?.id) return;
    const now = Date.now();
    this.upsert({
      id: job.id,
      tool: job.tool,
      laneId: job.laneId,
      state: 'cancelled',
      cancelledAt: job.cancelledAt || now,
      finishedAt: job.cancelledAt || now
    });
  }

  getJob(jobId) {
    if (!jobId) return null;
    const entry = this.jobs.find((job) => job.id === jobId);
    return entry || null;
  }

  listByLane(laneId, filters = {}) {
    const safeLaneId = laneId || 'anonymous';
    const limit = Number.isFinite(filters.limit) ? Math.max(1, Math.min(500, filters.limit)) : 100;
    const tool = filters.tool ? String(filters.tool).trim() : '';
    const state = filters.state ? String(filters.state).trim() : '';

    return this.jobs
      .filter((job) => job.laneId === safeLaneId)
      .filter((job) => (!tool || job.tool === tool))
      .filter((job) => (!state || job.state === state))
      .slice(0, limit);
  }
}

