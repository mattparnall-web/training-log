import { useState, useEffect, useCallback } from "react";
import {
  sb, T, display, inputStyle,
  todayString, shiftDate, startOfDayLocal, endOfDayLocal,
  prettyDate, dateStrOf,
  DateBar,
} from "./_shared.jsx";

// localStorage key for per-date coach notes — survives reloads on this device.
const NOTES_KEY = (dateStr) => `coach-claude:notes:${dateStr}`;

// ---- Weekly programme ----
const DAYS = [
  { id: "monday",    label: "MON", name: "Upper Push",          type: "upper_push",  color: "#7c3aed" },
  { id: "tuesday",   label: "TUE", name: "Upper Pull + Deads",  type: "upper_pull",  color: "#0891b2" },
  { id: "wednesday", label: "WED", name: "Active Recovery",     type: "recovery",    color: "#16a34a" },
  { id: "thursday",  label: "THU", name: "Lower — Squat",       type: "lower_squat", color: "#2563eb" },
  { id: "friday",    label: "FRI", name: "Flexible",            type: "flexible",    color: "#94a3b8" },
  { id: "saturday",  label: "SAT", name: "Olympic + MetCon",    type: "olympic",     color: "#dc2626" },
  { id: "sunday",    label: "SUN", name: "Zone 2 Cardio",       type: "cardio",      color: "#16a34a" },
];
function dayDefFor(dateStr) {
  const dt = startOfDayLocal(dateStr);
  const idx = (dt.getDay() + 6) % 7;
  return DAYS[idx];
}

// ---- Anthropic proxy ----
const PROXY_URL = "/api/proxy";
const COACH_MODEL = "claude-sonnet-4-5";

async function callClaudeText(systemPrompt, userPrompt, maxTokens = 1200) {
  const r = await fetch(PROXY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: COACH_MODEL,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    }),
  });
  if (!r.ok) throw new Error(`Proxy ${r.status}: ${await r.text()}`);
  const json = await r.json();
  const block = json?.content?.find?.((c) => c.type === "text");
  if (!block?.text) throw new Error("Empty Claude response");
  return block.text.trim();
}

// ---- Defensive Garmin extractors (same as before) ----
function pickSleep(section) {
  const d = section?.data;
  if (!d) return null;
  const dto = d.dailySleepDTO || d;
  const score =
    dto?.sleepScores?.overall?.value ??
    dto?.sleepScores?.overall?.qualifierKey ??
    dto?.sleepScoreFeedback ??
    null;
  return {
    duration_seconds: dto?.sleepTimeSeconds ?? null,
    deep_seconds: dto?.deepSleepSeconds ?? null,
    light_seconds: dto?.lightSleepSeconds ?? null,
    rem_seconds: dto?.remSleepSeconds ?? null,
    awake_seconds: dto?.awakeSleepSeconds ?? null,
    score,
  };
}
function pickBodyBattery(section) {
  const d = section?.data;
  if (!d) return null;
  const day = Array.isArray(d) ? d[0] : d;
  if (!day) return null;
  const values = day.bodyBatteryValuesArray || day.bodyBatteryValues || [];
  let max = null, min = null, current = null;
  for (const row of values) {
    const v = Array.isArray(row) ? row[1] : row?.value;
    if (typeof v !== "number") continue;
    if (max == null || v > max) max = v;
    if (min == null || v < min) min = v;
    current = v;
  }
  return { charged: day.charged ?? null, drained: day.drained ?? null, current, max, min };
}
function pickHRV(section) {
  const d = section?.data;
  if (!d) return null;
  const s = d.hrvSummary || d;
  return {
    last_night_avg: s.lastNightAvg ?? null,
    last_night_high: s.lastNightHigh ?? null,
    weekly_avg: s.weeklyAvg ?? null,
    status: s.status ?? null,
  };
}
function pickReadiness(section) {
  const d = section?.data;
  if (!d) return null;
  const r = Array.isArray(d) ? d[0] : d;
  if (!r) return null;
  // Drop the feedback if it's a raw Garmin composite key like MOD_RT_LOW_SS_MOD
  // (their app translates these to sentences client-side; we don't have the table).
  const rawFeedback = r.feedbackLong || r.feedbackShort || null;
  const friendlyFeedback =
    typeof rawFeedback === "string" && /^[A-Z0-9_]+$/.test(rawFeedback)
      ? null
      : rawFeedback;
  return {
    score: r.score ?? null,
    level: r.level ?? null,
    feedback: friendlyFeedback,
    sleep_score: r.sleepScore ?? null,
    hrv_factor: r.hrvFactorPercent ?? null,
    recovery_time: r.recoveryTime ?? null,
  };
}
// Garmin's training status integer enum → friendly name.
const TRAINING_STATUS_NAMES = {
  0: "No Status",
  1: "Detraining",
  2: "Recovery",
  3: "Maintaining",
  4: "Productive",
  5: "Peaking",
  6: "Overreaching",
  7: "Unproductive",
  8: "Strained",
};

