export type UsageSnapshot = {
  five_hour_tokens: number;
  weekly_tokens: number;
  last_request_at: string | null;
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

export const PLAN_PRESETS: Record<Exclude<PlanId, "custom">, PlanLimits> = {
  pro: { fiveHour: 1_000_000, weekly: 7_000_000 },
  max5x: { fiveHour: 5_000_000, weekly: 35_000_000 },
  max20x: { fiveHour: 20_000_000, weekly: 140_000_000 },
};

export type PetState = "idle" | "tired" | "sleep" | "dead";
