# Multi-User Execution Isolation Blueprint (Target Architecture)

This document supersedes the earlier short-term queue plan.  
It defines the long-term best solution while supporting your current reality:
- internal network only (VPN/office access)
- AD group based authentication will be added later

## 1. Executive Summary

The best long-term solution is a **Control Plane + Durable Queue + Worker Pool** architecture with lane-aware fair scheduling.

Today, users contend because job execution capacity is globally shared by tool.  
Target state is:
- jobs are queued durably
- scheduling is fair by lane
- execution happens in isolated workers
- identity and authorization become first-class once AD group auth is introduced

## Implementation Status (Current Branch)

Implemented now (pre-AD hardening baseline):
1. Lane-aware fair in-memory scheduler with per-tool and per-lane concurrency limits.
2. Durable job lifecycle metadata (`queued/running/completed/failed/cancelled/interrupted`).
3. Lane-scoped queue and job APIs (`/api/queues/me`, `/api/jobs/me`, `/api/jobs/:jobId`).
4. Session-bound lane identity using server-issued HttpOnly cookies for API and WebSocket scoping.

Still pending for full target architecture:
1. External durable queue (Redis/BullMQ).
2. Dedicated worker pool process separation.
3. AD principal and group enforcement integration.

## 2. What "Best" Means Here

1. Predictable fairness between users and teams.
2. No single user can monopolize tool execution.
3. Resilient to server restarts.
4. Horizontal scale path.
5. Clear audit trail and operational controls.
6. Clean authN/authZ integration point for future AD-group enforcement.

## 3. Current Issues That Must Be Eliminated

1. In-memory global per-tool queue behavior.
2. Single process as both API and heavy Playwright executor.
3. Queue loss on process restart.
4. Weak trust model for client-provided identity.

## 4. Target Architecture

## 4.1 Components

1. Control Plane API
- Validates requests.
- Creates jobs.
- Manages cancel/resume/update commands.
- Publishes events and status.

2. Durable Queue + State Store
- Redis + BullMQ (recommended for current Node stack) or RabbitMQ equivalent.
- Persists jobs, retries, and queue metadata.

3. Scheduler Service
- Applies lane fairness policy.
- Enforces per-lane and global limits.
- Dispatches queued jobs to workers.

4. Worker Pool
- Dedicated execution processes that run Playwright jobs.
- Pull jobs, heartbeat progress, update status, upload artifacts.

5. Event/Status Channel
- WebSocket/SSE from control plane.
- Fan-out scoped by lane/session.

6. Artifact Store
- Reports, logs, screenshots with strict lane/job scoping.

## 4.2 Logical Flow

1. Client sends start request.
2. Control plane creates `jobId` and durable queue record.
3. Scheduler assigns job when limits allow.
4. Worker runs job and emits progress.
5. Control plane streams status to subscribed client sessions.
6. Artifacts and history are attached to job and lane.

## 5. Identity and Authorization Model

## 5.1 Phase A (Now, before AD auth)

Use "network-trusted mode" with tighter boundaries:

1. Server issues `sessionId` (HttpOnly cookie) and `laneId`.
2. Client no longer chooses effective lane arbitrarily for execution.
3. Start/stop/resume commands require valid server session binding.
4. Keep internal-only network controls (already true).

Note: this is not full zero-trust security, but it is much stronger than trusting raw `X-User-Id`.

## 5.2 Phase B (When AD group auth is ready)

1. Integrate AD-backed auth at reverse proxy/app gateway.
2. Control plane receives immutable principal (UPN/object ID).
3. Map principal to lane and authorization policy.
4. Enforce AD group membership for execution APIs.
5. Remove or disable network-trusted fallback mode.

## 5.3 Authorization Rules

1. User can read/write only their own lane by default.
2. Optional team lanes supported via policy.
3. Admin endpoints require elevated role/group.

## 6. Scheduling Strategy (Fairness and Isolation)

## 6.1 Queue Keys

- Primary key: `tool`
- Fairness partition: `laneId`
- Effective scheduling unit: `(tool, laneId)`

## 6.2 Limits

1. `MAX_GLOBAL_RUNNING_PER_TOOL`
2. `MAX_RUNNING_PER_LANE_PER_TOOL`
3. `MAX_QUEUED_PER_LANE_PER_TOOL`

## 6.3 Algorithm

Use Deficit Round Robin or weighted round robin per tool:

1. Maintain active lane ring per tool.
2. Dispatch one job per eligible lane per cycle.
3. Respect per-lane and global limits.
4. Support future lane weights (team priority).

