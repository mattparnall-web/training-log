import { useState, useEffect, useCallback } from "react";

// ----- Supabase config (same project / key as the rest of the app) -----
const SUPABASE_URL = "https://bbkxvbsutpvtuizonzsn.supabase.co";
const SUPABASE_KEY = "sb_publishable__8dc2jqeQIClVXwpZQCSWA_Y5yaV1ao";

async function sb(path, options = {}) {
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
}

const T = {
  bg: "#f8fafc", surface: "#ffffff", surface2: "#f1f5f9",
  border: "#e2e8f0", border2: "#cbd5e1",
  text: "#0f172a", textSub: "#475569", textMuted: "#94a3b8",
  accent: "#ea580c",
  amber: "#f59e0b",
  ok: "#16a34a",
  warn: "#dc2626",
};

// ---- Drink catalogue ----
// units = (volume_ml * abv_pct) / 1000
// calories = roughly volume_ml * 0.4 for beer, * 0.83 for wine, * 2.2 for spirits, * 1.5 mixed cocktails
// (close enough for tracking — actual values vary by brand)
const DRINKS = [
  { type: "beer",     portion: "half_pint", label: "Half pint",     emoji: "🍺", units: 1.42, calories:  95, ml: 284, abv: 5 },
  { type: "beer",     portion: "pint",      label: "Pint",          emoji: "🍺", units: 2.84, calories: 190, ml: 568, abv: 5 },
  { type: "beer",     portion: "can",       label: "Can/bottle",    emoji: "🍻", units: 1.65, calories: 132, ml: 330, abv: 5 },
  { type: "beer",     portion: "strong_pint", label: "Strong pint", emoji: "🍺", units: 3.41, calories: 230, ml: 568, abv: 6 },
  { type: "wine",     portion: "small_glass",  label: "Small wine",  emoji: "🍷", units: 1.50, calories: 104, ml: 125, abv: 12 },
  { type: "wine",     portion: "medium_glass", label: "Medium wine", emoji: "🍷", units: 2.10, calories: 145, ml: 175, abv: 12 },
  { type: "wine",     portion: "large_glass",  label: "Large wine",  emoji: "🍷", units: 3.00, calories: 208, ml: 250, abv: 12 },
  { type: "spirit",   portion: "single",  label: "Single",   emoji: "🥃", units: 1.00, calories:  55, ml:  25, abv: 40 },
  { type: "spirit",   portion: "double",  label: "Double",   emoji: "🥃", units: 2.00, calories: 110, ml:  50, abv: 40 },
  { type: "cocktail", portion: "standard", label: "Cocktail", emoji: "🍸", units: 2.00, calories: 200, ml:  50, abv: 40 },
];

const TYPE_COLOR = {
  beer:     "#f59e0b",
  wine:     "#be185d",
  spirit:   "#7c3aed",
  cocktail: "#0891b2",
};

// ---- date helpers (Singapore timezone-aware-ish: use local) ----
function startOfDay(d = new Date()) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function startOfWeek(d = new Date()) {
  const x = startOfDay(d);
  const day = (x.getDay() + 6) % 7; // Monday = 0
  x.setDate(x.getDate() - day);
  return x;
}

export default function Alcohol() {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [logging, setLogging] = useState(null); // drink portion key in flight
  const [weeklyTarget, setWeeklyTarget] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      // Last 8 days is enough for today + this week's running total.
      const since = new Date();
      since.setDate(since.getDate() - 8);
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

  // ---- Load entries + weekly target ----
  useEffect(() => {
    (async () => {
      try {
        const settings = await sb("/settings?select=weekly_alcohol_units_target&id=eq.1");
        const t = settings?.[0]?.weekly_alcohol_units_target;
        setWeeklyTarget(typeof t === "number" ? t : null);
      } catch {
        // Settings table optional — ignore failure.
      }
      load();
    })();
  }, [load]);

  // ---- Totals ----
  const todayStart = startOfDay().getTime();
  const weekStart = startOfWeek().getTime();

  const todayEntries = entries.filter(
    (e) => new Date(e.consumed_at).getTime() >= todayStart
  );
  const weekEntries = entries.filter(
    (e) => new Date(e.consumed_at).getTime() >= weekStart
  );

  const sum = (arr, key) =>
    arr.reduce((acc, e) => acc + Number(e[key] || 0), 0);

  const todayUnits = round1(sum(todayEntries, "units"));
  const todayCals = Math.round(sum(todayEntries, "calories"));
  const weekUnits = round1(sum(weekEntries, "units"));

  const weeklyPct = weeklyTarget
    ? Math.min(100, Math.round((weekUnits / weeklyTarget) * 100))
    : null;

  // ---- Actions ----
  const quickLog = async (drink) => {
    setLogging(`${drink.type}_${drink.portion}`);
    try {
      const row = {
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
      // Optimistically prepend.
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
      load(); // re-sync from server on failure
    }
  };

  return (
    <div style={{ padding: "20px", paddingBottom: "100px" }}>
      <div
        style={{
          fontFamily: "'Bebas Neue', sans-serif",
          fontSize: "36px",
          letterSpacing: "0.05em",
          color: T.text,
          marginBottom: "4px",
        }}
      >
        ALCOHOL
      </div>
      <div
        style={{
          fontSize: "11px",
          color: T.textMuted,
          letterSpacing: "0.15em",
          marginBottom: "16px",
        }}
      >
        QUICK-TAP · UK UNITS
      </div>

      {error && (
        <div
          style={{
            background: "#fee2e2",
            color: "#991b1b",
            padding: "10px 12px",
            borderRadius: "8px",
            marginBottom: "16px",
            fontSize: "13px",
          }}
        >
          {error}
        </div>
      )}

      {/* ---- Totals row ---- */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: "10px",
          marginBottom: "16px",
        }}
      >
        <StatCard label="TODAY" value={`${todayUnits} units`} sub={`${todayCals} cal`} />
        <StatCard
          label="THIS WEEK"
          value={`${weekUnits} units`}
          sub={weeklyTarget ? `of ${weeklyTarget} target` : "no target set"}
          progress={weeklyPct}
          color={
            weeklyPct == null ? T.textMuted :
            weeklyPct < 70 ? T.ok :
            weeklyPct < 100 ? T.amber : T.warn
          }
        />
      </div>

      {/* ---- Quick-tap grid ---- */}
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
          TAP TO LOG
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
                <div style={{ fontSize: "11px", color: T.textMuted, letterSpacing: "0.05em" }}>
                  {d.units} units · {d.calories} cal
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* ---- Today's entries ---- */}
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
          TODAY'S ENTRIES
        </div>
        {loading ? (
          <div style={{ color: T.textSub, fontSize: "13px" }}>Loading…</div>
        ) : todayEntries.length === 0 ? (
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
            Nothing logged today.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            {todayEntries.map((e) => (
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
            ))}
          </div>
        )}
      </div>
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
function timeOf(iso) {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