function humanTrainingStatus(raw) {
  if (raw == null) return null;
  if (typeof raw === "number") return TRAINING_STATUS_NAMES[raw] || `Status ${raw}`;
  if (typeof raw === "string") {
    // If it looks like a composite key (underscores), it's the wrong field
    // (that's the feedback phrase key, not the status). Bail.
    if (raw.includes("_")) return null;
    return raw.charAt(0) + raw.slice(1).toLowerCase();
  }
  return null;
}

function pickTrainingStatus(section) {
  const d = section?.data;
  if (!d) return null;
  const latest = d?.mostRecentTrainingStatus?.latestTrainingStatusData;
  if (!latest) return null;
  const firstDevice = Object.values(latest)[0];
  if (!firstDevice) return null;

  // The composite "trainingStatusFeedbackPhrase" (e.g. MOD_RT_LOW_SS_MOD) is
  // Garmin's internal key — their app translates it to a sentence client-side.
  // We don't have the translation table so we just hide it.
  const rawFeedback = firstDevice?.trainingStatusFeedbackPhrase ?? null;
  const friendlyFeedback =
    typeof rawFeedback === "string" && /^[A-Z0-9_]+$/.test(rawFeedback)
      ? null
      : rawFeedback;

  return {
    status: humanTrainingStatus(firstDevice?.trainingStatus),
    load:
      firstDevice?.acwrFlash?.value ?? firstDevice?.weeklyTrainingLoad ?? null,
    feedback: friendlyFeedback,
  };
}
function pickDailySummary(section) {
  const d = section?.data;
  if (!d) return null;
  return {
    steps: d.totalSteps ?? d.dailyStepGoalRaw ?? null,
    step_goal: d.dailyStepGoal ?? null,
    active_calories: d.activeKilocalories ?? null,
    intensity_minutes: (d.moderateIntensityMinutes ?? 0) + (d.vigorousIntensityMinutes ?? 0) * 2,
    resting_heart_rate: d.restingHeartRate ?? null,
  };
}

// ---- Helpers ----
function hoursMinutes(seconds) {
  if (!seconds && seconds !== 0) return "—";
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds - h * 3600) / 60);
  return `${h}h ${m}m`;
}
function valueOrDash(v, unit = "") { return v == null ? "—" : `${v}${unit}`; }
function round1(n) { return Math.round(n * 10) / 10; }

function summariseSession(s) {
  // Slim a session row down to a one-line text summary the coach can read.
  const exParts = (s.exercises || [])
    .slice(0, 6)
    .map((ex) => {
      const sets = (ex.sets || []).filter((set) => set.reps || set.weight);
      const repSummary = sets.length
        ? sets
            .map((set) => `${set.reps || "?"}×${set.weight || "?"}`)
            .join(", ")
        : "(no sets)";
      return `${ex.name}: ${repSummary}`;
    })
    .join(" | ");
  return `${s.date} (${s.dayName || s.dayId}): ${exParts || "(no exercises)"}${s.rpe ? ` · RPE ${s.rpe}` : ""}${s.notes ? ` · ${s.notes}` : ""}`;
}

