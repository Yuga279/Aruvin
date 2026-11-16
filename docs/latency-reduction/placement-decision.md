# Infrastructure Placement Investigation & Comparative Analysis (Gate D6 / Task 11)

**Document Status:** Complete (On-Paper Investigation Only — No Infrastructure Changes Executed)  
**Date:** 2026-10-29  
**Reference Plan:** `docs/latency-reduction/plan.md` (Task 11, Gate D6)  
**Execution Context:** Single-process executor architecture, native MongoDB replica set with majority write quorum (`w: "majority"`), strict bounded schemas and synchronous durability invariants.

---

## 1. Executive Summary & Problem Formulation

During Phase 1 and the latency-reduction initiative (Tasks 0–9), extensive software optimizations were designed and verified offline:
- Observation and accounting pipelining (`createObservationWriter`) with synchronous identity latching.
- Shared durable admission staging and disposable receipt recycling (`AdmissionReceiptStore`).
- Short owned execution phases with cached fencing tokens (`runPhase`).
- Folded atomic CAS session releases and parallelized publication stages (`publication-stage`).
- Stock-saver bounded read facade (`createBoundedSaverClient`) and graph state passing.

These software changes successfully reduced modeled network waves:
- `new-text`: reduced from 227 to 180 waves.
- `follow-up-1`: reduced from 219 to 176 waves.
- Modeled end-to-end latency at 67 ms read / 449 ms write was reduced from **~38.6s down to ~29.6s** (a savings of ~9,000 ms).

**The Irreducible Physical Network Floor:**  
Despite eliminating 47 unnecessary round-trips, the application still executes 176–180 sequential and pipelined database waves per completed text turn. Under an infrastructure topology where the backend executor runs on a remote developer PC or office workstation and connects to a cloud-hosted MongoDB replica set across a Wide Area Network (WAN):
- Base network RTT across public internet: ~40–80 ms per round-trip.
- Replica set majority write acknowledgment (`w: "majority"`): requires primary journal sync + replication round-trip to secondary nodes (often 100–450 ms over high-latency WAN or cross-region setups).
- Physical latency math: `176 waves * ~160 ms average wave time = ~28 seconds`.

No amount of application-level code tuning can overcome the speed-of-light propagation delay of 176 network hops over a WAN. Reducing latency from tens of seconds to conversational response times (< 1.5–2 seconds) requires addressing **infrastructure placement**.

This document presents an on-paper comparative analysis of deployment topologies to guide operator decisions, without authorizing or performing any live infrastructure modifications.

---

## 2. Sanitized Operational Facts & Discovery Status (Task 11.1)

| Parameter | Current Status / Fact | Verification Level | Source / Notes |
| :--- | :--- | :--- | :--- |
| **Backend Execution Environment** | Windows Node.js v24.18.0 on developer workstation | Verified local runtime | Execution environment |
| **Database Product & Version** | MongoDB 6.x / 7.x wire protocol compatible | Operator-attested / uncertified | Phase 1 requirement: native replica set |
| **Database Host Location** | Remote cloud / external network endpoint | Operator-attested | Cross-WAN connectivity observed in high baseline latency |
| **Replica Set Quorum Topology** | 3-node or multi-region replica set | Unknown / Unverified | Primary and secondary region locations unconfirmed |
| **Write Concern** | `w: "majority"`, `journal: true` | Mandatory requirement | Required by `AGENTS.md` to prevent rollbacks and split-brain |
| **Access Control & Identity** | Server-resolved test identity; user auth deferred | Verified specification | Public endpoint deployment not yet authorized |
| **External/Paid Benchmarks** | Unrun | Gate D7 | Strictly preserved to prevent unapproved cloud billing |

---

## 3. Root Cause Investigation: Measured vs Wire Realities (Task 11.2)

To distinguish software overhead from network propagation:
1. **Zero-Latency Profile (`0ms`):**
   - In offline fixtures with 0 ms simulated wire delay, the entire multi-phase text turn completes in **< 15 ms of CPU execution time**.
   - This proves that in-process execution, JSON serialization, LangGraph checkpointing, and MongoDB driver wrapping consume negligible overhead.
2. **Delayed Synthetic Profile (`67/449ms`):**
   - Applying 67 ms read and 449 ms majority-write delay to the deterministic wire probe inflates execution time to **29,632 ms**.
   - The elapsed time is 100% dominated by the cumulative duration of the 180 wire waves.
3. **Write Quorum Characteristics:**
   - In native MongoDB with `w: "majority"`, an acknowledgment is returned to the client only after the primary has written to its journal AND a quorum of replica members have replicated the oplog entry.
   - If the client-to-primary link has latency $L_{cp}$ and primary-to-secondary replication has latency $L_{ps}$, a write round-trip takes $2 \cdot L_{cp} + 2 \cdot L_{ps} + T_{disk}$.
   - Placing the client near the primary reduces $L_{cp}$ from ~50 ms to < 1 ms. Placing the replica set members in the same cloud region or availability zone reduces $L_{ps}$ from ~50–100 ms to < 1–2 ms.

---

## 4. Comparative Topology Options (Task 11.3)

### Candidate 1: Cloud-Colocated Backend Executor (Preferred Production Candidate)

* **Architecture:**
  - The backend NestJS process is containerized and deployed in the same cloud region and Virtual Private Cloud (VPC) / internal subnet as the primary MongoDB replica set.
  - Browser clients connect to the backend executor over public HTTPS / Server-Sent Events (SSE).
