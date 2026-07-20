// Shared pieces used by the Food + Alcohol tabs:
//   - design tokens (T, display, inputStyle, arrowBtnStyle)
//   - date helpers
//   - SubTabs / DateBar / HistoryView / CalendarMonthView components
// Mirrors the visual pattern in WorkoutTracker.jsx (LOG / HISTORY / CALENDAR).

import { useState } from "react";

// ---------- Supabase helper (used by callers) ----------
export const SUPABASE_URL = "https://bbkxvbsutpvtuizonzsn.supabase.co";
export const SUPABASE_KEY = "sb_publishable__8dc2jqeQIClVXwpZQCSWA_Y5yaV1ao";

// Retry policy for transient network failures.
// iOS Safari (and the installed PWA) throws "Load failed" when fetch() itself
// errors — typically a network blip when the app wakes from background, DNS
// hiccup, or a dropped connection. These almost always recover on a quick retry.
// We do NOT retry HTTP errors (4xx/5xx) — those are real problems that need
// surfacing to the user (e.g. the nutrition_targets column being missing).
const SB_MAX_RETRIES = 2;
const SB_RETRY_DELAY_MS = [300, 800]; // backoff between attempts

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTransientNetworkError(err) {
  // Browsers throw a plain TypeError with messages like "Load failed",
  // "Failed to fetch", "NetworkError", or "The network connection was lost".
  if (!err) return false;
  if (err.name === "TypeError") return true;
  const msg = String(err.message || "").toLowerCase();
  return (
    msg.includes("load failed") ||
    msg.includes("failed to fetch") ||
    msg.includes("network") ||
    msg.includes("connection")
  );
}

export async function sb(path, options = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= SB_MAX_RETRIES; attempt++) {
    try {
      const r = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
        ...options,
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
          "Content-Type": "application/json",
          Prefer: "return=representation",
          ...(options.headers || {}),
        },
      });
      if (!r.ok) throw new Error(`Supabase ${r.status}: ${await r.text()}`);
      return r.status === 204 ? null : r.json();
    } catch (err) {
      lastErr = err;
      // Only retry on a transient network failure.
      if (!isTransientNetworkError(err) || attempt === SB_MAX_RETRIES) {
        throw err;
      }
      await wait(SB_RETRY_DELAY_MS[attempt] ?? 800);
    }
  }
  throw lastErr;
}

// Shared error banner with a Retry button.
// Use across tabs to give users an explicit recovery action when the data
// load fails (instead of a dead-end red banner).
export function ErrorBanner({ message, onRetry }) {
  if (!message) return null;
  return (
    <div
      style={{
        background: "#fee2e2",
        color: "#991b1b",
        padding: "10px 12px",
        borderRadius: "8px",
        marginBottom: "16px",
        fontSize: "13px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "10px",
      }}
    >
      <div style={{ flex: 1, minWidth: 0, wordBreak: "break-word" }}>{message}</div>
      {onRetry && (
        <button
          onClick={onRetry}
          style={{
            background: "#fff",
            color: "#991b1b",
            border: "1px solid #fca5a5",
            borderRadius: "6px",
            padding: "6px 12px",
            fontSize: "12px",
            fontWeight: 700,
            letterSpacing: "0.05em",
            cursor: "pointer",
            fontFamily: "inherit",
            flexShrink: 0,
          }}
        >
          RETRY
        </button>
      )}
    </div>
  );
}

// ---------- Design tokens ----------
export const T = {
  bg: "#f8fafc",
  surface: "#ffffff",
  surface2: "#f1f5f9",
  border: "#e2e8f0",
  border2: "#cbd5e1",
  text: "#0f172a",
  textSub: "#475569",
  textMuted: "#94a3b8",
  accent: "#ea580c",
  ok: "#16a34a",
  amber: "#f59e0b",
  warn: "#dc2626",
};

export const display = {
  fontFamily: "'Bebas Neue', sans-serif",
  letterSpacing: "0.04em",
  color: T.text,
  lineHeight: 1,
};

export const inputStyle = {
  background: T.surface,
  border: `1px solid ${T.border2}`,
  borderRadius: "8px",
  color: T.text,
  padding: "8px 10px",
  fontSize: "13px",
  fontFamily: "inherit",
  outline: "none",
  boxSizing: "border-box",
};

export const arrowBtnStyle = {
  width: "36px",
  height: "36px",
  background: T.surface,
  border: `1px solid ${T.border2}`,
  borderRadius: "8px",
  color: T.textSub,
  fontSize: "18px",
  fontWeight: 700,
  cursor: "pointer",
  fontFamily: "inherit",
  lineHeight: 1,
};

