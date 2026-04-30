import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { PlanConfig, PlanId, UsageSnapshot } from "./types";
import { PLAN_PRESETS } from "./types";
import { loadPlanConfig, savePlanConfig } from "./store";
import { ACCESSORIES, DEFAULT_SKIN_ID, SKINS, findSkin } from "./skins";
import {
  CACHE_TTL_MS,
  derive,
  formatRemain,
  formatResetCountdown,
  formatTokens,
} from "./petLogic";
import { maybeNotify, resetThreshold } from "./notifier";
import "./App.css";

type IdleAction =
  | "none"
  | "roll"
  | "bamboo"
  | "jump"
  | "spin"
  | "run"
  | "shy"
  | "doze"
  | "scratch";

const IDLE_ACTIONS: ReadonlyArray<{ name: Exclude<IdleAction, "none">; durationMs: number }> = [
  { name: "roll", durationMs: 1600 },
  { name: "bamboo", durationMs: 4500 },
  { name: "jump", durationMs: 1200 },
  { name: "spin", durationMs: 1800 },
  { name: "run", durationMs: 2500 },
  { name: "shy", durationMs: 2800 },
  { name: "doze", durationMs: 3800 },
  { name: "scratch", durationMs: 3000 },
];

// Battery-style: notify when remaining drops to these thresholds.
const REMAINING_THRESHOLDS: Array<[number, string]> = [
  [0.3, "30%"],
  [0.1, "10%"],
  [0.0, "0%"],
];

type View = "loading" | "onboarding" | "pet";

export default function App() {
  const [view, setView] = useState<View>("loading");
  const [config, setConfig] = useState<PlanConfig | null>(null);

  useEffect(() => {
    loadPlanConfig().then((cfg) => {
      if (cfg) {
        setConfig(cfg);
        setView("pet");
      } else {
        setView("onboarding");
      }
    });
  }, []);

  if (view === "loading") return null;
  if (view === "onboarding") {
    return (
      <Onboarding
        onDone={async (cfg) => {
          await savePlanConfig(cfg);
          setConfig(cfg);
          setView("pet");
        }}
      />
    );
  }
  return (
    <Pet
      config={config!}
      onConfigChange={async (cfg) => {
        await savePlanConfig(cfg);
        setConfig(cfg);
      }}
    />
  );
}

function Onboarding({ onDone }: { onDone: (cfg: PlanConfig) => void }) {
  const [plan, setPlan] = useState<PlanId>("max5x");
  const [customFive, setCustomFive] = useState(5_000_000);
  const [customWeek, setCustomWeek] = useState(35_000_000);

  const submit = () => {
    const limits =
      plan === "custom"
        ? { fiveHour: customFive, weekly: customWeek }
        : PLAN_PRESETS[plan];
    onDone({ plan, limits, skin: DEFAULT_SKIN_ID });
  };

  return (
    <div className="onboarding">
      <h1>Claude Desk Pet</h1>
      <p className="sub">너의 토큰 잔량을 알려줄게.</p>

      <div className="plans">
        {(["pro", "max5x", "max20x", "custom"] as PlanId[]).map((p) => (
          <button
            key={p}
            className={`plan ${plan === p ? "selected" : ""}`}
            onClick={() => setPlan(p)}
          >
            <strong>{labelOf(p)}</strong>
            <span>{descOf(p)}</span>
          </button>
        ))}
      </div>

      {plan === "custom" && (
        <div className="custom-fields">
          <label>
            5시간 한도 (tokens)
            <input
              type="number"
              value={customFive}
              onChange={(e) => setCustomFive(Number(e.target.value))}
            />
          </label>
          <label>
            주간 한도 (tokens)
            <input
              type="number"
              value={customWeek}
              onChange={(e) => setCustomWeek(Number(e.target.value))}
            />
          </label>
        </div>
      )}

      <button className="primary" onClick={submit}>
        시작
      </button>
      <p className="hint">
        한도는 추정치입니다. 설정에서 캘리브레이션할 수 있어요.
      </p>
    </div>
  );
}

function labelOf(p: PlanId) {
  return p === "pro"
    ? "Pro"
    : p === "max5x"
    ? "Max 5×"
    : p === "max20x"
    ? "Max 20×"
    : "Custom";
}
function descOf(p: PlanId) {
  if (p === "custom") return "직접 입력";
  const l = PLAN_PRESETS[p];
  return `${formatTokens(l.fiveHour)} / 5h · ${formatTokens(l.weekly)} / 주`;
}