* **Latency Profile:**
  - Backend-to-MongoDB Read RTT: **0.5 – 2 ms**.
  - Backend-to-MongoDB Majority Write RTT: **3 – 15 ms** (assuming intra-region replica set secondaries).
  - Modeled 180-Wave Database Turn Time: **180 waves $\times$ ~8 ms avg = ~1.44 seconds**.
  - Overall Turn Latency: Dominated by OpenRouter LLM time-to-first-token (~800–1200 ms) + streaming duration. Total user-perceived response time: **~2.5 – 3.5 seconds** (an order-of-magnitude reduction from 30+ seconds).
* **Operational Trade-offs & Prerequisites:**
  - *Access Control:* Phase 1 deferred authentication; deploying on cloud requires implementing production authentication, session authorization, and CORS hardening before public exposure.
  - *Infrastructure Cost:* Requires cloud compute (e.g. AWS ECS/Fargate, Azure Container Apps, or GCP Cloud Run) alongside database hosting.
  - *High Availability & Disaster Recovery:* Leverages cloud VPC security, automated snapshots, and multi-AZ replica set failover.
  - *Approval Prerequisite:* Requires explicit operator approval for cloud provisioning, domain configuration, and secret management.

---

### Candidate 2: PC-Bound Local Topology (Developer / Air-Gapped Environment)

* **Architecture:**
  - Both the backend NestJS service and an admitted native MongoDB replica set run locally on the developer machine / workstation (e.g., via Docker Compose with a 1-node or 3-node local replica set on loopback `127.0.0.1`).
* **Latency Profile:**
  - Backend-to-MongoDB Read RTT: **< 0.2 ms**.
  - Backend-to-MongoDB Majority Write RTT: **1 – 4 ms** (limited only by local NVMe disk sync).
  - Modeled 180-Wave Database Turn Time: **< 300 ms**.
  - Overall Turn Latency: Equivalent to `0ms` profile; completely bounded by OpenRouter model inference.
* **Operational Trade-offs & Prerequisites:**
  - *Suitability:* Ideal for rapid local engineering, offline feature development, and automated test execution.
  - *Disaster Recovery Limitation:* A single-machine replica set provides zero protection against workstation hardware failure, OS crashes, or disk corruption.
  - *RPO/RTO:* Recovery Point Objective (RPO) and Recovery Time Objective (RTO) depend entirely on manual local database exports/backups.
  - *Approval Prerequisite:* Zero cloud costs or deployment approval needed; requires only local Docker/MongoDB service setup by the developer.

---

### Candidate 3: Code-Only Optimization with Remote Database (Status Quo)

* **Architecture:**
  - The backend stays on the local PC/workstation while continuing to connect across the public WAN to the remote cloud MongoDB instance.
* **Latency Profile:**
  - Backend-to-MongoDB Read RTT: **50 – 80 ms**.
  - Backend-to-MongoDB Majority Write RTT: **200 – 450 ms**.
  - Total Database Turn Time: **~28 – 30 seconds**.
* **Operational Trade-offs:**
  - *Zero Operational Risk:* Requires no cloud provisioning, no deployment pipelines, and no local container management.
  - *Unacceptable Interactive Experience:* Chat interactions suffer from a ~30-second delay per turn, making real-time voice and conversational text feel sluggish.
  - *Recommendation:* Reject for production interactive chat; acceptable only as a temporary diagnostic baseline during offline development.

---

## 5. Architectural Comparison Matrix

| Evaluation Dimension | Candidate 1: Cloud-Colocated Backend | Candidate 2: Local PC Replica Set | Candidate 3: Status Quo (Remote WAN DB) |
| :--- | :--- | :--- | :--- |
| **Typical DB Wave Round-Trip** | 5 – 15 ms | 1 – 3 ms | 150 – 450 ms |
| **Modeled DB Time (180 waves)** | **1.2 – 2.0 s** | **0.2 – 0.5 s** | **27 – 30 s** |
| **User-Perceived Response Time** | **2.5 – 3.5 s** | **1.5 – 2.5 s** | **~30 s** |
| **High Availability (HA)** | Multi-AZ cloud failover | None (single machine) | Dependent on remote cluster |
| **RPO / RTO Guarantees** | Cloud point-in-time restore | Manual local exports | Managed by cloud DB provider |
| **Access Control Requirement** | Mandatory auth before rollout | Loopback access control | Local/private network |
| **Infrastructure Cost** | Cloud compute + DB hosting | \$0 (local hardware) | Remote DB hosting only |
| **Implementation Risk** | Medium (deployment setup) | Low (local container) | Low (no changes) |

---

## 6. Strategic Recommendations & Gate Governance (Task 11.4)

1. **Production Path Recommendation:**
   - Adopt **Candidate 1 (Cloud-Colocated Backend Executor)** for production rollout. Colocating the single NestJS executor with the MongoDB primary inside the same cloud region yields an immediate **~90% reduction in end-to-end turn latency**, transforming Aurvin into a responsive, low-latency assistant without compromising transactional durability or security invariants.
2. **Local Engineering Path Recommendation:**
   - Adopt **Candidate 2 (Local PC Replica Set)** for day-to-day feature development and regression test runs.
3. **Explicit Gate Preservation (D6 & D7):**
   - **Gate D6 (Infrastructure Placement Changes):** REMAINS GATED. This document provides the architectural evaluation required by the plan; no cloud instances, containers, or network routes have been provisioned or modified.
   - **Gate D7 (External/Paid Benchmarks):** REMAINS GATED. All performance baselines cited were generated via deterministic offline probes; no live external OpenRouter or cloud database charges were incurred.
