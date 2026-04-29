use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};
use std::fs::File;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use walkdir::WalkDir;

const FIVE_HOUR_GAP_THRESHOLD: i64 = 5 * 3600;
const WEEKLY_LOOKBACK_DAYS: i64 = 7;
const CACHE_WINDOW_MS: i64 = 5 * 60 * 1000;

#[derive(Debug, Clone, Serialize)]
pub struct UsageSnapshot {
    pub five_hour_tokens: u64,
    pub weekly_tokens: u64,
    /// Most recent assistant message timestamp (used for the 5min cache TTL).
    pub last_request_at: Option<DateTime<Utc>>,
    /// Latest "real" user prompt (NOT a tool_result follow-up). Used to detect
    /// when the user has just re-prompted Claude.
    pub last_user_prompt_at: Option<DateTime<Utc>>,
    /// True when the latest real user prompt is newer than the latest
    /// assistant message — i.e. Claude is currently "thinking".
    pub is_thinking: bool,
    pub five_hour_window_start: Option<DateTime<Utc>>,
    pub five_hour_resets_at: Option<DateTime<Utc>>,
    pub weekly_window_start: Option<DateTime<Utc>>,
    pub weekly_resets_at: Option<DateTime<Utc>>,
    /// Cache hits (cache_read_input_tokens > 0) in the last 5 minutes.
    pub cache_hits_5min: u32,
    /// Cache misses (cache_read_input_tokens == 0) in the last 5 minutes.
    pub cache_misses_5min: u32,
    /// Consecutive cache hits ending at the most recent assistant message.
    /// Resets to 0 the moment a miss interrupts the streak.
    pub current_combo: u32,
    pub now: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
struct RawLine {
    timestamp: Option<String>,
    message: Option<RawMessage>,
}

#[derive(Debug, Deserialize)]
struct RawMessage {
    role: Option<String>,
    content: Option<serde_json::Value>,
    usage: Option<RawUsage>,
}

#[derive(Debug, Deserialize)]
struct RawUsage {
    input_tokens: Option<u64>,
    output_tokens: Option<u64>,
    cache_creation_input_tokens: Option<u64>,
    cache_read_input_tokens: Option<u64>,
}

#[derive(Debug, Clone)]
struct ParsedEntry {
    timestamp: DateTime<Utc>,
    role: Role,
    /// For assistant entries only: tokens (input + output + cache_creation).
    tokens: u64,
    /// For assistant entries only: was the prompt cache hit?
    cache_hit: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Role {
    Assistant,
    UserPrompt,
    UserToolResult,
}

pub fn claude_projects_dir() -> Option<PathBuf> {
    let home = dirs::home_dir()?;
    let p = home.join(".claude").join("projects");
    if p.exists() { Some(p) } else { None }
}

fn collect_parsed_since(since: DateTime<Utc>) -> Vec<ParsedEntry> {
    let Some(root) = claude_projects_dir() else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for entry in WalkDir::new(&root)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_file())
        .filter(|e| e.path().extension().and_then(|x| x.to_str()) == Some("jsonl"))
    {
        if let Some(modified) = entry
            .metadata()
            .ok()
            .and_then(|m| m.modified().ok())
            .map(DateTime::<Utc>::from)
        {
            if modified < since - Duration::hours(1) {
                continue;
            }
        }
        scan_file(entry.path(), since, &mut out);
    }
    out.sort_by_key(|e| e.timestamp);
    out
}

fn scan_file(path: &Path, since: DateTime<Utc>, out: &mut Vec<ParsedEntry>) {
    let Ok(file) = File::open(path) else { return };
    let reader = BufReader::new(file);
    for line in reader.lines().map_while(Result::ok) {
        // Cheap pre-filter
        if !line.contains("\"timestamp\"") {
            continue;
        }
        let Ok(raw) = serde_json::from_str::<RawLine>(&line) else {
            continue;
        };
        let Some(msg) = raw.message else { continue };
        let Some(ts_str) = raw.timestamp else { continue };
        let Ok(ts) = DateTime::parse_from_rfc3339(&ts_str) else {
            continue;
        };
        let ts = ts.with_timezone(&Utc);
        if ts < since {
            continue;
        }
        let role = match msg.role.as_deref() {
            Some("assistant") => Role::Assistant,
            Some("user") => {
                if has_tool_result(msg.content.as_ref()) {
                    Role::UserToolResult
                } else {
                    Role::UserPrompt
                }
            }
            _ => continue,
        };

        let (tokens, cache_hit) = if role == Role::Assistant {
            if let Some(u) = msg.usage {
                let t = u.input_tokens.unwrap_or(0)
                    + u.output_tokens.unwrap_or(0)
                    + u.cache_creation_input_tokens.unwrap_or(0);
                let hit = u.cache_read_input_tokens.unwrap_or(0) > 0;
                (t, hit)
            } else {
                continue;
            }
        } else {
            (0, false)
        };

        out.push(ParsedEntry {
            timestamp: ts,
            role,
            tokens,
            cache_hit,
        });
    }
}

fn has_tool_result(content: Option<&serde_json::Value>) -> bool {
    let Some(content) = content else { return false };
    let Some(arr) = content.as_array() else { return false };
    for item in arr {
        if let Some(t) = item.get("type").and_then(|v| v.as_str()) {
            if t == "tool_result" {
                return true;
            }
        }
    }
    false
}

fn five_hour_window_start(
    assistant_entries: &[&ParsedEntry],
    now: DateTime<Utc>,
) -> Option<DateTime<Utc>> {
    if assistant_entries.is_empty() {
        return None;
    }
    let last = assistant_entries.last().unwrap();
    if (now - last.timestamp).num_seconds() >= FIVE_HOUR_GAP_THRESHOLD {
        return None;
    }
    for i in (1..assistant_entries.len()).rev() {
        let gap = (assistant_entries[i].timestamp - assistant_entries[i - 1].timestamp)
            .num_seconds();
        if gap >= FIVE_HOUR_GAP_THRESHOLD {
            return Some(assistant_entries[i].timestamp);
        }
    }
    Some(assistant_entries[0].timestamp)
}

pub fn snapshot() -> UsageSnapshot {
    let now = Utc::now();
    let lookback = now - Duration::days(WEEKLY_LOOKBACK_DAYS);
    let parsed = collect_parsed_since(lookback);

    let assistants: Vec<&ParsedEntry> =
        parsed.iter().filter(|e| e.role == Role::Assistant).collect();

    let five_start = five_hour_window_start(&assistants, now);
    let five_reset = five_start.map(|s| s + Duration::hours(5));

    let mut five_hour: u64 = 0;
    let mut weekly: u64 = 0;
    let mut weekly_first: Option<DateTime<Utc>> = None;
    let mut last_assistant_at: Option<DateTime<Utc>> = None;
    let mut last_user_prompt_at: Option<DateTime<Utc>> = None;

    let cache_window_start = now - Duration::milliseconds(CACHE_WINDOW_MS);
    let mut hits_5min: u32 = 0;
    let mut misses_5min: u32 = 0;

    for e in &parsed {
        match e.role {
            Role::Assistant => {
                weekly = weekly.saturating_add(e.tokens);
                if weekly_first.is_none() {
                    weekly_first = Some(e.timestamp);
                }
                if let Some(start) = five_start {
                    if e.timestamp >= start && e.timestamp <= now {
                        five_hour = five_hour.saturating_add(e.tokens);
                    }
                }
                last_assistant_at = Some(e.timestamp);
                if e.timestamp >= cache_window_start {
                    if e.cache_hit {
                        hits_5min = hits_5min.saturating_add(1);
                    } else {
                        misses_5min = misses_5min.saturating_add(1);
                    }
                }
            }
            Role::UserPrompt => {
                last_user_prompt_at = Some(e.timestamp);
            }
            Role::UserToolResult => {
                // ignored for thinking-state detection
            }
        }
    }

    // Combo: walk assistants backwards counting consecutive hits.
    let mut current_combo: u32 = 0;
    for a in assistants.iter().rev() {
        if a.cache_hit {
            current_combo += 1;
        } else {
            break;
        }
    }

    let weekly_reset = weekly_first.map(|s| s + Duration::days(WEEKLY_LOOKBACK_DAYS));

    let is_thinking = match (last_user_prompt_at, last_assistant_at) {
        (Some(u), Some(a)) => u > a,
        (Some(_), None) => true,
        _ => false,
    };

    UsageSnapshot {
        five_hour_tokens: five_hour,
        weekly_tokens: weekly,
        last_request_at: last_assistant_at,
        last_user_prompt_at,
        is_thinking,
        five_hour_window_start: five_start,
        five_hour_resets_at: five_reset,
        weekly_window_start: weekly_first,
        weekly_resets_at: weekly_reset,
        cache_hits_5min: hits_5min,
        cache_misses_5min: misses_5min,
        current_combo,
        now,
    }
}
