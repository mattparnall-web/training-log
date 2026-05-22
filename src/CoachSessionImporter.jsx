// Importer that loads today's Coach Claude plan and turns each exercise into
// an editable strength row (same shape the WhiteboardImporter produces) so
// you can review/edit/approve before logging.

import { useEffect, useState } from "react";

const SUPABASE_URL = "https://bbkxvbsutpvtuizonzsn.supabase.co";
const SUPABASE_KEY = "sb_publishable__8dc2jqeQIClVXwpZQCSWA_Y5yaV1ao";

async function sb(path) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
    },
  });
  if (!r.ok) throw new Error(`Supabase ${r.status}: ${await r.text()}`);
  return r.json();
}

// ---- Local design tokens (match the rest of the app) ----
const T = {
  bg: "#f8fafc", surface: "#ffffff", surface2: "#f1f5f9",
  border: "#e2e8f0", border2: "#cbd5e1",
  text: "#0f172a", textSub: "#475569", textMuted: "#94a3b8",
  overlay: "rgba(15,23,42,0.5)",
  accent: "#ea580c",
};

const inputStyle = {
  background: T.surface2,
  border: `1px solid ${T.border}`,
  borderRadius: "6px",
  color: T.text,
  padding: "6px 10px",
  fontSize: "13px",
  width: "70px",
  outline: "none",
  fontFamily: "inherit",
};

// ---- JSON extract (same heuristic as the Dashboard parser) ----
function tryExtractJSON(text) {
  try { return JSON.parse(text); } catch {}
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (fence) {
    try { return JSON.parse(fence[1]); } catch {}
  }
  const brace = text.match(/\{[\s\S]*\}/);
  if (brace) {
    try { return JSON.parse(brace[0]); } catch {}
  }
  return null;
}

// ---- Turn a prescription string like "4 × 6 @ 82 kg" into editable sets ----
function parsePrescription(text) {
  if (!text) return { sets: [{ reps: "", weight: "" }], unclear: true };

  const txt = String(text);

  // "N × R @ W kg" (with various separators + range support)
  let m = txt.match(/(\d+)\s*[×x*]\s*(\d+(?:[-–]\d+)?)\s*@\s*([\d.]+)\s*kg/i);
  if (m) {
    const nSets = Math.min(20, Math.max(1, parseInt(m[1], 10)));
    const reps = m[2].split(/[-–]/)[0];
    const weight = m[3];
    return {
      sets: Array.from({ length: nSets }, () => ({ reps, weight })),
      unclear: false,
    };
  }

  // "N × R" (no weight — bodyweight, ring, etc.)
  m = txt.match(/(\d+)\s*[×x*]\s*(\d+(?:[-–]\d+)?)/);
  if (m) {
    const nSets = Math.min(20, Math.max(1, parseInt(m[1], 10)));
    const reps = m[2].split(/[-–]/)[0];
    return {
      sets: Array.from({ length: nSets }, () => ({ reps, weight: "" })),
      unclear: false,
    };
  }

  // "N sets / N rounds"
  m = txt.match(/(\d+)\s+(?:sets?|rounds?)/i);
  if (m) {
    const nSets = Math.min(20, Math.max(1, parseInt(m[1], 10)));
    return {
      sets: Array.from({ length: nSets }, () => ({ reps: "", weight: "" })),
      unclear: false,
    };
  }

  // Descriptive (cardio, mobility, time-based) — single placeholder row, marked unclear.
  return { sets: [{ reps: "", weight: "" }], unclear: true };
}

function planToReviewExercises(planRow) {
  const raw = planRow?.plan_text || "";
  const json = tryExtractJSON(raw);
  if (!json || !Array.isArray(json.exercises)) return null;

  return json.exercises.map((ex) => {
    const parsed = parsePrescription(ex.prescription || "");
    return {
      name: ex.name || "Exercise",
      prescription: ex.prescription || "",
      note: ex.note || "",
      sets: parsed.sets,
      unclear: parsed.unclear,
    };
  });
}

function buildNotesFromPlan(planRow, originalExercises) {
  // Take Claude's summary + the original prescription strings so the user
  // keeps the context after import (raw prescriptions get flattened into
  // sets/reps, which can lose information like "Zone 2" or "RPE 8").
  const json = tryExtractJSON(planRow?.plan_text || "");
  const summary = json?.summary || planRow?.summary || "";
  const prescriptions = (originalExercises || [])
    .filter((ex) => ex.prescription)
    .map((ex) => `${ex.name}: ${ex.prescription}${ex.note ? ` — ${ex.note}` : ""}`)
    .join("\n");
  return [summary, "Coach plan:", prescriptions].filter(Boolean).join("\n\n");
}

