import { useState, useEffect } from "react";

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

// ----- design tokens (matches WorkoutTracker) -----
const T = {
  bg: "#f8fafc", surface: "#ffffff", surface2: "#f1f5f9",
  border: "#e2e8f0", border2: "#cbd5e1",
  text: "#0f172a", textSub: "#475569", textMuted: "#94a3b8",
  accent: "#ea580c",
};

const labelStyle = {
  fontSize: "11px",
  letterSpacing: "0.15em",
  textTransform: "uppercase",
  color: T.textMuted,
  fontWeight: 600,
  marginBottom: "6px",
};

const inputStyle = {
  background: T.surface,
  border: `1px solid ${T.border2}`,
  borderRadius: "8px",
  color: T.text,
  padding: "10px 12px",
  fontSize: "16px",
  fontFamily: "inherit",
  width: "100%",
  outline: "none",
  boxSizing: "border-box",
};

const sectionStyle = {
  background: T.surface,
  border: `1px solid ${T.border}`,
  borderRadius: "12px",
  padding: "16px",
  marginBottom: "16px",
};

const sectionHeader = {
  fontFamily: "'Bebas Neue', sans-serif",
  fontSize: "20px",
  letterSpacing: "0.05em",
  color: T.text,
  marginBottom: "12px",
};

