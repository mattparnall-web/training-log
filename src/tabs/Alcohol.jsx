import { useState, useEffect, useCallback } from "react";
import {
  sb, T, display, inputStyle,
  todayString, startOfDayLocal, endOfDayLocal,
  startOfWeekFor, endOfWeekFor, noonOf, prettyDate, timeOf, dateStrOf,
  SubTabs, DateBar, HistoryView, CalendarMonthView, ErrorBanner,
} from "./_shared.jsx";

// ---- Drink catalogue (UK alcohol units + rough calories) ----
const DRINKS = [
  { type: "beer",     portion: "half_pint",  label: "Half pint",  emoji: "🍺", units: 1.42, calories:  95 },
  { type: "beer",     portion: "pint",       label: "Pint",       emoji: "🍺", units: 2.84, calories: 190 },
  { type: "beer",     portion: "can",        label: "Can/bottle", emoji: "🍻", units: 1.65, calories: 132 },
  { type: "beer",     portion: "strong_pint", label: "Strong pint", emoji: "🍺", units: 3.41, calories: 230 },
  { type: "wine",     portion: "small_glass",  label: "Small wine",  emoji: "🍷", units: 1.50, calories: 104 },
  { type: "wine",     portion: "medium_glass", label: "Medium wine", emoji: "🍷", units: 2.10, calories: 145 },
  { type: "wine",     portion: "large_glass",  label: "Large wine",  emoji: "🍷", units: 3.00, calories: 208 },
  { type: "spirit",   portion: "single",  label: "Single",   emoji: "🥃", units: 1.00, calories:  55 },
  { type: "spirit",   portion: "double",  label: "Double",   emoji: "🥃", units: 2.00, calories: 110 },
  { type: "cocktail", portion: "standard", label: "Cocktail", emoji: "🍸", units: 2.00, calories: 200 },
];

const TYPE_COLOR = {
  beer:     "#f59e0b",
  wine:     "#be185d",
  spirit:   "#7c3aed",
  cocktail: "#0891b2",
};

// How far back to fetch on mount. ~3 months is enough for the typical calendar browse.
const LOOKBACK_DAYS = 90;

