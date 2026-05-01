import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { ApiConfig, PlanConfig, PlanId, UsageSnapshot } from "./types";
import { PLAN_PRESETS } from "./types";
import {
  loadApiConfig,
  loadPlanConfig,
  saveApiConfig,
  savePlanConfig,
} from "./store";
import { ACCESSORIES, DEFAULT_SKIN_ID, SKINS, findSkin, type ActionName } from "./skins";
import {
  CACHE_TTL_MS,
  derive,
  formatRemain,
  formatResetCountdown,
  formatTokens,
} from "./petLogic";
import { maybeNotify, resetThreshold } from "./notifier";
import "./App.css";

// Action set + wait gap, conditioned on the panda's current energy tier.
// Energetic actions only happen at upper tiers; sluggish ones at lower.
function allowedActionsFor(state: string) {
  const energetic = new Set(["roll", "jump", "spin", "run", "front-roll", "exercise", "wave"]);
  const calm = new Set(["bamboo", "eat-fruit", "scratch", "shy", "wave"]);
  const sluggish = new Set(["doze", "lying", "scratch", "shy"]);

  let names: Set<string>;
  switch (state) {
    case "full":
    case "high":
    case "good":
      names = new Set([...energetic, ...calm]);
      break;
    case "mid":
      names = new Set([...calm, "spin", "wave"]);
      break;
    case "low":
    case "tired":
    case "sleepy":
      names = sluggish;
      break;
    default:
      return [];
  }
  return IDLE_ACTIONS.filter((a) => names.has(a.name));
}

// Wait between actions, by tier — peppier states act more often.
function waitMsFor(state: string): [number, number] {
  switch (state) {
    case "full":
    case "high":
      return [4_500, 5_500];      // ~5-10s
    case "good":
      return [6_000, 6_000];      // ~6-12s
    case "mid":
      return [9_000, 7_000];      // ~9-16s
    case "low":
    case "tired":
      return [13_000, 9_000];     // ~13-22s
    case "sleepy":
      return [18_000, 12_000];    // ~18-30s
    default:
      return [10_000, 10_000];
  }
}

type IdleAction =
  | "none"
  | "roll"
  | "bamboo"
  | "jump"
  | "spin"
  | "run"
  | "shy"
  | "doze"
  | "scratch"
  | "wave"
  | "lying"
  | "front-roll"
  | "eat-fruit"
  | "exercise";

const IDLE_ACTIONS: ReadonlyArray<{ name: Exclude<IdleAction, "none">; durationMs: number }> = [
  // Existing
  { name: "roll", durationMs: 1600 },
  { name: "bamboo", durationMs: 4500 },
  { name: "jump", durationMs: 1200 },
  { name: "spin", durationMs: 1800 },
  { name: "run", durationMs: 2500 },
  { name: "shy", durationMs: 2800 },
  { name: "doze", durationMs: 3800 },
  { name: "scratch", durationMs: 3000 },
  // New
  { name: "wave", durationMs: 2000 },        // 인사 (앞발 들기)
  { name: "lying", durationMs: 4000 },        // 누워서 뒹굴뒹굴
  { name: "front-roll", durationMs: 1400 },   // 앞구르기
  { name: "eat-fruit", durationMs: 4000 },    // 사과 먹기
  { name: "exercise", durationMs: 3200 },     // 운동
];

// Battery-style: notify when remaining drops to these thresholds.
const REMAINING_THRESHOLDS: Array<[number, string]> = [
  [0.3, "30%"],
  [0.1, "10%"],
  [0.0, "0%"],
];

type View = "loading" | "onboarding" | "pet";

// Two windows share this bundle: the pinned panel ("main") and the
// settings popup ("settings"). The popup is launched with ?view=settings
// so we can branch the React tree at the top.
function isSettingsWindow(): boolean {
  return new URLSearchParams(window.location.search).get("view") === "settings";
}

export default function App() {
  if (isSettingsWindow()) {
    return <SettingsApp />;
  }
  return <PetApp />;
}