// ---- Coach prompt ----
function buildCoachPrompt({ dateStr, day, settings, garmin, recentSessions, yIntake, athleteNotes }) {
  const sleep = pickSleep(garmin?.sleep);
  const bb = pickBodyBattery(garmin?.body_battery);
  const hrv = pickHRV(garmin?.hrv);
  const readiness = pickReadiness(garmin?.training_readiness);
  const status = pickTrainingStatus(garmin?.training_status);

  const keyLiftsText = (settings?.key_lifts || [])
    .map((l) => `  - ${l.name}: target ${l.target_kg ?? "?"}kg`)
    .join("\n") || "  (none configured)";

  const recentText = recentSessions.length
    ? recentSessions.map(summariseSession).join("\n  ")
    : "  (no recent sessions logged)";

  return `DATE: ${dateStr}
DAY OF WEEK: ${day.label} — programme says: ${day.name}

KEY LIFT TARGETS (athlete's current 1-rep targets or working weights):
${keyLiftsText}

NUTRITION TARGETS:
  - Daily calories: ${settings?.daily_calorie_target ?? "not set"}
  - Daily protein: ${settings?.daily_protein_target_g ?? "not set"} g
  - Weekly alcohol units: ${settings?.weekly_alcohol_units_target ?? "not set"}

LAST NIGHT / TODAY'S RECOVERY (from Garmin):
  - Sleep: ${hoursMinutes(sleep?.duration_seconds)} (score: ${sleep?.score ?? "n/a"}); deep ${hoursMinutes(sleep?.deep_seconds)}, REM ${hoursMinutes(sleep?.rem_seconds)}
  - HRV (last night): ${hrv?.last_night_avg ?? "n/a"}ms; status: ${hrv?.status ?? "n/a"}; 7d avg: ${hrv?.weekly_avg ?? "n/a"}
  - Body Battery: current ${bb?.current ?? "n/a"}, range ${bb?.min ?? "?"}–${bb?.max ?? "?"}; charged ${bb?.charged ?? "?"}, drained ${bb?.drained ?? "?"}
  - Training readiness: ${readiness?.score ?? "n/a"}/100 (${readiness?.level ?? "n/a"})
  - Training status: ${status?.status ?? "n/a"}${status?.feedback ? ` — ${status.feedback}` : ""}

YESTERDAY'S INTAKE:
  - Calories: ${yIntake?.calories ?? 0} kcal
  - Protein: ${yIntake?.protein_g ?? 0} g
  - Alcohol: ${yIntake?.drinks ?? 0} drinks, ${yIntake?.units ?? 0} units

RECENT SESSIONS (most recent first, up to 10):
  ${recentText}

ATHLETE NOTES (free-text observations from the athlete — take these into account):
${athleteNotes?.trim() ? athleteNotes.trim() : "  (none today)"}`;
}

const COACH_SYSTEM_PROMPT = `You are an experienced strength & conditioning coach. The athlete is on a body-recomp protocol with a fixed weekly split:
- Mon: Upper Push        - Tue: Upper Pull + Deadlifts
- Wed: Active Recovery   - Thu: Lower — Squat
- Fri: Flexible          - Sat: Olympic + MetCon
- Sun: Zone 2 Cardio

You will be given today's date, the athlete's recent training, last night's recovery data from Garmin, yesterday's nutrition + alcohol, and the athlete's current target weights for their key lifts.

Your job: recommend TODAY'S SESSION, calibrated to recovery and recent load. Be specific and decisive.

Hard rules:
- Adapt intensity to readiness. Low HRV / poor sleep / low body battery / low readiness → scale back, focus on volume not load, or move some work to accessories. Strong recovery → push toward PRs.
- Respect the planned day type unless recovery is genuinely poor (in which case suggest substituting a lighter session and say so).
- Use the athlete's key lift targets as the reference for working weights; suggest specific percentages (e.g. "85% of target = 76kg").
- Keep it realistic for a single ~60-minute session.
- If yesterday's nutrition was well under calories or protein was way low, mention it briefly but don't lecture.

Output format — produce exactly two sections, in this order:

SUMMARY:
<one or two sentences explaining your reasoning — what the recovery picture is and how today's session is calibrated to it.>

SESSION:
1. <Exercise name> — <sets> × <reps> @ <weight> kg
2. ...
(Aim for 4–7 exercises. Add a brief inline note after exercises where useful, in parentheses.)

No headers, no markdown, no extra preamble. Just SUMMARY: then SESSION:.`;

