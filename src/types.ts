export type UsageSnapshot = {
  five_hour_tokens: number;
  weekly_tokens: number;
  last_request_at: string | null;
  last_user_prompt_at: string | null;
  is_thinking: boolean;
  five_hour_window_start: string | null;
  five_hour_resets_at: string | null;
  weekly_window_start: string | null;
  weekly_resets_at: string | null;
  cache_hits_5min: number;
  cache_misses_5min: number;
  current_combo: number;
  now: string;
};

export type PlanId = "pro" | "max5x" | "max20x" | "custom";

export type PlanLimits = {
  fiveHour: number;
  weekly: number;
};

export type PlanConfig = {
  plan: PlanId;
  limits: PlanLimits;
  skin: string;
};

// Anthropic does not publish exact 5h/weekly token limits per plan.
// These are calibrated estimates (input + output + cache_creation), not
// authoritative. Override via Custom or in Settings if your real % from
// the Claude UI doesn't line up with what the pet shows.
export const PLAN_PRESETS: Record<Exclude<PlanId, "custom">, PlanLimits> = {
  pro: { fiveHour: 5_000_000, weekly: 35_000_000 },
  max5x: { fiveHour: 25_000_000, weekly: 175_000_000 },
  max20x: { fiveHour: 100_000_000, weekly: 700_000_000 },
};

export type PetState = "idle" | "tired" | "sleep" | "dead";
