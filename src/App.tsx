import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { PlanConfig, PlanId, UsageSnapshot } from "./types";
import { PLAN_PRESETS } from "./types";
import { loadPlanConfig, savePlanConfig } from "./store";
import { ACCESSORIES, DEFAULT_SKIN_ID, SKINS, findSkin } from "./skins";
import {
  CACHE_TTL_MS,
  derive,
  formatRemain,
  formatTokens,
} from "./petLogic";
import { maybeNotify, resetThreshold } from "./notifier";
import "./App.css";

type IdleAction = "none" | "roll" | "bamboo";

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

  useEffect(() => {
    invoke<UsageSnapshot>("get_usage_snapshot").then(setSnap).catch(() => {});
    const unlistenP = listen<UsageSnapshot>("usage-update", (e) =>
      setSnap(e.payload),
    );
    const tick = setInterval(() => setNow(Date.now()), 500);
    return () => {
      clearInterval(tick);
      unlistenP.then((fn) => fn());
    };
  }, []);

  const d = useMemo(() => derive(snap, config.limits, now), [snap, config, now]);

  // Idle micro-actions
  useEffect(() => {
    if (d.petState !== "idle") {
      setIdleAction("none");
      return;
    }
    let cancelled = false;
    let actionTimeout: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      const wait = 12_000 + Math.random() * 10_000;
      actionTimeout = setTimeout(() => {
        if (cancelled) return;
        const next: IdleAction = Math.random() < 0.55 ? "bamboo" : "roll";
        setIdleAction(next);
        const dur = next === "bamboo" ? 4500 : 1600;
        actionTimeout = setTimeout(() => {
          if (cancelled) return;
          setIdleAction("none");
          schedule();
        }, dur);
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

  return (
    <div className="pet-root">
      <div className="bubble-stack">
        {d.cacheRemainMs !== null && (
          <CacheBubble remainMs={d.cacheRemainMs} nudge={d.cacheNudge} />
        )}
        {snap && (
          <UsageBubble
            fiveRemaining={d.fiveHourRemaining}
            weeklyRemaining={d.weeklyRemaining}
          />
        )}
      </div>

      <div
        className="character"
        data-state={d.petState}
        data-action={idleAction}
        data-tauri-drag-region
      >
        <img
          src={skin.frames[d.petState]}
          alt={d.petState}
          draggable={false}
          data-tauri-drag-region
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).style.opacity = "0";
          }}
        />
        <PlaceholderPanda state={d.petState} />
        {idleAction === "bamboo" && (
          <img className="bamboo" src={ACCESSORIES.bamboo} alt="" draggable={false} />
        )}
      </div>

      <button
        className="gear"
        onClick={() => setShowSettings(true)}
        title="설정"
      >
        ⚙
      </button>
      <button
        className="close"
        onClick={() => getCurrentWindow().close()}
        title="닫기"
      >
        ×
      </button>

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

function CacheBubble({ remainMs, nudge }: { remainMs: number; nudge: boolean }) {
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
      {nudge && <div className="bubble-tip">. 이라도 눌러!</div>}
    </div>
  );
}

function UsageBubble({
  fiveRemaining,
  weeklyRemaining,
}: {
  fiveRemaining: number;
  weeklyRemaining: number;
}) {
  return (
    <div className="bubble usage">
      <div className="usage-row">
        <span className="usage-label">5h</span>
        <span className={`usage-pct ${toneOf(fiveRemaining)}`}>
          {Math.round(fiveRemaining * 100)}%
        </span>
      </div>
      <div className="usage-row">
        <span className="usage-label">주간</span>
        <span className={`usage-pct ${toneOf(weeklyRemaining)}`}>
          {Math.round(weeklyRemaining * 100)}%
        </span>
      </div>
    </div>
  );
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
          placeholder="예: 30"
          value={fivePct}
          onChange={(e) => setFivePct(e.target.value)}
        />
      </label>
      <label>
        Claude UI의 주간 사용 %
        <input
          type="number"
          placeholder="예: 36"
          value={weekPct}
          onChange={(e) => setWeekPct(e.target.value)}
        />
      </label>
      <button type="button" className="primary slim" onClick={compute}>
        한도 계산해서 Custom에 적용
      </button>
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
