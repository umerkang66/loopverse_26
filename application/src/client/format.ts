import { RESOURCE_LABEL } from '@/domain/constants';
import { RESOURCE_KEYS, type ResourceVector } from '@/domain/types';

export function mmss(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

export function clock(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function ago(iso: string | null | undefined, now: number): string {
  if (!iso) return 'never';
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 60) return `${s} s ago`;
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  return `${Math.floor(s / 3600)} h ago`;
}

export const short = (k: keyof typeof RESOURCE_LABEL) => RESOURCE_LABEL[k].short;

/** "P79 W50 O59 R26 B16" */
export function vecText(v: ResourceVector): string {
  return RESOURCE_KEYS.map((k) => `${short(k)}${v[k]}`).join(' ');
}

export function hash8(hash: string | null | undefined): string {
  return hash ? `#${hash.slice(0, 6)}` : '';
}

export function secs(ms: number | undefined | null): string {
  return ms === undefined || ms === null ? '' : `${(ms / 1000).toFixed(1)}s`;
}
