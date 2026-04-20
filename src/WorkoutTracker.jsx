import { useState, useEffect, useRef } from "react";

// --- SUPABASE CONFIG ---
const SUPABASE_URL = "https://bbkxvbsutpvtuizonzsn.supabase.co";
const SUPABASE_KEY = "sb_publishable__8dc2jqeQIClVXwpZQCSWA_Y5yaV1ao";

// Supabase REST helpers — direct fetch, no SDK needed
async function sbFetch(path, options = {}) {
  const resp = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    ...options,
    headers: {
      "apikey": SUPABASE_KEY,
      "Authorization": `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
      "Prefer": "return=representation",
      ...(options.headers || {})
    }
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Supabase ${resp.status}: ${text.substring(0, 200)}`);
  }
  return resp.status === 204 ? null : resp.json();
}

// Convert DB row <-> app session format
function rowToSession(r) {
  return {
    id: r.id,
    date: r.date,
    dayId: r.day_id,
    dayName: r.day_name,
    dayType: r.day_type,
    exercises: r.exercises || [],
    notes: r.notes || "",
    rpe: r.rpe
  };
}
function sessionToRow(s) {
  return {
    id: s.id,
    date: s.date,
    day_id: s.dayId,
    day_name: s.dayName,
    day_type: s.dayType,
    exercises: s.exercises,
    notes: s.notes || "",
    rpe: s.rpe
  };
}

async function cloudLoad() {
  const rows = await sbFetch("/sessions?select=*&order=date.asc");
  return rows.map(rowToSession);
}
async function cloudInsert(session) {
  const rows = await sbFetch("/sessions", { method: "POST", body: JSON.stringify(sessionToRow(session)) });
  return rows[0] ? rowToSession(rows[0]) : null;
}
async function cloudDelete(id) {
  await sbFetch(`/sessions?id=eq.${id}`, { method: "DELETE" });
}

// --- DATA CONSTANTS ---
const DAYS = [
  { id: "monday", label: "MON", name: "Upper Push", type: "upper_push", color: "#7c3aed" },
  { id: "tuesday", label: "TUE", name: "Lower — Squat", type: "lower_squat", color: "#2563eb" },
  { id: "wednesday", label: "WED", name: "Active Recovery", type: "recovery", color: "#16a34a" },
  { id: "thursday", label: "THU", name: "Upper Pull + Deadlifts", type: "upper_pull", color: "#0891b2" },
  { id: "friday", label: "FRI", name: "Flexible", type: "flexible", color: "#94a3b8" },
  { id: "saturday", label: "SAT", name: "Olympic Lifts + MetCon", type: "olympic", color: "#dc2626" },
  { id: "sunday", label: "SUN", name: "Zone 2 Cardio", type: "cardio", color: "#16a34a" },
];

const EXERCISE_TEMPLATES = {
  upper_push: ["Dumbbell Bench Press", "Overhead Press", "Incline Press", "Push-ups", "Dumbbell Shoulder Press", "Tricep Extension", "Chest Fly", "Arnold Press", "Close-grip Press", "Lateral Raise"],
  lower_squat: ["Back Squat", "Front Squat", "Goblet Squat", "Bulgarian Split Squat", "Dumbbell Squat", "Step-ups", "Lunges", "Calf Raise", "Leg Press (DB)", "Box Squat"],
  recovery: ["Mobility Work", "Foam Rolling", "Stretching", "Ice Bath", "Light Cycling", "Yoga Flow", "Breathwork"],
  upper_pull: ["Pull-ups", "Dumbbell Row", "Barbell Deadlift", "Romanian Deadlift", "Face Pull", "Bicep Curl", "Lat Pulldown", "Single-Arm Row", "Shrug", "Hammer Curl"],
  flexible: ["Pull-ups", "Dumbbell Bench Press", "Overhead Press", "Dumbbell Row", "Mobility Work", "Foam Rolling", "Ice Bath", "Light Cycling"],
  olympic: ["Barbell Clean", "Power Clean", "Barbell Snatch", "Push Press", "Clean & Jerk", "Hang Clean", "Muscle Snatch", "Rowing (metres)", "Cycling (mins)", "Burpees", "Box Jumps", "Wall Balls", "Thrusters", "Double Unders"],
  cardio: ["Cycling (mins)", "Rowing (mins)", "Walk/Jog", "Zone 2 Cycling"],
};

const T = {
  bg: "#f8fafc", surface: "#ffffff", surface2: "#f1f5f9",
  border: "#e2e8f0", border2: "#cbd5e1",
  text: "#0f172a", textSub: "#475569", textMuted: "#94a3b8",
  overlay: "rgba(15,23,42,0.5)",
};

const inputStyle = {
  background: T.surface2, border: `1px solid ${T.border}`, borderRadius: "6px",
  color: T.text, padding: "6px 10px", fontSize: "13px", width: "70px",
  outline: "none", fontFamily: "inherit"
};

// --- Icons ---
const PlusIcon = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>;
const TrashIcon = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/></svg>;
const ChevronIcon = ({ open }) => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ transform: open ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.2s" }}><polyline points="6 9 12 15 18 9"/></svg>;
const BarChartIcon = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="18" y="3" width="4" height="18"/><rect x="10" y="8" width="4" height="13"/><rect x="2" y="13" width="4" height="8"/></svg>;
const DumbellIcon = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="9" width="4" height="6" rx="1"/><rect x="18" y="9" width="4" height="6" rx="1"/><rect x="7" y="7" width="3" height="10" rx="1"/><rect x="14" y="7" width="3" height="10" rx="1"/><line x1="10" y1="12" x2="14" y2="12"/></svg>;
const CalendarIcon = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>;
const CameraIcon = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>;
const CheckIcon = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>;
const CloudIcon = () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/></svg>;
const DuplicateIcon = () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>;
const TimerIcon = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>;
const ZapIcon = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>;

// --- Sparkline ---
function MiniSparkline({ data, color }) {
  if (!data || data.length < 2) return null;
  const max = Math.max(...data), min = Math.min(...data), range = max - min || 1;
  const w = 80, h = 28, pad = 3;
  const pts = data.map((v, i) => `${pad + (i / (data.length - 1)) * (w - pad * 2)},${h - pad - ((v - min) / range) * (h - pad * 2)}`).join(" ");
  const last = pts.split(" ").pop().split(",");
  return <svg width={w} height={h} style={{ display: "block" }}><polyline points={pts} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /><circle cx={last[0]} cy={last[1]} r="3" fill={color} /></svg>;
}

// --- AI Analyse ---
function AnalyseButton({ sessions, onResult }) {
  const [loading, setLoading] = useState(false);
  async function analyse() {
    if (sessions.length < 2) { onResult("Log at least 2 sessions before requesting analysis."); return; }
    setLoading(true); onResult(null);
    try {
      const summary = sessions.slice(-20).map(s =>
        `${s.date} (${s.dayName}): ${s.exercises.map(e => `${e.name} - ${e.sets.map(st => `${st.reps}r@${st.weight}kg`).join(", ")}`).join("; ")}${s.notes ? ` | Notes: ${s.notes}` : ""}`
      ).join("\n");
      const resp = await fetch("/api/proxy", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-5", max_tokens: 1000,
          system: "You are an expert strength and conditioning coach specialising in body recomposition and hypertrophy. The user is a 39-year-old male training for body recomposition — reducing fat while building significant lower body muscle mass. He trains from a home gym with dumbbells, pull-up bar, rowing machine, cycling machine. Weekly: Mon recovery, Tue lower squat, Wed upper, Thu lower hinge, Fri power, Sat CrossFit, Sun Zone 2. Intermediate/advanced understanding — be mechanistic, specific, practical. No generic advice.",
          messages: [{ role: "user", content: `Recent sessions:\n\n${summary}\n\nAnalyse: 1) Progressive overload trends, 2) Weaknesses/imbalances, 3) Programme tweaks, 4) Priorities. Concise bullets.` }]
        })
      });
      const data = await resp.json();
      onResult(data.content?.find(b => b.type === "text")?.text || "No analysis returned.");
    } catch { onResult("Analysis failed — please try again."); }
    setLoading(false);
  }
  return (
    <button onClick={analyse} disabled={loading} style={{
      display: "flex", alignItems: "center", gap: "8px",
      background: loading ? T.surface2 : "linear-gradient(135deg, #ea580c, #dc2626)",
      color: loading ? T.textMuted : "#fff", border: loading ? `1px solid ${T.border}` : "none",
      borderRadius: "10px", padding: "10px 18px",
      cursor: loading ? "not-allowed" : "pointer", fontSize: "13px", fontWeight: "700",
      letterSpacing: "0.05em", opacity: loading ? 0.8 : 1, fontFamily: "inherit"
    }}>{loading ? "Analysing…" : <><BarChartIcon /> AI ANALYSIS</>}</button>
  );
}

