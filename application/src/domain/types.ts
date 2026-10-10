// Core domain types for ARES ACCORD. Pure: shared by the server and (Phase 2) the client.

export const RESOURCE_KEYS = ['power', 'water', 'oxygen', 'robot', 'bandwidth'] as const;
export type ResourceKey = (typeof RESOURCE_KEYS)[number];
export type ResourceVector = Record<ResourceKey, number>;

export const DEPARTMENT_IDS = ['LIFE_SUPPORT', 'MEDICAL', 'FOOD', 'ENGINEERING'] as const;
export type DepartmentId = (typeof DEPARTMENT_IDS)[number];
export const AGENT_IDS = ['COMMANDER', ...DEPARTMENT_IDS] as const;
export type AgentId = (typeof AGENT_IDS)[number];
export type ActorId = AgentId | 'VALIDATOR' | 'SYSTEM' | 'JUDGE';

export const MODE_IDS = ['L1', 'L2', 'L3', 'M1', 'M2', 'M3', 'F1', 'F2', 'F3', 'E1', 'E2', 'E3'] as const;
export type ModeId = (typeof MODE_IDS)[number];
export type ModeTier = 'STANDARD' | 'RESTRICTED' | 'SACRIFICE';
export interface ModePackage {
  id: ModeId;
  department: DepartmentId;
  tier: ModeTier;
  label: string;
  resources: ResourceVector;
  risk: number;
  consequence: string;
}
export type Selections = Record<DepartmentId, ModeId>;

export interface ActivePolicy {
  riskLimit: number;
  maxSacrifices: number;
  crisisOverride: boolean;
  requiredReturnCommitments: number;
}

// ── Commitments ──
export type CommitmentKind = 'RESOURCE_SHARE' | 'RESERVE_ASSIGNMENT' | 'PRIORITY' | 'FUTURE_RESOURCE' | 'OTHER';
export type CommitmentStatus =
  | 'OFFERED' | 'ACCEPTED' | 'DECLINED' | 'WITHDRAWN' // negotiation
  | 'ACTIVE' // part of an approved plan
  | 'DUE' | 'FULFILLED' | 'BREACHED' | 'VOID' | 'EXPIRED'; // post-event review
export interface Expiry {
  unit: 'HOURS' | 'CYCLES' | 'SCENARIOS';
  value: number;
  label: string;
}
export interface Commitment {
  id: string; // "C-1"
  scenarioId: string;
  round: number;
  createdAtHour: number;
  owner: AgentId; // who promises (department or COMMANDER)
  beneficiary: DepartmentId; // the (would-be) sacrificing department
  kind: CommitmentKind;
  resource: ResourceKey | null;
  amount: number | null;
  promise: string;
  expiry: Expiry;
  onlyIfSacrificeMode: ModeId | null; // conditional offer, e.g. only if LIFE_SUPPORT runs L3
  status: CommitmentStatus;
  history: { at: string; status: CommitmentStatus; by: ActorId; reason: string }[];
  sourceMessageId: string | null;
}

// ── Votes and plans ──
export type VoteDecision = 'ACCEPT' | 'REJECT';
export type MessageSource = 'LLM' | 'FALLBACK' | 'DETERMINISTIC' | 'HUMAN';
export interface Vote {
  id: string;
  agentId: DepartmentId;
  planVersion: number;
  planHash: string;
  decision: VoteDecision;
  reason: string;
  conditionsForAccept: string[];
  round: number;
  source: MessageSource;
  createdAt: string;
}
export type PlanStatus =
  | 'DRAFT' | 'FAILED' | 'READY' | 'VOTING' | 'REJECTED' | 'APPROVED' | 'RATIFIED'
  | 'SUPERSEDED' | 'STALE' | 'INVALID';
