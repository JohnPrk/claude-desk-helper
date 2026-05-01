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
      petState: "full",
      cacheRemainMs: null,
      cacheNudge: false,
      fiveHourResetMs: null,
      weeklyResetMs: null,
    };
  }
  // Prefer the live API if it's fresh (<2 minutes old). Anthropic's own
  // utilization% is authoritative — no calibration needed.
  const apiFresh =
    snap.api &&
    nowMs - Date.parse(snap.api.fetched_at) < 2 * 60 * 1000;

  const fiveHourUsed = apiFresh
    ? clampPct(snap.api!.five_hour_pct / 100)
    : clampPct(snap.five_hour_tokens / Math.max(1, limits.fiveHour));
  const weeklyUsed = apiFresh
    ? clampPct(snap.api!.weekly_pct / 100)
    : clampPct(snap.weekly_tokens / Math.max(1, limits.weekly));
  const fiveHourRemaining = 1 - fiveHourUsed;
  const weeklyRemaining = 1 - weeklyUsed;

  // Pet state from the LOWEST remaining % across both windows. Tier
  // boundaries match the per-state PNG ranges in src/skins/<skin>/.
  // weekly = 0 short-circuits to dead (weekly0.png).
  let petState: PetState;
  const lowest = Math.min(fiveHourRemaining, weeklyRemaining);
  if (weeklyRemaining <= 0) petState = "dead";
  else if (lowest <= 0.15) petState = "sleepy";  // 0–15% (also 5h=0%)
  else if (lowest <= 0.33) petState = "tired";   // 15–33%
  else if (lowest <= 0.49) petState = "low";     // 33–49%
  else if (lowest <= 0.63) petState = "mid";     // 49–63%
  else if (lowest <= 0.77) petState = "good";    // 63–77%
  else if (lowest <= 0.90) petState = "high";    // 77–90%
  else petState = "full";                         // 90–100%

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

  const fiveResetSrc =
    apiFresh && snap.api!.five_hour_resets_at
      ? snap.api!.five_hour_resets_at
      : snap.five_hour_resets_at;
  const weeklyResetSrc =
    apiFresh && snap.api!.weekly_resets_at
      ? snap.api!.weekly_resets_at
      : snap.weekly_resets_at;
  const fiveHourResetMs = fiveResetSrc
    ? Math.max(0, Date.parse(fiveResetSrc) - nowMs)
    : null;
  const weeklyResetMs = weeklyResetSrc
    ? Math.max(0, Date.parse(weeklyResetSrc) - nowMs)
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