## 7. Job Lifecycle and State Model

## 7.1 States

`queued -> scheduled -> running -> completed | failed | cancelled`

Optional sub-states:
- `waiting-for-auth`
- `waiting-for-credentials`
- `paused`
- `retry-pending`

## 7.2 Required Job Metadata

1. `jobId`, `tool`, `laneId`, `createdBy`
2. request payload hash + validated options
3. timestamps for every state transition
4. worker assignment and heartbeat
5. retry count and final reason

## 8. Worker Design

1. Worker process startup registers capabilities and capacity.
2. Worker acquires job lease and heartbeat.
3. Lost heartbeat triggers requeue or fail-safe cancellation.
4. Cancellation is cooperative with hard timeout fallback.
5. Browser contexts and temp files are isolated per job.

## 9. APIs and Contracts (Target)

## 9.1 Control APIs

1. `POST /api/jobs` (start)
2. `POST /api/jobs/{id}/cancel`
3. `POST /api/jobs/{id}/resume`
4. `POST /api/jobs/{id}/credentials`
5. `GET /api/jobs/{id}`
6. `GET /api/jobs?tool=&state=`

## 9.2 Queue Visibility APIs

1. `GET /api/queues/me`
2. `GET /api/queues/admin` (restricted)

## 9.3 Compatibility

Keep existing tool endpoints during migration and internally translate to new job APIs until clients are moved.

## 10. Observability and Operations

## 10.1 Metrics

1. Queue depth per tool and lane.
2. Wait time percentiles.
3. Run duration percentiles.
4. Failure and retry rate by tool.
5. Worker utilization and crash rate.

## 10.2 Logs

Structured logs with:
`jobId`, `laneId`, `tool`, `workerId`, `principal`, `state`, `reason`.

## 10.3 Alerts

1. Queue depth breach.
2. Worker heartbeat loss.
3. High fail/retry spike.
4. Stuck running jobs.

## 11. Security Posture by Phase

## Phase A (pre-AD)

1. Internal network only (already in place).
2. Session-bound lane assignment from server.
3. Reject missing/invalid session for execution calls.
4. Disable unauthenticated admin queue introspection.

## Phase B (AD-group enabled)

1. Enforce AD principal authentication.
2. Enforce AD group membership for execution.
3. Bind WebSocket subscriptions to authenticated principal.
4. Record principal in job audit trail.

## 12. Migration Plan

## Milestone 1 - Foundations

1. Introduce durable queue infrastructure (Redis/BullMQ).
2. Implement job table/state store.
3. Add session-bound lane IDs (pre-AD mode).

## Milestone 2 - Scheduler and Worker Split

1. Move job execution out of API process.
2. Implement fair lane scheduler.
3. Add worker heartbeat/lease and cancellation.

## Milestone 3 - API Compatibility Layer

1. Route existing `/api/{tool}/*` endpoints through job service.
2. Preserve current UI behavior while backend changes.

## Milestone 4 - AD Auth Integration

1. Turn on AD principal mapping.
2. Enforce group policy.
3. Remove legacy identity fallback paths.

## Milestone 5 - Hardening and Scale

1. Load test with realistic concurrency.
2. Tune limits and worker counts.
3. Add admin operational tooling.

## 13. Testing Strategy

## 13.1 Functional

1. Two or more users same tool, same time, fair progress.
2. Cross-lane data isolation in status/history/results.
3. Correct cancel/resume semantics under load.

## 13.2 Resilience

1. API restart during queued/running jobs.
2. Worker crash mid-job.
3. Redis interruption and recovery behavior.

## 13.3 Security

1. Lane spoof attempts in pre-AD mode should fail via session binding.
2. AD group enforcement tests post-integration.

## 14. Risks and Mitigations

1. Increased system complexity
- Mitigation: phased migration + compatibility layer.

2. Queue or worker operational overhead
- Mitigation: standard runbooks, metrics, and alerts.

3. Auth integration timing dependency
- Mitigation: phase A session-bound model until AD is ready.

## 15. Recommended Stack (Pragmatic)

1. Redis + BullMQ for durable queue and scheduling primitives.
2. Node worker processes for Playwright executors.
3. Keep Express for control plane initially.
4. Add OpenTelemetry-compatible metrics/logging.

## 16. Success Criteria

1. No user perceives single-lane blocking for same-tool concurrency.
2. Restart does not drop queued jobs.
3. Job ownership isolation is enforced by backend, not client cooperation.
4. AD group policy can be enabled without redesign.