export interface PlanDiff {
  fromVersion: number;
  modeChanges: { department: DepartmentId; from: ModeId; to: ModeId; delta: ResourceVector; riskDelta: number }[];
  commitmentsAdded: string[];
  commitmentsRemoved: string[];
  policyChanged: boolean;
  summary: string;
}
export interface Plan {
  version: number; // global, monotonic across the session: v1, v2, …
  hash: string; // sha256 of canonical content (selections + commitment terms + policy + pool)
  scenarioId: string;
  round: number;
  author: 'COMMANDER';
  label: string;
  selections: Selections;
  commitmentIds: string[];
  policy: ActivePolicy;
  poolSnapshot: ResourceVector;
  reserveRequirements: Partial<ResourceVector>;
  totals: ResourceVector;
  reserve: ResourceVector;
  risk: number;
  sacrifices: DepartmentId[];
  status: PlanStatus;
  statusReason: string | null;
  rationale: string;
  respondsTo: string[]; // message ids this version answers
  validations: ValidationReport[];
  votes: Vote[];
  diff: PlanDiff | null;
  createdAt: string;
}

// ── Validation ──
export type CheckId =
  | 'MODE_SELECTION' | 'PACKAGE_INTEGRITY' | 'FORBIDDEN_MODES' | 'RESOURCES' | 'RISK_LIMIT'
  | 'SACRIFICE_LIMIT' | 'RETURN_AGREEMENT' | 'COMMITMENT_AFFORDABILITY' | 'PLAN_CURRENCY' | 'VOTES';
export interface ValidationCheck {
  id: CheckId;
  label: string;
  status: 'PASS' | 'FAIL' | 'SKIP';
  reason: string;
  details?: Record<string, unknown>;
}
export type ValidationStage = 'DRY_RUN' | 'PRE_VOTE' | 'APPROVAL';
export interface ValidationReport {
  status: 'PASS' | 'FAIL';
  stage: ValidationStage;
  planVersion: number | null;
  planHash: string | null;
  checks: ValidationCheck[];
  totals: ResourceVector;
  reserve: ResourceVector;
  risk: number;
  sacrifices: DepartmentId[];
  warnings: string[];
  evaluatedAt: string;
}

// ── Messages ──
export const MESSAGE_TYPES = [
  'BRIEFING', 'PROPOSAL', 'OBJECTION', 'COUNTEROFFER', 'COMMITMENT', 'PLAN_DRAFT',
  'VALIDATION', 'VOTE', 'APPROVAL', 'DECISION', 'EVENT', 'SYSTEM',
] as const;
export type MessageType = (typeof MESSAGE_TYPES)[number];
export type Phase =
  | 'IDLE' | 'EVENT_INTAKE' | 'REVIEW' | 'BRIEFING' | 'POSITIONS' | 'SYNTHESIS' | 'CONSENT'
  | 'VALIDATION' | 'VOTING' | 'DECISION' | 'DONE';
export interface LlmMeta {
  model: string;
  latencyMs: number;
  attempts: number;
  inputTokens?: number;
  outputTokens?: number;
  traceId?: string;
  fallbackReason?: string;
  toolCalls: { name: string; args: string; result: string }[];
}
export interface CouncilMessage {
  id: string;
  seq: number;
  scenarioId: string;
  round: number;
  phase: Phase;
  from: ActorId;
  to: 'ALL' | AgentId[];
  type: MessageType;
  subtype: string | null; // e.g. 'SACRIFICE_REFUSAL', 'VOTES_CLEARED', 'PLAN_INVALID', 'OFFER', 'ACCEPT'
  summary: string; // one line with numbers, shown collapsed
  body: string; // the agent's own words (or deterministic text)
  planVersion: number | null;
  data: Record<string, unknown>;
  turnId: string | null; // groups the messages produced by one agent turn
  source: MessageSource;
  meta: LlmMeta | null;
  createdAt: string;
}

// ── Events ──
export type EventEffect =
  | { type: 'RESOURCE_DELTA'; resource: ResourceKey; value: number }
  | { type: 'RESOURCE_PERCENT'; resource: ResourceKey; value: number }
  | { type: 'RESOURCE_SET'; resource: ResourceKey; value: number }
  | { type: 'RESERVE_REQUIREMENT'; resource: ResourceKey; value: number }
  | { type: 'FORBID_MODE'; modeId: ModeId; reason: string }
  | { type: 'ALLOW_MODE'; modeId: ModeId }
  | { type: 'RISK_LIMIT'; value: number }
  | { type: 'MAX_SACRIFICES'; value: number }
  | { type: 'PRIORITY'; department: DepartmentId | null; note: string }
  | { type: 'INFO'; note: string };