// ---- Parse Claude's response into summary + exercise list ----
function parseCoachReply(text) {
  const summaryMatch = text.match(/SUMMARY\s*:?\s*([\s\S]*?)(?:\n\s*SESSION\s*:?|$)/i);
  const sessionMatch = text.match(/SESSION\s*:?\s*([\s\S]*)$/i);
  return {
    summary: summaryMatch ? summaryMatch[1].trim() : "",
    session: sessionMatch ? sessionMatch[1].trim() : text,
  };
}

// ---- Read recent sessions from training-log's existing endpoint ----
async function fetchRecentSessions(limit = 10) {
  try {
    const r = await fetch("/api/sessions");
    if (!r.ok) return [];
    const all = await r.json();
    // Endpoint returns date-sorted ascending; take the last N.
    return all.slice(-limit).reverse();
  } catch {
    return [];
  }
}

// ===========================================================================
//                                DASHBOARD
// ===========================================================================
export default function Dashboard() {
  const [selectedDate, setSelectedDate] = useState(todayString());
  const yesterdayStr = shiftDate(selectedDate, -1);

  const [garmin, setGarmin] = useState(null);
  const [garminLoading, setGarminLoading] = useState(true);
  const [garminError, setGarminError] = useState(null);

  // Separate fetch for yesterday's activity card when viewing today
  // (today's steps/RHR are meaningless at 7am — show yesterday's instead).
  const [yesterdayActivity, setYesterdayActivity] = useState(null);

  const [settings, setSettings] = useState(null);
  const [foodYesterday, setFoodYesterday] = useState([]);
  const [alcoholYesterday, setAlcoholYesterday] = useState([]);
  const [intakeLoading, setIntakeLoading] = useState(true);

  // Coach plan state
  const [plan, setPlan] = useState(null);             // { summary, session, model, created_at }
  const [planLoading, setPlanLoading] = useState(true);
  const [coachBusy, setCoachBusy] = useState(false);
  const [coachError, setCoachError] = useState(null);

  // Free-text notes the user can jot before tapping "Plan today's session".
  // Persisted per-date in localStorage so they survive reloads on this device.
  const [notes, setNotes] = useState("");
  useEffect(() => {
    try {
      setNotes(localStorage.getItem(NOTES_KEY(selectedDate)) || "");
    } catch {
      setNotes("");
    }
  }, [selectedDate]);
  const updateNotes = (v) => {
    setNotes(v);
    try { localStorage.setItem(NOTES_KEY(selectedDate), v); } catch {}
  };

  const isToday = selectedDate === todayString();
  const day = dayDefFor(selectedDate);

  // ---- Garmin morning brief (with timeout + retry-friendly) ----
  const fetchWithTimeout = async (url, ms = 25000) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ms);
    try {
      return await fetch(url, { signal: ctrl.signal });
    } finally {
      clearTimeout(timer);
    }
  };

  const loadGarmin = useCallback(async () => {
    setGarminLoading(true);
    setGarminError(null);
    try {
      const r = await fetchWithTimeout(`/api/garmin-data?date=${selectedDate}`);
      if (!r.ok) {
        const t = await r.text();
        throw new Error(`Garmin ${r.status}: ${t.slice(0, 200)}`);
      }
      setGarmin(await r.json());
    } catch (e) {
      const msg = e?.name === "AbortError"
        ? "Garmin timed out — server may be cold-starting. Tap retry."
        : e?.message || String(e);
      setGarminError(msg);
      setGarmin(null);
    } finally {
      setGarminLoading(false);
    }

    // When viewing today, fetch yesterday's activity in parallel so the
    // "ACTIVITY" card shows meaningful numbers (today's are mostly zero at 7am).
    if (selectedDate === todayString()) {
      try {
        const r = await fetchWithTimeout(
          `/api/garmin-data?date=${shiftDate(selectedDate, -1)}`
        );
        if (r.ok) setYesterdayActivity(await r.json());
        else setYesterdayActivity(null);
      } catch {
        setYesterdayActivity(null);
      }
    } else {
      setYesterdayActivity(null);
    }
  }, [selectedDate]);

  // ---- Settings + yesterday intake ----
  const loadIntake = useCallback(async () => {
    setIntakeLoading(true);
    try {
      const [settingsRows, food, drinks] = await Promise.all([
        sb("/settings?select=*&id=eq.1"),
        sb(`/food_entries?select=*&consumed_at=gte.${startOfDayLocal(yesterdayStr).toISOString()}&consumed_at=lte.${endOfDayLocal(yesterdayStr).toISOString()}`),
        sb(`/alcohol_entries?select=*&consumed_at=gte.${startOfDayLocal(yesterdayStr).toISOString()}&consumed_at=lte.${endOfDayLocal(yesterdayStr).toISOString()}`),
      ]);
      setSettings(settingsRows?.[0] || null);
      setFoodYesterday(food || []);
      setAlcoholYesterday(drinks || []);
    } catch (e) {
      console.error("intake load failed:", e);
    } finally {
      setIntakeLoading(false);
    }
  }, [yesterdayStr]);

  // ---- Saved plan for selectedDate ----
  const loadPlan = useCallback(async () => {
    setPlanLoading(true);
    setCoachError(null);
    try {
      const rows = await sb(`/planned_sessions?select=*&date=eq.${selectedDate}`);
      if (rows && rows.length > 0) {
        const r = rows[0];
        setPlan({
          summary: r.summary || "",
          session: r.plan_text || "",
          model: r.model,
          created_at: r.created_at,
        });
      } else {
        setPlan(null);
      }
    } catch (e) {
      console.error("plan load failed:", e);
      setPlan(null);
    } finally {
      setPlanLoading(false);
    }
  }, [selectedDate]);

  useEffect(() => { loadGarmin(); }, [loadGarmin]);
  useEffect(() => { loadIntake(); }, [loadIntake]);
  useEffect(() => { loadPlan(); }, [loadPlan]);

  // ---- Generate plan ----
  const planSession = async () => {
    setCoachBusy(true);
    setCoachError(null);
    try {
      const recentSessions = await fetchRecentSessions(10);
      const yIntake = {
        calories: Math.round(foodYesterday.reduce((a, e) => a + Number(e.calories || 0), 0)),
        protein_g: Math.round(foodYesterday.reduce((a, e) => a + Number(e.protein_g || 0), 0)),
        drinks: alcoholYesterday.length,
        units: round1(alcoholYesterday.reduce((a, e) => a + Number(e.units || 0), 0)),
      };
      const userPrompt = buildCoachPrompt({
        dateStr: selectedDate,
        day,
        settings,
        garmin,
        recentSessions,
        yIntake,
        athleteNotes: notes,
      });
      const replyText = await callClaudeText(COACH_SYSTEM_PROMPT, userPrompt, 1400);
      const parsed = parseCoachReply(replyText);

      // Persist to Supabase, one row per date (upsert).
      const row = {
        date: selectedDate,
        day_id: day.id,
        day_name: day.name,
        summary: parsed.summary,
        plan_text: parsed.session,
        model: COACH_MODEL,
      };
      await sb("/planned_sessions", {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=representation" },
        body: JSON.stringify(row),
      });

      setPlan({
        summary: parsed.summary,
        session: parsed.session,
        model: COACH_MODEL,
        created_at: new Date().toISOString(),
      });
    } catch (e) {
      setCoachError(e.message);
    } finally {
      setCoachBusy(false);
    }
  };

  const clearPlan = async () => {
    try {
      await sb(`/planned_sessions?date=eq.${selectedDate}`, { method: "DELETE" });
      setPlan(null);
    } catch (e) {
      setCoachError(e.message);
    }
  };

  // ---- Derived ----
  const sleep = pickSleep(garmin?.sleep);
  const bb = pickBodyBattery(garmin?.body_battery);
  const hrv = pickHRV(garmin?.hrv);
  const readiness = pickReadiness(garmin?.training_readiness);
  const trainingStatus = pickTrainingStatus(garmin?.training_status);
  // Activity card data: when viewing today, prefer yesterday (today's not
  // meaningful in the morning). Otherwise show the selected date's own data.
  const activitySource = isToday ? yesterdayActivity : garmin;
  const activityDateStr = isToday ? yesterdayStr : selectedDate;
  const daily = pickDailySummary(activitySource?.daily_summary);

  const yCalories = Math.round(foodYesterday.reduce((a, e) => a + Number(e.calories || 0), 0));
  const yProtein = Math.round(foodYesterday.reduce((a, e) => a + Number(e.protein_g || 0), 0));
  const yUnits = round1(alcoholYesterday.reduce((a, e) => a + Number(e.units || 0), 0));
  const yDrinks = alcoholYesterday.length;

  const calTarget = settings?.daily_calorie_target;
  const proteinTarget = settings?.daily_protein_target_g;
  const keyLifts = Array.isArray(settings?.key_lifts) ? settings.key_lifts : [];

  return (
    <div style={{ padding: "20px", paddingBottom: "100px" }}>
      {/* Brand */}
      <div style={{ ...display, fontSize: "44px", marginBottom: "4px" }}>COACH CLAUDE</div>
      <div
        style={{
          fontSize: "10px",
          color: T.textMuted,
          letterSpacing: "0.2em",
          fontWeight: 700,
          marginBottom: "20px",
        }}
      >
        TRAIN · EAT · RECOVER · REPEAT
      </div>

      <DateBar value={selectedDate} onChange={setSelectedDate} />

      <div style={{ ...display, fontSize: "26px", marginBottom: "4px" }}>
        {isToday ? "TODAY" : prettyDate(selectedDate).toUpperCase()}
      </div>
      <div
        style={{
          fontSize: "11px",
          color: T.textMuted,
          letterSpacing: "0.15em",
          fontWeight: 600,
          marginBottom: "16px",
        }}
      >
        MORNING BRIEFING
      </div>

      {/* Session card with coach loop */}
      <Card>
        <CardLabel>SESSION · {day.label}</CardLabel>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: "4px" }}>
          <div style={{ fontSize: "20px", fontWeight: 700, color: day.color }}>{day.name}</div>
        </div>
        {readiness?.score != null && (
          <div style={{ fontSize: "12px", color: T.textSub, marginTop: "8px" }}>
            <strong>Readiness {readiness.score}/100</strong>
            {readiness.level ? ` · ${readiness.level}` : ""}
            {readiness.feedback ? <div style={{ marginTop: "4px", color: T.textMuted, fontStyle: "italic" }}>{readiness.feedback}</div> : null}
          </div>
        )}
        {keyLifts.length > 0 && (
          <div style={{ marginTop: "10px", borderTop: `1px solid ${T.border}`, paddingTop: "10px" }}>
            <div style={{ fontSize: "10px", letterSpacing: "0.15em", color: T.textMuted, fontWeight: 700, marginBottom: "6px" }}>
              KEY LIFT TARGETS
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
              {keyLifts.map((l, i) => (
                <div
                  key={i}
                  style={{
                    background: T.surface2,
                    border: `1px solid ${T.border}`,
                    borderRadius: "6px",
                    padding: "4px 8px",
                    fontSize: "12px",
                    color: T.text,
                  }}
                >
                  <strong>{l.name}</strong>
                  {l.target_kg != null ? <span style={{ color: T.textMuted }}> · {l.target_kg}kg</span> : null}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ---- Coach output ---- */}
        <div style={{ marginTop: "14px" }}>
          {coachError && (
            <div
              style={{
                background: "#fee2e2",
                color: "#991b1b",
                padding: "10px 12px",
                borderRadius: "8px",
                marginBottom: "10px",
                fontSize: "12px",
              }}
            >
              {coachError}
            </div>
          )}

          {planLoading ? (
            <div style={{ fontSize: "13px", color: T.textSub }}>Checking for saved plan…</div>
          ) : plan ? (
            <CoachPlanView plan={plan} onRegenerate={planSession} onClear={clearPlan} busy={coachBusy} />
          ) : (
            <>
              <div
                style={{
                  fontSize: "10px",
                  letterSpacing: "0.15em",
                  color: T.textMuted,
                  fontWeight: 700,
                  marginBottom: "6px",
                }}
              >
                NOTES FOR THE COACH (optional)
              </div>
              <textarea
                value={notes}
                onChange={(e) => updateNotes(e.target.value)}
                placeholder="e.g. knee feels stiff, hit RPE 9 on bench Mon, sleep was broken…"
                rows={3}
                style={{
                  ...inputStyle,
                  width: "100%",
                  fontSize: "13px",
                  resize: "vertical",
                  marginBottom: "10px",
                }}
              />
              <button
                onClick={planSession}
                disabled={coachBusy || garminLoading}
                style={{
                  width: "100%",
                  padding: "14px",
                  background: coachBusy ? T.surface2 : T.accent,
                  color: coachBusy ? T.textMuted : "#fff",
                  border: "none",
                  borderRadius: "10px",
                  fontSize: "13px",
                  fontWeight: 700,
                  letterSpacing: "0.08em",
                  cursor: coachBusy ? "wait" : "pointer",
                  boxShadow: coachBusy ? "none" : "0 4px 12px rgba(234,88,12,0.25)",
                }}
              >
                {coachBusy ? "COACH IS THINKING…" : "🧠 PLAN TODAY'S SESSION"}
              </button>
            </>
          )}
        </div>
      </Card>

      {/* Recovery card */}
      <Card>
        <CardLabel>RECOVERY</CardLabel>
        {garminLoading ? (
          <div style={{ fontSize: "13px", color: T.textSub }}>Fetching Garmin data…</div>
        ) : garminError ? (
          <div>
            <div
              style={{
                fontSize: "12px",
                color: T.warn,
                background: "#fee2e2",
                padding: "8px 10px",
                borderRadius: "6px",
                marginBottom: "8px",
              }}
            >
              {garminError}
            </div>
            <button
              onClick={loadGarmin}
              style={{
                width: "100%",
                padding: "10px",
                background: T.surface2,
                border: `1px solid ${T.border2}`,
                borderRadius: "8px",
                color: T.text,
                fontSize: "12px",
                fontWeight: 700,
                letterSpacing: "0.08em",
                cursor: "pointer",
              }}
            >
              🔄 RETRY
            </button>
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
            <Metric label="PRIOR NIGHT'S SLEEP" big={hoursMinutes(sleep?.duration_seconds)} sub={sleep?.score != null ? `Score: ${sleep.score}` : null} />
            <Metric label="BODY BATTERY" big={valueOrDash(bb?.current ?? bb?.max)} sub={bb?.max != null && bb?.min != null ? `${bb.min}–${bb.max}` : null} />
            <Metric label="HRV (LAST NIGHT)" big={valueOrDash(hrv?.last_night_avg, "ms")} sub={hrv?.status ? hrv.status : (hrv?.weekly_avg != null ? `7d avg ${hrv.weekly_avg}` : null)} />
            <Metric label="TRAINING STATUS" big={trainingStatus?.status || "—"} sub={trainingStatus?.feedback || null} />
          </div>
        )}
      </Card>

      {/* Yesterday intake */}
      <Card>
        <CardLabel>YESTERDAY'S INTAKE</CardLabel>
        {intakeLoading ? (
          <div style={{ fontSize: "13px", color: T.textSub }}>Loading…</div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "10px" }}>
            <Metric
              label="CALORIES"
              big={yCalories || "—"}
              sub={calTarget ? `of ${calTarget}` : null}
              tone={calTarget == null ? null : yCalories < 0.9 * calTarget ? "under" : yCalories <= 1.05 * calTarget ? "ok" : "over"}
            />
            <Metric
              label="PROTEIN (G)"
              big={yProtein || "—"}
              sub={proteinTarget ? `of ${proteinTarget}` : null}
              tone={proteinTarget == null ? null : yProtein < 0.8 * proteinTarget ? "under" : "ok"}
            />
            <Metric
              label="DRINKS"
              big={yDrinks || "0"}
              sub={yUnits ? `${yUnits} units` : null}
              tone={yUnits === 0 ? "ok" : yUnits < 4 ? "ok" : "over"}
            />
          </div>
        )}
      </Card>

      {daily && (
        <Card>
          <CardLabel>
            {isToday ? "YESTERDAY · ACTIVITY" : prettyDate(activityDateStr).toUpperCase() + " · ACTIVITY"}
          </CardLabel>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
            <Metric label="STEPS" big={valueOrDash(daily.steps)} sub={daily.step_goal ? `Goal ${daily.step_goal}` : null} />
            <Metric label="RESTING HR" big={valueOrDash(daily.resting_heart_rate, " bpm")} />
          </div>
        </Card>
      )}
    </div>
  );
}

