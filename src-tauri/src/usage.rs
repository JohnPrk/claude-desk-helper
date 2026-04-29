use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};
use std::fs::File;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use walkdir::WalkDir;

#[derive(Debug, Clone, Copy, Serialize)]
pub struct UsageEntry {
    pub timestamp: DateTime<Utc>,
    pub tokens: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct UsageSnapshot {
    pub five_hour_tokens: u64,
    pub weekly_tokens: u64,
    pub last_request_at: Option<DateTime<Utc>>,
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
    usage: Option<RawUsage>,
}

#[derive(Debug, Deserialize)]
struct RawUsage {
    input_tokens: Option<u64>,
    output_tokens: Option<u64>,
    cache_creation_input_tokens: Option<u64>,
    cache_read_input_tokens: Option<u64>,
}

pub fn claude_projects_dir() -> Option<PathBuf> {
    let home = dirs::home_dir()?;
    let p = home.join(".claude").join("projects");
    if p.exists() { Some(p) } else { None }
}

pub fn collect_entries_since(since: DateTime<Utc>) -> Vec<UsageEntry> {
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

fn scan_file(path: &Path, since: DateTime<Utc>, out: &mut Vec<UsageEntry>) {
    let Ok(file) = File::open(path) else { return };
    let reader = BufReader::new(file);
    for line in reader.lines().map_while(Result::ok) {
        if !line.contains("\"usage\"") {
            continue;
        }
        let Ok(raw) = serde_json::from_str::<RawLine>(&line) else {
            continue;
        };
        let Some(msg) = raw.message else { continue };
        if msg.role.as_deref() != Some("assistant") {
            continue;
        }
        let Some(u) = msg.usage else { continue };
        let Some(ts_str) = raw.timestamp else { continue };
        let Ok(ts) = DateTime::parse_from_rfc3339(&ts_str) else {
            continue;
        };
        let ts = ts.with_timezone(&Utc);
        if ts < since {
            continue;
        }
        let tokens = u.input_tokens.unwrap_or(0)
            + u.output_tokens.unwrap_or(0)
            + u.cache_creation_input_tokens.unwrap_or(0)
            + u.cache_read_input_tokens.unwrap_or(0);
        if tokens == 0 {
            continue;
        }
        out.push(UsageEntry { timestamp: ts, tokens });
    }
}

pub fn snapshot() -> UsageSnapshot {
    let now = Utc::now();
    let week_start = now - Duration::days(7);
    let entries = collect_entries_since(week_start);
    let five_hour_cut = now - Duration::hours(5);

    let mut weekly: u64 = 0;
    let mut five_hour: u64 = 0;
    let mut last: Option<DateTime<Utc>> = None;
    for e in &entries {
        weekly = weekly.saturating_add(e.tokens);
        if e.timestamp >= five_hour_cut {
            five_hour = five_hour.saturating_add(e.tokens);
        }
        last = Some(match last {
            Some(prev) if prev > e.timestamp => prev,
            _ => e.timestamp,
        });
    }
    UsageSnapshot {
        five_hour_tokens: five_hour,
        weekly_tokens: weekly,
        last_request_at: last,
        now,
    }
}