export type EventSource = 'DETERMINISTIC' | 'LLM' | 'HYBRID' | 'MANUAL' | 'PRESET';
export interface EventInterpretation {
  title: string;
  summary: string;
  effects: EventEffect[];
  durationHours: number | null;
  triggerHour: number | null;
  requiresReplan: boolean;
  messageToCommander: string | null;
  source: EventSource;
  confidence: number;
  warnings: string[];
  assumptions: string[];
  raw: unknown;
}
export interface EventRecord {
  id: string;
  scenarioId: string;
  receivedAt: string;
  interpretation: EventInterpretation;
  poolBefore: ResourceVector;
  poolAfter: ResourceVector;
}

// ── Infeasibility ──
export interface InfeasibilityCertificate {
  combinationsChecked: number;
  policyEvaluated: ActivePolicy;
  blocking: { constraint: string; detail: string }[];
  closest: { selections: Selections; shortfall: ResourceVector; risk: number; sacrifices: number; policy: string }[];
  requests: string[];
  policyAlternatives: { change: string; feasible: boolean; detail: string }[];
}

// ── Scenarios, agents, session ──
export type ScenarioKind = 'BASELINE' | 'EVENT';
export type ScenarioOutcome = 'APPROVED' | 'INFEASIBLE' | 'DEADLOCK' | 'TIMEOUT' | 'INTERRUPTED';
export type ScenarioStatus = 'PENDING' | 'NEGOTIATING' | 'AWAITING_COUNTERSIGN' | 'RESOLVED';
export interface Scenario {
  id: string; // "S0" baseline, "S1" first event …
  index: number;
  kind: ScenarioKind;
  title: string;
  description: string;
  colonyHour: number;
  eventId: string | null;
  pool: ResourceVector;
  reserveRequirements: Partial<ResourceVector>;
  forbiddenModes: ModeId[];
  priorities: string[];
  policy: ActivePolicy;
  overrideAvailable: boolean;
  riskCap: number | null; // hard caps imposed by events (bound Crisis Override too)
  maxSacrificesCap: number | null;
  minRoundsBeforeApproval: number;
  maxRounds: number;
  /** Judge override of the scenario deadline (seconds); null/absent = the configured default. */
  deadlineSeconds?: number | null;
  status: ScenarioStatus;
  outcome: ScenarioOutcome | null;
  outcomeReason: string | null;
  round: number;
  startedAt: string | null;
  deadlineAt: string | null;
  resolvedAt: string | null;
  approvedPlanVersion: number | null;
  certificate: InfeasibilityCertificate | null;
  previousPlan: { version: number; status: 'STALE' | 'INVALID'; reasons: string[] } | null;
  /** Opening statement + asks for the next round, written by the Commander's synthesis. */
  nextBrief: { statement: string; asks: { to: 'ALL' | DepartmentId; ask: string }[]; source?: 'LLM' | 'FALLBACK' } | null;
}
export interface AgentProfile {
  id: AgentId;
  callsign: string;
  name: string;
  title: string;
  departmentName: string;
  mission: string;
  mainConcern: string;
  goals: string[];
  constraints: string[];
  redLines: string[];
  voice: string;
  color: string;
}
export type SacrificeStance = 'REFUSE' | 'CONDITIONAL' | 'ACCEPT' | 'NOT_ASKED';
export type AgentStatus = 'IDLE' | 'THINKING' | 'DONE' | 'ERROR';
export interface AgentState {
  id: AgentId;
  status: AgentStatus;
  requestedMode: ModeId | null;
  stance: { sacrifice: SacrificeStance; conditions: string[]; round: number; scenarioId: string } | null;
  requestHistory: { scenarioId: string; round: number; modeId: ModeId }[];
  stanceHistory: { scenarioId: string; round: number; stance: SacrificeStance }[];
  memory: { scenarioId: string; round: number; note: string; at: string }[]; // private notes
  sacrificeLedger: { scenarioId: string; modeId: ModeId; planVersion: number; commitmentIds: string[] }[];
  trust: Partial<Record<AgentId, number>>;
  lastSeenSeq: number; // inbox cursor
  sessionItems: unknown[]; // persisted Agents-SDK session items (private history)
  stats: { llmCalls: number; fallbacks: number; totalLatencyMs: number; inputTokens: number; outputTokens: number };
}
export type RunStatus = 'IDLE' | 'RUNNING' | 'AWAITING_COUNTERSIGN' | 'COMPLETED' | 'INTERRUPTED';
export interface RunState {
  status: RunStatus;
  phase: Phase;
  scenarioId: string | null;
  round: number;
  activeAgents: AgentId[];
  startedAt: string | null;
  deadlineAt: string | null;
  lastError: string | null;
}
export interface SessionConfig {
  mode: 'live' | 'offline';
  models: { commander: string; departments: string; fallback: string; effortCommander: string; effortDepartments: string };
  maxRoundsBaseline: number;
  maxRoundsEvent: number;
  baselineDeadlineSec: number;
  eventDeadlineSec: number;
  modelCallTimeoutMs: number;
  agentTurnTimeoutMs: number;
  hitl: { enabled: boolean; riskThreshold: number };
}
export interface SessionCounters {
  seq: number;
  plan: number;
  commitment: number;
  event: number;
  vote: number;
  turn: number;
}
export interface SessionState {
  id: string; // UUIDv7 generated by the app, also the Supabase primary key
  instanceId: string; // ARES_INSTANCE_ID, namespacing sessions per deployment
  createdAt: string;
  updatedAt: string;
  config: SessionConfig;
  scenarioConfigId: string;
  catalogHash: string;
  scenarios: Scenario[];
  events: EventRecord[];
  plans: Plan[];
  commitments: Commitment[];
  messages: CouncilMessage[];
  agents: Record<AgentId, AgentState>;
  run: RunState;
  planInForceVersion: number | null;
  counters: SessionCounters;
}