export default function Alcohol() {
  const [view, setView] = useState("log");
  const [selectedDate, setSelectedDate] = useState(todayString());
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [logging, setLogging] = useState(null);
  const [weeklyTarget, setWeeklyTarget] = useState(null);
  const [error, setError] = useState(null);

  const isToday = selectedDate === todayString();

  // ---- Load LOOKBACK_DAYS of entries ----
  const load = useCallback(async () => {
    try {
      setError(null);
      const since = new Date();
      since.setDate(since.getDate() - LOOKBACK_DAYS);
      const rows = await sb(
        `/alcohol_entries?select=*&consumed_at=gte.${since.toISOString()}&order=consumed_at.desc`
      );
      setEntries(rows || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const settings = await sb("/settings?select=weekly_alcohol_units_target&id=eq.1");
        const t = settings?.[0]?.weekly_alcohol_units_target;
        setWeeklyTarget(typeof t === "number" ? t : null);
      } catch {}
      load();
    })();
  }, [load]);

  // ---- Totals for the selected day + its week ----
  const dayStartMs = startOfDayLocal(selectedDate).getTime();
  const dayEndMs = endOfDayLocal(selectedDate).getTime();
  const weekStartMs = startOfWeekFor(selectedDate).getTime();
  const weekEndMs = endOfWeekFor(selectedDate).getTime();

  const dayEntries = entries.filter((e) => {
    const t = new Date(e.consumed_at).getTime();
    return t >= dayStartMs && t <= dayEndMs;
  });
  const weekEntries = entries.filter((e) => {
    const t = new Date(e.consumed_at).getTime();
    return t >= weekStartMs && t <= weekEndMs;
  });

  const sum = (arr, key) => arr.reduce((acc, e) => acc + Number(e[key] || 0), 0);
  const dayUnits = round1(sum(dayEntries, "units"));
  const dayCals = Math.round(sum(dayEntries, "calories"));
  const weekUnits = round1(sum(weekEntries, "units"));

  const weeklyPct = weeklyTarget
    ? Math.min(100, Math.round((weekUnits / weeklyTarget) * 100))
    : null;

  // ---- Actions ----
  const quickLog = async (drink) => {
    setLogging(`${drink.type}_${drink.portion}`);
    try {
      const consumed = isToday ? new Date() : noonOf(selectedDate);
      const row = {
        consumed_at: consumed.toISOString(),
        drink_type: drink.type,
        portion: drink.portion,
        display_label: drink.label,
        units: drink.units,
        calories: drink.calories,
      };
      const created = await sb("/alcohol_entries", {
        method: "POST",
        body: JSON.stringify(row),
      });
      setEntries((prev) => [created[0], ...prev]);
    } catch (e) {
      setError(e.message);
    } finally {
      setLogging(null);
    }
  };

  const deleteEntry = async (id) => {
    setEntries((prev) => prev.filter((e) => e.id !== id));
    try {
      await sb(`/alcohol_entries?id=eq.${id}`, { method: "DELETE" });
    } catch (e) {
      setError(e.message);
      load();
    }
  };

  // ---- Render an entry row (used by LOG/HISTORY/CALENDAR) ----
  const renderEntryRow = (e) => (
    <div
      key={e.id}
      style={{
        background: T.surface,
        border: `1px solid ${T.border}`,
        borderLeft: `3px solid ${TYPE_COLOR[e.drink_type] || T.accent}`,
        borderRadius: "8px",
        padding: "10px 12px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "10px",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
        <div style={{ fontSize: "13px", fontWeight: 600, color: T.text }}>
          {e.display_label || `${e.drink_type} (${e.portion})`}
        </div>
        <div style={{ fontSize: "11px", color: T.textMuted }}>
          {Number(e.units).toFixed(1)} units · {e.calories} cal · {timeOf(e.consumed_at)}
        </div>
      </div>
      <button
        onClick={() => deleteEntry(e.id)}
        style={{
          background: "transparent",
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
  );

  return (
    <div style={{ padding: "20px", paddingBottom: "100px" }}>
      <div style={{ ...display, fontSize: "36px", marginBottom: "4px" }}>ALCOHOL</div>
      <div
        style={{
          fontSize: "11px",
          color: T.textMuted,
          letterSpacing: "0.15em",
          marginBottom: "16px",
          fontWeight: 600,
        }}
      >
        QUICK-TAP · UK UNITS
      </div>

      <SubTabs
        view={view}
        onChange={setView}
        tabs={[
          ["log", "LOG"],
          ["history", "HISTORY"],
          ["calendar", "CALENDAR"],
        ]}
      />

      <ErrorBanner
        message={error}
        onRetry={() => {
          setError(null);
          setLoading(true);
          load();
        }}
      />


      {/* =================== LOG VIEW =================== */}
      {view === "log" && (
        <>
          <DateBar value={selectedDate} onChange={setSelectedDate} />

          {/* Totals row */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: "10px",
              marginBottom: "16px",
            }}
          >
            <StatCard
              label={isToday ? "TODAY" : prettyDate(selectedDate).toUpperCase()}
              value={`${dayUnits} units`}
              sub={`${dayCals} cal`}
            />
            <StatCard
              label="WEEK"
              value={`${weekUnits} units`}
              sub={weeklyTarget ? `of ${weeklyTarget} target` : "no target set"}
              progress={weeklyPct}
              color={
                weeklyPct == null
                  ? T.textMuted
                  : weeklyPct < 70
                  ? T.ok
                  : weeklyPct < 100
                  ? T.amber
                  : T.warn
              }
            />
          </div>

          {/* Quick-tap grid */}
          <div style={{ marginBottom: "20px" }}>
            <div
              style={{
                fontSize: "11px",
                letterSpacing: "0.15em",
                color: T.textMuted,
                fontWeight: 600,
                marginBottom: "10px",
              }}
            >
              TAP TO LOG{!isToday ? ` · FOR ${prettyDate(selectedDate).toUpperCase()}` : ""}
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: "10px",
              }}
            >
              {DRINKS.map((d) => {
                const busy = logging === `${d.type}_${d.portion}`;
                return (
                  <button
                    key={`${d.type}_${d.portion}`}
                    onClick={() => quickLog(d)}
                    disabled={!!logging}
                    style={{
                      background: T.surface,
                      border: `1px solid ${T.border}`,
                      borderLeft: `4px solid ${TYPE_COLOR[d.type] || T.accent}`,
                      borderRadius: "10px",
                      padding: "12px",
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "flex-start",
                      gap: "4px",
                      cursor: logging ? "wait" : "pointer",
                      fontFamily: "inherit",
                      textAlign: "left",
                      opacity: logging && !busy ? 0.5 : 1,
                      transition: "transform 0.08s",
                      transform: busy ? "scale(0.97)" : "scale(1)",
                    }}
                  >
                    <div style={{ fontSize: "20px", lineHeight: 1 }}>{d.emoji}</div>
                    <div style={{ fontSize: "14px", fontWeight: 700, color: T.text }}>
                      {d.label}
                    </div>
                    <div
                      style={{
                        fontSize: "11px",
                        color: T.textMuted,
                        letterSpacing: "0.05em",
                      }}
                    >
                      {d.units} units · {d.calories} cal
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Selected day's entries */}
          <div>
            <div
              style={{
                fontSize: "11px",
                letterSpacing: "0.15em",
                color: T.textMuted,
                fontWeight: 600,
                marginBottom: "10px",
              }}
            >
              {isToday ? "TODAY'S ENTRIES" : prettyDate(selectedDate).toUpperCase()}
            </div>
            {loading ? (
              <div style={{ color: T.textSub, fontSize: "13px" }}>Loading…</div>
            ) : dayEntries.length === 0 ? (
              <div
                style={{
                  padding: "20px",
                  background: T.surface2,
                  borderRadius: "10px",
                  color: T.textMuted,
                  fontSize: "13px",
                  textAlign: "center",
                }}
              >
                Nothing logged.
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                {dayEntries.map(renderEntryRow)}
              </div>
            )}
          </div>
        </>
      )}

      {/* =================== HISTORY VIEW =================== */}
      {view === "history" && (
        <>
          {loading ? (
            <div style={{ color: T.textSub, fontSize: "13px" }}>Loading…</div>
          ) : (
            <HistoryView
              entries={entries}
              renderEntry={renderEntryRow}
              emptyText="Nothing logged in the last 90 days."
            />
          )}
        </>
      )}

      {/* =================== CALENDAR VIEW =================== */}
      {view === "calendar" && (
        <CalendarMonthView
          entries={entries}
          dotColorOf={(e) => TYPE_COLOR[e.drink_type] || T.accent}
          onSelectDay={(ds) => {
            setSelectedDate(ds);
            setView("log");
          }}
          renderDayDetail={(dayEntries) => (
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              {dayEntries.map(renderEntryRow)}
              <div
                style={{
                  fontSize: "11px",
                  color: T.textMuted,
                  marginTop: "4px",
                  paddingTop: "8px",
                  borderTop: `1px solid ${T.border}`,
                }}
              >
                {dayEntries.length} drinks · {round1(dayEntries.reduce((a, e) => a + Number(e.units || 0), 0))} units · {Math.round(dayEntries.reduce((a, e) => a + Number(e.calories || 0), 0))} cal
              </div>
            </div>
          )}
        />
      )}
    </div>
  );
}

function StatCard({ label, value, sub, progress, color }) {
  return (
    <div
      style={{
        background: T.surface,
        border: `1px solid ${T.border}`,
        borderRadius: "12px",
        padding: "14px",
        position: "relative",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          fontSize: "10px",
          letterSpacing: "0.15em",
          color: T.textMuted,
          fontWeight: 600,
          marginBottom: "6px",
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: "22px", fontWeight: 700, color: T.text, lineHeight: 1 }}>
        {value}
      </div>
      <div style={{ fontSize: "11px", color: T.textMuted, marginTop: "4px" }}>{sub}</div>
      {progress != null && (
        <div
          style={{
            position: "absolute",
            left: 0,
            bottom: 0,
            height: "3px",
            width: `${progress}%`,
            background: color || T.accent,
          }}
        />
      )}
    </div>
  );
}

function round1(n) {
  return Math.round(n * 10) / 10;
}
