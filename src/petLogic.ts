import type { PetState, PlanLimits, UsageSnapshot } from "./types";

export const CACHE_TTL_MS = 5 * 60 * 1000;
export const CACHE_NUDGE_AT_MS = 4 * 60 * 1000;

export type DerivedState = {
  fiveHourPct: number;
  weeklyPct: number;
  petState: PetState;
  cacheRemainMs: number | null;
  cacheNudge: boolean;
};

export function derive(
  snap: UsageSnapshot | null,
  limits: PlanLimits,
  nowMs: number,
): DerivedState {
  if (!snap) {
    return {
      fiveHourPct: 0,
      weeklyPct: 0,
      petState: "idle",
      cacheRemainMs: null,
      cacheNudge: false,
    };
  }
  const fiveHourPct = clampPct(snap.five_hour_tokens / Math.max(1, limits.fiveHour));
  const weeklyPct = clampPct(snap.weekly_tokens / Math.max(1, limits.weekly));

  let petState: PetState = "idle";
  if (weeklyPct >= 1) petState = "dead";
  else if (fiveHourPct >= 1) petState = "sleep";
  else if (weeklyPct >= 0.7 || fiveHourPct >= 0.7) petState = "tired";

  let cacheRemainMs: number | null = null;
  let cacheNudge = false;
  if (snap.last_request_at) {
    const lastMs = Date.parse(snap.last_request_at);
    const elapsed = nowMs - lastMs;
    if (elapsed < CACHE_TTL_MS && elapsed >= 0) {
      cacheRemainMs = CACHE_TTL_MS - elapsed;
      if (elapsed >= CACHE_NUDGE_AT_MS) cacheNudge = true;
    }
  }

  return { fiveHourPct, weeklyPct, petState, cacheRemainMs, cacheNudge };
}

function clampPct(v: number) {
  if (!Number.isFinite(v) || v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

export function formatRemain(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const mm = Math.floor(s / 60);
  const ss = s % 60;
  return `${mm}:${ss.toString().padStart(2, "0")}`;
}