// --- Whiteboard Scanner ---
function WhiteboardImporter({ day, onImported, onCancel }) {
  const [step, setStep] = useState("upload");
  const [imagePreview, setImagePreview] = useState(null);
  const [imageB64, setImageB64] = useState(null);
  const [imageType, setImageType] = useState("image/jpeg");
  const [parsed, setParsed] = useState(null);
  const [errorMsg, setErrorMsg] = useState("");
  const fileRef = useRef();
  const libraryRef = useRef();

  function handleFile(file) {
    if (!file) return;
    setImageType(file.type || "image/jpeg");
    const reader = new FileReader();
    reader.onload = e => { setImagePreview(e.target.result); setImageB64(e.target.result.split(",")[1]); setStep("ready"); };
    reader.readAsDataURL(file);
  }

  async function scan() {
    setStep("scanning");
    setErrorMsg("");
    try {
      const resp = await fetch("/api/proxy", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-5", max_tokens: 2000,
          messages: [{
            role: "user",
            content: [
              { type: "image", source: { type: "base64", media_type: imageType, data: imageB64 } },
              { type: "text", text: `Read this handwritten gym whiteboard. Exercise names on left in black, sets x reps in middle black, weights in red on right (comma-separated progression). Return ONLY JSON: {"exercises":[{"name":"...","sets":[{"reps":"5","weight":"70"}],"unclear":false}],"notes":""}. If progression like "70,75,80,85" with "4x5", create 4 sets with different weights. DB=Dumbbell, BSS=Bulgarian Split Squat, RDL=Romanian Deadlift. Weight numbers only, no kg. If unclear leave "" or mark unclear:true. If unreadable return {"exercises":[],"notes":"","unreadable":true}.` }
            ]
          }]
        })
      });
      if (!resp.ok) { throw new Error("API error " + resp.status); }
      const data = await resp.json();
      if (data.error) throw new Error(JSON.stringify(data.error));
      const text = data.content?.find(b => b.type === "text")?.text || "";
      if (!text) throw new Error("Empty response");
      const cleaned = text.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "").trim();
      const result = JSON.parse(cleaned);
      if (result.unreadable) { setParsed({ exercises: [], notes: "", unreadable: true }); setStep("review"); return; }
      if (!result.exercises || !Array.isArray(result.exercises)) throw new Error("bad structure");
      const exercises = result.exercises.map(ex => ({ ...ex, sets: ex.sets?.length > 0 ? ex.sets : [{ reps: "", weight: "" }] }));
      setParsed({ ...result, exercises });
      setStep("review");
    } catch (e) {
      setErrorMsg("Scan failed: " + (e.message || "Unknown"));
      setStep("error");
    }
  }

  function updateName(i, name) { setParsed(p => ({ ...p, exercises: p.exercises.map((ex, idx) => idx === i ? { ...ex, name } : ex) })); }
  function updateSet(ei, si, field, val) { setParsed(p => ({ ...p, exercises: p.exercises.map((ex, idx) => idx === ei ? { ...ex, sets: ex.sets.map((s, sidx) => sidx === si ? { ...s, [field]: val } : s) } : ex) })); }
  function removeExercise(i) { setParsed(p => ({ ...p, exercises: p.exercises.filter((_, idx) => idx !== i) })); }
  function removeSet(ei, si) { setParsed(p => ({ ...p, exercises: p.exercises.map((ex, idx) => idx === ei ? { ...ex, sets: ex.sets.filter((_, sidx) => sidx !== si) } : ex) })); }
  function addSet(ei) { setParsed(p => ({ ...p, exercises: p.exercises.map((ex, idx) => idx === ei ? { ...ex, sets: [...ex.sets, { reps: "", weight: "" }] } : ex) })); }

  return (
    <div style={{ position: "fixed", inset: 0, background: T.overlay, zIndex: 200, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "20px", overflowY: "auto" }}>
      <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: "16px", width: "100%", maxWidth: "520px", padding: "24px", boxShadow: "0 20px 60px rgba(0,0,0,0.15)" }}>
        <div style={{ marginBottom: "20px" }}>
          <div style={{ fontSize: "11px", color: "#0891b2", fontWeight: "700", letterSpacing: "0.1em", marginBottom: "4px" }}>WHITEBOARD SCAN</div>
          <div style={{ fontSize: "18px", fontWeight: "800", color: T.text }}>{day.name}</div>
        </div>
        {(step === "upload" || step === "ready") && (
          <>
            <input ref={fileRef} type="file" accept="image/*" capture="environment" style={{ display: "none" }} onChange={e => handleFile(e.target.files[0])} />
            <input ref={libraryRef} type="file" accept="image/*" style={{ display: "none" }} onChange={e => handleFile(e.target.files[0])} />
            {!imagePreview ? (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", marginBottom: "8px" }}>
                <button onClick={() => fileRef.current.click()} style={{ background: T.surface2, border: `2px dashed ${T.border2}`, borderRadius: "14px", padding: "28px 12px", cursor: "pointer", textAlign: "center" }}>
                  <div style={{ color: "#0891b2", marginBottom: "8px", display: "flex", justifyContent: "center" }}><CameraIcon /></div>
                  <div style={{ fontSize: "13px", color: T.textSub, fontWeight: "700" }}>Take Photo</div>
                  <div style={{ fontSize: "11px", color: T.textMuted, marginTop: "3px" }}>Open camera</div>
                </button>
                <button onClick={() => libraryRef.current.click()} style={{ background: T.surface2, border: `2px dashed ${T.border2}`, borderRadius: "14px", padding: "28px 12px", cursor: "pointer", textAlign: "center" }}>
                  <div style={{ color: "#7c3aed", marginBottom: "8px", display: "flex", justifyContent: "center" }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
                  </div>
                  <div style={{ fontSize: "13px", color: T.textSub, fontWeight: "700" }}>Upload Photo</div>
                  <div style={{ fontSize: "11px", color: T.textMuted, marginTop: "3px" }}>From library</div>
                </button>
              </div>
            ) : (
              <>
                <img src={imagePreview} alt="Whiteboard" style={{ width: "100%", borderRadius: "12px", marginBottom: "12px", border: `1px solid ${T.border}`, maxHeight: "280px", objectFit: "cover" }} />
                <div style={{ display: "flex", gap: "10px", marginBottom: "16px" }}>
                  <button onClick={() => fileRef.current.click()} style={{ background: "none", border: "none", color: T.textSub, fontSize: "12px", cursor: "pointer", fontFamily: "inherit" }}>📷 Retake</button>
                  <button onClick={() => libraryRef.current.click()} style={{ background: "none", border: "none", color: T.textSub, fontSize: "12px", cursor: "pointer", fontFamily: "inherit" }}>🖼 Choose different</button>
                </div>
              </>
            )}
            <div style={{ display: "flex", gap: "10px", marginTop: "8px" }}>
              <button onClick={onCancel} style={{ flex: 1, background: T.surface2, border: `1px solid ${T.border}`, color: T.textSub, borderRadius: "10px", padding: "12px", fontSize: "12px", fontWeight: "700", cursor: "pointer", fontFamily: "inherit" }}>CANCEL</button>
              <button onClick={scan} disabled={!imageB64} style={{
                flex: 2, background: imageB64 ? "linear-gradient(135deg, #0891b2, #2563eb)" : T.surface2,
                border: "none", color: imageB64 ? "#fff" : T.textMuted, borderRadius: "10px",
                padding: "12px", fontSize: "12px", fontWeight: "800",
                cursor: imageB64 ? "pointer" : "not-allowed", letterSpacing: "0.05em", fontFamily: "inherit",
                display: "flex", alignItems: "center", justifyContent: "center", gap: "8px"
              }}><CameraIcon /> SCAN WHITEBOARD</button>
            </div>
          </>
        )}
        {step === "scanning" && (
          <div style={{ textAlign: "center", padding: "48px 0" }}>
            <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
            <div style={{ fontSize: "36px", marginBottom: "16px", display: "inline-block", animation: "spin 1.2s linear infinite", color: "#0891b2" }}>◌</div>
            <div style={{ fontSize: "14px", color: T.textSub }}>Reading your whiteboard…</div>
          </div>
        )}
        {step === "error" && (
          <div style={{ textAlign: "center", padding: "32px 0" }}>
            <div style={{ fontSize: "14px", color: "#dc2626", marginBottom: "20px" }}>{errorMsg}</div>
            <button onClick={() => setStep("ready")} style={{ background: T.surface2, border: `1px solid ${T.border}`, color: T.textSub, borderRadius: "10px", padding: "10px 20px", fontSize: "13px", cursor: "pointer", fontFamily: "inherit" }}>Try Again</button>
          </div>
        )}
        {step === "review" && parsed && (
          <>
            {parsed.unreadable ? (
              <div style={{ background: "#fef9c3", border: "1px solid #fde047", borderRadius: "10px", padding: "12px 14px", marginBottom: "16px", fontSize: "12px", color: "#854d0e" }}>
                ⚠ Couldn't read the board. Add manually or rescan.
              </div>
            ) : (
              <div style={{ background: "#ecfeff", border: "1px solid #a5f3fc", borderRadius: "10px", padding: "10px 14px", marginBottom: "12px", fontSize: "12px", color: "#0e7490", display: "flex", alignItems: "center", gap: "8px" }}>
                <CheckIcon /> Scanned {parsed.exercises.length} exercise{parsed.exercises.length !== 1 ? "s" : ""} — review and confirm
              </div>
            )}
            {parsed.exercises.map((ex, ei) => (
              <div key={ei} style={{ background: T.surface2, border: `1px solid ${ex.unclear ? "#fde047" : T.border}`, borderRadius: "12px", marginBottom: "10px", padding: "12px 14px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "10px" }}>
                  <input value={ex.name} onChange={e => updateName(ei, e.target.value)} style={{ ...inputStyle, flex: 1, width: "auto", fontWeight: "700", borderColor: ex.unclear ? "#fde047" : T.border, background: ex.unclear ? "#fefce8" : T.surface2 }} />
                  <button onClick={() => removeExercise(ei)} style={{ background: "none", border: "none", color: T.textMuted, cursor: "pointer" }}><TrashIcon /></button>
                </div>
                {ex.sets.map((s, si) => (
                  <div key={si} style={{ display: "flex", gap: "8px", alignItems: "center", marginBottom: "6px" }}>
                    <span style={{ color: T.textMuted, fontSize: "12px", minWidth: "28px", fontWeight: "600" }}>#{si + 1}</span>
                    <input type="number" placeholder="reps" value={s.reps} onChange={e => updateSet(ei, si, "reps", e.target.value)} style={{ ...inputStyle, borderColor: s.unclear ? "#fde047" : T.border, background: s.unclear ? "#fefce8" : T.surface2 }} />
                    <span style={{ color: T.textMuted, fontSize: "12px" }}>×</span>
                    <input type="number" placeholder="kg" value={s.weight} onChange={e => updateSet(ei, si, "weight", e.target.value)} style={{ ...inputStyle, borderColor: s.unclear ? "#fde047" : T.border, background: s.unclear ? "#fefce8" : T.surface2 }} />
                    <button onClick={() => removeSet(ei, si)} style={{ background: "none", border: "none", color: T.textMuted, cursor: "pointer" }}><TrashIcon /></button>
                  </div>
                ))}
                <button onClick={() => addSet(ei)} style={{ background: T.surface, border: `1px solid ${T.border}`, color: T.textSub, borderRadius: "8px", padding: "5px 12px", fontSize: "12px", cursor: "pointer", fontFamily: "inherit" }}>+ set</button>
              </div>
            ))}
            <div style={{ display: "flex", gap: "10px" }}>
              <button onClick={() => setStep("ready")} style={{ flex: 1, background: T.surface2, border: `1px solid ${T.border}`, color: T.textSub, borderRadius: "10px", padding: "12px", fontSize: "12px", fontWeight: "700", cursor: "pointer", fontFamily: "inherit" }}>← RESCAN</button>
              {!parsed.unreadable && (
                <button onClick={() => onImported(parsed.exercises, parsed.notes || "")} style={{
                  flex: 2, background: "linear-gradient(135deg, #0891b2, #2563eb)", border: "none",
                  color: "#fff", borderRadius: "10px", padding: "12px", fontSize: "12px", fontWeight: "800",
                  cursor: "pointer", letterSpacing: "0.05em", fontFamily: "inherit",
                  display: "flex", alignItems: "center", justifyContent: "center", gap: "8px"
                }}><CheckIcon /> CONFIRM & LOG</button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// --- Set Row ---
function SetRow({ set, index, onChange, onRemove, onDuplicate, type }) {
  const isCardio = ["cardio", "recovery", "crossfit"].includes(type);
  return (
    <div style={{ display: "flex", gap: "8px", alignItems: "center", marginBottom: "6px" }}>
      <span style={{ color: T.textMuted, fontSize: "12px", minWidth: "28px", fontWeight: "600" }}>#{index + 1}</span>
      {isCardio ? (
        <>
          <input type="number" placeholder="mins/reps" value={set.reps} onChange={e => onChange({ ...set, reps: e.target.value })} style={inputStyle} />
          <input type="text" placeholder="distance/notes" value={set.weight} onChange={e => onChange({ ...set, weight: e.target.value })} style={{ ...inputStyle, width: "110px" }} />
        </>
      ) : (
        <>
          <input type="number" placeholder="reps" value={set.reps} onChange={e => onChange({ ...set, reps: e.target.value })} style={inputStyle} />
          <span style={{ color: T.textMuted, fontSize: "12px" }}>×</span>
          <input type="number" placeholder="kg" value={set.weight} onChange={e => onChange({ ...set, weight: e.target.value })} style={inputStyle} />
        </>
      )}
      <button onClick={onDuplicate} title="Duplicate set" style={{ background: "none", border: "none", color: T.textMuted, cursor: "pointer", padding: "4px" }}><DuplicateIcon /></button>
      <button onClick={onRemove} style={{ background: "none", border: "none", color: T.textMuted, cursor: "pointer", padding: "4px" }}><TrashIcon /></button>
    </div>
  );
}

// --- Exercise Card ---
function ExerciseCard({ exercise, onChange, onRemove, type, allHistory }) {
  const [open, setOpen] = useState(true);
  const history = allHistory.filter(s => s.exercises?.some(e => e.name === exercise.name));
  const pbWeight = history.reduce((max, s) => {
    const ex = s.exercises.find(e => e.name === exercise.name);
    return ex ? Math.max(max, ...ex.sets.map(st => parseFloat(st.weight) || 0)) : max;
  }, 0);
  const sparkData = history.slice(-8).map(s => {
    const ex = s.exercises.find(e => e.name === exercise.name);
    return ex ? Math.max(...ex.sets.map(st => parseFloat(st.weight) || 0)) : null;
  }).filter(Boolean);

  return (
    <div style={{ background: T.surface2, border: `1px solid ${T.border}`, borderRadius: "12px", marginBottom: "10px", overflow: "hidden" }}>
      <div onClick={() => setOpen(o => !o)} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 14px", cursor: "pointer" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px", color: T.textSub }}>
          <DumbellIcon />
          <span style={{ fontWeight: "700", fontSize: "14px", color: T.text }}>{exercise.name}</span>
          {pbWeight > 0 && <span style={{ fontSize: "11px", color: "#ea580c", fontWeight: "600" }}>PB {pbWeight}kg</span>}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          {sparkData.length > 1 && <MiniSparkline data={sparkData} color="#2563eb" />}
          <button onClick={e => { e.stopPropagation(); onRemove(); }} style={{ background: "none", border: "none", color: T.textMuted, cursor: "pointer", padding: "2px" }}><TrashIcon /></button>
          <span style={{ color: T.textMuted }}><ChevronIcon open={open} /></span>
        </div>
      </div>
      {open && (
        <div style={{ padding: "0 14px 14px" }}>
          {exercise.sets.map((set, i) => (
            <SetRow key={i} set={set} index={i} type={type}
              onChange={s => { const sets = [...exercise.sets]; sets[i] = s; onChange({ ...exercise, sets }); }}
              onDuplicate={() => { const sets = [...exercise.sets]; sets.splice(i + 1, 0, { ...set }); onChange({ ...exercise, sets }); }}
              onRemove={() => onChange({ ...exercise, sets: exercise.sets.filter((_, idx) => idx !== i) })} />
          ))}
          <div style={{ display: "flex", gap: "8px", marginTop: "4px" }}>
            <button onClick={() => onChange({ ...exercise, sets: [...exercise.sets, { reps: "", weight: "" }] })} style={{ background: T.surface, border: `1px solid ${T.border}`, color: T.textSub, borderRadius: "8px", padding: "6px 14px", fontSize: "12px", cursor: "pointer", display: "flex", alignItems: "center", gap: "6px", fontFamily: "inherit" }}><PlusIcon /> Add set</button>
            {exercise.sets.length > 0 && (
              <button onClick={() => { const last = exercise.sets[exercise.sets.length - 1]; onChange({ ...exercise, sets: [...exercise.sets, { ...last }] }); }} style={{ background: T.surface, border: `1px solid ${T.border}`, color: T.textSub, borderRadius: "8px", padding: "6px 14px", fontSize: "12px", cursor: "pointer", display: "flex", alignItems: "center", gap: "6px", fontFamily: "inherit" }}>
                <DuplicateIcon /> Duplicate last
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}


// --- AMRAP Logger ---
function AmrapLogger({ onSave, onCancel }) {
  const [name, setName] = useState("");
  const [timeCap, setTimeCap] = useState("");
  const [exercises, setExercises] = useState([{ name: "", reps: "" }]);
  const [rounds, setRounds] = useState("");
  const [extraReps, setExtraReps] = useState("");
  const [notes, setNotes] = useState("");

  function addExercise() { setExercises(e => [...e, { name: "", reps: "" }]); }
  function updateEx(i, field, val) { setExercises(e => e.map((ex, idx) => idx === i ? { ...ex, [field]: val } : ex)); }
  function removeEx(i) { setExercises(e => e.filter((_, idx) => idx !== i)); }

  function save() {
    const result = {
      name: name || "AMRAP",
      type: "amrap",
      timeCap: timeCap ? parseInt(timeCap) : null,
      exercises: exercises.filter(e => e.name),
      result: { rounds: rounds ? parseInt(rounds) : null, extraReps: extraReps ? parseInt(extraReps) : null },
      notes
    };
    onSave(result);
  }

  const valid = exercises.some(e => e.name) && (rounds || extraReps);

  return (
    <div style={{ background: "#fef3c7", border: "1px solid #f59e0b44", borderRadius: "14px", padding: "16px", marginBottom: "16px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "12px" }}>
        <ZapIcon /><span style={{ fontSize: "12px", fontWeight: "800", color: "#92400e", letterSpacing: "0.08em" }}>AMRAP</span>
      </div>
      <input placeholder="Name (e.g. The Chief)" value={name} onChange={e => setName(e.target.value)}
        style={{ ...inputStyle, width: "100%", marginBottom: "10px" }} />
      <div style={{ display: "flex", gap: "8px", alignItems: "center", marginBottom: "12px" }}>
        <TimerIcon />
        <input type="number" placeholder="Time cap (mins)" value={timeCap} onChange={e => setTimeCap(e.target.value)}
          style={{ ...inputStyle, width: "140px" }} />
      </div>
      <div style={{ fontSize: "11px", color: "#92400e", fontWeight: "700", marginBottom: "6px", letterSpacing: "0.08em" }}>MOVEMENTS</div>
      {exercises.map((ex, i) => (
        <div key={i} style={{ display: "flex", gap: "6px", marginBottom: "6px" }}>
          <input placeholder="Exercise" value={ex.name} onChange={e => updateEx(i, "name", e.target.value)}
            style={{ ...inputStyle, flex: 2, width: "auto" }} />
          <input type="number" placeholder="reps" value={ex.reps} onChange={e => updateEx(i, "reps", e.target.value)}
            style={{ ...inputStyle, width: "60px" }} />
          <button onClick={() => removeEx(i)} style={{ background: "none", border: "none", color: T.textMuted, cursor: "pointer" }}><TrashIcon /></button>
        </div>
      ))}
      <button onClick={addExercise} style={{ background: "none", border: "none", color: "#92400e", fontSize: "12px", cursor: "pointer", fontFamily: "inherit", marginBottom: "12px" }}>+ movement</button>
      <div style={{ fontSize: "11px", color: "#92400e", fontWeight: "700", marginBottom: "6px", letterSpacing: "0.08em" }}>RESULT</div>
      <div style={{ display: "flex", gap: "8px", alignItems: "center", marginBottom: "10px" }}>
        <input type="number" placeholder="Rounds" value={rounds} onChange={e => setRounds(e.target.value)} style={{ ...inputStyle, width: "90px" }} />
        <span style={{ color: T.textMuted, fontSize: "12px" }}>rounds +</span>
        <input type="number" placeholder="reps" value={extraReps} onChange={e => setExtraReps(e.target.value)} style={{ ...inputStyle, width: "70px" }} />
        <span style={{ color: T.textMuted, fontSize: "12px" }}>reps</span>
      </div>
      <input placeholder="Notes…" value={notes} onChange={e => setNotes(e.target.value)} style={{ ...inputStyle, width: "100%", marginBottom: "10px" }} />
      <div style={{ display: "flex", gap: "8px" }}>
        <button onClick={onCancel} style={{ flex: 1, background: T.surface, border: `1px solid ${T.border}`, color: T.textSub, borderRadius: "8px", padding: "8px", fontSize: "12px", cursor: "pointer", fontFamily: "inherit" }}>Cancel</button>
        <button onClick={save} disabled={!valid} style={{ flex: 2, background: valid ? "#f59e0b" : T.surface2, border: "none", color: valid ? "#fff" : T.textMuted, borderRadius: "8px", padding: "8px", fontSize: "12px", fontWeight: "700", cursor: valid ? "pointer" : "not-allowed", fontFamily: "inherit" }}>Add AMRAP</button>
      </div>
    </div>
  );
}

// --- EMOM Logger ---
function EmomLogger({ onSave, onCancel }) {
  const [name, setName] = useState("");
  const [duration, setDuration] = useState("");
  const [interval, setInterval] = useState("1");
  const [exercises, setExercises] = useState([{ name: "", reps: "" }]);
  const [completed, setCompleted] = useState("");
  const [notes, setNotes] = useState("");

  function addExercise() { setExercises(e => [...e, { name: "", reps: "" }]); }
  function updateEx(i, field, val) { setExercises(e => e.map((ex, idx) => idx === i ? { ...ex, [field]: val } : ex)); }
  function removeEx(i) { setExercises(e => e.filter((_, idx) => idx !== i)); }

  function save() {
    const result = {
      name: name || "EMOM",
      type: "emom",
      duration: duration ? parseInt(duration) : null,
      interval: interval ? parseInt(interval) : 1,
      exercises: exercises.filter(e => e.name),
      result: { completed: completed ? parseInt(completed) : null },
      notes
    };
    onSave(result);
  }

  const valid = exercises.some(e => e.name) && duration;

  return (
    <div style={{ background: "#ede9fe", border: "1px solid #7c3aed44", borderRadius: "14px", padding: "16px", marginBottom: "16px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "12px" }}>
        <TimerIcon /><span style={{ fontSize: "12px", fontWeight: "800", color: "#4c1d95", letterSpacing: "0.08em" }}>EMOM</span>
      </div>
      <input placeholder="Name (e.g. Squat EMOM)" value={name} onChange={e => setName(e.target.value)}
        style={{ ...inputStyle, width: "100%", marginBottom: "10px" }} />
      <div style={{ display: "flex", gap: "8px", alignItems: "center", marginBottom: "12px" }}>
        <TimerIcon />
        <input type="number" placeholder="Total mins" value={duration} onChange={e => setDuration(e.target.value)} style={{ ...inputStyle, width: "100px" }} />
        <span style={{ color: T.textMuted, fontSize: "12px" }}>mins, every</span>
        <input type="number" placeholder="1" value={interval} onChange={e => setInterval(e.target.value)} style={{ ...inputStyle, width: "50px" }} />
        <span style={{ color: T.textMuted, fontSize: "12px" }}>min</span>
      </div>
      <div style={{ fontSize: "11px", color: "#4c1d95", fontWeight: "700", marginBottom: "6px", letterSpacing: "0.08em" }}>MOVEMENTS PER INTERVAL</div>
      {exercises.map((ex, i) => (
        <div key={i} style={{ display: "flex", gap: "6px", marginBottom: "6px" }}>
          <input placeholder="Exercise" value={ex.name} onChange={e => updateEx(i, "name", e.target.value)}
            style={{ ...inputStyle, flex: 2, width: "auto" }} />
          <input type="number" placeholder="reps" value={ex.reps} onChange={e => updateEx(i, "reps", e.target.value)}
            style={{ ...inputStyle, width: "60px" }} />
          <button onClick={() => removeEx(i)} style={{ background: "none", border: "none", color: T.textMuted, cursor: "pointer" }}><TrashIcon /></button>
        </div>
      ))}
      <button onClick={addExercise} style={{ background: "none", border: "none", color: "#4c1d95", fontSize: "12px", cursor: "pointer", fontFamily: "inherit", marginBottom: "12px" }}>+ movement</button>
      <div style={{ fontSize: "11px", color: "#4c1d95", fontWeight: "700", marginBottom: "6px", letterSpacing: "0.08em" }}>RESULT</div>
      <div style={{ display: "flex", gap: "8px", alignItems: "center", marginBottom: "10px" }}>
        <input type="number" placeholder="Rounds completed" value={completed} onChange={e => setCompleted(e.target.value)} style={{ ...inputStyle, width: "140px" }} />
        <span style={{ color: T.textMuted, fontSize: "12px" }}>/ {duration && interval ? Math.floor(parseInt(duration) / parseInt(interval)) : "?"} rounds</span>
      </div>
      <input placeholder="Notes…" value={notes} onChange={e => setNotes(e.target.value)} style={{ ...inputStyle, width: "100%", marginBottom: "10px" }} />
      <div style={{ display: "flex", gap: "8px" }}>
        <button onClick={onCancel} style={{ flex: 1, background: T.surface, border: `1px solid ${T.border}`, color: T.textSub, borderRadius: "8px", padding: "8px", fontSize: "12px", cursor: "pointer", fontFamily: "inherit" }}>Cancel</button>
        <button onClick={save} disabled={!valid} style={{ flex: 2, background: valid ? "#7c3aed" : T.surface2, border: "none", color: valid ? "#fff" : T.textMuted, borderRadius: "8px", padding: "8px", fontSize: "12px", fontWeight: "700", cursor: valid ? "pointer" : "not-allowed", fontFamily: "inherit" }}>Add EMOM</button>
      </div>
    </div>
  );
}

// --- Complex display card in session ---
function ComplexCard({ complex, onRemove }) {
  const isAmrap = complex.type === "amrap";
  const bg = isAmrap ? "#fef3c7" : "#ede9fe";
  const border = isAmrap ? "#f59e0b44" : "#7c3aed44";
  const accent = isAmrap ? "#92400e" : "#4c1d95";
  const badge = isAmrap ? "#f59e0b" : "#7c3aed";

  return (
    <div style={{ background: bg, border: `1px solid ${border}`, borderRadius: "12px", padding: "12px 14px", marginBottom: "10px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "6px" }}>
            <span style={{ background: badge, color: "#fff", fontSize: "10px", fontWeight: "800", padding: "2px 8px", borderRadius: "10px", letterSpacing: "0.08em" }}>{complex.type.toUpperCase()}</span>
            <span style={{ fontSize: "13px", fontWeight: "700", color: accent }}>{complex.name}</span>
            {complex.timeCap && <span style={{ fontSize: "11px", color: accent }}>· {complex.timeCap} min cap</span>}
            {complex.duration && <span style={{ fontSize: "11px", color: accent }}>· {complex.duration} mins</span>}
          </div>
          <div style={{ fontSize: "12px", color: accent, marginBottom: "4px" }}>
            {complex.exercises.map(e => `${e.reps ? e.reps + "× " : ""}${e.name}`).join(" → ")}
          </div>
          {complex.result && (
            <div style={{ fontSize: "12px", fontWeight: "700", color: accent }}>
              {isAmrap && complex.result.rounds !== null && `${complex.result.rounds} rounds${complex.result.extraReps ? ` + ${complex.result.extraReps} reps` : ""}`}
              {!isAmrap && complex.result.completed !== null && `${complex.result.completed}/${complex.duration && complex.interval ? Math.floor(complex.duration / complex.interval) : "?"} rounds completed`}
            </div>
          )}
          {complex.notes && <div style={{ fontSize: "11px", color: accent, fontStyle: "italic", marginTop: "4px" }}>"{complex.notes}"</div>}
        </div>
        <button onClick={onRemove} style={{ background: "none", border: "none", color: accent, cursor: "pointer", opacity: 0.5 }}><TrashIcon /></button>
      </div>
    </div>
  );
}

// --- Session Logger ---
function SessionLogger({ day, sessions, onSave, onClose }) {
  const today = new Date().toISOString().split("T")[0];
  const [date, setDate] = useState(today);
  const [exercises, setExercises] = useState([]);
  const [customExercise, setCustomExercise] = useState("");
  const [notes, setNotes] = useState("");
  const [rpe, setRpe] = useState("");
  const [showScanner, setShowScanner] = useState(false);
  const [showAmrap, setShowAmrap] = useState(false);
  const [showEmom, setShowEmom] = useState(false);
  const [complexes, setComplexes] = useState([]);
  const [saving, setSaving] = useState(false);
  const templates = EXERCISE_TEMPLATES[day.type] || [];

  function addExercise(name) {
    if (!name.trim()) return;
    setExercises(ex => [...ex, { name, sets: [{ reps: "", weight: "" }] }]);
    setCustomExercise("");
  }

  function handleImported(importedExercises, importedNotes) {
    setExercises(importedExercises);
    if (importedNotes) setNotes(importedNotes);
    setShowScanner(false);
  }

  async function save() {
    if ((exercises.length === 0 && complexes.length === 0) || saving) return;
    setSaving(true);
    await onSave({ id: Date.now(), date, dayId: day.id, dayName: day.name, dayType: day.type, exercises, complexes, notes, rpe: rpe ? parseInt(rpe) : null });
    setSaving(false);
    onClose();
  }

  return (
    <>
      {showScanner && <WhiteboardImporter day={day} onImported={handleImported} onCancel={() => setShowScanner(false)} />}
      <div style={{ position: "fixed", inset: 0, background: T.overlay, zIndex: 100, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "20px", overflowY: "auto" }}>
        <div style={{ background: T.surface, border: `1px solid ${day.color}44`, borderRadius: "16px", width: "100%", maxWidth: "520px", padding: "24px", boxShadow: "0 20px 60px rgba(0,0,0,0.12)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
            <div>
              <div style={{ fontSize: "11px", color: day.color, fontWeight: "700", letterSpacing: "0.1em", marginBottom: "4px" }}>LOG SESSION</div>
              <div style={{ fontSize: "20px", fontWeight: "800", color: T.text }}>{day.name}</div>
            </div>
            <input type="date" value={date} onChange={e => setDate(e.target.value)} style={{ ...inputStyle, width: "140px", fontSize: "12px" }} />
          </div>

          <button onClick={() => setShowScanner(true)} style={{
            width: "100%", background: "#ecfeff", border: "1px solid #a5f3fc",
            borderRadius: "12px", padding: "14px", marginBottom: "10px",
            cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: "10px",
            color: "#0891b2", fontSize: "13px", fontWeight: "700", letterSpacing: "0.06em", fontFamily: "inherit"
          }}><CameraIcon /> SCAN WHITEBOARD PHOTO</button>

          {/* Complex buttons */}
          <div style={{ display: "flex", gap: "8px", marginBottom: "20px" }}>
            <button onClick={() => { setShowAmrap(true); setShowEmom(false); }} style={{
              flex: 1, background: "#fef3c7", border: "1px solid #f59e0b44", borderRadius: "10px",
              padding: "10px", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: "6px",
              color: "#92400e", fontSize: "12px", fontWeight: "700", fontFamily: "inherit"
            }}><ZapIcon /> AMRAP</button>
            <button onClick={() => { setShowEmom(true); setShowAmrap(false); }} style={{
              flex: 1, background: "#ede9fe", border: "1px solid #7c3aed44", borderRadius: "10px",
              padding: "10px", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: "6px",
              color: "#4c1d95", fontSize: "12px", fontWeight: "700", fontFamily: "inherit"
            }}><TimerIcon /> EMOM</button>
          </div>

          {showAmrap && <AmrapLogger onSave={c => { setComplexes(prev => [...prev, c]); setShowAmrap(false); }} onCancel={() => setShowAmrap(false)} />}
          {showEmom && <EmomLogger onSave={c => { setComplexes(prev => [...prev, c]); setShowEmom(false); }} onCancel={() => setShowEmom(false)} />}
          {complexes.map((c, i) => <ComplexCard key={i} complex={c} onRemove={() => setComplexes(prev => prev.filter((_, idx) => idx !== i))} />)}

          <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "16px" }}>
            <div style={{ flex: 1, height: "1px", background: T.border }} />
            <span style={{ fontSize: "11px", color: T.textMuted }}>OR ADD MANUALLY</span>
            <div style={{ flex: 1, height: "1px", background: T.border }} />
          </div>

          <div style={{ marginBottom: "16px" }}>
            <div style={{ fontSize: "11px", color: T.textSub, fontWeight: "700", letterSpacing: "0.08em", marginBottom: "8px" }}>QUICK ADD</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
              {templates.filter(t => !exercises.find(e => e.name === t)).map(t => (
                <button key={t} onClick={() => addExercise(t)} style={{ background: T.surface2, border: `1px solid ${T.border}`, color: T.textSub, borderRadius: "20px", padding: "5px 12px", fontSize: "12px", cursor: "pointer", fontFamily: "inherit" }}>{t}</button>
              ))}
            </div>
          </div>

          <div style={{ display: "flex", gap: "8px", marginBottom: "20px" }}>
            <input placeholder="Custom exercise…" value={customExercise}
              onChange={e => setCustomExercise(e.target.value)}
              onKeyDown={e => e.key === "Enter" && addExercise(customExercise)}
              style={{ ...inputStyle, flex: 1, width: "auto" }} />
            <button onClick={() => addExercise(customExercise)} style={{ background: T.surface2, border: `1px solid ${T.border}`, color: T.textSub, borderRadius: "8px", padding: "6px 12px", cursor: "pointer", fontFamily: "inherit" }}><PlusIcon /></button>
          </div>

          {exercises.map((ex, i) => (
            <ExerciseCard key={i} exercise={ex} type={day.type} allHistory={sessions}
              onChange={updated => setExercises(exs => exs.map((e, idx) => idx === i ? updated : e))}
              onRemove={() => setExercises(exs => exs.filter((_, idx) => idx !== i))} />
          ))}

          <div style={{ display: "flex", gap: "10px", marginBottom: "16px", marginTop: "8px" }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: "11px", color: T.textSub, fontWeight: "700", marginBottom: "6px", letterSpacing: "0.08em" }}>RPE (1–10)</div>
              <input type="number" min="1" max="10" placeholder="8" value={rpe} onChange={e => setRpe(e.target.value)} style={{ ...inputStyle, width: "100%" }} />
            </div>
            <div style={{ flex: 3 }}>
              <div style={{ fontSize: "11px", color: T.textSub, fontWeight: "700", marginBottom: "6px", letterSpacing: "0.08em" }}>NOTES</div>
              <input placeholder="How did it feel?" value={notes} onChange={e => setNotes(e.target.value)} style={{ ...inputStyle, width: "100%" }} />
            </div>
          </div>

          <div style={{ display: "flex", gap: "10px" }}>
            <button onClick={onClose} style={{ flex: 1, background: T.surface2, border: `1px solid ${T.border}`, color: T.textSub, borderRadius: "10px", padding: "12px", fontSize: "13px", fontWeight: "700", cursor: "pointer", fontFamily: "inherit" }}>CANCEL</button>
            <button onClick={save} disabled={(exercises.length === 0 && complexes.length === 0) || saving} style={{
              flex: 2, background: (exercises.length > 0 || complexes.length > 0) && !saving ? `linear-gradient(135deg, ${day.color}dd, ${day.color})` : T.surface2,
              border: "none", color: (exercises.length > 0 || complexes.length > 0) && !saving ? "#fff" : T.textMuted, borderRadius: "10px",
              padding: "12px", fontSize: "13px", fontWeight: "800",
              cursor: (exercises.length > 0 || complexes.length > 0) && !saving ? "pointer" : "not-allowed", letterSpacing: "0.05em", fontFamily: "inherit"
            }}>{saving ? "SAVING…" : "SAVE SESSION"}</button>
          </div>
        </div>
      </div>
    </>
  );
}


// --- Calendar View ---
function CalendarView({ sessions }) {
  const today = new Date();
  const [currentMonth, setCurrentMonth] = useState(new Date(today.getFullYear(), today.getMonth(), 1));

  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth();

  // Build a map of date -> session
  const sessionMap = {};
  for (const s of sessions) {
    if (!sessionMap[s.date]) sessionMap[s.date] = [];
    sessionMap[s.date].push(s);
  }

  // Day type colours
  const typeColor = {
    recovery: "#16a34a",
    lower_squat: "#2563eb",
    upper: "#7c3aed",
    lower_hinge: "#2563eb",
    power: "#ea580c",
    crossfit: "#dc2626",
    cardio: "#16a34a",
  };

  // Days in month grid
  const firstDay = new Date(year, month, 1).getDay(); // 0=Sun
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  // Shift so Mon=0
  const offset = (firstDay + 6) % 7;

  const cells = [];
  for (let i = 0; i < offset; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  function dateStr(d) {
    return `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }

  const todayStr = today.toISOString().split("T")[0];
  const monthNames = ["January","February","March","April","May","June","July","August","September","October","November","December"];

  // Stats for this month
  const monthSessions = sessions.filter(s => s.date.startsWith(`${year}-${String(month+1).padStart(2,"0")}`));
  const typeCounts = {};
  for (const s of monthSessions) {
    typeCounts[s.dayType] = (typeCounts[s.dayType] || 0) + 1;
  }

  return (
    <div>
      {/* Month nav */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
        <button onClick={() => setCurrentMonth(new Date(year, month - 1, 1))} style={{ background: T.surface2, border: `1px solid ${T.border}`, borderRadius: "8px", padding: "8px 14px", cursor: "pointer", fontSize: "16px", color: T.textSub }}>‹</button>
        <div style={{ fontSize: "16px", fontWeight: "800", color: T.text }}>{monthNames[month]} {year}</div>
        <button onClick={() => setCurrentMonth(new Date(year, month + 1, 1))} style={{ background: T.surface2, border: `1px solid ${T.border}`, borderRadius: "8px", padding: "8px 14px", cursor: "pointer", fontSize: "16px", color: T.textSub }}>›</button>
      </div>

      {/* Day labels */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: "3px", marginBottom: "3px" }}>
        {["M","T","W","T","F","S","S"].map((d, i) => (
          <div key={i} style={{ textAlign: "center", fontSize: "11px", fontWeight: "700", color: T.textMuted, padding: "4px 0" }}>{d}</div>
        ))}
      </div>

      {/* Calendar grid */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: "3px", marginBottom: "24px" }}>
        {cells.map((day, i) => {
          if (!day) return <div key={i} />;
          const ds = dateStr(day);
          const daySessions = sessionMap[ds] || [];
          const isToday = ds === todayStr;
          const isFuture = ds > todayStr;
          const colors = daySessions.map(s => typeColor[s.dayType] || "#94a3b8");

          return (
            <div key={i} style={{
              background: isToday ? "#0f172a" : daySessions.length > 0 ? T.surface : isFuture ? T.bg : T.surface2,
              border: `1px solid ${isToday ? "#0f172a" : daySessions.length > 0 ? colors[0] + "66" : T.border}`,
              borderRadius: "8px", padding: "6px 4px", textAlign: "center", minHeight: "48px",
              display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "space-between"
            }}>
              <div style={{ fontSize: "12px", fontWeight: isToday ? "800" : "600", color: isToday ? "#fff" : isFuture ? T.textMuted : T.textSub }}>
                {day}
              </div>
              {daySessions.length > 0 && (
                <div style={{ display: "flex", gap: "2px", flexWrap: "wrap", justifyContent: "center" }}>
                  {colors.map((c, ci) => (
                    <div key={ci} style={{ width: "8px", height: "8px", borderRadius: "50%", background: c }} />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Month summary */}
      <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: "14px", padding: "16px", marginBottom: "16px" }}>
        <div style={{ fontSize: "11px", color: T.textMuted, fontWeight: "700", letterSpacing: "0.1em", marginBottom: "12px" }}>
          {monthNames[month].toUpperCase()} SUMMARY
        </div>
        <div style={{ fontSize: "24px", fontFamily: "'Bebas Neue', cursive", color: T.text, marginBottom: "12px" }}>
          {monthSessions.length} <span style={{ fontSize: "14px", fontWeight: "400", fontFamily: "inherit", color: T.textSub }}>sessions</span>
        </div>
        {Object.keys(typeCounts).length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            {Object.entries(typeCounts).map(([type, count]) => {
              const day = DAYS.find(d => d.type === type);
              return (
                <div key={type} style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <div style={{ width: "10px", height: "10px", borderRadius: "50%", background: typeColor[type] || "#94a3b8", flexShrink: 0 }} />
                  <div style={{ fontSize: "12px", color: T.textSub, flex: 1 }}>{day?.name || type}</div>
                  <div style={{ fontSize: "12px", fontWeight: "700", color: T.text }}>{count}</div>
                </div>
              );
            })}
          </div>
        )}
        {monthSessions.length === 0 && (
          <div style={{ fontSize: "13px", color: T.textMuted }}>No sessions this month yet.</div>
        )}
      </div>

      {/* Legend */}
      <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: "14px", padding: "16px" }}>
        <div style={{ fontSize: "11px", color: T.textMuted, fontWeight: "700", letterSpacing: "0.1em", marginBottom: "10px" }}>LEGEND</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px" }}>
          {DAYS.filter((d, i, arr) => arr.findIndex(x => x.color === d.color && x.name === d.name) === i).map(day => (
            <div key={day.id} style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <div style={{ width: "8px", height: "8px", borderRadius: "50%", background: day.color, flexShrink: 0 }} />
              <div style={{ fontSize: "11px", color: T.textSub }}>{day.name}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// --- History ---
function HistoryView({ sessions, onDelete }) {
  const [analysis, setAnalysis] = useState(null);
  const sorted = [...sessions].sort((a, b) => b.date.localeCompare(a.date));
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
        <div style={{ fontSize: "13px", color: T.textSub }}>{sessions.length} sessions logged</div>
        <AnalyseButton sessions={sessions} onResult={setAnalysis} />
      </div>
      {analysis && (
        <div style={{ background: "#fff7ed", border: "1px solid #fed7aa", borderRadius: "14px", padding: "18px", marginBottom: "20px" }}>
          <div style={{ fontSize: "11px", color: "#ea580c", fontWeight: "700", letterSpacing: "0.1em", marginBottom: "10px" }}>AI ANALYSIS</div>
          <div style={{ fontSize: "13px", color: T.text, lineHeight: "1.7", whiteSpace: "pre-wrap" }}>{analysis}</div>
          <button onClick={() => setAnalysis(null)} style={{ marginTop: "12px", background: "none", border: "none", color: T.textMuted, fontSize: "12px", cursor: "pointer", fontFamily: "inherit" }}>Dismiss</button>
        </div>
      )}
      {sorted.length === 0 ? (
        <div style={{ textAlign: "center", color: T.textMuted, padding: "40px", fontSize: "14px" }}>No sessions yet. Tap a day to log your first session.</div>
      ) : sorted.map(session => {
        const day = DAYS.find(d => d.id === session.dayId);
        const color = day?.color || "#2563eb";
        return (
          <div key={session.id} style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: "14px", marginBottom: "12px", overflow: "hidden", boxShadow: "0 1px 4px rgba(0,0,0,0.05)" }}>
            <div style={{ borderLeft: `3px solid ${color}`, padding: "14px 16px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "8px" }}>
                <div>
                  <span style={{ fontSize: "11px", color, fontWeight: "700", letterSpacing: "0.08em" }}>{session.dayName?.toUpperCase()}</span>
                  <div style={{ fontSize: "13px", color: T.textSub, display: "flex", alignItems: "center", gap: "5px", marginTop: "2px" }}>
                    <CalendarIcon /> {session.date}
                    {session.rpe && <span style={{ marginLeft: "8px", color: "#ea580c", fontWeight: "600" }}>RPE {session.rpe}</span>}
                  </div>
                </div>
                <button onClick={() => onDelete(session.id)} style={{ background: "none", border: "none", color: T.textMuted, cursor: "pointer", padding: "4px" }}><TrashIcon /></button>
              </div>
              {session.exercises.map((ex, i) => (
                <div key={i} style={{ marginBottom: "6px" }}>
                  <span style={{ fontSize: "13px", color: T.text, fontWeight: "600" }}>{ex.name}</span>
                  <span style={{ fontSize: "12px", color: T.textSub, marginLeft: "8px" }}>
                    {ex.sets.map(s => s.weight ? `${s.reps}×${s.weight}kg` : `${s.reps}`).join("  ")}
                  </span>
                </div>
              ))}
              {(session.complexes || []).map((c, i) => (
                <div key={i} style={{ marginBottom: "4px", display: "flex", alignItems: "center", gap: "6px" }}>
                  <span style={{ background: c.type === "amrap" ? "#f59e0b" : "#7c3aed", color: "#fff", fontSize: "9px", fontWeight: "800", padding: "1px 6px", borderRadius: "8px" }}>{c.type.toUpperCase()}</span>
                  <span style={{ fontSize: "13px", color: T.text, fontWeight: "600" }}>{c.name}</span>
                  {c.result?.rounds != null && <span style={{ fontSize: "12px", color: T.textSub }}>{c.result.rounds}r+{c.result.extraReps || 0}</span>}
                  {c.result?.completed != null && <span style={{ fontSize: "12px", color: T.textSub }}>{c.result.completed} rounds</span>}
                </div>
              ))}
              {session.notes && <div style={{ fontSize: "12px", color: T.textMuted, fontStyle: "italic", marginTop: "6px" }}>"{session.notes}"</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// --- Main ---
export default function WorkoutTracker() {
  const [sessions, setSessions] = useState([]);
  const [view, setView] = useState("log");
  const [activeDay, setActiveDay] = useState(null);
  const [syncStatus, setSyncStatus] = useState("loading"); // loading | synced | error
  const [loadError, setLoadError] = useState(null);

  // Load from Supabase on mount
  useEffect(() => {
    cloudLoad().then(data => {
      setSessions(data);
      setSyncStatus("synced");
    }).catch(err => {
      setLoadError(err.message);
      setSyncStatus("error");
    });
  }, []);

  async function addSession(s) {
    try {
      setSyncStatus("saving");
      const saved = await cloudInsert(s);
      setSessions(prev => [...prev, saved || s]);
      setSyncStatus("synced");
    } catch (err) {
      setLoadError(err.message);
      setSyncStatus("error");
    }
  }

  async function deleteSession(id) {
    try {
      setSyncStatus("saving");
      await cloudDelete(id);
      setSessions(prev => prev.filter(s => s.id !== id));
      setSyncStatus("synced");
    } catch (err) {
      setLoadError(err.message);
      setSyncStatus("error");
    }
  }

  const todayDay = DAYS[new Date().getDay() === 0 ? 6 : new Date().getDay() - 1];

  const syncLabel = { loading: "Loading…", saving: "Saving…", synced: "Synced ✓", error: "Sync error" }[syncStatus];
  const syncColor = { loading: T.textMuted, saving: "#0891b2", synced: "#16a34a", error: "#dc2626" }[syncStatus];

  return (
    <div style={{ minHeight: "100vh", background: T.bg, fontFamily: "'DM Mono', 'Courier New', monospace", color: T.text, padding: "20px", maxWidth: "560px", margin: "0 auto" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@300;400;500&family=Bebas+Neue&display=swap');
        input[type=number]::-webkit-outer-spin-button, input[type=number]::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
        input:focus { outline: none; border-color: #94a3b8 !important; }
        input[type="date"]::-webkit-calendar-picker-indicator { filter: none; opacity: 0.5; }
        * { box-sizing: border-box; }
      `}</style>

      <div style={{ marginBottom: "24px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div style={{ fontFamily: "'Bebas Neue', cursive", fontSize: "36px", letterSpacing: "0.05em", color: T.text, lineHeight: 1 }}>TRAINING LOG</div>
          <div style={{ display: "flex", alignItems: "center", gap: "5px", marginTop: "8px" }}>
            <span style={{ color: syncColor }}><CloudIcon /></span>
            <span style={{ fontSize: "10px", color: syncColor, fontWeight: "700", letterSpacing: "0.05em" }}>{syncLabel}</span>
          </div>
        </div>
        <div style={{ fontSize: "11px", color: T.textMuted, fontWeight: "500", letterSpacing: "0.15em", marginTop: "4px" }}>
          {syncStatus === "loading" ? "Loading from cloud…" : `${sessions.length} SESSIONS · BODY RECOMP PROTOCOL`}
        </div>
      </div>

      {syncStatus === "error" && loadError && (
        <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: "12px", padding: "14px", marginBottom: "20px", fontSize: "12px", color: "#dc2626" }}>
          <div style={{ fontWeight: "700", marginBottom: "4px" }}>Connection error</div>
          <div style={{ wordBreak: "break-all" }}>{loadError}</div>
        </div>
      )}

      {syncStatus === "loading" ? (
        <div style={{ textAlign: "center", padding: "60px 0", color: T.textMuted }}>
          <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
          <div style={{ fontSize: "28px", marginBottom: "12px", display: "inline-block", animation: "spin 1.2s linear infinite" }}>◌</div>
          <div style={{ fontSize: "13px" }}>Loading your training data…</div>
        </div>
      ) : (
        <>
          <div style={{ display: "flex", gap: "6px", marginBottom: "24px" }}>
            {[["log", "LOG SESSION"], ["history", "HISTORY & ANALYSIS"], ["calendar", "CALENDAR"]].map(([v, label]) => (
              <button key={v} onClick={() => setView(v)} style={{
                flex: 1, background: view === v ? T.text : "none",
                border: `1px solid ${view === v ? T.text : T.border}`,
                color: view === v ? "#fff" : T.textSub,
                borderRadius: "10px", padding: "10px", fontSize: "11px",
                fontWeight: "700", cursor: "pointer", letterSpacing: "0.08em", fontFamily: "inherit"
              }}>{label}</button>
            ))}
          </div>

          {view === "log" && (
            <>
              <div style={{ fontSize: "11px", color: T.textMuted, fontWeight: "700", letterSpacing: "0.12em", marginBottom: "12px" }}>SELECT DAY TO LOG</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: "6px", marginBottom: "24px" }}>
                {DAYS.map(day => {
                  const isToday = day.id === todayDay.id;
                  const count = sessions.filter(s => s.dayId === day.id).length;
                  return (
                    <button key={day.id} onClick={() => setActiveDay(day)} style={{
                      background: isToday ? `${day.color}12` : T.surface,
                      border: `1px solid ${isToday ? day.color + "66" : T.border}`,
                      borderRadius: "10px", padding: "10px 4px", cursor: "pointer", textAlign: "center"
                    }}>
                      <div style={{ fontSize: "10px", color: isToday ? day.color : T.textMuted, fontWeight: "700" }}>{day.label}</div>
                      {count > 0 && <div style={{ width: "6px", height: "6px", borderRadius: "50%", background: day.color, margin: "4px auto 0" }} />}
                    </button>
                  );
                })}
              </div>
              <div style={{ display: "grid", gap: "10px" }}>
                {DAYS.map(day => {
                  const daySessions = sessions.filter(s => s.dayId === day.id);
                  const last = daySessions[daySessions.length - 1];
                  const isToday = day.id === todayDay.id;
                  return (
                    <button key={day.id} onClick={() => setActiveDay(day)} style={{
                      background: T.surface, border: `1px solid ${isToday ? day.color + "66" : T.border}`,
                      borderRadius: "14px", padding: "14px 16px", cursor: "pointer",
                      textAlign: "left", display: "flex", justifyContent: "space-between", alignItems: "center",
                      boxShadow: isToday ? `0 0 0 3px ${day.color}18` : "0 1px 4px rgba(0,0,0,0.05)"
                    }}>
                      <div>
                        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
                          <span style={{ fontSize: "11px", color: day.color, fontWeight: "700", letterSpacing: "0.08em" }}>{day.label}</span>
                          {isToday && <span style={{ fontSize: "10px", background: `${day.color}18`, color: day.color, padding: "1px 7px", borderRadius: "10px", fontWeight: "700" }}>TODAY</span>}
                        </div>
                        <div style={{ fontSize: "14px", fontWeight: "700", color: T.text }}>{day.name}</div>
                        {last && <div style={{ fontSize: "11px", color: T.textMuted, marginTop: "3px" }}>Last: {last.date}</div>}
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <div style={{ fontSize: "24px", fontFamily: "'Bebas Neue', cursive", color: daySessions.length > 0 ? day.color : T.border }}>{daySessions.length}</div>
                        <div style={{ fontSize: "10px", color: T.textMuted }}>sessions</div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </>
          )}

          {view === "history" && <HistoryView sessions={sessions} onDelete={deleteSession} />}
          {view === "calendar" && <CalendarView sessions={sessions} />}
        </>
      )}

      {activeDay && <SessionLogger day={activeDay} sessions={sessions} onSave={addSession} onClose={() => setActiveDay(null)} />}
    </div>
  );
}
