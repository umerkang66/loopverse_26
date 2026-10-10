import {
  AlertTriangle,
  ClipboardList,
  FileText,
  Gavel,
  Handshake,
  HeartPulse,
  Info,
  Megaphone,
  Repeat2,
  ShieldCheck,
  ShieldHalf,
  Sprout,
  Stamp,
  UserRound,
  Vote,
  Wind,
  Wrench,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import { PROFILES } from '@/domain/scenario';
import type { ActorId, AgentId, MessageSource, MessageType, ModeTier, PlanStatus } from '@/domain/types';

export interface ActorMeta {
  callsign: string;
  dept: string;
  short: string;
  color: string;
  icon: LucideIcon;
}

const AGENT_ICON: Record<AgentId, LucideIcon> = {
  COMMANDER: ShieldHalf,
  LIFE_SUPPORT: Wind,
  MEDICAL: HeartPulse,
  FOOD: Sprout,
  ENGINEERING: Wrench,
};

const SHORT: Record<AgentId, string> = { COMMANDER: 'Cmdr', LIFE_SUPPORT: 'LS', MEDICAL: 'Med', FOOD: 'Food', ENGINEERING: 'Eng' };

export const ACTOR_META: Record<ActorId, ActorMeta> = {
  COMMANDER: { callsign: PROFILES.COMMANDER.callsign, dept: 'Commander', short: SHORT.COMMANDER, color: PROFILES.COMMANDER.color, icon: AGENT_ICON.COMMANDER },
  LIFE_SUPPORT: { callsign: PROFILES.LIFE_SUPPORT.callsign, dept: PROFILES.LIFE_SUPPORT.departmentName, short: SHORT.LIFE_SUPPORT, color: PROFILES.LIFE_SUPPORT.color, icon: AGENT_ICON.LIFE_SUPPORT },
  MEDICAL: { callsign: PROFILES.MEDICAL.callsign, dept: PROFILES.MEDICAL.departmentName, short: SHORT.MEDICAL, color: PROFILES.MEDICAL.color, icon: AGENT_ICON.MEDICAL },
  FOOD: { callsign: PROFILES.FOOD.callsign, dept: PROFILES.FOOD.departmentName, short: SHORT.FOOD, color: PROFILES.FOOD.color, icon: AGENT_ICON.FOOD },
  ENGINEERING: { callsign: PROFILES.ENGINEERING.callsign, dept: PROFILES.ENGINEERING.departmentName, short: SHORT.ENGINEERING, color: PROFILES.ENGINEERING.color, icon: AGENT_ICON.ENGINEERING },
  VALIDATOR: { callsign: 'VALIDATOR', dept: 'Deterministic engine', short: 'Val', color: '#9CA3AF', icon: ShieldCheck },
  SYSTEM: { callsign: 'SYSTEM', dept: 'Council system', short: 'Sys', color: '#60A5FA', icon: Info },
  JUDGE: { callsign: 'MISSION CONTROL', dept: 'Human judge', short: 'Judge', color: '#60A5FA', icon: UserRound },
};

export const MESSAGE_TYPE_META: Record<MessageType, { label: string; icon: LucideIcon }> = {
  BRIEFING: { label: 'Briefing', icon: Megaphone },
  PROPOSAL: { label: 'Proposal', icon: FileText },
  OBJECTION: { label: 'Objection', icon: AlertTriangle },
  COUNTEROFFER: { label: 'Counteroffer', icon: Repeat2 },
  COMMITMENT: { label: 'Commitment', icon: Handshake },
  PLAN_DRAFT: { label: 'Plan draft', icon: ClipboardList },
  VALIDATION: { label: 'Validation', icon: ShieldCheck },
  VOTE: { label: 'Vote', icon: Vote },
  APPROVAL: { label: 'Approval', icon: Stamp },
  DECISION: { label: 'Decision', icon: Gavel },
  EVENT: { label: 'Event', icon: Zap },
  SYSTEM: { label: 'System', icon: Info },
};

export const OBJECTION_LABEL: Record<string, string> = {
  RESOURCE_CONFLICT: 'Resource conflict',
  UNFAIR_SACRIFICE: 'Unfair sacrifice',
  SACRIFICE_REFUSAL: 'Sacrifice refused',
  RISK_LIMIT: 'Risk limit',
  MISSING_RETURN: 'Missing return',
  INVALID_PLAN: 'Invalid plan',
  CONFLICT_REPORT: 'Conflict report',
  HUMAN_VETO: 'Mission Control veto',
};

export type Tone = 'success' | 'amber' | 'danger' | 'info' | 'stale' | 'mars' | 'muted';

/** Text + border + tint classes per tone (always paired with a word or icon, never color alone). */
export const TONE_CLASS: Record<Tone, string> = {
  success: 'text-success border-success/40 bg-success/10',
  amber: 'text-amber border-amber/40 bg-amber/10',
  danger: 'text-danger border-danger/40 bg-danger/10',
  info: 'text-info border-info/40 bg-info/10',
  stale: 'text-stale border-stale/40 bg-stale/10',
  mars: 'text-mars border-mars/40 bg-mars/10',
  muted: 'text-muted-foreground border-border bg-panel-2',
};

export const TIER_TONE: Record<ModeTier, Tone> = { STANDARD: 'success', RESTRICTED: 'amber', SACRIFICE: 'danger' };

export const PLAN_STATUS_TONE: Record<PlanStatus, Tone> = {
  DRAFT: 'info',
  FAILED: 'danger',
  READY: 'success',
  VOTING: 'mars',
  REJECTED: 'danger',
  APPROVED: 'success',
  RATIFIED: 'success',
  SUPERSEDED: 'stale',
  STALE: 'stale',
  INVALID: 'danger',
};

export const SOURCE_TONE: Record<MessageSource, Tone> = { LLM: 'success', FALLBACK: 'amber', DETERMINISTIC: 'stale', HUMAN: 'info' };

export const OUTCOME_TONE: Record<string, Tone> = {
  APPROVED: 'success',
  INFEASIBLE: 'danger',
  DEADLOCK: 'amber',
  TIMEOUT: 'amber',
  INTERRUPTED: 'stale',
};