// ---- Subcomponents ----
function Card({ children }) {
  return (
    <div
      style={{
        background: T.surface,
        border: `1px solid ${T.border}`,
        borderRadius: "12px",
        padding: "14px",
        marginBottom: "12px",
      }}
    >
      {children}
    </div>
  );
}

function CardLabel({ children }) {
  return (
    <div style={{ fontSize: "10px", letterSpacing: "0.2em", color: T.textMuted, fontWeight: 700, marginBottom: "10px" }}>
      {children}
    </div>
  );
}

function Metric({ label, big, sub, tone }) {
  const toneColor =
    tone === "under" ? T.amber :
    tone === "over"  ? T.warn :
    tone === "ok"    ? T.ok : T.text;
  return (
    <div>
      <div style={{ fontSize: "9px", letterSpacing: "0.15em", color: T.textMuted, fontWeight: 700, marginBottom: "4px" }}>{label}</div>
      <div style={{ fontSize: "20px", fontWeight: 700, color: toneColor, lineHeight: 1 }}>{big}</div>
      {sub && <div style={{ fontSize: "11px", color: T.textMuted, marginTop: "3px" }}>{sub}</div>}
    </div>
  );
}

function CoachPlanView({ plan, onRegenerate, onClear, busy }) {
  return (
    <div
      style={{
        background: "#0f172a",
        borderRadius: "12px",
        padding: "14px",
        color: "#f1f5f9",
      }}
    >
      <div
        style={{
          fontSize: "10px",
          letterSpacing: "0.2em",
          color: "#fb923c",
          fontWeight: 700,
          marginBottom: "10px",
          display: "flex",
          alignItems: "center",
          gap: "6px",
        }}
      >
        🧠 COACH CLAUDE SAYS
      </div>

      {plan.summary && (
        <div
          style={{
            fontSize: "13px",
            lineHeight: 1.55,
            marginBottom: "12px",
            color: "#e2e8f0",
          }}
        >
          {plan.summary}
        </div>
      )}

      <div
        style={{
          background: "rgba(255,255,255,0.05)",
          borderRadius: "8px",
          padding: "12px",
          fontSize: "13px",
          lineHeight: 1.65,
          color: "#f1f5f9",
          whiteSpace: "pre-wrap",
          fontFamily: "ui-monospace, 'SF Mono', Menlo, monospace",
        }}
      >
        {plan.session}
      </div>

      <div style={{ display: "flex", gap: "8px", marginTop: "12px" }}>
        <button
          onClick={onRegenerate}
          disabled={busy}
          style={{
            flex: 1,
            background: "transparent",
            border: "1px solid #475569",
            color: "#e2e8f0",
            borderRadius: "8px",
            padding: "8px",
            fontSize: "11px",
            fontWeight: 700,
            letterSpacing: "0.08em",
            cursor: busy ? "wait" : "pointer",
          }}
        >
          {busy ? "REGENERATING…" : "🔄 REGENERATE"}
        </button>
        <button
          onClick={onClear}
          disabled={busy}
          style={{
            background: "transparent",
            border: "1px solid #475569",
            color: "#94a3b8",
            borderRadius: "8px",
            padding: "8px 14px",
            fontSize: "11px",
            fontWeight: 700,
            letterSpacing: "0.08em",
            cursor: busy ? "wait" : "pointer",
          }}
        >
          DISCARD
        </button>
      </div>

      {plan.created_at && (
        <div style={{ fontSize: "10px", color: "#64748b", marginTop: "8px", textAlign: "right" }}>
          generated {new Date(plan.created_at).toLocaleString()}
        </div>
      )}
    </div>
  );
}