function Pet({
  config,
  onConfigChange,
}: {
  config: PlanConfig;
  onConfigChange: (cfg: PlanConfig) => void;
}) {
  const [snap, setSnap] = useState<UsageSnapshot | null>(null);
  const [now, setNow] = useState(Date.now());
  const [showSettings, setShowSettings] = useState(false);
  const [idleAction, setIdleAction] = useState<IdleAction>("none");
  const [flash, setFlash] = useState<"hit" | "miss" | null>(null);
  const [seenCounts, setSeenCounts] = useState({ hits: -1, misses: -1 });

  useEffect(() => {
    invoke<UsageSnapshot>("get_usage_snapshot").then(setSnap).catch(() => {});
    const unlistenP = listen<UsageSnapshot>("usage-update", (e) =>
      setSnap(e.payload),
    );
    const unlistenSettings = listen("show-settings", () => setShowSettings(true));
    const tick = setInterval(() => setNow(Date.now()), 500);
    return () => {
      clearInterval(tick);
      unlistenP.then((fn) => fn());
      unlistenSettings.then((fn) => fn());
    };
  }, []);

  const d = useMemo(() => derive(snap, config.limits, now), [snap, config, now]);

  // Cache hit/miss flash effect: detect deltas in counts and pulse the panda
  useEffect(() => {
    if (!snap) return;
    const { cache_hits_5min: h, cache_misses_5min: m } = snap;
    if (seenCounts.hits === -1) {
      // First load — initialize without firing effects
      setSeenCounts({ hits: h, misses: m });
      return;
    }
    let trigger: "hit" | "miss" | null = null;
    if (h > seenCounts.hits) trigger = "hit";
    else if (m > seenCounts.misses) trigger = "miss";
    if (trigger) {
      setFlash(trigger);
      const t = setTimeout(() => setFlash(null), 900);
      setSeenCounts({ hits: h, misses: m });
      return () => clearTimeout(t);
    }
    setSeenCounts({ hits: h, misses: m });
  }, [snap?.cache_hits_5min, snap?.cache_misses_5min]);

  // Idle micro-actions
  useEffect(() => {
    if (d.petState !== "idle") {
      setIdleAction("none");
      return;
    }
    let cancelled = false;
    let actionTimeout: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      const wait = 6_000 + Math.random() * 6_000; // 6~12s between actions
      actionTimeout = setTimeout(() => {
        if (cancelled) return;
        const pick = IDLE_ACTIONS[Math.floor(Math.random() * IDLE_ACTIONS.length)];
        setIdleAction(pick.name);
        actionTimeout = setTimeout(() => {
          if (cancelled) return;
          setIdleAction("none");
          schedule();
        }, pick.durationMs);
      }, wait);
    };
    schedule();
    return () => {
      cancelled = true;
      if (actionTimeout) clearTimeout(actionTimeout);
    };
  }, [d.petState]);

  // Tray title — battery style: lowest remaining %
  useEffect(() => {
    const lowest = Math.min(d.fiveHourRemaining, d.weeklyRemaining);
    const emoji =
      d.petState === "dead" ? "💀" :
      d.petState === "sleep" ? "💤" :
      d.petState === "tired" ? "🪫" : "🔋";
    const title = `${emoji} ${Math.round(lowest * 100)}%`;
    invoke("set_tray_title", { title }).catch(() => {});
  }, [d.fiveHourRemaining, d.weeklyRemaining, d.petState]);

  // Threshold notifications (battery-style: low remaining triggers alert)
  useEffect(() => {
    if (!snap) return;
    for (const [t] of REMAINING_THRESHOLDS) {
      if (d.fiveHourRemaining <= t) {
        const pct = Math.round(d.fiveHourRemaining * 100);
        maybeNotify({
          key: `5h-${t}`,
          title: t === 0 ? `5시간 토큰 소진` : `5시간 토큰 ${pct}% 남음`,
          body:
            t === 0
              ? `5시간 윈도우가 리셋될 때까지 사용 불가입니다.`
              : `여유 있게 쓰려면 곧 속도를 늦춰주세요.`,
        });
      }
      if (d.weeklyRemaining <= t) {
        const pct = Math.round(d.weeklyRemaining * 100);
        maybeNotify({
          key: `weekly-${t}`,
          title: t === 0 ? `주간 토큰 소진` : `주간 토큰 ${pct}% 남음`,
          body:
            t === 0
              ? `주간 윈도우가 리셋될 때까지 사용 불가입니다.`
              : `이번 주 남은 토큰이 ${pct}% 입니다.`,
        });
      }
    }
    if (snap.last_request_at) {
      const elapsed = Date.parse(snap.now) - Date.parse(snap.last_request_at);
      if (elapsed > 5 * 3600_000) resetThreshold("5h-");
    }
  }, [d.fiveHourRemaining, d.weeklyRemaining, snap]);

  const skin = findSkin(config.skin);

  const showCache =
    d.cacheRemainMs !== null && !(snap?.is_thinking ?? false);

  return (
    <div className="pet-root">
      <div className="bubble-stack">
        {showCache && (
          <CacheBubble
            remainMs={d.cacheRemainMs!}
            nudge={d.cacheNudge}
            hits={snap!.cache_hits_5min}
            misses={snap!.cache_misses_5min}
            combo={snap!.current_combo}
          />
        )}
        {snap?.is_thinking && <ThinkingBubble />}
        {snap && (
          <UsageBubble
            fiveRemaining={d.fiveHourRemaining}
            weeklyRemaining={d.weeklyRemaining}
            fiveResetMs={d.fiveHourResetMs}
            weeklyResetMs={d.weeklyResetMs}
          />
        )}
      </div>

      <div
        className="character"
        data-state={d.petState}
        data-action={idleAction}
        data-flash={flash ?? ""}
        data-tauri-drag-region
      >
        <img
          src={
            idleAction === "doze"
              ? skin.frames.sleep
              : skin.frames[d.petState]
          }
          alt={d.petState}
          draggable={false}
          data-tauri-drag-region
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).style.opacity = "0";
          }}
        />
        <PlaceholderPanda state={d.petState} />
        {(idleAction === "bamboo" || idleAction === "scratch") && (
          <img
            className={`bamboo bamboo-${idleAction}`}
            src={ACCESSORIES.bamboo}
            alt=""
            draggable={false}
          />
        )}
        {idleAction === "shy" && <span className="action-emoji shy-emoji">💕</span>}
        {idleAction === "run" && <span className="action-emoji run-emoji">💨</span>}
        {idleAction === "jump" && <span className="action-emoji jump-emoji">!</span>}
        {idleAction === "doze" && <span className="action-emoji doze-emoji">z</span>}
        {flash && (
          <div className={`flash-overlay flash-${flash}`}>
            <span className="flash-mark">{flash === "hit" ? "✨" : "💨"}</span>
          </div>
        )}
      </div>

      {showSettings && (
        <Settings
          config={config}
          snap={snap}
          onClose={() => setShowSettings(false)}
          onSave={(c) => {
            onConfigChange(c);
            setShowSettings(false);
          }}
        />
      )}
    </div>
  );
}

