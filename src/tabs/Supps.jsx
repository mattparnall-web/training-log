import { useState, useEffect, useCallback } from "react";
import {
  sb, T, display, inputStyle,
  todayString, startOfDayLocal, endOfDayLocal,
  noonOf, prettyDate, timeOf, dateStrOf,
  SubTabs, DateBar, HistoryView, CalendarMonthView,
} from "./_shared.jsx";

// ---- Catalogue ----
const SUPPS = [
  { type: "protein",   label: "Protein shake", emoji: "🥤", group: "supps"    },
  { type: "vitamins",  label: "Vitamins",      emoji: "💊", group: "supps"    },
  { type: "omega3",    label: "Omega 3",       emoji: "🐟", group: "supps"    },
  { type: "collagen",  label: "Collagen",      emoji: "✨", group: "supps"    },
  { type: "creatine",  label: "Creatine",      emoji: "💪", group: "supps"    },
  { type: "ice_bath",  label: "Ice bath",      emoji: "🧊", group: "recovery" },
  { type: "sauna",     label: "Sauna",         emoji: "🧖", group: "recovery" },
];

const TYPE_COLOR = {
  protein:  "#16a34a",
  vitamins: "#7c3aed",
  omega3:   "#0891b2",
  collagen: "#be185d",
  creatine: "#ea580c",
  ice_bath: "#2563eb",
  sauna:    "#dc2626",
};

const LOOKBACK_DAYS = 90;

export default function Supps() {
  const [view, setView] = useState("log");
  const [selectedDate, setSelectedDate] = useState(todayString());
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [logging, setLogging] = useState(null);
  const [error, setError] = useState(null);

  const isToday = selectedDate === todayString();

  const load = useCallback(async () => {
    try {
      setError(null);
      const since = new Date();
      since.setDate(since.getDate() - LOOKBACK_DAYS);
      const rows = await sb(
        `/supps_entries?select=*&consumed_at=gte.${since.toISOString()}&order=consumed_at.desc`
      );
      setEntries(rows || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const dayStartMs = startOfDayLocal(selectedDate).getTime();
  const dayEndMs = endOfDayLocal(selectedDate).getTime();
  const dayEntries = entries.filter((e) => {
    const t = new Date(e.consumed_at).getTime();
    return t >= dayStartMs && t <= dayEndMs;
  });

  const todayTypes = new Set(dayEntries.map((e) => e.supp_type));

  const quickLog = async (item) => {
    setLogging(`${item.type}`);
    try {
      const consumed = isToday ? new Date() : noonOf(selectedDate);
      const row = {
        consumed_at: consumed.toISOString(),
        supp_type: item.type,
        display_label: item.label,
      };
      const created = await sb("/supps_entries", {
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
      await sb(`/supps_entries?id=eq.${id}`, { method: "DELETE" });
    } catch (e) {
      setError(e.message);
      load();
    }
  };

  const renderEntryRow = (e) => (
    <div
      key={e.id}
      style={{
        background: T.surface,
        border: `1px solid ${T.border}`,
        borderLeft: `3px solid ${TYPE_COLOR[e.supp_type] || T.accent}`,
        borderRadius: "8px",
        padding: "10px 12px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "10px",
      }}
    >
      <div>
        <div style={{ fontSize: "13px", fontWeight: 600, color: T.text }}>
          {e.display_label || e.supp_type}
        </div>
        <div style={{ fontSize: "11px", color: T.textMuted, marginTop: "2px" }}>
          {timeOf(e.consumed_at)}
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

  const renderQuickTapGroup = (items, heading) => (
    <div style={{ marginBottom: "16px" }}>
      <div
        style={{
          fontSize: "10px",
          letterSpacing: "0.15em",
          color: T.textMuted,
          fontWeight: 700,
          marginBottom: "8px",
        }}
      >
        {heading}
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: "8px",
        }}
      >
        {items.map((item) => {
          const busy = logging === item.type;
          const tickedToday = todayTypes.has(item.type);
          return (
            <button
              key={item.type}
              onClick={() => quickLog(item)}
              disabled={!!logging}
              style={{
                background: tickedToday ? "#ecfdf5" : T.surface,
                border: `1px solid ${tickedToday ? "#a7f3d0" : T.border}`,
                borderLeft: `4px solid ${TYPE_COLOR[item.type] || T.accent}`,
                borderRadius: "10px",
                padding: "12px",
                display: "flex",
                alignItems: "center",
                gap: "10px",
                cursor: logging ? "wait" : "pointer",
                fontFamily: "inherit",
                textAlign: "left",
                opacity: logging && !busy ? 0.5 : 1,
                transition: "transform 0.08s",
                transform: busy ? "scale(0.97)" : "scale(1)",
              }}
            >
              <div style={{ fontSize: "22px", lineHeight: 1 }}>{item.emoji}</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: "13px", fontWeight: 700, color: T.text }}>
                  {item.label}
                </div>
                {tickedToday && (
                  <div style={{ fontSize: "10px", color: "#059669", fontWeight: 700, letterSpacing: "0.06em" }}>
                    ✓ DONE
                  </div>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );

  const suppsList = SUPPS.filter((s) => s.group === "supps");
  const recoveryList = SUPPS.filter((s) => s.group === "recovery");

  return (
    <div style={{ padding: "20px", paddingBottom: "100px" }}>
      <div style={{ ...display, fontSize: "36px", marginBottom: "4px" }}>SUPPS</div>
      <div
        style={{
          fontSize: "11px",
          color: T.textMuted,
          letterSpacing: "0.15em",
          marginBottom: "16px",
          fontWeight: 600,
        }}
      >
        SUPPLEMENTS · RECOVERY
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

      {view === "log" && (
        <>
          <DateBar value={selectedDate} onChange={setSelectedDate} />

          <div
            style={{
              fontSize: "11px",
              letterSpacing: "0.15em",
              color: T.textMuted,
              fontWeight: 600,
              marginBottom: "10px",
            }}
          >
            {isToday ? `${dayEntries.length} LOGGED TODAY` : `${dayEntries.length} ON ${prettyDate(selectedDate).toUpperCase()}`}
          </div>

          {renderQuickTapGroup(suppsList, "SUPPLEMENTS")}
          {renderQuickTapGroup(recoveryList, "RECOVERY")}

          <div style={{ marginTop: "20px" }}>
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

      {view === "calendar" && (
        <CalendarMonthView
          entries={entries}
          dotColorOf={(e) => TYPE_COLOR[e.supp_type] || T.accent}
          onSelectDay={(ds) => {
            setSelectedDate(ds);
            setView("log");
          }}
          renderDayDetail={(dayEntries) => (
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              {dayEntries.map(renderEntryRow)}
            </div>
          )}
        />
      )}
    </div>
  );
}
