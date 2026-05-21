import { useState, useEffect, useCallback, useRef } from "react";

// ---- Supabase config ----
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

// ---- Anthropic proxy (same one the whiteboard scanner uses) ----
const PROXY_URL = "/api/proxy";
const MODEL = "claude-sonnet-4-5";

async function callClaude(body) {
  const r = await fetch(PROXY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`Proxy ${r.status}: ${await r.text()}`);
  return r.json();
}

const NUTRITION_SCHEMA_INSTRUCTIONS = `You are a careful nutrition analyst. Estimate macros for the meal described.

Reply with ONLY a JSON object (no prose, no markdown fences) using exactly these keys:

{
  "name": "Short, specific description e.g. 'Scrambled eggs on sourdough with avocado'",
  "calories": <integer>,
  "protein_g": <number>,
  "carbs_g": <number>,
  "fat_g": <number>,
  "confidence": "low" | "medium" | "high",
  "notes": "Brief caveat about your estimate, or an empty string."
}

Be realistic — these are estimates, not lab measurements. Use UK portion sizes by default. If you can't identify the food clearly, still give your best guess and set confidence to "low".`;

function buildPhotoBody(base64) {
  return {
    model: MODEL,
    max_tokens: 800,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: "image/jpeg", data: base64 },
          },
          { type: "text", text: NUTRITION_SCHEMA_INSTRUCTIONS },
        ],
      },
    ],
  };
}

function buildTextBody(userText) {
  return {
    model: MODEL,
    max_tokens: 800,
    messages: [
      {
        role: "user",
        content: `${NUTRITION_SCHEMA_INSTRUCTIONS}\n\nMeal description from the user:\n"""\n${userText}\n"""`,
      },
    ],
  };
}

// ---- Anthropic response → parsed JSON ----
function extractAssistantText(resp) {
  if (!resp || !resp.content) {
    throw new Error("No content in Anthropic response");
  }
  // content is an array of blocks; pick the first text block
  const block = resp.content.find((c) => c.type === "text");
  if (!block?.text) throw new Error("No text block in response");
  return block.text.trim();
}

function tryParseJSON(text) {
  try { return JSON.parse(text); } catch {}
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (fenceMatch) {
    try { return JSON.parse(fenceMatch[1]); } catch {}
  }
  const braceMatch = text.match(/\{[\s\S]*\}/);
  if (braceMatch) {
    try { return JSON.parse(braceMatch[0]); } catch {}
  }
  throw new Error("Could not parse macros JSON from Claude's response");
}

// ---- Resize image on canvas before sending to Anthropic ----
async function resizeAndEncode(file, maxDim = 1024, quality = 0.85) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = reject;
      i.src = url;
    });
    const ratio = Math.min(1, maxDim / Math.max(img.width, img.height));
    const w = Math.max(1, Math.round(img.width * ratio));
    const h = Math.max(1, Math.round(img.height * ratio));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    canvas.getContext("2d").drawImage(img, 0, 0, w, h);

    const blob = await new Promise((resolve, reject) =>
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("Canvas blob failed"))),
        "image/jpeg",
        quality
      )
    );
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(",")[1]);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

// ---- Design tokens (match the rest of the app) ----
const T = {
  bg: "#f8fafc", surface: "#ffffff", surface2: "#f1f5f9",
  border: "#e2e8f0", border2: "#cbd5e1",
  text: "#0f172a", textSub: "#475569", textMuted: "#94a3b8",
  accent: "#ea580c",
  ok: "#16a34a", amber: "#f59e0b", warn: "#dc2626",
};