function CacheBubble({
  remainMs,
  nudge,
  hits,
  misses,
  combo,
}: {
  remainMs: number;
  nudge: boolean;
  hits: number;
  misses: number;
  combo: number;
}) {
  const pct = Math.max(0, Math.min(1, remainMs / CACHE_TTL_MS));
  return (
    <div className={`bubble cache ${nudge ? "nudge" : ""}`}>
      <div className="bubble-row">
        <span className="bubble-time">{formatRemain(remainMs)}</span>
        <span className="bubble-label">캐시</span>
      </div>
      <div className="bubble-bar">
        <div className="bubble-fill" style={{ width: `${pct * 100}%` }} />
      </div>
      {(hits > 0 || misses > 0) && (
        <div className="bubble-stats">
          <span className="stat hit">✨{hits}</span>
          <span className="stat miss">💨{misses}</span>
          {combo >= 2 && <span className="stat combo">🔥×{combo}</span>}
        </div>
      )}
      {nudge && <div className="bubble-tip">. 이라도 눌러!</div>}
    </div>
  );
}

function ThinkingBubble() {
  return (
    <div className="bubble thinking">
      <span className="dots">
        <span/><span/><span/>
      </span>
      <span className="thinking-label">생각 중</span>
    </div>
  );
}

function UsageBubble({
  fiveRemaining,
  weeklyRemaining,
  fiveResetMs,
  weeklyResetMs,
}: {
  fiveRemaining: number;
  weeklyRemaining: number;
  fiveResetMs: number | null;
  weeklyResetMs: number | null;
}) {
  return (
    <div className="bubble usage">
      <div className="usage-row">
        <span className="usage-label">5h</span>
        <span className={`usage-pct ${toneOf(fiveRemaining)}`}>
          {pad(Math.round(fiveRemaining * 100))}%
        </span>
        <span className="usage-reset">
          {fiveResetMs !== null ? formatResetCountdown(fiveResetMs) : "—"}
        </span>
      </div>
      <div className="usage-row">
        <span className="usage-label">주간</span>
        <span className={`usage-pct ${toneOf(weeklyRemaining)}`}>
          {pad(Math.round(weeklyRemaining * 100))}%
        </span>
        <span className="usage-reset">
          {weeklyResetMs !== null ? formatResetCountdown(weeklyResetMs) : "—"}
        </span>
      </div>
    </div>
  );
}

