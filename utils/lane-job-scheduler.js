// lane-job-scheduler.js
// Fair, lane-aware in-memory scheduler for tool jobs.

import crypto from 'crypto';

function parseBool(value, fallback = false) {
  if (value === undefined || value === null) return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

export class LaneJobScheduler {
  constructor(options = {}) {
    this.globalConcurrencyByTool = options.globalConcurrencyByTool || {};
    this.perLaneConcurrencyByTool = options.perLaneConcurrencyByTool || {};
    this.globalQueueLimitByTool = options.globalQueueLimitByTool || {};
    this.defaultGlobalConcurrency = Number.isFinite(options.defaultGlobalConcurrency)
      ? options.defaultGlobalConcurrency
      : 1;
    this.defaultPerLaneConcurrency = Number.isFinite(options.defaultPerLaneConcurrency)
      ? options.defaultPerLaneConcurrency
      : 1;
    this.defaultQueueLimit = Number.isFinite(options.defaultQueueLimit)
      ? options.defaultQueueLimit
      : 50;
    this.allowMultipleQueuedPerLaneTool = parseBool(options.allowMultipleQueuedPerLaneTool, false);
    this.hooks = {
      onEnqueued: typeof options.onEnqueued === 'function' ? options.onEnqueued : null,
      onStarted: typeof options.onStarted === 'function' ? options.onStarted : null,
      onFinished: typeof options.onFinished === 'function' ? options.onFinished : null,
      onCancelled: typeof options.onCancelled === 'function' ? options.onCancelled : null
    };

    // Map<tool, ToolState>
    this.tools = new Map();
    // Map<laneId:tool, Job>
    this.queuedJobsByKey = new Map();
  }

  triggerHook(name, payload) {
    const hook = this.hooks[name];
    if (!hook) return;
    try {
      hook(payload);
    } catch (err) {
      console.error(`[LaneJobScheduler] Hook ${name} failed`, err);
    }
  }

  getToolState(tool) {
    if (!this.tools.has(tool)) {
      this.tools.set(tool, {
        globalRunning: 0,
        laneOrder: [],
        laneCursor: 0,
        lanes: new Map() // Map<laneId, { running:number, queue:Job[] }>
      });
    }
    return this.tools.get(tool);
  }

  getLaneState(toolState, laneId) {
    if (!toolState.lanes.has(laneId)) {
      toolState.lanes.set(laneId, { running: 0, queue: [] });
      toolState.laneOrder.push(laneId);
    }
    return toolState.lanes.get(laneId);
  }

  getGlobalConcurrency(tool) {
    return this.globalConcurrencyByTool[tool] ?? this.defaultGlobalConcurrency;
  }

  getPerLaneConcurrency(tool) {
    return this.perLaneConcurrencyByTool[tool] ?? this.defaultPerLaneConcurrency;
  }

  getGlobalQueueLimit(tool) {
    return this.globalQueueLimitByTool[tool] ?? this.defaultQueueLimit;
  }

  getQueueKey(laneId, tool) {
    return `${laneId}:${tool}`;
  }

  hasQueuedJob(laneId, tool) {
    const key = this.getQueueKey(laneId, tool);
    return this.queuedJobsByKey.has(key);
  }

  totalQueuedForTool(toolState) {
    let total = 0;
    toolState.lanes.forEach((laneState) => {
      total += laneState.queue.length;
    });
    return total;
  }

  getQueuePosition(toolState, laneId, key) {
    const laneState = this.getLaneState(toolState, laneId);
    const lanePosition = laneState.queue.findIndex((job) => job.key === key) + 1;

    let globalPosition = 0;
    for (const laneKey of toolState.laneOrder) {
      const state = toolState.lanes.get(laneKey);
      if (!state || state.queue.length === 0) continue;
      for (const job of state.queue) {
        globalPosition += 1;
        if (job.key === key) {
          return { lanePosition, globalPosition };
        }
      }
    }

    return { lanePosition, globalPosition: lanePosition };
  }

  enqueue({ tool, laneId, processor, startFn, meta = {} }) {
    const safeLaneId = laneId || 'anonymous';
    const key = this.getQueueKey(safeLaneId, tool);
    const toolState = this.getToolState(tool);
    const laneState = this.getLaneState(toolState, safeLaneId);
    const globalQueueLimit = this.getGlobalQueueLimit(tool);
    const globalQueued = this.totalQueuedForTool(toolState);

    if (!this.allowMultipleQueuedPerLaneTool && this.queuedJobsByKey.has(key)) {
      const existing = this.queuedJobsByKey.get(key);
      const existingPosition = this.getQueuePosition(toolState, safeLaneId, key);
      return {
        queued: true,
        alreadyQueued: true,
        jobId: existing?.id || null,
        position: existingPosition.globalPosition,
        lanePosition: existingPosition.lanePosition,
        queueSize: this.totalQueuedForTool(toolState),
        laneQueueSize: laneState.queue.length,
        running: toolState.globalRunning,
        limit: this.getGlobalConcurrency(tool),
        laneLimit: this.getPerLaneConcurrency(tool)
      };
    }

    if (globalQueued >= globalQueueLimit) {
      return { queued: false, rejected: true, reason: 'queue-full' };
    }

    const job = {
      id: crypto.randomUUID(),
      key,
      tool,
      laneId: safeLaneId,
      processor,
      startFn,
      createdAt: Date.now()
    };

    laneState.queue.push(job);
    this.queuedJobsByKey.set(key, job);
    this.triggerHook('onEnqueued', {
      ...job,
      queueSize: this.totalQueuedForTool(toolState),
      laneQueueSize: laneState.queue.length,
      meta
    });

    const { lanePosition, globalPosition } = this.getQueuePosition(toolState, safeLaneId, key);

    if (processor && typeof processor.emitStatus === 'function') {
      processor.emitStatus({
        type: 'queued',
        message: `Queued (lane ${lanePosition}, global ${globalPosition})`,
        queuePosition: globalPosition,
        laneQueuePosition: lanePosition,
        laneId: safeLaneId
      });
    }

    this.dispatch(tool);

    if (!this.queuedJobsByKey.has(key)) {
      return {
        queued: false,
        started: true,
        jobId: job.id,
        running: toolState.globalRunning,
        limit: this.getGlobalConcurrency(tool),
        laneLimit: this.getPerLaneConcurrency(tool)
      };
    }

    return {
      queued: true,
      jobId: job.id,
      position: globalPosition,
      lanePosition,
      queueSize: this.totalQueuedForTool(toolState),
      laneQueueSize: laneState.queue.length,
      running: toolState.globalRunning,
      limit: this.getGlobalConcurrency(tool),
      laneLimit: this.getPerLaneConcurrency(tool)
    };
  }

  cancelQueued(laneId, tool) {
    const safeLaneId = laneId || 'anonymous';
    const key = this.getQueueKey(safeLaneId, tool);
    const queuedJob = this.queuedJobsByKey.get(key);
    if (!queuedJob) return null;

    const toolState = this.getToolState(tool);
    const laneState = this.getLaneState(toolState, safeLaneId);
    const index = laneState.queue.findIndex((job) => job.key === key);
    if (index < 0) return null;

    const [removed] = laneState.queue.splice(index, 1);
    this.queuedJobsByKey.delete(key);

    if (removed?.processor && typeof removed.processor.emitStatus === 'function') {
      removed.processor.emitStatus({
        type: 'cancelled',
        message: 'Removed from queue',
        laneId: safeLaneId
      });
    }

    this.triggerHook('onCancelled', {
      ...removed,
      cancelledAt: Date.now()
    });

    return removed;
  }

  selectNextLane(toolState, tool) {
    const laneCount = toolState.laneOrder.length;
    if (laneCount === 0) return null;

    const perLaneLimit = this.getPerLaneConcurrency(tool);
    for (let i = 0; i < laneCount; i += 1) {
      const index = (toolState.laneCursor + i) % laneCount;
      const laneId = toolState.laneOrder[index];
      const laneState = toolState.lanes.get(laneId);
      if (!laneState || laneState.queue.length === 0) continue;
      if (laneState.running >= perLaneLimit) continue;

      toolState.laneCursor = (index + 1) % laneCount;
      return { laneId, laneState };
    }

    return null;
  }

  dispatch(tool) {
    const toolState = this.getToolState(tool);
    const globalLimit = this.getGlobalConcurrency(tool);

    while (toolState.globalRunning < globalLimit) {
      const next = this.selectNextLane(toolState, tool);
      if (!next) return;

      const { laneId, laneState } = next;
      const job = laneState.queue.shift();
      if (!job) continue;

      this.queuedJobsByKey.delete(job.key);
      laneState.running += 1;
      toolState.globalRunning += 1;
      this.triggerHook('onStarted', {
        ...job,
        startedAt: Date.now(),
        runningGlobal: toolState.globalRunning,
        runningInLane: laneState.running
      });

      Promise.resolve()
        .then(() => job.startFn())
        .then(() => {
          this.triggerHook('onFinished', {
            ...job,
            status: 'completed',
            finishedAt: Date.now()
          });
        })
        .catch((err) => {
          console.error(`[Queue] ${tool} job failed`, err);
          this.triggerHook('onFinished', {
            ...job,
            status: 'failed',
            finishedAt: Date.now(),
            error: err?.message || String(err)
          });
        })
        .finally(() => {
          laneState.running = Math.max(0, laneState.running - 1);
          toolState.globalRunning = Math.max(0, toolState.globalRunning - 1);
          this.dispatch(tool);
        });
    }
  }

  getToolLaneSnapshot(laneId, tool) {
    const safeLaneId = laneId || 'anonymous';
    const toolState = this.tools.get(tool);
    if (!toolState) {
      return {
        laneId: safeLaneId,
        tool,
        runningInLane: 0,
        queuedInLane: 0,
        runningGlobal: 0,
        queuedGlobal: 0,
        laneConcurrencyLimit: this.getPerLaneConcurrency(tool),
        globalConcurrencyLimit: this.getGlobalConcurrency(tool)
      };
    }

    const laneState = toolState.lanes.get(safeLaneId);
    return {
      laneId: safeLaneId,
      tool,
      runningInLane: laneState?.running || 0,
      queuedInLane: laneState?.queue.length || 0,
      runningGlobal: toolState.globalRunning,
      queuedGlobal: this.totalQueuedForTool(toolState),
      laneConcurrencyLimit: this.getPerLaneConcurrency(tool),
      globalConcurrencyLimit: this.getGlobalConcurrency(tool)
    };
  }

  getLaneSnapshot(laneId) {
    const safeLaneId = laneId || 'anonymous';
    const tools = {};
    this.tools.forEach((toolState, tool) => {
      const laneState = toolState.lanes.get(safeLaneId);
      if (!laneState) return;
      tools[tool] = {
        runningInLane: laneState.running,
        queuedInLane: laneState.queue.length,
        runningGlobal: toolState.globalRunning,
        queuedGlobal: this.totalQueuedForTool(toolState),
        laneConcurrencyLimit: this.getPerLaneConcurrency(tool),
        globalConcurrencyLimit: this.getGlobalConcurrency(tool)
      };
    });
    return {
      laneId: safeLaneId,
      tools
    };
  }

  getGlobalSnapshot() {
    const tools = {};
    this.tools.forEach((toolState, tool) => {
      tools[tool] = {
        runningGlobal: toolState.globalRunning,
        queuedGlobal: this.totalQueuedForTool(toolState),
        lanes: toolState.laneOrder.map((laneId) => {
          const laneState = toolState.lanes.get(laneId);
          return {
            laneId,
            runningInLane: laneState?.running || 0,
            queuedInLane: laneState?.queue.length || 0
          };
        })
      };
    });
    return { tools };
  }
}
