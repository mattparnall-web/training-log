import { useState, useEffect } from "react";
// Reuse the shared Supabase helper (with retry-on-network-failure) and the
// shared ErrorBanner with a Retry button. Previously this file had its own
// sb() copy, which meant Settings didn't benefit from the retry logic.
import {
  sb,
  ErrorBanner,
  WORKOUT_TYPES,
  WORKOUT_TYPE_LABELS,
  NUTRITION_BUCKETS,
  NUTRITION_BUCKET_LABELS,
  DEFAULT_WEEKLY_SCHEDULE,
  weeklyScheduleFor,
  colorForType,
  bucketDefaultFor,
} from "./_shared.jsx";

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
  // Long-form programme context that the coach reads on every plan/review.
  // Matt pastes this from his previous Claude chats — goals, blocks, history,
  // constraints, anything that should stay in the coach's awareness.
  const [programmeContext, setProgrammeContext] = useState("");

  // The user-editable weekly programme — 7 day defs (Mon..Sun). Each has a
  // name, type, and bucket. Initialised from settings.weekly_schedule or the
  // factory default if missing.
  const [weeklySchedule, setWeeklySchedule] = useState(() => weeklyScheduleFor(null));

  // Per-day-type macro targets: { rest: {...}, lifting: {...}, big: {...} }
  const [nutritionTargets, setNutritionTargets] = useState({
    rest:    { calories: "", protein_g: "", fat_g: "", carbs_g: "" },
    lifting: { calories: "", protein_g: "", fat_g: "", carbs_g: "" },
    big:     { calories: "", protein_g: "", fat_g: "", carbs_g: "" },
  });

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
          setProgrammeContext(row.programme_context ?? "");
          setWeeklySchedule(weeklyScheduleFor(row));
          const nt = row.nutrition_targets || {};
          setNutritionTargets({
            rest:    { calories: nt.rest?.calories    ?? "", protein_g: nt.rest?.protein_g    ?? "", fat_g: nt.rest?.fat_g    ?? "", carbs_g: nt.rest?.carbs_g    ?? "" },
            lifting: { calories: nt.lifting?.calories ?? "", protein_g: nt.lifting?.protein_g ?? "", fat_g: nt.lifting?.fat_g ?? "", carbs_g: nt.lifting?.carbs_g ?? "" },
            big:     { calories: nt.big?.calories     ?? "", protein_g: nt.big?.protein_g     ?? "", fat_g: nt.big?.fat_g     ?? "", carbs_g: nt.big?.carbs_g     ?? "" },
          });
        }
      } catch (e) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Schedule editor helpers
  const updateScheduleDay = (i, field, value) => {
    setWeeklySchedule((prev) => {
      const next = [...prev];
      const updated = { ...next[i], [field]: value };
      // When the user changes the workout type, refresh the derived color and
      // suggest a sensible bucket if they haven't customised it explicitly.
      if (field === "type") {
        updated.color = colorForType(value);
        // Don't overwrite a user-set bucket; only suggest if blank/unset.
      }
      next[i] = updated;
      return next;
    });
    markDirty();
  };
  const restoreScheduleDefaults = () => {
    setWeeklySchedule(weeklyScheduleFor(null));
    markDirty();
  };

  const updateMacroTarget = (bucket, macro, value) => {
    setNutritionTargets((prev) => ({
      ...prev,
      [bucket]: { ...prev[bucket], [macro]: value },
    }));
    markDirty();
  };

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
        programme_context: programmeContext?.trim() ? programmeContext.trim() : null,
        // Persist only the fields the user owns; id / label / color are
        // derived from position + type and recomputed on read.
        weekly_schedule: weeklySchedule.map((d) => ({
          name: d.name,
          type: d.type,
          bucket: d.bucket,
        })),
        key_lifts: keyLifts
          .filter((l) => l.name?.trim())
          .map((l) => ({
            name: l.name.trim(),
            target_kg: numOrNull(l.target_kg),
          })),
        nutrition_targets: {
          rest:    { calories: numOrNull(nutritionTargets.rest.calories),    protein_g: numOrNull(nutritionTargets.rest.protein_g),    fat_g: numOrNull(nutritionTargets.rest.fat_g),    carbs_g: numOrNull(nutritionTargets.rest.carbs_g) },
          lifting: { calories: numOrNull(nutritionTargets.lifting.calories), protein_g: numOrNull(nutritionTargets.lifting.protein_g), fat_g: numOrNull(nutritionTargets.lifting.fat_g), carbs_g: numOrNull(nutritionTargets.lifting.carbs_g) },
          big:     { calories: numOrNull(nutritionTargets.big.calories),     protein_g: numOrNull(nutritionTargets.big.protein_g),     fat_g: numOrNull(nutritionTargets.big.fat_g),     carbs_g: numOrNull(nutritionTargets.big.carbs_g) },
        },
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

      <ErrorBanner
        message={error}
        onRetry={() => {
          setError(null);
          setLoading(true);
          // Re-run the mount loader by hitting the settings endpoint again.
          (async () => {
            try {
              const rows = await sb("/settings?select=*&id=eq.1");
              const row = rows?.[0];
              if (row) {
                setCalTarget(row.daily_calorie_target ?? "");
                setProteinTarget(row.daily_protein_target_g ?? "");
                setAlcoholTarget(row.weekly_alcohol_units_target ?? "");
                setKeyLifts(Array.isArray(row.key_lifts) ? row.key_lifts : []);
                setProgrammeContext(row.programme_context ?? "");
                setWeeklySchedule(weeklyScheduleFor(row));
                const nt = row.nutrition_targets || {};
                setNutritionTargets({
                  rest:    { calories: nt.rest?.calories    ?? "", protein_g: nt.rest?.protein_g    ?? "", fat_g: nt.rest?.fat_g    ?? "", carbs_g: nt.rest?.carbs_g    ?? "" },
                  lifting: { calories: nt.lifting?.calories ?? "", protein_g: nt.lifting?.protein_g ?? "", fat_g: nt.lifting?.fat_g ?? "", carbs_g: nt.lifting?.carbs_g ?? "" },
                  big:     { calories: nt.big?.calories     ?? "", protein_g: nt.big?.protein_g     ?? "", fat_g: nt.big?.fat_g     ?? "", carbs_g: nt.big?.carbs_g     ?? "" },
                });
              }
            } catch (e) {
              setError(e.message);
            } finally {
              setLoading(false);
            }
          })();
        }}
      />


      {/* ---- Nutrition targets (per day-type bucket) ---- */}
      <div style={sectionStyle}>
        <div style={sectionHeader}>NUTRITION TARGETS</div>
        <div style={{ ...labelStyle, marginBottom: "14px" }}>
          Targets vary by training day. Protein floor is constant across all days.
        </div>

        {[
          { key: "rest",    label: "REST DAY",            sub: "Wed (recovery) · Fri (flexible)", color: "#16a34a" },
          { key: "lifting", label: "LIFTING DAY",         sub: "Mon · Tue · Sat (Olympic)",       color: "#7c3aed" },
          { key: "big",     label: "BIG TRAINING / RIDE", sub: "Thu (legs) · Sun (cardio)",       color: "#dc2626" },
        ].map((bucket) => (
          <div
            key={bucket.key}
            style={{
              background: T.surface2,
              border: `1px solid ${T.border}`,
              borderLeft: `4px solid ${bucket.color}`,
              borderRadius: "10px",
              padding: "12px",
              marginBottom: "10px",
            }}
          >
            <div
              style={{
                fontSize: "11px",
                fontWeight: 800,
                letterSpacing: "0.1em",
                color: T.text,
                marginBottom: "2px",
              }}
            >
              {bucket.label}
            </div>
            <div style={{ fontSize: "10px", color: T.textMuted, marginBottom: "10px" }}>
              {bucket.sub}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
              <MacroInput
                label="Calories"
                value={nutritionTargets[bucket.key].calories}
                onChange={(v) => updateMacroTarget(bucket.key, "calories", v)}
              />
              <MacroInput
                label="Protein (g)"
                value={nutritionTargets[bucket.key].protein_g}
                onChange={(v) => updateMacroTarget(bucket.key, "protein_g", v)}
              />
              <MacroInput
                label="Fat (g)"
                value={nutritionTargets[bucket.key].fat_g}
                onChange={(v) => updateMacroTarget(bucket.key, "fat_g", v)}
              />
              <MacroInput
                label="Carbs (g)"
                value={nutritionTargets[bucket.key].carbs_g}
                onChange={(v) => updateMacroTarget(bucket.key, "carbs_g", v)}
              />
            </div>
          </div>
        ))}
      </div>

      {/* ---- Legacy single targets (kept hidden — superseded by nutrition_targets above) ---- */}
      <div style={{ display: "none" }}>
        <div>
          <input
            type="number"
            value={calTarget}
            onChange={(e) => { setCalTarget(e.target.value); markDirty(); }}
          />
        </div>
        <div>
          <input
            type="number"
            value={proteinTarget}
            onChange={(e) => { setProteinTarget(e.target.value); markDirty(); }}
            placeholder="e.g. 180"
            style={inputStyle}
          />
        </div>
      </div>

      {/* ---- Weekly programme editor ---- */}
      <div style={sectionStyle}>
        <div style={sectionHeader}>WEEKLY PROGRAMME</div>
        <div style={{ ...labelStyle, marginBottom: "12px", textTransform: "none", letterSpacing: "0", fontSize: "12px", color: T.textSub, fontWeight: 500, lineHeight: 1.5 }}>
          What you train on each day. Changing the workout type updates the
          exercise templates in the logger; changing the macro bucket updates
          the calorie + protein + fat + carb targets the Food tab uses.
        </div>

        {weeklySchedule.map((d, i) => (
          <div
            key={d.id}
            style={{
              background: T.surface2,
              border: `1px solid ${T.border}`,
              borderLeft: `4px solid ${d.color}`,
              borderRadius: "10px",
              padding: "10px 12px",
              marginBottom: "8px",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "10px",
                marginBottom: "8px",
              }}
            >
              <div
                style={{
                  fontSize: "11px",
                  fontWeight: 800,
                  letterSpacing: "0.1em",
                  color: d.color,
                  width: "32px",
                  flexShrink: 0,
                }}
              >
                {d.label}
              </div>
              <input
                type="text"
                value={d.name || ""}
                onChange={(e) => updateScheduleDay(i, "name", e.target.value)}
                placeholder="Session name"
                style={{ ...inputStyle, flex: 1, fontSize: "14px" }}
              />
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: "8px",
              }}
            >
              <div>
                <div style={{ fontSize: "10px", letterSpacing: "0.08em", color: T.textMuted, fontWeight: 700, marginBottom: "4px" }}>
                  TYPE
                </div>
                <select
                  value={d.type}
                  onChange={(e) => updateScheduleDay(i, "type", e.target.value)}
                  style={{ ...inputStyle, fontSize: "13px", padding: "8px 10px", appearance: "auto" }}
                >
                  {WORKOUT_TYPES.map((w) => (
                    <option key={w.type} value={w.type}>{w.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <div style={{ fontSize: "10px", letterSpacing: "0.08em", color: T.textMuted, fontWeight: 700, marginBottom: "4px" }}>
                  MACROS
                </div>
                <select
                  value={d.bucket}
                  onChange={(e) => updateScheduleDay(i, "bucket", e.target.value)}
                  style={{ ...inputStyle, fontSize: "13px", padding: "8px 10px", appearance: "auto" }}
                >
                  {NUTRITION_BUCKETS.map((b) => (
                    <option key={b} value={b}>{NUTRITION_BUCKET_LABELS[b]}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        ))}

        <button
          onClick={restoreScheduleDefaults}
          style={{
            marginTop: "4px",
            width: "100%",
            padding: "10px",
            background: T.surface2,
            border: `1px dashed ${T.border2}`,
            color: T.textSub,
            borderRadius: "8px",
            cursor: "pointer",
            fontSize: "12px",
            fontWeight: 600,
            fontFamily: "inherit",
          }}
        >
          ↺ Restore default programme
        </button>
      </div>

      {/* ---- Programme context (free-text that the coach reads on every call) ---- */}
      <div style={sectionStyle}>
        <div style={sectionHeader}>PROGRAMME CONTEXT FOR THE COACH</div>
        <div style={{ ...labelStyle, marginBottom: "10px", textTransform: "none", letterSpacing: "0", fontSize: "12px", color: T.textSub, fontWeight: 500, lineHeight: 1.5 }}>
          Paste anything you want Coach Claude to remember — programme strategy,
          goals, training blocks, history, injury constraints, equipment notes.
          Read on every plan, revision, and post-session review.
        </div>
        <textarea
          value={programmeContext}
          onChange={(e) => { setProgrammeContext(e.target.value); markDirty(); }}
          placeholder="e.g. 12-week body-recomp block. 2RM Back Squat: 130kg. Coming back from a left-shoulder strain — avoid heavy overhead until week 6. Sat Olympic days focus on technique not load…"
          rows={10}
          style={{
            ...inputStyle,
            width: "100%",
            fontSize: "14px",
            lineHeight: 1.5,
            resize: "vertical",
            fontFamily: "inherit",
          }}
        />
        <div style={{ fontSize: "11px", color: T.textMuted, marginTop: "6px" }}>
          {programmeContext.length.toLocaleString()} characters
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

function MacroInput({ label, value, onChange }) {
  return (
    <div>
      <div
        style={{
          fontSize: "10px",
          letterSpacing: "0.1em",
          color: T.textMuted,
          fontWeight: 700,
          marginBottom: "4px",
        }}
      >
        {label}
      </div>
      <input
        type="number"
        inputMode="numeric"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{ ...inputStyle, fontSize: "15px", padding: "8px 10px", width: "100%" }}
      />
    </div>
  );
}

function numOrNull(v) {
  if (v === "" || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