// ── Persistence status (shown in the dashboard) ──
export const DB_TABLES = [
  'ares_sessions', 'ares_instances', 'ares_scenarios', 'ares_events', 'ares_plans', 'ares_plan_validations',
  'ares_votes', 'ares_commitments', 'ares_messages', 'ares_agent_states', 'ares_agent_memory',
] as const;
export type DbTable = (typeof DB_TABLES)[number];
export type StorageState = 'SYNCED' | 'SYNCING' | 'DEGRADED' | 'ERROR' | 'LOCAL_ONLY';
export interface StorageStatus {
  driver: 'supabase' | 'file';
  state: StorageState;
  instanceId: string;
  project: string | null; // e.g. "abcd1234.supabase.co": host only, never a key
  pendingRows: number;
  lastSyncAt: string | null;
  lastError: { code: string; message: string; hint: string } | null;
  rowsWritten: Partial<Record<DbTable, number>>;
  dbMessageCount: number | null;
  leaseWarning: string | null;
}

// ── Compliance ──
export interface ComplianceItem {
  id: string;
  label: string;
  scope: 'BASELINE' | 'EVENT' | 'SYSTEM';
  status: 'PASS' | 'FAIL' | 'PENDING' | 'NA';
  evidence: string[];
  detail: string;
}
export interface ComplianceReport {
  items: ComplianceItem[];
  passed: number;
  applicable: number;
}

// ── What the server streams to clients ──
export type PublicAgentState = Omit<AgentState, 'sessionItems'> & { sessionItemCount: number };
export interface PublicState extends Omit<SessionState, 'messages' | 'agents'> {
  agents: Record<AgentId, PublicAgentState>;
  messageCount: number;
  storage: StorageStatus;
  compliance: ComplianceReport;
}