const display = {
  fontFamily: "'Bebas Neue', sans-serif",
  letterSpacing: "0.04em",
  color: T.text,
  lineHeight: 1,
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

function startOfDay(d = new Date()) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export default function Food() {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [calTarget, setCalTarget] = useState(null);
  const [proteinTarget, setProteinTarget] = useState(null);
  const [error, setError] = useState(null);

  // Modal state for the parse-and-review flow
  const [draft, setDraft] = useState(null); // { source, name, calories, protein_g, carbs_g, fat_g, confidence, ai_notes }
  const [busyMode, setBusyMode] = useState(null); // 'photo' | 'text' | 'manual' | null
  const [textInput, setTextInput] = useState("");
  const [showTextEntry, setShowTextEntry] = useState(false);
  const fileInputRef = useRef(null);

  // ---- Load today's entries + settings ----
  const load = useCallback(async () => {
    try {
      setError(null);
      const since = startOfDay();
      const rows = await sb(
        `/food_entries?select=*&consumed_at=gte.${since.toISOString()}&order=consumed_at.desc`
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
        const settings = await sb(
          "/settings?select=daily_calorie_target,daily_protein_target_g&id=eq.1"
        );
        setCalTarget(settings?.[0]?.daily_calorie_target ?? null);
        setProteinTarget(settings?.[0]?.daily_protein_target_g ?? null);
      } catch {}
      load();
    })();
  }, [load]);

  // ---- Totals ----
  const sum = (k) => entries.reduce((a, e) => a + Number(e[k] || 0), 0);
  const todayCals = Math.round(sum("calories"));
  const todayProtein = Math.round(sum("protein_g"));
  const calPct = calTarget ? Math.min(100, Math.round((todayCals / calTarget) * 100)) : null;
  const proteinPct = proteinTarget ? Math.min(100, Math.round((todayProtein / proteinTarget) * 100)) : null;

  // ---- Actions ----
  const onPhotoSelected = async (file) => {
    if (!file) return;
    setBusyMode("photo");
    setError(null);
    try {
      const base64 = await resizeAndEncode(file);
      const resp = await callClaude(buildPhotoBody(base64));
      const text = extractAssistantText(resp);
      const parsed = tryParseJSON(text);
      setDraft({ source: "photo", ...normaliseParsed(parsed) });
    } catch (e) {
      setError(e.message);
    } finally {
      setBusyMode(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const onTextParse = async () => {
    if (!textInput.trim()) return;
    setBusyMode("text");
    setError(null);
    try {
      const resp = await callClaude(buildTextBody(textInput.trim()));
      const text = extractAssistantText(resp);
      const parsed = tryParseJSON(text);
      setDraft({ source: "text", ...normaliseParsed(parsed) });
      setTextInput("");
      setShowTextEntry(false);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusyMode(null);
    }
  };

  const openManual = () => {
    setDraft({
      source: "manual",
      name: "",
      calories: "",
      protein_g: "",
      carbs_g: "",
      fat_g: "",
      confidence: null,
      ai_notes: "",
    });
  };

  const saveDraft = async () => {
    if (!draft) return;
    setBusyMode("save");
    try {
      const row = {
        source: draft.source,
        name: draft.name?.trim() || "Untitled meal",
        calories: numOrNull(draft.calories),
        protein_g: numOrNull(draft.protein_g),
        carbs_g: numOrNull(draft.carbs_g),
        fat_g: numOrNull(draft.fat_g),
        ai_confidence: draft.confidence || null,
        ai_notes: draft.ai_notes || null,
      };
      const created = await sb("/food_entries", {
        method: "POST",
        body: JSON.stringify(row),
      });
      setEntries((prev) => [created[0], ...prev]);
      setDraft(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusyMode(null);
    }
  };

  const deleteEntry = async (id) => {
    setEntries((prev) => prev.filter((e) => e.id !== id));
    try {
      await sb(`/food_entries?id=eq.${id}`, { method: "DELETE" });
    } catch (e) {
      setError(e.message);
      load();
    }
  };

  return (
    <div style={{ padding: "20px", paddingBottom: "100px" }}>
      <div style={{ ...display, fontSize: "36px", marginBottom: "4px" }}>FOOD</div>
      <div
        style={{
          fontSize: "11px",
          color: T.textMuted,
          letterSpacing: "0.15em",
          marginBottom: "16px",
          fontWeight: 600,
        }}
      >
        MEALS · DRINKS · MACROS
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

      {/* ---- Today's totals ---- */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: "10px",
          marginBottom: "16px",
        }}
      >
        <StatCard
          label="CALORIES"
          value={todayCals}
          sub={calTarget ? `of ${calTarget}` : "no target set"}
          progress={calPct}
          color={calPct == null ? T.textMuted : calPct < 90 ? T.ok : calPct < 105 ? T.amber : T.warn}
        />
        <StatCard
          label="PROTEIN (G)"
          value={todayProtein}
          sub={proteinTarget ? `of ${proteinTarget}` : "no target set"}
          progress={proteinPct}
          color={proteinPct == null ? T.textMuted : proteinPct < 80 ? T.amber : T.ok}
        />
      </div>

      {/* ---- Log buttons ---- */}
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
          LOG A MEAL
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr 1fr",
            gap: "10px",
          }}
        >
          <ActionButton
            big="📷"
            label="Photo"
            onClick={() => fileInputRef.current?.click()}
            disabled={!!busyMode}
            busy={busyMode === "photo"}
          />
          <ActionButton
            big="✏️"
            label="Type"
            onClick={() => setShowTextEntry((v) => !v)}
            disabled={!!busyMode}
            busy={busyMode === "text"}
          />
          <ActionButton
            big="✍️"
            label="Manual"
            onClick={openManual}
            disabled={!!busyMode}
          />
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={(e) => onPhotoSelected(e.target.files?.[0])}
          style={{ display: "none" }}
        />

        {showTextEntry && (
          <div
            style={{
              marginTop: "12px",
              background: T.surface,
              border: `1px solid ${T.border}`,
              borderRadius: "10px",
              padding: "12px",
            }}
          >
            <div
              style={{
                fontSize: "11px",
                letterSpacing: "0.15em",
                color: T.textMuted,
                fontWeight: 600,
                marginBottom: "6px",
              }}
            >
              DESCRIBE YOUR MEAL
            </div>
            <textarea
              value={textInput}
              onChange={(e) => setTextInput(e.target.value)}
              placeholder="e.g. Two eggs scrambled with butter on sourdough, half an avocado"
              rows={3}
              style={{ ...inputStyle, resize: "vertical", fontSize: "14px" }}
            />
            <button
              onClick={onTextParse}
              disabled={!textInput.trim() || busyMode === "text"}
              style={{
                marginTop: "8px",
                width: "100%",
                padding: "10px",
                background: textInput.trim() ? T.accent : T.surface2,
                color: textInput.trim() ? "#fff" : T.textMuted,
                border: "none",
                borderRadius: "8px",
                fontSize: "13px",
                fontWeight: 700,
                letterSpacing: "0.05em",
                cursor: textInput.trim() ? "pointer" : "default",
              }}
            >
              {busyMode === "text" ? "ANALYSING…" : "ESTIMATE MACROS"}
            </button>
          </div>
        )}

        {busyMode === "photo" && (
          <div
            style={{
              marginTop: "12px",
              padding: "12px",
              textAlign: "center",
              color: T.textSub,
              fontSize: "13px",
              background: T.surface2,
              borderRadius: "8px",
            }}
          >
            Analysing photo… Claude is estimating macros.
          </div>
        )}
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
          TODAY
        </div>
        {loading ? (
          <div style={{ color: T.textSub, fontSize: "13px" }}>Loading…</div>
        ) : entries.length === 0 ? (
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
            {entries.map((e) => (
              <div
                key={e.id}
                style={{
                  background: T.surface,
                  border: `1px solid ${T.border}`,
                  borderRadius: "10px",
                  padding: "10px 12px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: "10px",
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: "13px",
                      fontWeight: 600,
                      color: T.text,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {e.name}
                  </div>
                  <div
                    style={{
                      fontSize: "11px",
                      color: T.textMuted,
                      marginTop: "2px",
                    }}
                  >
                    {e.calories ?? "?"} cal
                    {e.protein_g != null ? ` · P ${Number(e.protein_g).toFixed(0)}` : ""}
                    {e.carbs_g != null ? ` · C ${Number(e.carbs_g).toFixed(0)}` : ""}
                    {e.fat_g != null ? ` · F ${Number(e.fat_g).toFixed(0)}` : ""}
                    {" · "}{timeOf(e.consumed_at)}
                    {e.ai_confidence ? ` · ${e.ai_confidence}` : ""}
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

      {/* ---- Review modal ---- */}
      {draft && (
        <ReviewSheet
          draft={draft}
          onChange={setDraft}
          onCancel={() => setDraft(null)}
          onSave={saveDraft}
          saving={busyMode === "save"}
        />
      )}
    </div>
  );
}

// ---- Subcomponents ----

function ActionButton({ big, label, onClick, disabled, busy }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        background: T.surface,
        border: `1px solid ${T.border}`,
        borderRadius: "12px",
        padding: "16px 8px",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "6px",
        cursor: disabled ? "wait" : "pointer",
        fontFamily: "inherit",
        opacity: disabled && !busy ? 0.4 : 1,
        transition: "transform 0.08s",
        transform: busy ? "scale(0.97)" : "scale(1)",
      }}
    >
      <div style={{ fontSize: "26px", lineHeight: 1 }}>{busy ? "⌛" : big}</div>
      <div
        style={{
          fontSize: "11px",
          fontWeight: 700,
          color: T.text,
          letterSpacing: "0.08em",
        }}
      >
        {label.toUpperCase()}
      </div>
    </button>
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

function ReviewSheet({ draft, onChange, onCancel, onSave, saving }) {
  const set = (k, v) => onChange({ ...draft, [k]: v });
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15,23,42,0.55)",
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
        zIndex: 200,
      }}
      onClick={onCancel}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: T.bg,
          width: "100%",
          maxWidth: "640px",
          borderTopLeftRadius: "20px",
          borderTopRightRadius: "20px",
          padding: "20px",
          paddingBottom: "max(20px, env(safe-area-inset-bottom))",
          maxHeight: "85vh",
          overflowY: "auto",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: "12px",
          }}
        >
          <div style={{ ...display, fontSize: "26px" }}>
            {draft.source === "manual" ? "MANUAL ENTRY" : "REVIEW MACROS"}
          </div>
          <button
            onClick={onCancel}
            style={{
              background: "transparent",
              border: `1px solid ${T.border2}`,
              color: T.textSub,
              borderRadius: "8px",
              padding: "6px 12px",
              fontSize: "13px",
              cursor: "pointer",
            }}
          >
            Cancel
          </button>
        </div>

        {draft.confidence && (
          <div
            style={{
              fontSize: "12px",
              padding: "6px 10px",
              borderRadius: "6px",
              marginBottom: "10px",
              background:
                draft.confidence === "high" ? "#dcfce7" :
                draft.confidence === "medium" ? "#fef3c7" : "#fee2e2",
              color:
                draft.confidence === "high" ? "#166534" :
                draft.confidence === "medium" ? "#854d0e" : "#991b1b",
              display: "inline-block",
            }}
          >
            Claude's confidence: <strong>{draft.confidence}</strong>
          </div>
        )}
        {draft.ai_notes && (
          <div
            style={{
              fontSize: "12px",
              color: T.textSub,
              fontStyle: "italic",
              marginBottom: "12px",
              lineHeight: 1.5,
            }}
          >
            {draft.ai_notes}
          </div>
        )}

        <Field
          label="Meal name"
          value={draft.name}
          onChange={(v) => set("name", v)}
          placeholder="e.g. Chicken stir-fry"
        />
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: "10px",
            marginTop: "10px",
          }}
        >
          <Field
            label="Calories"
            type="number"
            value={draft.calories}
            onChange={(v) => set("calories", v)}
          />
          <Field
            label="Protein (g)"
            type="number"
            value={draft.protein_g}
            onChange={(v) => set("protein_g", v)}
          />
          <Field
            label="Carbs (g)"
            type="number"
            value={draft.carbs_g}
            onChange={(v) => set("carbs_g", v)}
          />
          <Field
            label="Fat (g)"
            type="number"
            value={draft.fat_g}
            onChange={(v) => set("fat_g", v)}
          />
        </div>

        <button
          onClick={onSave}
          disabled={saving}
          style={{
            marginTop: "20px",
            width: "100%",
            padding: "14px",
            background: T.accent,
            color: "#fff",
            border: "none",
            borderRadius: "10px",
            fontSize: "15px",
            fontWeight: 700,
            letterSpacing: "0.05em",
            cursor: saving ? "wait" : "pointer",
            opacity: saving ? 0.6 : 1,
            boxShadow: "0 4px 12px rgba(234,88,12,0.25)",
          }}
        >
          {saving ? "SAVING…" : "SAVE ENTRY"}
        </button>
      </div>
    </div>
  );
}

function Field({ label, value, onChange, type = "text", placeholder = "" }) {
  return (
    <div>
      <div
        style={{
          fontSize: "11px",
          letterSpacing: "0.15em",
          color: T.textMuted,
          fontWeight: 600,
          marginBottom: "4px",
          textTransform: "uppercase",
        }}
      >
        {label}
      </div>
      <input
        type={type}
        inputMode={type === "number" ? "decimal" : "text"}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        style={inputStyle}
      />
    </div>
  );
}

// ---- Helpers ----
function normaliseParsed(p) {
  return {
    name: p.name || "",
    calories: numOrEmpty(p.calories),
    protein_g: numOrEmpty(p.protein_g),
    carbs_g: numOrEmpty(p.carbs_g),
    fat_g: numOrEmpty(p.fat_g),
    confidence: p.confidence || null,
    ai_notes: p.notes || "",
  };
}
function numOrEmpty(v) {
  if (v === null || v === undefined || v === "") return "";
  const n = Number(v);
  return Number.isFinite(n) ? n : "";
}
function numOrNull(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function timeOf(iso) {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
