import type { PetState, PlanLimits, UsageSnapshot } from "./types";

export const CACHE_TTL_MS = 5 * 60 * 1000;
export const CACHE_NUDGE_AT_MS = 4 * 60 * 1000;

export type DerivedState = {
  /** Battery-style remaining %: 1.0 = full, 0.0 = exhausted */
  fiveHourRemaining: number;
  weeklyRemaining: number;
  /** Used %, kept for notification logic */
  fiveHourUsed: number;
  weeklyUsed: number;
  petState: PetState;
  cacheRemainMs: number | null;
  cacheNudge: boolean;
  fiveHourResetMs: number | null;
  weeklyResetMs: number | null;
};

export function derive(
  snap: UsageSnapshot | null,
  limits: PlanLimits,
  nowMs: number,
): DerivedState {
  if (!snap) {
    return {
      fiveHourRemaining: 1,
      weeklyRemaining: 1,
      fiveHourUsed: 0,
      weeklyUsed: 0,
      petState: "idle",
      cacheRemainMs: null,
      cacheNudge: false,
      fiveHourResetMs: null,
      weeklyResetMs: null,
    };
  }
  const fiveHourUsed = clampPct(snap.five_hour_tokens / Math.max(1, limits.fiveHour));
  const weeklyUsed = clampPct(snap.weekly_tokens / Math.max(1, limits.weekly));
  const fiveHourRemaining = 1 - fiveHourUsed;
  const weeklyRemaining = 1 - weeklyUsed;

  // Pet state, battery-style 5-tier breakdown of the lowest remaining %:
  //   ≥ 80% → idle, 60-80% → cheerful, 40-60% → tired,
  //   20-40% → weary, 0-20% → sleepy.
  // Hard 0% on either window short-circuits to sleep / dead.
  let petState: PetState;
  const lowest = Math.min(fiveHourRemaining, weeklyRemaining);
  if (weeklyRemaining <= 0) petState = "dead";
  else if (fiveHourRemaining <= 0) petState = "sleep";
  else if (lowest <= 0.2) petState = "sleepy";
  else if (lowest <= 0.4) petState = "weary";
  else if (lowest <= 0.6) petState = "tired";
  else if (lowest <= 0.8) petState = "cheerful";
  else petState = "idle";

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

  const fiveHourResetMs = snap.five_hour_resets_at
    ? Math.max(0, Date.parse(snap.five_hour_resets_at) - nowMs)
    : null;
  const weeklyResetMs = snap.weekly_resets_at
    ? Math.max(0, Date.parse(snap.weekly_resets_at) - nowMs)
    : null;

  return {
    fiveHourRemaining,
    weeklyRemaining,
    fiveHourUsed,
    weeklyUsed,
    petState,
    cacheRemainMs,
    cacheNudge,
    fiveHourResetMs,
    weeklyResetMs,
  };
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

export function formatResetCountdown(ms: number): string {
  if (ms <= 0) return "곧 초기화";
  const totalMin = Math.floor(ms / 60000);
  const days = Math.floor(totalMin / (60 * 24));
  const hours = Math.floor((totalMin % (60 * 24)) / 60);
  const mins = totalMin % 60;
  if (days >= 1) return `${days}일 ${hours}시간 후`;
  if (hours >= 1) return `${hours}시간 ${mins}분 후`;
  return `${mins}분 후`;
}
