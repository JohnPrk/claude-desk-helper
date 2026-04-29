import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { PlanConfig, PlanId, UsageSnapshot } from "./types";
import { PLAN_PRESETS } from "./types";
import { loadPlanConfig, savePlanConfig } from "./store";
import { DEFAULT_SKIN_ID, SKINS, findSkin } from "./skins";
import {
  CACHE_TTL_MS,
  derive,
  formatRemain,
  formatTokens,
} from "./petLogic";
import { maybeNotify, resetThreshold } from "./notifier";
import "./App.css";

const THRESHOLDS: Array<[number, string]> = [
  [0.7, "70%"],
  [0.9, "90%"],
  [1.0, "100%"],
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
  const [customFive, setCustomFive] = useState(1_000_000);
  const [customWeek, setCustomWeek] = useState(7_000_000);

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
      <p className="sub">너의 토큰을 알려줘.</p>

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
        한도는 추정치입니다. 설정에서 언제든 바꿀 수 있어요.
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

  // Update tray title with current usage
  useEffect(() => {
    const worst = Math.max(d.fiveHourPct, d.weeklyPct);
    const emoji =
      d.petState === "dead" ? "💀" :
      d.petState === "sleep" ? "💤" :
      d.petState === "tired" ? "😓" : "🐼";
    const title = `${emoji} ${Math.round(worst * 100)}%`;
    invoke("set_tray_title", { title }).catch(() => {});
  }, [d.fiveHourPct, d.weeklyPct, d.petState]);

  // Threshold notifications
  useEffect(() => {
    if (!snap) return;
    for (const [t, label] of THRESHOLDS) {
      if (d.fiveHourPct >= t) {
        maybeNotify({
          key: `5h-${t}`,
          title: `5시간 토큰 ${label} 도달`,
          body: `${formatTokens(snap.five_hour_tokens)} / ${formatTokens(config.limits.fiveHour)} 사용`,
        });
      }
      if (d.weeklyPct >= t) {
        maybeNotify({
          key: `weekly-${t}`,
          title: `주간 토큰 ${label} 도달`,
          body: `${formatTokens(snap.weekly_tokens)} / ${formatTokens(config.limits.weekly)} 사용`,
        });
      }
    }
    // Reset notification dedupe when window rolls over (≥1h since last request)
    if (snap.last_request_at) {
      const elapsed = Date.parse(snap.now) - Date.parse(snap.last_request_at);
      if (elapsed > 5 * 3600_000) resetThreshold("5h-");
    }
  }, [d.fiveHourPct, d.weeklyPct, snap, config.limits]);

  const skin = findSkin(config.skin);

  return (
    <div className="pet-root">
      <div className="cache-bubble-wrap">
        {d.cacheRemainMs !== null && (
          <CacheBubble remainMs={d.cacheRemainMs} nudge={d.cacheNudge} />
        )}
      </div>

      <div
        className="character"
        data-state={d.petState}
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
      </div>

      <div className="gauges">
        <Gauge
          label="5h"
          pct={d.fiveHourPct}
          tokens={snap?.five_hour_tokens ?? 0}
          limit={config.limits.fiveHour}
        />
        <Gauge
          label="주간"
          pct={d.weeklyPct}
          tokens={snap?.weekly_tokens ?? 0}
          limit={config.limits.weekly}
        />
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
    <div className={`bubble ${nudge ? "nudge" : ""}`}>
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

function Gauge({
  label,
  pct,
  tokens,
  limit,
}: {
  label: string;
  pct: number;
  tokens: number;
  limit: number;
}) {
  const tone = pct >= 1 ? "danger" : pct >= 0.7 ? "warn" : "ok";
  return (
    <div className={`gauge ${tone}`}>
      <div className="gauge-head">
        <span className="gauge-label">{label}</span>
        <span className="gauge-num">{Math.round(pct * 100)}%</span>
      </div>
      <div className="gauge-bar">
        <div className="gauge-fill" style={{ width: `${Math.min(1, pct) * 100}%` }} />
      </div>
      <div className="gauge-foot">
        {formatTokens(tokens)} / {formatTokens(limit)}
      </div>
    </div>
  );
}

function Settings({
  config,
  onClose,
  onSave,
}: {
  config: PlanConfig;
  onClose: () => void;
  onSave: (c: PlanConfig) => void;
}) {
  const [plan, setPlan] = useState<PlanId>(config.plan);
  const [five, setFive] = useState(config.limits.fiveHour);
  const [week, setWeek] = useState(config.limits.weekly);
  const [skin, setSkin] = useState(config.skin);

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