// ===========================================================================
//                         COACH SESSION IMPORTER
// ===========================================================================
export default function CoachSessionImporter({ day, date, onImported, onCancel }) {
  const [step, setStep] = useState("loading"); // loading | review | empty | error
  const [exercises, setExercises] = useState([]);
  const [summary, setSummary] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const rows = await sb(`/planned_sessions?select=*&date=eq.${date}`);
        const row = rows?.[0];
        if (!row) {
          setStep("empty");
          return;
        }
        const exs = planToReviewExercises(row);
        if (!exs || exs.length === 0) {
          setStep("empty");
          return;
        }
        const json = tryExtractJSON(row.plan_text || "");
        setSummary(json?.summary || row.summary || "");
        setExercises(exs);
        setStep("review");
      } catch (e) {
        setErrorMsg(e.message || String(e));
        setStep("error");
      }
    })();
  }, [date]);

  // Edit handlers (mirror WhiteboardImporter)
  const updateName = (i, name) =>
    setExercises((p) => p.map((ex, idx) => (idx === i ? { ...ex, name } : ex)));
  const updateSet = (ei, si, field, val) =>
    setExercises((p) =>
      p.map((ex, idx) =>
        idx === ei
          ? {
              ...ex,
              sets: ex.sets.map((s, sidx) =>
                sidx === si ? { ...s, [field]: val } : s
              ),
            }
          : ex
      )
    );
  const removeSet = (ei, si) =>
    setExercises((p) =>
      p.map((ex, idx) =>
        idx === ei ? { ...ex, sets: ex.sets.filter((_, sidx) => sidx !== si) } : ex
      )
    );
  const addSet = (ei) =>
    setExercises((p) =>
      p.map((ex, idx) =>
        idx === ei ? { ...ex, sets: [...ex.sets, { reps: "", weight: "" }] } : ex
      )
    );
  const removeExercise = (i) =>
    setExercises((p) => p.filter((_, idx) => idx !== i));

  const confirm = () => {
    // Build the same shape WhiteboardImporter passes through
    const cleaned = exercises.map((ex) => ({
      name: ex.name,
      sets: ex.sets.length > 0 ? ex.sets : [{ reps: "", weight: "" }],
    }));
    const notes = buildNotesFromPlan({ summary, plan_text: JSON.stringify({ exercises }) }, exercises);
    onImported(cleaned, notes);
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: T.overlay,
        zIndex: 200,
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        padding: "20px",
        overflowY: "auto",
      }}
    >
      <div
        style={{
          background: T.surface,
          border: `1px solid ${T.border}`,
          borderRadius: "16px",
          width: "100%",
          maxWidth: "520px",
          padding: "24px",
          boxShadow: "0 20px 60px rgba(0,0,0,0.15)",
        }}
      >
        <div style={{ marginBottom: "20px" }}>
          <div
            style={{
              fontSize: "11px",
              color: T.accent,
              fontWeight: 700,
              letterSpacing: "0.1em",
              marginBottom: "4px",
            }}
          >
            🧠 IMPORT COACH PLAN
          </div>
          <div style={{ fontSize: "18px", fontWeight: 800, color: T.text }}>
            {day.name}
          </div>
        </div>

        {step === "loading" && (
          <div style={{ textAlign: "center", padding: "40px 0", color: T.textSub }}>
            <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
            <div
              style={{
                fontSize: "32px",
                marginBottom: "12px",
                display: "inline-block",
                animation: "spin 1.2s linear infinite",
                color: T.accent,
              }}
            >
              ◌
            </div>
            <div style={{ fontSize: "13px" }}>Loading today's plan…</div>
          </div>
        )}

        {step === "empty" && (
          <div style={{ padding: "20px 0" }}>
            <div
              style={{
                background: T.surface2,
                border: `1px dashed ${T.border2}`,
                borderRadius: "12px",
                padding: "20px",
                textAlign: "center",
                color: T.textMuted,
                fontSize: "13px",
                marginBottom: "16px",
              }}
            >
              No Coach Claude plan saved for <strong>{date}</strong>.
              <div style={{ marginTop: "8px", fontSize: "12px" }}>
                Open the <strong>Today</strong> tab and tap <strong>🧠 PLAN TODAY'S SESSION</strong> first.
              </div>
            </div>
            <button
              onClick={onCancel}
              style={{
                width: "100%",
                background: T.surface2,
                border: `1px solid ${T.border}`,
                color: T.textSub,
                borderRadius: "10px",
                padding: "12px",
                fontSize: "12px",
                fontWeight: 700,
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              CLOSE
            </button>
          </div>
        )}

        {step === "error" && (
          <div style={{ padding: "20px 0" }}>
            <div
              style={{
                background: "#fee2e2",
                color: "#991b1b",
                padding: "12px",
                borderRadius: "8px",
                fontSize: "12px",
                marginBottom: "12px",
              }}
            >
              Couldn't load the plan: {errorMsg}
            </div>
            <button
              onClick={onCancel}
              style={{
                width: "100%",
                background: T.surface2,
                border: `1px solid ${T.border}`,
                color: T.textSub,
                borderRadius: "10px",
                padding: "12px",
                fontSize: "12px",
                fontWeight: 700,
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              CLOSE
            </button>
          </div>
        )}

        {step === "review" && (
          <>
            {summary && (
              <div
                style={{
                  background: "#fff7ed",
                  border: `1px solid #fed7aa`,
                  borderRadius: "8px",
                  padding: "10px 12px",
                  fontSize: "12px",
                  color: "#7c2d12",
                  lineHeight: 1.5,
                  marginBottom: "16px",
                  fontStyle: "italic",
                }}
              >
                {summary}
              </div>
            )}

            <div
              style={{
                fontSize: "12px",
                color: T.textSub,
                marginBottom: "12px",
                fontWeight: 600,
                letterSpacing: "0.04em",
              }}
            >
              {exercises.length} exercise{exercises.length !== 1 ? "s" : ""} — review and edit before adding to the session.
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginBottom: "16px" }}>
              {exercises.map((ex, ei) => (
                <div
                  key={ei}
                  style={{
                    background: ex.unclear ? "#fefce8" : T.surface2,
                    border: `1px solid ${ex.unclear ? "#fde047" : T.border}`,
                    borderRadius: "10px",
                    padding: "10px",
                  }}
                >
                  <div style={{ display: "flex", gap: "8px", alignItems: "center", marginBottom: "6px" }}>
                    <input
                      value={ex.name}
                      onChange={(e) => updateName(ei, e.target.value)}
                      style={{
                        ...inputStyle,
                        flex: 1,
                        width: "auto",
                        fontWeight: 700,
                        background: T.surface,
                      }}
                    />
                    <button
                      onClick={() => removeExercise(ei)}
                      style={{
                        background: "transparent",
                        border: `1px solid ${T.border2}`,
                        color: T.textMuted,
                        borderRadius: "6px",
                        padding: "4px 8px",
                        cursor: "pointer",
                        fontSize: "12px",
                      }}
                    >
                      ×
                    </button>
                  </div>

                  {ex.prescription && (
                    <div
                      style={{
                        fontSize: "11px",
                        color: T.textMuted,
                        marginBottom: "8px",
                        fontFamily: "ui-monospace, 'SF Mono', Menlo, monospace",
                      }}
                    >
                      coach said: {ex.prescription}
                      {ex.note ? ` — ${ex.note}` : ""}
                    </div>
                  )}

                  {ex.sets.map((s, si) => (
                    <div
                      key={si}
                      style={{
                        display: "flex",
                        gap: "6px",
                        marginBottom: "4px",
                        alignItems: "center",
                      }}
                    >
                      <span
                        style={{
                          fontSize: "10px",
                          color: T.textMuted,
                          fontWeight: 700,
                          minWidth: "22px",
                        }}
                      >
                        SET {si + 1}
                      </span>
                      <input
                        type="number"
                        placeholder="reps"
                        value={s.reps}
                        onChange={(e) => updateSet(ei, si, "reps", e.target.value)}
                        style={inputStyle}
                      />
                      <input
                        type="number"
                        placeholder="kg"
                        value={s.weight}
                        onChange={(e) => updateSet(ei, si, "weight", e.target.value)}
                        style={inputStyle}
                      />
                      <button
                        onClick={() => removeSet(ei, si)}
                        style={{
                          background: "transparent",
                          border: "none",
                          color: T.textMuted,
                          cursor: "pointer",
                          opacity: 0.6,
                          padding: "2px 6px",
                        }}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                  <button
                    onClick={() => addSet(ei)}
                    style={{
                      background: T.surface,
                      border: `1px dashed ${T.border2}`,
                      color: T.textSub,
                      borderRadius: "6px",
                      padding: "4px 8px",
                      fontSize: "11px",
                      cursor: "pointer",
                      marginTop: "4px",
                      fontFamily: "inherit",
                    }}
                  >
                    + add set
                  </button>
                </div>
              ))}
            </div>

            <div style={{ display: "flex", gap: "10px" }}>
              <button
                onClick={onCancel}
                style={{
                  flex: 1,
                  background: T.surface2,
                  border: `1px solid ${T.border}`,
                  color: T.textSub,
                  borderRadius: "10px",
                  padding: "12px",
                  fontSize: "12px",
                  fontWeight: 700,
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                CANCEL
              </button>
              <button
                onClick={confirm}
                disabled={exercises.length === 0}
                style={{
                  flex: 2,
                  background: T.accent,
                  border: "none",
                  color: "#fff",
                  borderRadius: "10px",
                  padding: "12px",
                  fontSize: "12px",
                  fontWeight: 800,
                  cursor: "pointer",
                  letterSpacing: "0.05em",
                  fontFamily: "inherit",
                  boxShadow: "0 4px 12px rgba(234,88,12,0.25)",
                }}
              >
                ✓ ADD TO SESSION
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