function PetApp() {
  const [view, setView] = useState<View>("loading");
  const [config, setConfig] = useState<PlanConfig | null>(null);

  useEffect(() => {
    Promise.all([loadPlanConfig(), loadApiConfig()]).then(([cfg, api]) => {
      if (api) {
        invoke("set_api_config", { orgId: api.orgId, cookie: api.cookie }).catch(
          () => {},
        );
      }
      if (cfg) {
        setConfig(cfg);
        setView("pet");
      } else {
        setView("onboarding");
      }
    });
  }, []);

  // The standalone settings window emits `config-changed` after every
  // save. Reload the plan from the shared store so the pet picks up the
  // new skin/limits without restarting. The api config is already pushed
  // to the Rust side directly by the settings window via set_api_config,
  // so we don't need to mirror it in pet React state.
  useEffect(() => {
    const un = listen("config-changed", async () => {
      const cfg = await loadPlanConfig();
      if (cfg) setConfig(cfg);
    });
    return () => {
      un.then((fn) => fn());
    };
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
  return <Pet config={config!} />;
}

// The settings popup is its own ordinary, decorated window. No panel
// pinning, no level juggling — text inputs work normally. It loads the
// shared config store, lets the user edit, and broadcasts
// `config-changed` so the pet window can re-read.
function SettingsApp() {
  const [config, setConfig] = useState<PlanConfig | null>(null);
  const [apiConfig, setApiConfig] = useState<ApiConfig | null>(null);
  const [snap, setSnap] = useState<UsageSnapshot | null>(null);

  useEffect(() => {
    Promise.all([
      loadPlanConfig(),
      loadApiConfig(),
      invoke<UsageSnapshot>("get_usage_snapshot").catch(() => null),
    ]).then(([cfg, api, s]) => {
      setConfig(cfg);
      setApiConfig(api);
      if (s) setSnap(s);
    });
    const un = listen<UsageSnapshot>("usage-update", (e) => setSnap(e.payload));
    return () => {
      un.then((fn) => fn());
    };
  }, []);

  if (!config) return null;

  const closeSelf = async () => {
    try {
      await getCurrentWindow().close();
    } catch {
      // best-effort
    }
  };

  return (
    <div className="settings-window">
      <Settings
        config={config}
        apiConfig={apiConfig}
        snap={snap}
        onClose={closeSelf}
        onSave={async (c) => {
          await savePlanConfig(c);
          setConfig(c);
          await emit("config-changed");
          await closeSelf();
        }}
        onApiSave={async (a) => {
          await saveApiConfig(a);
          await invoke("set_api_config", {
            orgId: a?.orgId ?? null,
            cookie: a?.cookie ?? null,
          }).catch(() => {});
          setApiConfig(a);
          await emit("config-changed");
        }}
      />
    </div>
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
}: {
  config: PlanConfig;
}) {
  const [snap, setSnap] = useState<UsageSnapshot | null>(null);
  const [now, setNow] = useState(Date.now());
  const [idleAction, setIdleAction] = useState<IdleAction>("none");
  const [flash, setFlash] = useState<"hit" | "miss" | null>(null);
  const [seenCounts, setSeenCounts] = useState({ hits: -1, misses: -1 });
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    invoke<UsageSnapshot>("get_usage_snapshot").then(setSnap).catch(() => {});
    const unlistenP = listen<UsageSnapshot>("usage-update", (e) =>
      setSnap(e.payload),
    );
    // Fallback for any old code path that emits show-settings: route to
    // the new standalone window instead of opening an in-panel overlay.
    const unlistenSettings = listen("show-settings", () => {
      invoke("open_settings_window").catch(() => {});
    });
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

  // Idle micro-actions: filtered by current energy tier so a sleepy panda
  // doesn't spontaneously start exercising. sleep/dead never trigger any.
  useEffect(() => {
    if (d.petState === "dead") {
      setIdleAction("none");
      return;
    }
    const allowed = allowedActionsFor(d.petState);
    if (allowed.length === 0) {
      setIdleAction("none");
      return;
    }
    let cancelled = false;
    let actionTimeout: ReturnType<typeof setTimeout> | undefined;
    const tierGap = waitMsFor(d.petState);
    const schedule = () => {
      const wait = tierGap[0] + Math.random() * tierGap[1];
      actionTimeout = setTimeout(() => {
        if (cancelled) return;
        const pick = allowed[Math.floor(Math.random() * allowed.length)];
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

  // Tray title — battery style, always based on the 5h window so the
  // menubar % matches the "5h" row in the bubble. Weekly is reflected in
  // the pet state (dead) but not in the headline number.
  useEffect(() => {
    const remaining = d.fiveHourRemaining;
    const emoji =
      d.petState === "dead" ? "💀" :
      remaining <= 0.15 ? "😴" :
      remaining <= 0.49 ? "🪫" :
      "🔋";
    const title = `${emoji} ${Math.round(remaining * 100)}%`;
    invoke("set_tray_title", { title }).catch(() => {});
  }, [d.fiveHourRemaining, d.petState]);

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

  // Prefer a motion gif for the current action if the skin provides one.
  // The static frame always tracks the current pet state (energy tier) —
  // idle actions overlay CSS animation only, never swap to a different
  // tier's PNG, so the panda never visually jumps tier mid-action.
  const characterSrc = (() => {
    if (idleAction !== "none") {
      const gif = skin.actions?.[idleAction as ActionName];
      if (gif) return gif;
    }
    return skin.frames[d.petState];
  })();

  // Track image-load failure as React state instead of mutating inline
  // styles in onError. The previous approach set opacity:0 on error and
  // never restored it, so a single transient load failure (e.g. during
  // re-render after a click on the tauri drag region) made the panda
  // disappear permanently. Resetting on src change keeps it self-healing.
  const [imgFailed, setImgFailed] = useState(false);
  useEffect(() => {
    setImgFailed(false);
  }, [characterSrc]);

  const showCache =
    d.cacheRemainMs !== null && !(snap?.is_thinking ?? false);

  // Drag uses Tauri's native data-tauri-drag-region — macOS handles
  // click-vs-drag at the OS layer. Manual refresh is now exclusively a
  // right-click on the panda (or the tray menu's "지금 새로고침").
  const triggerRefresh = () => {
    setRefreshing(true);
    invoke("refresh_usage").catch(() => {});
    window.setTimeout(() => setRefreshing(false), 700);
  };

  return (
    <div className="pet-root">
      <div className="bubble-stack" data-tauri-drag-region>
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
        data-refreshing={refreshing ? "true" : ""}
        data-tauri-drag-region
        onContextMenu={(e) => {
          // Right-click on the panda = manual refresh. preventDefault
          // suppresses any browser/webview context menu so only the
          // refresh ping is visible.
          e.preventDefault();
          triggerRefresh();
        }}
      >
        <img
          src={characterSrc}
          alt={d.petState}
          draggable={false}
          style={imgFailed ? { opacity: 0 } : undefined}
          onError={() => setImgFailed(true)}
          onLoad={() => setImgFailed(false)}
        />
        {(idleAction === "bamboo" || idleAction === "scratch") && (
          <img
            className={`bamboo bamboo-${idleAction}`}
            src={ACCESSORIES.bamboo}
            alt=""
            draggable={false}
          />
        )}
        {idleAction === "eat-fruit" && (
          <img className="bamboo bamboo-eat-fruit" src={ACCESSORIES.apple} alt="" draggable={false} />
        )}
        {idleAction === "exercise" && (
          <img className="bamboo bamboo-exercise" src={ACCESSORIES.dumbbell} alt="" draggable={false} />
        )}
        {idleAction === "shy" && <span className="action-emoji shy-emoji">💕</span>}
        {idleAction === "run" && <span className="action-emoji run-emoji">💨</span>}
        {idleAction === "jump" && <span className="action-emoji jump-emoji">!</span>}
        {idleAction === "doze" && <span className="action-emoji doze-emoji">z</span>}
        {idleAction === "wave" && <span className="action-emoji wave-emoji">👋</span>}
        {idleAction === "exercise" && <span className="action-emoji exercise-emoji">💪</span>}
        {flash && (
          <div className={`flash-overlay flash-${flash}`}>
            <span className="flash-mark">{flash === "hit" ? "✨" : "💨"}</span>
          </div>
        )}
      </div>
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
    <div className={`bubble cache ${nudge ? "nudge" : ""}`} data-tauri-drag-region>
      <div className="bubble-row" data-tauri-drag-region>
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
    <div className="bubble thinking" data-tauri-drag-region>
      <span className="dots" data-tauri-drag-region>
        <span/><span/><span/>
      </span>
      <span className="thinking-label" data-tauri-drag-region>생각 중</span>
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
    <div className="bubble usage" data-tauri-drag-region>
      <div className="usage-row" data-tauri-drag-region>
        <span className="usage-label" data-tauri-drag-region>5h</span>
        <span
          className={`usage-pct ${toneOf(fiveRemaining)}`}
          data-tauri-drag-region
        >
          {pad(Math.round(fiveRemaining * 100))}%
        </span>
        <span className="usage-reset" data-tauri-drag-region>
          {fiveResetMs !== null ? formatResetCountdown(fiveResetMs) : "—"}
        </span>
      </div>
      <div className="usage-row" data-tauri-drag-region>
        <span className="usage-label" data-tauri-drag-region>주간</span>
        <span
          className={`usage-pct ${toneOf(weeklyRemaining)}`}
          data-tauri-drag-region
        >
          {pad(Math.round(weeklyRemaining * 100))}%
        </span>
        <span className="usage-reset" data-tauri-drag-region>
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
  apiConfig,
  snap,
  onClose,
  onSave,
  onApiSave,
}: {
  config: PlanConfig;
  apiConfig: ApiConfig | null;
  snap: UsageSnapshot | null;
  onClose: () => void;
  onSave: (c: PlanConfig) => void;
  onApiSave: (a: ApiConfig | null) => void;
}) {
  const [skin, setSkin] = useState(config.skin);
  const apiActive = !!snap?.api && Date.now() - Date.parse(snap.api.fetched_at) < 2 * 60 * 1000;

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="settings" onClick={(e) => e.stopPropagation()}>
        <h2>설정</h2>
        <div className="skin-picker">
          <span className="skin-picker-label">캐릭터</span>
          <div className="skin-grid">
            {SKINS.map((s) => (
              <button
                type="button"
                key={s.id}
                className={`skin-tile ${skin === s.id ? "selected" : ""}`}
                onClick={() => setSkin(s.id)}
                title={s.name}
              >
                <img src={s.frames.good} alt={s.name} />
                <span>{s.name}</span>
              </button>
            ))}
          </div>
        </div>

        <ApiSection
          apiConfig={apiConfig}
          apiActive={apiActive}
          apiError={snap?.api_error ?? null}
          onSave={onApiSave}
        />

        <div className="settings-actions">
          <button onClick={onClose}>취소</button>
          <button
            className="primary"
            onClick={() =>
              onSave({
                plan: config.plan,
                limits: config.limits,
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

function ApiSection({
  apiConfig,
  apiActive,
  apiError,
  onSave,
}: {
  apiConfig: ApiConfig | null;
  apiActive: boolean;
  apiError: string | null;
  onSave: (a: ApiConfig | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [orgId, setOrgId] = useState(apiConfig?.orgId ?? "");
  const [cookie, setCookie] = useState(apiConfig?.cookie ?? "");
  const [testStatus, setTestStatus] = useState<string>("");
  const [showHelp, setShowHelp] = useState(false);

  const test = async () => {
    setTestStatus("테스트 중...");
    try {
      const res = await invoke<{ five_hour_pct: number; weekly_pct: number }>(
        "test_api_config",
        { orgId: orgId.trim(), cookie: cookie.trim() },
      );
      setTestStatus(
        `✓ 5h ${res.five_hour_pct.toFixed(0)}%, 주간 ${res.weekly_pct.toFixed(0)}%`,
      );
    } catch (e: unknown) {
      setTestStatus(`✗ ${String(e)}`);
    }
  };

  return (
    <div className="api-section">
      <div className="api-section-head">
        <button
          className="link"
          type="button"
          onClick={() => setOpen((v) => !v)}
        >
          {open ? "API 연동 닫기" : "API 연동"}
        </button>
        <button
          type="button"
          className="help-bell-btn"
          onClick={() => setShowHelp((v) => !v)}
          aria-label="API 연동 설명 보기"
          title="어떻게 연결되는지 보기"
        >
          <span className="bell-icon" aria-hidden="true">🔔</span>
          <span className="bell-text">어떻게 연결되나요?</span>
        </button>
      </div>
      {showHelp && (
        <div className="api-help-popup" role="note">
          <div className="cookie-flow" aria-hidden="true">
            <div className="cookie-flow-step">
              <span className="cookie-flow-icon">🌐</span>
              <span className="cookie-flow-label">claude.ai</span>
            </div>
            <span className="cookie-flow-arrow">→</span>
            <div className="cookie-flow-step">
              <span className="cookie-flow-icon">🍪</span>
              <span className="cookie-flow-label">쿠키 5개</span>
            </div>
            <span className="cookie-flow-arrow">→</span>
            <div className="cookie-flow-step">
              <span className="cookie-flow-icon">🐼</span>
              <span className="cookie-flow-label">이 앱</span>
            </div>
          </div>
          <p>
            <strong>로컬에서만 동작</strong>해요. 입력한 Org ID와 쿠키는 이 컴퓨터에만 저장되고,
            앱이 직접 <code>claude.ai/api/.../usage</code>를 30초마다 조회해 사용량을 가져옵니다.
            외부 서버로 전송하지 않아요.
          </p>
          <p>
            쿠키가 만료되거나 무효해지면 (HTTP 401·403·404) 다음 폴링에서 감지해
            <strong> 이 설정 창이 자동으로 다시 열립니다.</strong> 그때 claude.ai에서 새 쿠키를 복사해 붙여넣으면 돼요.
          </p>
          <p>
            쿠키는 claude.ai/settings/usage의 개발자도구 → Network → <code>usage</code> 요청 →
            Request Headers의 <code>cookie</code> 줄 전체를 그대로 붙여넣으면 됩니다.
            필요한 키 5개(<code>sessionKey</code>, <code>cf_clearance</code>, <code>__cf_bm</code>, <code>_cfuvid</code>, <code>routingHint</code>)만 사용하고 나머지는 무시돼요.
          </p>
        </div>
      )}
      {apiActive && !open && (
        <p className="api-note ok">
          ✓ Anthropic API에서 실시간 사용량을 받고 있어요.
        </p>
      )}
      {apiError && !open && (
        <p className="api-note err">⚠ API 오류: {apiError}</p>
      )}
      {open && (
        <div className="api-form">
          <label>
            Organization ID
            <input
              type="text"
              placeholder="63e058d5-142c-4368-bca3-39d64d78b4f5"
              value={orgId}
              onChange={(e) => setOrgId(e.target.value)}
              spellCheck={false}
            />
          </label>
          <label>
            세션 쿠키 (5개만)
            <textarea
              placeholder="sessionKey=sk-ant-sid02-...; cf_clearance=...; __cf_bm=...; _cfuvid=...; routingHint=[sk-ant-rh-...]"
              value={cookie}
              onChange={(e) => setCookie(e.target.value)}
              rows={4}
              spellCheck={false}
            />
          </label>
          <div className="api-actions">
            <button type="button" onClick={test}>
              테스트
            </button>
            <button
              type="button"
              className="primary slim"
              onClick={() => {
                if (orgId.trim() && cookie.trim()) {
                  onSave({ orgId: orgId.trim(), cookie: cookie.trim() });
                  setTestStatus("저장됨");
                }
              }}
            >
              저장
            </button>
            {apiConfig && (
              <button
                type="button"
                onClick={() => {
                  onSave(null);
                  setOrgId("");
                  setCookie("");
                  setTestStatus("연동 해제됨");
                }}
              >
                연동 해제
              </button>
            )}
          </div>
          {testStatus && <p className="api-status">{testStatus}</p>}
        </div>
      )}
    </div>
  );
}