function pad(n: number) {
  return n < 10 ? `  ${n}` : n < 100 ? ` ${n}` : `${n}`;
}

function toneOf(remaining: number) {
  if (remaining <= 0) return "danger";
  if (remaining <= 0.3) return "warn";
  return "ok";
}

function Settings({
  config,
  snap,
  onClose,
  onSave,
}: {
  config: PlanConfig;
  snap: UsageSnapshot | null;
  onClose: () => void;
  onSave: (c: PlanConfig) => void;
}) {
  const [plan, setPlan] = useState<PlanId>(config.plan);
  const [five, setFive] = useState(config.limits.fiveHour);
  const [week, setWeek] = useState(config.limits.weekly);
  const [skin, setSkin] = useState(config.skin);
  const [showCalibrate, setShowCalibrate] = useState(false);

  useEffect(() => {
    if (plan !== "custom") {
      setFive(PLAN_PRESETS[plan].fiveHour);
      setWeek(PLAN_PRESETS[plan].weekly);
    }
  }, [plan]);

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="settings" onClick={(e) => e.stopPropagation()}>
        <h2>설정</h2>
        <label>
          플랜
          <select value={plan} onChange={(e) => setPlan(e.target.value as PlanId)}>
            <option value="pro">Pro</option>
            <option value="max5x">Max 5×</option>
            <option value="max20x">Max 20×</option>
            <option value="custom">Custom</option>
          </select>
        </label>
        <label>
          5h 한도
          <input
            type="number"
            value={five}
            disabled={plan !== "custom"}
            onChange={(e) => setFive(Number(e.target.value))}
          />
        </label>
        <label>
          주간 한도
          <input
            type="number"
            value={week}
            disabled={plan !== "custom"}
            onChange={(e) => setWeek(Number(e.target.value))}
          />
        </label>
        <label>
          캐릭터
          <select value={skin} onChange={(e) => setSkin(e.target.value)}>
            {SKINS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>

        <button
          className="link"
          onClick={() => setShowCalibrate((v) => !v)}
          type="button"
        >
          {showCalibrate ? "캘리브레이션 닫기" : "캘리브레이션 도우미"}
        </button>

        {showCalibrate && (
          <Calibrator
            snap={snap}
            onApply={(fiveLimit, weekLimit) => {
              setPlan("custom");
              setFive(fiveLimit);
              setWeek(weekLimit);
            }}
          />
        )}

        <Diagnostics snap={snap} />

        <div className="settings-actions">
          <button onClick={onClose}>취소</button>
          <button
            className="primary"
            onClick={() =>
              onSave({
                plan,
                limits: { fiveHour: five, weekly: week },
                skin,
              })
            }
          >
            저장
          </button>
        </div>
      </div>
    </div>
  );
}