// ---------- Date helpers ----------
export function todayString() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
export function shiftDate(dateStr, deltaDays) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(y, m - 1, d + deltaDays);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}
export function startOfDayLocal(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d, 0, 0, 0, 0);
}
export function endOfDayLocal(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d, 23, 59, 59, 999);
}
export function startOfWeekFor(dateStr) {
  const x = startOfDayLocal(dateStr);
  const dow = (x.getDay() + 6) % 7; // Monday = 0
  x.setDate(x.getDate() - dow);
  return x;
}
export function endOfWeekFor(dateStr) {
  const s = startOfWeekFor(dateStr);
  const e = new Date(s);
  e.setDate(e.getDate() + 7);
  e.setMilliseconds(e.getMilliseconds() - 1);
  return e;
}
export function noonOf(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d, 12, 0, 0, 0);
}
export function dateStrOf(date) {
  const d = date instanceof Date ? date : new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
export function prettyDate(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}
export function timeOf(iso) {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

// ---------- Weekly programme + day-type → nutrition bucket ----------
//
// The weekly programme used to be a hardcoded constant duplicated across
// WorkoutTracker.jsx and this file. It's now user-editable in Settings and
// persisted to `settings.weekly_schedule` (JSONB array of 7 day defs,
// Mon..Sun). The constants below are the FALLBACK used when no override is
// saved.

// Catalogue of workout types (drives exercise templates + nutrition bucket).
// Add new types here when extending. `bucketDefault` is the macro bucket the
// type defaults to when the user hasn't explicitly chosen one.
export const WORKOUT_TYPES = [
  { type: "upper_push",  label: "Upper Push",       color: "#7c3aed", bucketDefault: "lifting" },
  { type: "upper_pull",  label: "Upper Pull",       color: "#0891b2", bucketDefault: "lifting" },
  { type: "lower_squat", label: "Lower (Squat)",    color: "#2563eb", bucketDefault: "big"     },
  { type: "recovery",    label: "Active Recovery",  color: "#16a34a", bucketDefault: "rest"    },
  { type: "flexible",    label: "Flexible / Open",  color: "#94a3b8", bucketDefault: "rest"    },
  { type: "olympic",     label: "Olympic / MetCon", color: "#dc2626", bucketDefault: "lifting" },
  { type: "cardio",      label: "Zone 2 Cardio",    color: "#16a34a", bucketDefault: "big"     },
];

export const WORKOUT_TYPE_LABELS = Object.fromEntries(
  WORKOUT_TYPES.map((w) => [w.type, w.label])
);

export function colorForType(type) {
  return WORKOUT_TYPES.find((w) => w.type === type)?.color || "#94a3b8";
}

export function bucketDefaultFor(type) {
  return WORKOUT_TYPES.find((w) => w.type === type)?.bucketDefault || "lifting";
}

// Default schedule — used when settings.weekly_schedule is null. This is the
// canonical "factory" programme.
export const DEFAULT_WEEKLY_SCHEDULE = [
  { id: "monday",    label: "MON", name: "Upper Push",          type: "upper_push",  bucket: "lifting" },
  { id: "tuesday",   label: "TUE", name: "Upper Pull + Deads",  type: "upper_pull",  bucket: "lifting" },
  { id: "wednesday", label: "WED", name: "Active Recovery",     type: "recovery",    bucket: "rest"    },
  { id: "thursday",  label: "THU", name: "Lower — Squat",       type: "lower_squat", bucket: "big"     },
  { id: "friday",    label: "FRI", name: "Flexible",            type: "flexible",    bucket: "rest"    },
  { id: "saturday",  label: "SAT", name: "Olympic + MetCon",    type: "olympic",     bucket: "lifting" },
  { id: "sunday",    label: "SUN", name: "Zone 2 Cardio",       type: "cardio",      bucket: "big"     },
];

// Day order is fixed Mon..Sun; the user only edits name/type/bucket per day.
const DAY_IDS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
const DAY_LABELS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];

// Resolve the active weekly schedule from settings, with graceful fallback.
// Always returns an array of 7 day defs decorated with id, label, color.
export function weeklyScheduleFor(settings) {
  const override = settings?.weekly_schedule;
  if (!Array.isArray(override) || override.length !== 7) {
    return DEFAULT_WEEKLY_SCHEDULE.map((d) => ({ ...d, color: colorForType(d.type) }));
  }
  return override.map((d, i) => {
    const type = d?.type || DEFAULT_WEEKLY_SCHEDULE[i].type;
    return {
      id: DAY_IDS[i],
      label: DAY_LABELS[i],
      name: d?.name || DEFAULT_WEEKLY_SCHEDULE[i].name,
      type,
      bucket: d?.bucket || bucketDefaultFor(type),
      color: colorForType(type),
    };
  });
}

// Back-compat export: the legacy `DAYS` constant. Code that imports DAYS
// without settings still gets the factory schedule. New code should call
// `weeklyScheduleFor(settings)` instead.
export const DAYS = DEFAULT_WEEKLY_SCHEDULE.map((d) => ({ ...d, color: colorForType(d.type) }));

// Resolve the day def for a given date string. Accepts an optional `settings`
// arg so the active (user-edited) schedule is used when available.
export function dayDefFor(dateStr, settings) {
  const schedule = weeklyScheduleFor(settings);
  const dt = startOfDayLocal(dateStr);
  const idx = (dt.getDay() + 6) % 7; // Monday = 0
  return schedule[idx];
}

export const NUTRITION_BUCKETS = ["rest", "lifting", "big"];

export const NUTRITION_BUCKET_LABELS = {
  rest:    "REST DAY",
  lifting: "LIFTING DAY",
  big:     "BIG TRAINING / RIDE",
};

// Resolve the nutrition bucket for a given date. Uses the per-day bucket from
// the active schedule (settings override → default schedule). The dayType arg
// is accepted for legacy callers but ignored when settings is provided.
export function nutritionBucketFor(dayTypeOrDate, settings) {
  // If caller passed a date string AND settings, use the active schedule.
  if (typeof dayTypeOrDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(dayTypeOrDate) && settings) {
    return dayDefFor(dayTypeOrDate, settings).bucket;
  }
  // Legacy: dayType-based fallback.
  return bucketDefaultFor(dayTypeOrDate);
}

// Resolve the macro targets for a given date, falling back gracefully.
// Returns { calories, protein_g, fat_g, carbs_g, bucket }.
//
// NOTE: signature changed to accept either (settings, dayType) — legacy —
// or (settings, dateStr) when callers can pass the date for per-day bucket
// resolution. Behaviour: if 2nd arg looks like a date string, we resolve the
// bucket via the schedule; otherwise we fall back to the type→bucket default.
export function nutritionTargetsFor(settings, dayTypeOrDate) {
  const targets = settings?.nutrition_targets || {};
  const isDate = typeof dayTypeOrDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(dayTypeOrDate);
  const bucket = isDate
    ? dayDefFor(dayTypeOrDate, settings).bucket
    : bucketDefaultFor(dayTypeOrDate);
  const b = targets[bucket] || {};
  return {
    calories: numericOrNull(b.calories) ?? numericOrNull(settings?.daily_calorie_target),
    protein_g: numericOrNull(b.protein_g) ?? numericOrNull(settings?.daily_protein_target_g),
    fat_g: numericOrNull(b.fat_g),
    carbs_g: numericOrNull(b.carbs_g),
    bucket,
  };
}

function numericOrNull(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// ---------- Sub-tab nav (LOG / HISTORY / CALENDAR) ----------
export function SubTabs({ view, onChange, tabs }) {
  return (
    <div style={{ display: "flex", gap: "6px", marginBottom: "20px" }}>
      {tabs.map(([v, label]) => (
        <button
          key={v}
          onClick={() => onChange(v)}
          style={{
            flex: 1,
            background: view === v ? T.text : "none",
            border: `1px solid ${view === v ? T.text : T.border}`,
            color: view === v ? "#fff" : T.textSub,
            borderRadius: "10px",
            padding: "10px",
            fontSize: "11px",
            fontWeight: 700,
            cursor: "pointer",
            letterSpacing: "0.08em",
            fontFamily: "inherit",
          }}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

// ---------- Date bar (prev / picker / next / today shortcut) ----------
export function DateBar({ value, onChange }) {
  const isToday = value === todayString();
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "6px",
        marginBottom: "16px",
        flexWrap: "wrap",
      }}
    >
      <button
        onClick={() => onChange(shiftDate(value, -1))}
        style={arrowBtnStyle}
        aria-label="Previous day"
      >
        ‹
      </button>
      <input
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          ...inputStyle,
          width: "160px",
          textAlign: "center",
          fontWeight: 600,
          height: "36px",
        }}
      />
      <button
        onClick={() => onChange(shiftDate(value, 1))}
        style={arrowBtnStyle}
        aria-label="Next day"
      >
        ›
      </button>
      {!isToday && (
        <button
          onClick={() => onChange(todayString())}
          style={{
            ...arrowBtnStyle,
            width: "auto",
            padding: "0 12px",
            fontSize: "12px",
            fontWeight: 700,
            letterSpacing: "0.08em",
            color: T.accent,
            borderColor: T.accent,
          }}
        >
          TODAY
        </button>
      )}
    </div>
  );
}

// ---------- History view: groups entries by date, newest first ----------
export function HistoryView({ entries, renderEntry, emptyText = "Nothing logged yet." }) {
  if (!entries || entries.length === 0) {
    return (
      <div
        style={{
          padding: "30px 20px",
          background: T.surface2,
          borderRadius: "10px",
          color: T.textMuted,
          fontSize: "13px",
          textAlign: "center",
        }}
      >
        {emptyText}
      </div>
    );
  }

  // Group by YYYY-MM-DD of consumed_at (in local time).
  const groups = {};
  for (const e of entries) {
    const key = dateStrOf(e.consumed_at);
    if (!groups[key]) groups[key] = [];
    groups[key].push(e);
  }
  const orderedDates = Object.keys(groups).sort().reverse();

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      {orderedDates.map((dateStr) => (
        <div key={dateStr}>
          <div
            style={{
              fontSize: "11px",
              letterSpacing: "0.15em",
              color: T.textMuted,
              fontWeight: 700,
              marginBottom: "8px",
            }}
          >
            {prettyDate(dateStr).toUpperCase()}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            {groups[dateStr].map((e) => renderEntry(e))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------- Calendar month view ----------
// `dotColorOf(entry)` returns the colour for a dot representing this entry.
// `onSelectDay(dateStr)` is called when user taps a day that has entries.
// `dayBackgroundOf(dayEntries, dateStr)` (optional) returns a CSS background
//   override per day — colour, gradient, etc. Use to highlight days by content
//   (e.g. sauna days red, ice-bath days blue) or by absence (alcohol-free).
// `dayInnerOverlay(dayEntries, dateStr)` (optional) returns a ReactNode shown
//   inside the cell (in place of the dot row when there are no entries).
export function CalendarMonthView({
  entries,
  dotColorOf,
  onSelectDay,
  renderDayDetail, // (entries) => ReactNode shown beneath when a day is selected
  dayBackgroundOf,
  dayInnerOverlay,
}) {
  const today = new Date();
  const [currentMonth, setCurrentMonth] = useState(
    new Date(today.getFullYear(), today.getMonth(), 1)
  );
  const [selectedDate, setSelectedDate] = useState(null);

  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth();

  // Map dateStr -> entries
  const map = {};
  for (const e of entries || []) {
    const k = dateStrOf(e.consumed_at);
    if (!map[k]) map[k] = [];
    map[k].push(e);
  }

  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const offset = (firstDay + 6) % 7; // shift so Mon=0

  const cells = [];
  for (let i = 0; i < offset; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  function dateStr(d) {
    return `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }

  const todayStr = dateStrOf(new Date());
  const monthNames = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];

  return (
    <div>
      {/* Month nav */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "16px",
        }}
      >
        <button
          onClick={() => setCurrentMonth(new Date(year, month - 1, 1))}
          style={{
            background: T.surface2,
            border: `1px solid ${T.border}`,
            borderRadius: "8px",
            padding: "8px 14px",
            cursor: "pointer",
            fontSize: "16px",
            color: T.textSub,
          }}
        >
          ‹
        </button>
        <div style={{ fontSize: "16px", fontWeight: 800, color: T.text }}>
          {monthNames[month]} {year}
        </div>
        <button
          onClick={() => setCurrentMonth(new Date(year, month + 1, 1))}
          style={{
            background: T.surface2,
            border: `1px solid ${T.border}`,
            borderRadius: "8px",
            padding: "8px 14px",
            cursor: "pointer",
            fontSize: "16px",
            color: T.textSub,
          }}
        >
          ›
        </button>
      </div>

      {/* Day labels */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(7, 1fr)",
          gap: "3px",
          marginBottom: "3px",
        }}
      >
        {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => (
          <div
            key={i}
            style={{
              textAlign: "center",
              fontSize: "11px",
              fontWeight: 700,
              color: T.textMuted,
              padding: "4px 0",
            }}
          >
            {d}
          </div>
        ))}
      </div>

      {/* Calendar grid */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(7, 1fr)",
          gap: "3px",
          marginBottom: "20px",
        }}
      >
        {cells.map((day, i) => {
          if (!day) return <div key={i} />;
          const ds = dateStr(day);
          const dayEntries = map[ds] || [];
          const isToday = ds === todayStr;
          const isFuture = ds > todayStr;
          const isSelected = selectedDate === ds;
          // Dot colours per entry. `dotColorOf` may return null/undefined
          // for entries the tab wants to suppress (e.g. water on the Drinks
          // tab shouldn't contribute a blue dot). Filter those out BEFORE
          // slicing to the max-5 cap.
          const allDotColors = dayEntries.map(dotColorOf).filter((c) => !!c);
          const dots = allDotColors.slice(0, 5);
          const more = allDotColors.length > 5;

          // Tab-specific background override (e.g. sauna red, ice-bath blue,
          // alcohol-free green). Returned value can be a colour or gradient.
          // Selected/today states still win — those are clear UI signals we
          // shouldn't drown out.
          const customBg = dayBackgroundOf ? dayBackgroundOf(dayEntries, ds) : null;
          // Tab-specific inner content. Called for EVERY day (with or without
          // entries) so the tab has full control — the Drinks tab uses this
          // to show units on alcohol days AND a positive label on clean days.
          // A non-null return replaces the default dot rendering entirely.
          const overlay = dayInnerOverlay ? dayInnerOverlay(dayEntries, ds) : null;

          const defaultBg = dayEntries.length > 0 ? T.surface : isFuture ? T.bg : T.surface2;

          return (
            <div
              key={i}
              onClick={() =>
                dayEntries.length > 0 &&
                setSelectedDate(isSelected ? null : ds)
              }
              style={{
                background: isSelected
                  ? "#0f172a"
                  : isToday
                  ? "#1e293b"
                  : customBg || defaultBg,
                border: `1px solid ${
                  isSelected
                    ? "#0f172a"
                    : isToday
                    ? "#334155"
                    : dayEntries.length > 0
                    ? (dots[0] || T.accent) + "66"
                    : T.border
                }`,
                borderRadius: "8px",
                padding: "6px 4px",
                textAlign: "center",
                minHeight: "48px",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "space-between",
                cursor: dayEntries.length > 0 ? "pointer" : "default",
                transition: "all 0.15s",
              }}
            >
              <div
                style={{
                  fontSize: "12px",
                  fontWeight: isToday || isSelected ? 800 : 600,
                  color:
                    isSelected || isToday
                      ? "#fff"
                      : isFuture
                      ? T.textMuted
                      : T.textSub,
                }}
              >
                {day}
              </div>
              {overlay != null ? (
                // Consumer-provided override wins on every day it returns
                // non-null. Used by the Drinks tab to show units on alcohol
                // days and a positive label on clean days.
                <div
                  style={{
                    width: "100%",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    flex: 1,
                  }}
                >
                  {overlay}
                </div>
              ) : dots.length > 0 ? (
                <div
                  style={{
                    display: "flex",
                    gap: "2px",
                    flexWrap: "wrap",
                    justifyContent: "center",
                  }}
                >
                  {dots.map((c, ci) => (
                    <div
                      key={ci}
                      style={{
                        width: "6px",
                        height: "6px",
                        borderRadius: "50%",
                        background: isSelected ? "#fff" : c,
                      }}
                    />
                  ))}
                  {more && (
                    <div
                      style={{
                        fontSize: "9px",
                        color: isSelected ? "#fff" : T.textMuted,
                        lineHeight: 1,
                      }}
                    >
                      +
                    </div>
                  )}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      {/* Selected day detail */}
      {selectedDate && map[selectedDate] && (
        <div
          style={{
            background: T.surface,
            border: `1px solid ${T.border}`,
            borderRadius: "14px",
            padding: "16px",
            boxShadow: "0 4px 16px rgba(0,0,0,0.08)",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: "10px",
            }}
          >
            <div style={{ fontSize: "13px", fontWeight: 800, color: T.text }}>
              {prettyDate(selectedDate)}
            </div>
            <div style={{ display: "flex", gap: "6px" }}>
              {onSelectDay && (
                <button
                  onClick={() => onSelectDay(selectedDate)}
                  style={{
                    background: T.accent,
                    color: "#fff",
                    border: "none",
                    borderRadius: "6px",
                    padding: "4px 10px",
                    fontSize: "11px",
                    fontWeight: 700,
                    letterSpacing: "0.08em",
                    cursor: "pointer",
                  }}
                >
                  OPEN
                </button>
              )}
              <button
                onClick={() => setSelectedDate(null)}
                style={{
                  background: "none",
                  border: `1px solid ${T.border2}`,
                  color: T.textMuted,
                  borderRadius: "6px",
                  padding: "4px 8px",
                  fontSize: "12px",
                  cursor: "pointer",
                }}
              >
                ×
              </button>
            </div>
          </div>
          {renderDayDetail ? renderDayDetail(map[selectedDate]) : null}
        </div>
      )}
    </div>
  );
}