export default function Settings() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [dirty, setDirty] = useState(false);

  const [calTarget, setCalTarget] = useState("");
  const [proteinTarget, setProteinTarget] = useState("");
  const [alcoholTarget, setAlcoholTarget] = useState("");
  const [keyLifts, setKeyLifts] = useState([]);

  // ---- Load on mount ----
  useEffect(() => {
    (async () => {
      try {
        const rows = await sb("/settings?select=*&id=eq.1");
        const row = rows?.[0];
        if (row) {
          setCalTarget(row.daily_calorie_target ?? "");
          setProteinTarget(row.daily_protein_target_g ?? "");
          setAlcoholTarget(row.weekly_alcohol_units_target ?? "");
          setKeyLifts(Array.isArray(row.key_lifts) ? row.key_lifts : []);
        }
      } catch (e) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const markDirty = () => setDirty(true);

  const updateLift = (i, field, value) => {
    setKeyLifts((prev) => {
      const next = [...prev];
      next[i] = { ...next[i], [field]: value };
      return next;
    });
    markDirty();
  };
  const addLift = () => {
    setKeyLifts((prev) => [...prev, { name: "", target_kg: "" }]);
    markDirty();
  };
  const removeLift = (i) => {
    setKeyLifts((prev) => prev.filter((_, idx) => idx !== i));
    markDirty();
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const body = {
        id: 1,
        daily_calorie_target: numOrNull(calTarget),
        daily_protein_target_g: numOrNull(proteinTarget),
        weekly_alcohol_units_target: numOrNull(alcoholTarget),
        key_lifts: keyLifts
          .filter((l) => l.name?.trim())
          .map((l) => ({
            name: l.name.trim(),
            target_kg: numOrNull(l.target_kg),
          })),
      };
      await sb("/settings?id=eq.1", {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      setDirty(false);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div style={{ padding: "20px", color: T.textSub }}>Loading settings…</div>
    );
  }

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
        SETTINGS
      </div>
      <div
        style={{
          fontSize: "11px",
          color: T.textMuted,
          letterSpacing: "0.15em",
          marginBottom: "20px",
        }}
      >
        TARGETS · KEY LIFTS
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

      {/* ---- Daily / weekly targets ---- */}
      <div style={sectionStyle}>
        <div style={sectionHeader}>DAILY TARGETS</div>

        <div style={{ marginBottom: "14px" }}>
          <div style={labelStyle}>Calories per day</div>
          <input
            type="number"
            inputMode="numeric"
            value={calTarget}
            onChange={(e) => { setCalTarget(e.target.value); markDirty(); }}
            placeholder="e.g. 2400"
            style={inputStyle}
          />
        </div>

        <div style={{ marginBottom: "0" }}>
          <div style={labelStyle}>Protein per day (grams)</div>
          <input
            type="number"
            inputMode="numeric"
            value={proteinTarget}
            onChange={(e) => { setProteinTarget(e.target.value); markDirty(); }}
            placeholder="e.g. 180"
            style={inputStyle}
          />
        </div>
      </div>

      <div style={sectionStyle}>
        <div style={sectionHeader}>WEEKLY TARGETS</div>
        <div style={labelStyle}>Alcohol units per week (UK)</div>
        <input
          type="number"
          inputMode="numeric"
          value={alcoholTarget}
          onChange={(e) => { setAlcoholTarget(e.target.value); markDirty(); }}
          placeholder="e.g. 14"
          style={inputStyle}
        />
      </div>

      {/* ---- Key lifts ---- */}
      <div style={sectionStyle}>
        <div style={sectionHeader}>KEY LIFTS</div>
        <div style={{ ...labelStyle, marginBottom: "12px" }}>
          The lifts you want to track targets on
        </div>

        {keyLifts.length === 0 && (
          <div
            style={{
              padding: "16px",
              background: T.surface2,
              borderRadius: "8px",
              color: T.textMuted,
              fontSize: "13px",
              textAlign: "center",
              marginBottom: "12px",
            }}
          >
            No lifts yet. Tap "Add lift" to start.
          </div>
        )}

        {keyLifts.map((lift, i) => (
          <div
            key={i}
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 90px 36px",
              gap: "8px",
              marginBottom: "8px",
              alignItems: "center",
            }}
          >
            <input
              type="text"
              value={lift.name || ""}
              onChange={(e) => updateLift(i, "name", e.target.value)}
              placeholder="Lift name"
              style={inputStyle}
            />
            <input
              type="number"
              inputMode="decimal"
              value={lift.target_kg ?? ""}
              onChange={(e) => updateLift(i, "target_kg", e.target.value)}
              placeholder="kg"
              style={inputStyle}
            />
            <button
              onClick={() => removeLift(i)}
              style={{
                background: "transparent",
                border: `1px solid ${T.border2}`,
                color: T.textMuted,
                borderRadius: "8px",
                padding: "8px 0",
                cursor: "pointer",
                fontSize: "16px",
                lineHeight: 1,
              }}
              aria-label="Remove lift"
              title="Remove"
            >
              ×
            </button>
          </div>
        ))}

        <button
          onClick={addLift}
          style={{
            marginTop: "8px",
            width: "100%",
            padding: "10px",
            background: T.surface2,
            border: `1px dashed ${T.border2}`,
            color: T.textSub,
            borderRadius: "8px",
            cursor: "pointer",
            fontSize: "13px",
            fontWeight: 600,
          }}
        >
          + Add lift
        </button>
      </div>

      {/* ---- Save bar (sticky) ---- */}
      <div
        style={{
          position: "sticky",
          bottom: "70px",
          marginTop: "20px",
        }}
      >
        <button
          onClick={save}
          disabled={!dirty || saving}
          style={{
            width: "100%",
            padding: "14px",
            background: dirty && !saving ? T.accent : T.surface2,
            color: dirty && !saving ? "#ffffff" : T.textMuted,
            border: "none",
            borderRadius: "10px",
            fontSize: "15px",
            fontWeight: 700,
            letterSpacing: "0.05em",
            cursor: dirty && !saving ? "pointer" : "default",
            boxShadow:
              dirty && !saving ? "0 4px 12px rgba(234,88,12,0.25)" : "none",
          }}
        >
          {saving ? "SAVING…" : dirty ? "SAVE CHANGES" : "ALL SAVED"}
        </button>
      </div>
    </div>
  );
}

function numOrNull(v) {
  if (v === "" || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