function Calibrator({
  snap,
  onApply,
}: {
  snap: UsageSnapshot | null;
  onApply: (fiveLimit: number, weekLimit: number) => void;
}) {
  const [fivePct, setFivePct] = useState<string>("");
  const [weekPct, setWeekPct] = useState<string>("");

  const fiveTokens = snap?.five_hour_tokens ?? 0;
  const weekTokens = snap?.weekly_tokens ?? 0;

  const compute = () => {
    const f = Number(fivePct);
    const w = Number(weekPct);
    if (!f || !w || f <= 0 || w <= 0 || f >= 100 || w >= 100) return;
    const fiveLimit = Math.round(fiveTokens / (f / 100));
    const weekLimit = Math.round(weekTokens / (w / 100));
    onApply(fiveLimit, weekLimit);
  };

  return (
    <div className="calibrator">
      <p className="calibrator-help">
        Claude UI에 표시된 사용 % 를 입력하면 한도를 역산합니다.
      </p>
      <div className="calibrator-row">
        <span>현재 5h 카운트</span>
        <code>{formatTokens(fiveTokens)}</code>
      </div>
      <div className="calibrator-row">
        <span>현재 주간 카운트</span>
        <code>{formatTokens(weekTokens)}</code>
      </div>
      <label>
        Claude UI의 5h 사용 %
        <input
          type="number"
          placeholder="예: 53"
          value={fivePct}
          onChange={(e) => setFivePct(e.target.value)}
        />
      </label>
      <label>
        Claude UI의 주간 사용 %
        <input
          type="number"
          placeholder="예: 39"
          value={weekPct}
          onChange={(e) => setWeekPct(e.target.value)}
        />
      </label>
      {(Number(fivePct) > 0 || Number(weekPct) > 0) && (
        <div className="calibrator-preview">
          저장 후 펫 표시:
          {Number(fivePct) > 0 && (
            <code>5h {100 - Number(fivePct)}% 남음</code>
          )}
          {Number(weekPct) > 0 && (
            <code>주간 {100 - Number(weekPct)}% 남음</code>
          )}
          <span className="calibrator-note">
            (배터리 스타일이라 100 − 사용% = 남은%로 표시됩니다)
          </span>
        </div>
      )}
      <button type="button" className="primary slim" onClick={compute}>
        한도 계산해서 Custom에 적용
      </button>
    </div>
  );
}

function Diagnostics({ snap }: { snap: UsageSnapshot | null }) {
  if (!snap) {
    return (
      <div className="diagnostics">
        <strong>진단</strong>
        <span>jsonl 데이터 없음</span>
      </div>
    );
  }
  const lastReq = snap.last_request_at
    ? new Date(snap.last_request_at).toLocaleTimeString()
    : "—";
  const lastUser = snap.last_user_prompt_at
    ? new Date(snap.last_user_prompt_at).toLocaleTimeString()
    : "—";
  const fiveStart = snap.five_hour_window_start
    ? new Date(snap.five_hour_window_start).toLocaleString()
    : "(없음 — 5h 윈도우 비활성)";
  return (
    <div className="diagnostics">
      <strong>진단</strong>
      <div className="diag-row"><span>5h 카운트</span><code>{formatTokens(snap.five_hour_tokens)}</code></div>
      <div className="diag-row"><span>주간 카운트</span><code>{formatTokens(snap.weekly_tokens)}</code></div>
      <div className="diag-row"><span>5h 윈도우 시작</span><code>{fiveStart}</code></div>
      <div className="diag-row"><span>마지막 응답</span><code>{lastReq}</code></div>
      <div className="diag-row"><span>마지막 사용자 프롬프트</span><code>{lastUser}</code></div>
      <div className="diag-row"><span>생각 중</span><code>{snap.is_thinking ? "yes" : "no"}</code></div>
      <div className="diag-row"><span>캐시 hit/miss</span><code>{snap.cache_hits_5min} / {snap.cache_misses_5min}</code></div>
    </div>
  );
}

function PlaceholderPanda({ state }: { state: string }) {
  return (
    <svg
      className="placeholder-panda"
      viewBox="0 0 100 100"
      data-state={state}
      aria-hidden
    >
      <ellipse cx="50" cy="60" rx="32" ry="28" fill="#fff" stroke="#000" strokeWidth="2" />
      <circle cx="30" cy="35" r="11" fill="#000" />
      <circle cx="70" cy="35" r="11" fill="#000" />
      <circle cx="50" cy="50" r="22" fill="#fff" stroke="#000" strokeWidth="2" />
      {state === "sleep" || state === "dead" ? (
        <>
          <path d="M36 50 q5 -3 10 0" stroke="#000" strokeWidth="2" fill="none" />
          <path d="M54 50 q5 -3 10 0" stroke="#000" strokeWidth="2" fill="none" />
        </>
      ) : (
        <>
          <circle cx="42" cy="50" r="3" fill="#000" />
          <circle cx="58" cy="50" r="3" fill="#000" />
        </>
      )}
      <ellipse cx="50" cy="60" rx="4" ry="3" fill="#000" />
      {state === "dead" && (
        <text x="50" y="80" fontSize="10" textAnchor="middle">×_×</text>
      )}
    </svg>
  );
}
