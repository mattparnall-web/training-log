import { useState, useEffect, useCallback, useRef } from "react";
import {
  sb, T, display, inputStyle,
  todayString, startOfDayLocal, endOfDayLocal,
  noonOf, prettyDate, timeOf, dateStrOf,
  SubTabs, DateBar, HistoryView, CalendarMonthView,
  dayDefFor, nutritionTargetsFor, ErrorBanner,
} from "./_shared.jsx";

// ---- Anthropic proxy (same one the whiteboard scanner uses) ----
const PROXY_URL = "/api/proxy";
const MODEL = "claude-sonnet-4-5";
const LOOKBACK_DAYS = 90;

// ---- One-tap presets (frequent foods logged with a single tap) ----
// Each preset writes a food_entries row directly — no review modal.
const QUICK_FOODS = [
  {
    id: "protein_shake",
    emoji: "🥤",
    name: "Protein shake",
    calories: 240,
    protein_g: 48,
    carbs_g: 6,
    fat_g: null,
    color: "#16a34a",
  },
];

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

function extractAssistantText(resp) {
  if (!resp || !resp.content) throw new Error("No content in Anthropic response");
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

export default function Food() {
  const [view, setView] = useState("log");
  const [selectedDate, setSelectedDate] = useState(todayString());
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [settings, setSettings] = useState(null);
  const [error, setError] = useState(null);

  const [draft, setDraft] = useState(null);
  const [busyMode, setBusyMode] = useState(null);
  const [textInput, setTextInput] = useState("");
  const [showTextEntry, setShowTextEntry] = useState(false);
  const [quickLogBusy, setQuickLogBusy] = useState(null);
  const fileInputRef = useRef(null);

  const isToday = selectedDate === todayString();

  const load = useCallback(async () => {
    try {
      setError(null);
      const since = new Date();
      since.setDate(since.getDate() - LOOKBACK_DAYS);
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
        const rows = await sb("/settings?select=*&id=eq.1");
        setSettings(rows?.[0] || null);
      } catch {}
      load();
    })();
  }, [load]);

  // ---- Filter entries to the selected day ----
  const dayStartMs = startOfDayLocal(selectedDate).getTime();
  const dayEndMs = endOfDayLocal(selectedDate).getTime();
  const dayEntries = entries.filter((e) => {
    const t = new Date(e.consumed_at).getTime();
    return t >= dayStartMs && t <= dayEndMs;
  });

  // Day-aware targets — pull the right bucket for the selected date's day type.
  const day = dayDefFor(selectedDate);
  const targets = nutritionTargetsFor(settings, day.type);

  const sum = (k) => dayEntries.reduce((a, e) => a + Number(e[k] || 0), 0);
  const dayCals = Math.round(sum("calories"));
  const dayProtein = Math.round(sum("protein_g"));
  const dayFat = Math.round(sum("fat_g"));
  const dayCarbs = Math.round(sum("carbs_g"));

  const pct = (cur, t) => (t ? Math.min(100, Math.round((cur / t) * 100)) : null);
  const calPct = pct(dayCals, targets.calories);
  const proteinPct = pct(dayProtein, targets.protein_g);
  const fatPct = pct(dayFat, targets.fat_g);
  const carbsPct = pct(dayCarbs, targets.carbs_g);

  // Tone for cal: green just under, amber slightly over, red way over
  const calTone = targets.calories == null ? null : calPct < 90 ? T.ok : calPct < 105 ? T.amber : T.warn;
  const proteinTone = targets.protein_g == null ? null : proteinPct < 80 ? T.amber : T.ok;
  const fatTone = targets.fat_g == null ? null : fatPct < 80 ? T.amber : fatPct < 120 ? T.ok : T.warn;
  const carbsTone = targets.carbs_g == null ? null : carbsPct < 80 ? T.amber : carbsPct < 110 ? T.ok : T.warn;

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

  // One-tap log: write straight to food_entries with the preset's macros.
  const quickLogPreset = async (preset) => {
    setQuickLogBusy(preset.id);
    setError(null);
    try {
      const consumed = isToday ? new Date() : noonOf(selectedDate);
      const row = {
        consumed_at: consumed.toISOString(),
        source: "quick",
        name: preset.name,
        calories: preset.calories,
        protein_g: preset.protein_g,
        carbs_g: preset.carbs_g,
        fat_g: preset.fat_g,
        ai_confidence: null,
        ai_notes: null,
      };
      const created = await sb("/food_entries", {
        method: "POST",
        body: JSON.stringify(row),
      });
      setEntries((prev) => [created[0], ...prev]);
    } catch (e) {
      setError(e.message);
    } finally {
      setQuickLogBusy(null);
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
      const consumed = isToday ? new Date() : noonOf(selectedDate);
      const row = {
        consumed_at: consumed.toISOString(),
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

  // Duplicate an entry — useful for "one more of those biscuits".
  // Stamps the new entry at "now" if viewing today, otherwise noon of the selected date.
  const duplicateEntry = async (e) => {
    try {
      const consumed = isToday ? new Date() : noonOf(selectedDate);
      const row = {
        consumed_at: consumed.toISOString(),
        source: e.source || "manual",
        name: e.name,
        calories: e.calories,
        protein_g: e.protein_g,
        carbs_g: e.carbs_g,
        fat_g: e.fat_g,
        ai_confidence: e.ai_confidence,
        ai_notes: e.ai_notes,
      };
      const created = await sb("/food_entries", {
        method: "POST",
        body: JSON.stringify(row),
      });
      setEntries((prev) => [created[0], ...prev]);
    } catch (err) {
      setError(err.message);
    }
  };

  // ---- Entry row renderer (shared by LOG / HISTORY / CALENDAR) ----
  const renderEntryRow = (e) => (
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
        <div style={{ fontSize: "11px", color: T.textMuted, marginTop: "2px" }}>
          {e.calories ?? "?"} cal
          {e.protein_g != null ? ` · P ${Number(e.protein_g).toFixed(0)}` : ""}
          {e.carbs_g != null ? ` · C ${Number(e.carbs_g).toFixed(0)}` : ""}
          {e.fat_g != null ? ` · F ${Number(e.fat_g).toFixed(0)}` : ""}
          {" · "}{timeOf(e.consumed_at)}
          {e.ai_confidence ? ` · ${e.ai_confidence}` : ""}
        </div>
      </div>
      <div style={{ display: "flex", gap: "4px", flexShrink: 0 }}>
        <button
          onClick={() => duplicateEntry(e)}
          title="Log another of these"
          style={{
            background: "transparent",
            border: `1px solid ${T.border2}`,
            color: T.accent,
            borderRadius: "6px",
            padding: "4px 8px",
            fontSize: "11px",
            fontWeight: 700,
            cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          +1
        </button>
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
    </div>
  );

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

          {/* Bucket badge — shows which day-type bucket the targets came from */}
          <div
            style={{
              fontSize: "10px",
              letterSpacing: "0.15em",
              color: T.textMuted,
              fontWeight: 700,
              marginBottom: "8px",
            }}
          >
            TARGETS · {targets.bucket?.toUpperCase() || "—"} ({day.name})
          </div>
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
              value={dayCals}
              sub={targets.calories ? `of ${targets.calories}` : "no target"}
              progress={calPct}
              color={calTone || T.textMuted}
            />
            <StatCard
              label="PROTEIN (G)"
              value={dayProtein}
              sub={targets.protein_g ? `of ${targets.protein_g}` : "no target"}
              progress={proteinPct}
              color={proteinTone || T.textMuted}
            />
            <StatCard
              label="FAT (G)"
              value={dayFat}
              sub={targets.fat_g ? `of ${targets.fat_g}` : "no target"}
              progress={fatPct}
              color={fatTone || T.textMuted}
            />
            <StatCard
              label="CARBS (G)"
              value={dayCarbs}
              sub={targets.carbs_g ? `of ${targets.carbs_g}` : "no target"}
              progress={carbsPct}
              color={carbsTone || T.textMuted}
            />
          </div>

          {/* ---- Quick log (one-tap presets like protein shake) ---- */}
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
              QUICK LOG
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: "8px",
              }}
            >
              {QUICK_FOODS.map((preset) => {
                const busy = quickLogBusy === preset.id;
                return (
                  <button
                    key={preset.id}
                    onClick={() => quickLogPreset(preset)}
                    disabled={!!quickLogBusy}
                    style={{
                      background: T.surface,
                      border: `1px solid ${T.border}`,
                      borderLeft: `4px solid ${preset.color}`,
                      borderRadius: "10px",
                      padding: "12px",
                      display: "flex",
                      alignItems: "center",
                      gap: "10px",
                      cursor: quickLogBusy ? "wait" : "pointer",
                      fontFamily: "inherit",
                      textAlign: "left",
                      opacity: quickLogBusy && !busy ? 0.5 : 1,
                      transition: "transform 0.08s",
                      transform: busy ? "scale(0.97)" : "scale(1)",
                    }}
                  >
                    <div style={{ fontSize: "22px", lineHeight: 1 }}>{preset.emoji}</div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: "13px", fontWeight: 700, color: T.text }}>
                        {preset.name}
                      </div>
                      <div style={{ fontSize: "10px", color: T.textMuted, marginTop: "2px" }}>
                        {preset.calories} cal · P {preset.protein_g}
                        {preset.carbs_g != null ? ` · C ${preset.carbs_g}` : ""}
                        {preset.fat_g != null ? ` · F ${preset.fat_g}` : ""}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

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
              LOG A MEAL{!isToday ? ` · FOR ${prettyDate(selectedDate).toUpperCase()}` : ""}
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
                  style={{ ...inputStyle, resize: "vertical", fontSize: "14px", width: "100%" }}
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
              {isToday ? "TODAY" : prettyDate(selectedDate).toUpperCase()}
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
          dotColorOf={() => T.accent}
          onSelectDay={(ds) => {
            setSelectedDate(ds);
            setView("log");
          }}
          renderDayDetail={(dayEntries) => {
            const cals = Math.round(dayEntries.reduce((a, e) => a + Number(e.calories || 0), 0));
            const prot = Math.round(dayEntries.reduce((a, e) => a + Number(e.protein_g || 0), 0));
            return (
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
                  {dayEntries.length} entries · {cals} cal · {prot}g protein
                </div>
              </div>
            );
          }}
        />
      )}

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

// ---------- Subcomponents ----------

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

        <Field label="Meal name" value={draft.name} onChange={(v) => set("name", v)} placeholder="e.g. Chicken stir-fry" />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", marginTop: "10px" }}>
          <Field label="Calories" type="number" value={draft.calories} onChange={(v) => set("calories", v)} />
          <Field label="Protein (g)" type="number" value={draft.protein_g} onChange={(v) => set("protein_g", v)} />
          <Field label="Carbs (g)" type="number" value={draft.carbs_g} onChange={(v) => set("carbs_g", v)} />
          <Field label="Fat (g)" type="number" value={draft.fat_g} onChange={(v) => set("fat_g", v)} />
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
        style={{ ...inputStyle, fontSize: "16px", padding: "10px 12px", width: "100%" }}
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
