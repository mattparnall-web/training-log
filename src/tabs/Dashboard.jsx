import { useState, useEffect, useCallback } from "react";
import {
  sb, T, display, inputStyle,
  todayString, shiftDate, startOfDayLocal, endOfDayLocal,
  prettyDate, dateStrOf,
  DateBar,
  DAYS, dayDefFor, nutritionTargetsFor,
} from "./_shared.jsx";

// localStorage key for per-date coach notes — survives reloads on this device.
const NOTES_KEY = (dateStr) => `coach-claude:notes:${dateStr}`;

// ---- Anthropic proxy ----
const PROXY_URL = "/api/proxy";
const COACH_MODEL = "claude-opus-4-6";

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
// NOTE: Garmin's integer `trainingStatus` enum varies by firmware — same
// integer means different things across watch generations. The reliable
// source of truth is `trainingStatusFeedbackPhrase` (e.g. "PRODUCTIVE_3",
// "MAINTAINING_2", "RECOVERY_1") because the leading word IS the status.
//
// We use the phrase first, fall back to the integer only when the phrase is
// missing or unrecognised.

const PHRASE_STATUS_MAP = {
  PRODUCTIVE: "Productive",
  MAINTAINING: "Maintaining",
  UNPRODUCTIVE: "Unproductive",
  RECOVERY: "Recovery",
  DETRAINING: "Detraining",
  PEAKING: "Peaking",
  OVERREACHING: "Overreaching",
  STRAINED: "Strained",
  NO_STATUS: "No Status",
  PAUSED: "Paused",
};

function statusFromFeedbackPhrase(phrase) {
  if (typeof phrase !== "string" || !phrase) return null;
  // Strip trailing "_<digit>" intensity suffix, e.g. PRODUCTIVE_3 -> PRODUCTIVE.
  const base = phrase.replace(/_\d+$/, "");
  return PHRASE_STATUS_MAP[base] || null;
}

// Legacy integer-enum fallback (may be wrong on your firmware).
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
    if (raw.includes("_")) return null;
    return raw.charAt(0) + raw.slice(1).toLowerCase();
  }
  return null;
}

// Garmin's load-balance feedback phrases — directly actionable for coaching.
const LOAD_BALANCE_PHRASES = {
  BALANCED: "Load is balanced",
  AEROBIC_LOW_SHORTAGE: "Need more low aerobic (Z1–Z2)",
  AEROBIC_LOW_EXCESS: "Too much low aerobic",
  AEROBIC_HIGH_SHORTAGE: "Need more high aerobic (Z3–Z4)",
  AEROBIC_HIGH_EXCESS: "Too much high aerobic",
  ANAEROBIC_SHORTAGE: "Need more anaerobic work",
  ANAEROBIC_EXCESS: "Too much anaerobic work",
  AEROBIC_LOW_HIGH_SHORTAGE: "Need more aerobic (both zones)",
  AEROBIC_LOW_AND_ANAEROBIC_SHORTAGE: "Need more low aerobic + anaerobic",
  AEROBIC_HIGH_AND_ANAEROBIC_SHORTAGE: "Need more high aerobic + anaerobic",
};

function friendlyLoadBalance(phrase) {
  if (typeof phrase !== "string" || !phrase) return null;
  return LOAD_BALANCE_PHRASES[phrase] || phrase.replace(/_/g, " ").toLowerCase();
}

// Read the training status from a device entry.
// Priority: the feedback phrase (most reliable across firmwares) > the
// integer enum (varies by firmware — unreliable).
function readStatusValue(dev) {
  if (!dev) return null;
  const fromPhrase = statusFromFeedbackPhrase(dev.trainingStatusFeedbackPhrase);
  if (fromPhrase) return fromPhrase;
  if (typeof dev.trainingStatusType === "string" && dev.trainingStatusType.length > 0) {
    const s = dev.trainingStatusType;
    return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
  }
  return humanTrainingStatus(dev.trainingStatus);
}

function pickTrainingStatus(section) {
  const d = section?.data;
  if (!d) return null;
  const latest = d?.mostRecentTrainingStatus?.latestTrainingStatusData;
  if (!latest) return null;

  const deviceIds = Object.keys(latest);
  const devices = deviceIds.map((id) => ({ id, ...latest[id] }));
  if (!devices.length) return null;

  const dateOf = (dev) =>
    dev?.calendarDate || dev?.statusDate || dev?.timestamp || "";

  // Wristwatches typically carry richer training-status metadata than bike
  // computers (Edge), so score each device on data richness as a heuristic
  // for "this is the daily-wear watch". Tie-break by recency.
  const richnessScore = (dev) => {
    let s = 0;
    if (dev?.acwrFlash) s += 2;
    if (dev?.recoveryTime != null) s += 2;
    if (dev?.weeklyTrainingLoad != null) s += 1;
    if (dev?.fitnessTrend != null) s += 1;
    if (dev?.loadTunnelMin != null) s += 1;
    if (dev?.sleepStress != null) s += 1;
    if (dev?.restingHeartRate != null) s += 1;
    return s;
  };

  devices.sort((a, b) => {
    const r = richnessScore(b) - richnessScore(a);
    if (r !== 0) return r;
    return (dateOf(b) || "").localeCompare(dateOf(a) || "");
  });

  const chosen = devices[0];

  // Now that we use the feedback phrase to derive the status itself, the
  // most useful "sub" line is the LOAD BALANCE feedback — which tells the
  // athlete WHAT to do (more Z1–Z2, less anaerobic, etc.) rather than just
  // describing where they are.
  const loadBalanceMap = d?.mostRecentTrainingLoadBalance?.metricsTrainingLoadBalanceDTOMap;
  const loadBalanceEntry = loadBalanceMap ? Object.values(loadBalanceMap)[0] : null;
  const loadBalanceFeedback = friendlyLoadBalance(
    loadBalanceEntry?.trainingBalanceFeedbackPhrase
  );

  return {
    status: readStatusValue(chosen),
    load: chosen?.acwrFlash?.value ?? chosen?.weeklyTrainingLoad ?? null,
    feedback: loadBalanceFeedback,
    loadBalanceFeedback,
    loadBalanceRaw: loadBalanceEntry?.trainingBalanceFeedbackPhrase || null,
    feedbackPhrase: chosen?.trainingStatusFeedbackPhrase || null,
    source_date: dateOf(chosen) || null,
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
function buildCoachPrompt({ dateStr, day, settings, garmin, recentSessions, recentReviews, yIntake, todayTargets, yesterdayTargets, athleteNotes }) {
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

  // Programme-level context the athlete pasted from earlier coaching chats.
  // We put this at the top so it anchors all downstream reasoning.
  const programmeContextBlock = settings?.programme_context?.trim()
    ? `ATHLETE'S PROGRAMME CONTEXT (long-form, set by the athlete — always honour this):
"""
${settings.programme_context.trim()}
"""

`
    : "";

  // Coach's own past post-session reviews — so this week's planning sees the
  // notes Claude itself made on recent sessions, completing the feedback loop.
  const reviewsBlock = recentReviews?.length
    ? `RECENT COACH REVIEWS (your own notes from prior sessions — adapt this week's plan based on these):
${recentReviews.map((r) => `  - ${r.date} ${r.day_name || ""}: ${r.summary || "(no summary)"}`).join("\n")}

`
    : "";

  return `${programmeContextBlock}${reviewsBlock}DATE: ${dateStr}
DAY OF WEEK: ${day.label} — programme says: ${day.name}

KEY LIFT TARGETS (athlete's current 1-rep targets or working weights):
${keyLiftsText}

TODAY'S NUTRITION TARGETS (day-type: ${todayTargets?.bucket ?? "?"} — calibrated to training intensity):
  - Calories: ${todayTargets?.calories ?? "not set"}
  - Protein: ${todayTargets?.protein_g ?? "not set"} g
  - Fat: ${todayTargets?.fat_g ?? "not set"} g
  - Carbs: ${todayTargets?.carbs_g ?? "not set"} g
  - Weekly alcohol units cap: ${settings?.weekly_alcohol_units_target ?? "not set"}

LAST NIGHT / TODAY'S RECOVERY (from Garmin):
  - Sleep: ${hoursMinutes(sleep?.duration_seconds)} (score: ${sleep?.score ?? "n/a"}); deep ${hoursMinutes(sleep?.deep_seconds)}, REM ${hoursMinutes(sleep?.rem_seconds)}
  - HRV (last night): ${hrv?.last_night_avg ?? "n/a"}ms; status: ${hrv?.status ?? "n/a"}; 7d avg: ${hrv?.weekly_avg ?? "n/a"}
  - Body Battery: current ${bb?.current ?? "n/a"}, range ${bb?.min ?? "?"}–${bb?.max ?? "?"}; charged ${bb?.charged ?? "?"}, drained ${bb?.drained ?? "?"}
  - Training readiness: ${readiness?.score ?? "n/a"}/100 (${readiness?.level ?? "n/a"})
  - Training status: ${status?.status ?? "n/a"}
  - Training load balance: ${status?.loadBalanceFeedback ?? "n/a"}${status?.loadBalanceRaw ? ` (Garmin code: ${status.loadBalanceRaw})` : ""}

YESTERDAY'S INTAKE (vs yesterday's day-type targets — bucket: ${yesterdayTargets?.bucket ?? "?"}):
  - Calories: ${yIntake?.calories ?? 0} kcal (target ${yesterdayTargets?.calories ?? "?"})
  - Protein: ${yIntake?.protein_g ?? 0} g (target ${yesterdayTargets?.protein_g ?? "?"})
  - Fat: ${yIntake?.fat_g ?? 0} g (target ${yesterdayTargets?.fat_g ?? "?"})
  - Carbs: ${yIntake?.carbs_g ?? 0} g (target ${yesterdayTargets?.carbs_g ?? "?"})
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

You will be given today's date, the athlete's recent training, last night's recovery data from Garmin, yesterday's nutrition + alcohol, the athlete's current target weights for their key lifts, and any free-text notes the athlete added.

Your job: recommend TODAY'S SESSION, calibrated to recovery and recent load. Be specific and decisive.

Hard rules:
- Adapt intensity to readiness. Low HRV / poor sleep / low body battery / low readiness → scale back, focus on volume not load, or move some work to accessories. Strong recovery → push toward PRs.
- Respect the planned day type unless recovery is genuinely poor (in which case suggest substituting a lighter session and say so).
- Use the athlete's key lift targets as the reference for working weights; suggest specific percentages (e.g. "85% of target = 76 kg").
- Aim for 4–7 exercises in a single ~60-minute session.
- Treat athlete free-text notes as high-signal input — adapt the session around them.
- If yesterday's nutrition was well under calories or protein was way low, mention it briefly but don't lecture.

OUTPUT FORMAT — respond ONLY with a JSON object. No preamble, no markdown fences, no text outside the JSON. The JSON has exactly these keys:

{
  "summary": "One or two sentences explaining your reasoning — the recovery picture and how today's session is calibrated to it.",
  "exercises": [
    {
      "name": "Exercise name",
      "prescription": "sets × reps @ weight, OR a duration, OR descriptive text",
      "note": "optional brief inline note, or empty string"
    }
  ]
}

Prescription examples:
- "4 × 6 @ 82 kg"
- "3 × 8 (bodyweight + 5 kg)"
- "20–30 min @ Zone 2 (~60–70% max HR)"
- "5 min foam roll"
- "3 sets to RPE 8"

Notes examples:
- "deload from last week's PR — focus on bar speed"
- "stop if knee twinges"
- "" (when no note is needed)`;

// System prompt used when the athlete asks for a revision after seeing the plan.
// We feed the existing plan back in so the model can adjust rather than rebuild
// from scratch — keeping continuity with what the athlete already saw.
const COACH_REVISE_SYSTEM_PROMPT = `${COACH_SYSTEM_PROMPT}

REVISION MODE
You have already proposed a session for today (included below as PREVIOUS PLAN).
The athlete has read it and given you feedback. Revise the plan in light of their
feedback — keep what they didn't object to, change only what they flagged.
Respond with the same JSON shape as before (summary + exercises). In the
summary, briefly acknowledge the change you made (e.g. "Dropped bench to 70 kg
because you said it's too heavy.").`;

// ---- Parse Claude's response: JSON first, fall back to text headers ----
function tryExtractJSON(text) {
  try { return JSON.parse(text); } catch {}
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (fenceMatch) {
    try { return JSON.parse(fenceMatch[1]); } catch {}
  }
  const braceMatch = text.match(/\{[\s\S]*\}/);
  if (braceMatch) {
    try { return JSON.parse(braceMatch[0]); } catch {}
  }
  return null;
}

function parseCoachReply(text) {
  // Preferred path: structured JSON.
  const json = tryExtractJSON(text);
  if (json && typeof json.summary === "string" && Array.isArray(json.exercises)) {
    return {
      summary: json.summary.trim(),
      exercises: json.exercises.map((ex) => ({
        name: String(ex.name ?? "").trim(),
        prescription: String(ex.prescription ?? "").trim(),
        note: String(ex.note ?? "").trim(),
      })),
      sessionText: null,
    };
  }
  // Fallback for older / malformed responses: split on SESSION: header.
  const sessionRegex = /(?:^|\n)\s*SESSION\s*:?\s*\n?/i;
  const m = sessionRegex.exec(text);
  if (m) {
    const before = text.slice(0, m.index).trim();
    const after = text.slice(m.index + m[0].length).trim();
    const summary = before.replace(/^\s*SUMMARY\s*:?\s*/i, "").trim();
    return { summary, exercises: null, sessionText: after };
  }
  return { summary: "", exercises: null, sessionText: text };
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

// ---- Read recent post-session coach reviews (used to feed back into planning) ----
async function fetchRecentReviews(limit = 5) {
  try {
    const rows = await sb(
      `/session_reviews?select=session_id,date,day_name,summary,created_at&order=date.desc&limit=${limit}`
    );
    return rows || [];
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
  // 40s timeout: cold-start (Python init ~3s) + 6 sequential Garmin calls
  // (~1–4s each) can total ~25–35s. 40s gives comfortable headroom before
  // abort, vs. our previous 25s which sometimes clipped legitimate slow calls.
  const fetchWithTimeout = async (url, ms = 40000) => {
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
        // Re-parse the raw plan_text so old plans render correctly with the
        // new parser (no migration needed).
        const parsed = parseCoachReply(r.plan_text || "");
        setPlan({
          summary: parsed.summary || r.summary || "",
          exercises: parsed.exercises,
          sessionText: parsed.sessionText,
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
      const [recentSessions, recentReviews] = await Promise.all([
        fetchRecentSessions(10),
        fetchRecentReviews(5),
      ]);
      const yIntake = {
        calories: yCalories,
        protein_g: yProtein,
        fat_g: yFat,
        carbs_g: yCarbs,
        drinks: alcoholYesterday.length,
        units: round1(alcoholYesterday.reduce((a, e) => a + Number(e.units || 0), 0)),
      };
      const userPrompt = buildCoachPrompt({
        dateStr: selectedDate,
        day,
        settings,
        garmin,
        recentSessions,
        recentReviews,
        yIntake,
        todayTargets,
        yesterdayTargets,
        athleteNotes: notes,
      });
      const replyText = await callClaudeText(COACH_SYSTEM_PROMPT, userPrompt, 1400);
      const parsed = parseCoachReply(replyText);

      // Persist the raw reply text so we can re-parse on load (lets us evolve
      // the parser without re-running the AI call).
      const row = {
        date: selectedDate,
        day_id: day.id,
        day_name: day.name,
        summary: parsed.summary,
        plan_text: replyText,
        model: COACH_MODEL,
      };
      await sb("/planned_sessions", {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=representation" },
        body: JSON.stringify(row),
      });

      setPlan({
        summary: parsed.summary,
        exercises: parsed.exercises,
        sessionText: parsed.sessionText,
        model: COACH_MODEL,
        created_at: new Date().toISOString(),
      });
    } catch (e) {
      setCoachError(e.message);
    } finally {
      setCoachBusy(false);
    }
  };

  // ---- Revise the existing plan based on athlete feedback ----
  // Takes a free-text feedback string from the user, sends it back to Claude
  // along with the existing plan, and replaces the saved plan with the revision.
  const revisePlan = async (feedbackText) => {
    if (!plan || !feedbackText?.trim()) return;
    setCoachBusy(true);
    setCoachError(null);
    try {
      const [recentSessions, recentReviews] = await Promise.all([
        fetchRecentSessions(10),
        fetchRecentReviews(5),
      ]);
      const yIntake = {
        calories: yCalories,
        protein_g: yProtein,
        fat_g: yFat,
        carbs_g: yCarbs,
        drinks: alcoholYesterday.length,
        units: round1(alcoholYesterday.reduce((a, e) => a + Number(e.units || 0), 0)),
      };
      const baseContext = buildCoachPrompt({
        dateStr: selectedDate,
        day,
        settings,
        garmin,
        recentSessions,
        recentReviews,
        yIntake,
        todayTargets,
        yesterdayTargets,
        athleteNotes: notes,
      });
      const previousPlanJson = JSON.stringify(
        { summary: plan.summary, exercises: plan.exercises },
        null,
        2
      );
      const userPrompt = `${baseContext}

PREVIOUS PLAN (already shown to the athlete):
${previousPlanJson}

ATHLETE FEEDBACK ON THAT PLAN:
"""
${feedbackText.trim()}
"""

Revise the plan to address the feedback. Same JSON output format.`;
      const replyText = await callClaudeText(COACH_REVISE_SYSTEM_PROMPT, userPrompt, 1400);
      const parsed = parseCoachReply(replyText);

      const row = {
        date: selectedDate,
        day_id: day.id,
        day_name: day.name,
        summary: parsed.summary,
        plan_text: replyText,
        model: COACH_MODEL,
      };
      // Upsert (merge-duplicates) so the existing plan row gets replaced.
      await sb("/planned_sessions", {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=representation" },
        body: JSON.stringify(row),
      });

      setPlan({
        summary: parsed.summary,
        exercises: parsed.exercises,
        sessionText: parsed.sessionText,
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
  const yFat = Math.round(foodYesterday.reduce((a, e) => a + Number(e.fat_g || 0), 0));
  const yCarbs = Math.round(foodYesterday.reduce((a, e) => a + Number(e.carbs_g || 0), 0));
  const yUnits = round1(alcoholYesterday.reduce((a, e) => a + Number(e.units || 0), 0));
  const yDrinks = alcoholYesterday.length;

  // Use day-aware targets — yesterday's targets are based on yesterday's day type;
  // today's targets are based on today's day type (for the coach prompt).
  const yesterdayDay = dayDefFor(yesterdayStr);
  const yesterdayTargets = nutritionTargetsFor(settings, yesterdayDay.type);
  const todayTargets = nutritionTargetsFor(settings, day.type);

  const calTarget = yesterdayTargets.calories;
  const proteinTarget = yesterdayTargets.protein_g;
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
            <CoachPlanView
              plan={plan}
              onRegenerate={planSession}
              onRevise={revisePlan}
              onClear={clearPlan}
              busy={coachBusy}
            />
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

      {/* Recovery card — sleep gets pride of place with duration + score equal */}
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
          <>
            {/* Sleep — full-width row with duration + score side by side */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: "10px",
                paddingBottom: "12px",
                marginBottom: "12px",
                borderBottom: `1px solid ${T.border}`,
              }}
            >
              <Metric
                label="PRIOR NIGHT'S SLEEP"
                big={hoursMinutes(sleep?.duration_seconds)}
                sub={
                  sleep?.deep_seconds != null
                    ? `Deep ${hoursMinutes(sleep.deep_seconds)} · REM ${hoursMinutes(sleep.rem_seconds)}`
                    : null
                }
              />
              <Metric
                label="SLEEP SCORE"
                big={valueOrDash(sleep?.score)}
                tone={
                  sleep?.score == null
                    ? null
                    : sleep.score >= 80
                    ? "ok"
                    : sleep.score >= 60
                    ? "under"
                    : "over"
                }
              />
            </div>

            {/* Body battery + HRV side by side */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: "10px",
                marginBottom: "12px",
              }}
            >
              <Metric
                label="BODY BATTERY"
                big={valueOrDash(bb?.current ?? bb?.max)}
                sub={bb?.max != null && bb?.min != null ? `${bb.min}–${bb.max}` : null}
              />
              <Metric
                label="HRV (LAST NIGHT)"
                big={valueOrDash(hrv?.last_night_avg, "ms")}
                sub={hrv?.status ? hrv.status : (hrv?.weekly_avg != null ? `7d avg ${hrv.weekly_avg}` : null)}
              />
            </div>

            {/* Training status — full width with load-balance feedback below */}
            <div style={{ paddingTop: "12px", borderTop: `1px solid ${T.border}` }}>
              <Metric
                label="TRAINING STATUS"
                big={trainingStatus?.status || "—"}
                sub={trainingStatus?.feedback || null}
              />
            </div>
          </>
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

function CoachPlanView({ plan, onRegenerate, onRevise, onClear, busy }) {
  // Local state for the revise flow — typing in a feedback box without
  // bouncing through the Dashboard's React tree.
  const [showFeedback, setShowFeedback] = useState(false);
  const [feedbackText, setFeedbackText] = useState("");

  const submitFeedback = async () => {
    if (!feedbackText.trim() || busy) return;
    await onRevise?.(feedbackText);
    // Only clear the input on success — if onRevise threw, the parent will have
    // surfaced an error and we want the user to see what they typed.
    setFeedbackText("");
    setShowFeedback(false);
  };

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

      {/* Structured exercises (preferred) */}
      {Array.isArray(plan.exercises) && plan.exercises.length > 0 ? (
        <div
          style={{
            background: "rgba(255,255,255,0.05)",
            borderRadius: "8px",
            padding: "12px 14px",
            display: "flex",
            flexDirection: "column",
            gap: "10px",
          }}
        >
          {plan.exercises.map((ex, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                gap: "10px",
                alignItems: "flex-start",
              }}
            >
              <div
                style={{
                  flexShrink: 0,
                  width: "22px",
                  height: "22px",
                  borderRadius: "50%",
                  background: "#fb923c",
                  color: "#0f172a",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "11px",
                  fontWeight: 800,
                  marginTop: "1px",
                }}
              >
                {i + 1}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontSize: "14px",
                    fontWeight: 700,
                    color: "#f1f5f9",
                    lineHeight: 1.3,
                  }}
                >
                  {ex.name}
                </div>
                {ex.prescription && (
                  <div
                    style={{
                      fontSize: "13px",
                      color: "#cbd5e1",
                      marginTop: "2px",
                      fontFamily: "ui-monospace, 'SF Mono', Menlo, monospace",
                    }}
                  >
                    {ex.prescription}
                  </div>
                )}
                {ex.note && (
                  <div
                    style={{
                      fontSize: "12px",
                      color: "#94a3b8",
                      marginTop: "3px",
                      fontStyle: "italic",
                      lineHeight: 1.4,
                    }}
                  >
                    {ex.note}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        // Fallback: render raw session text (for legacy or malformed plans)
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
          {plan.sessionText || "(no session text)"}
        </div>
      )}

      {/* Revise feedback box — opens inline when the user taps REVISE */}
      {showFeedback && (
        <div
          style={{
            marginTop: "12px",
            background: "rgba(255,255,255,0.06)",
            border: "1px solid #334155",
            borderRadius: "10px",
            padding: "12px",
          }}
        >
          <div
            style={{
              fontSize: "10px",
              letterSpacing: "0.15em",
              color: "#fb923c",
              fontWeight: 700,
              marginBottom: "6px",
            }}
          >
            TELL THE COACH WHAT TO CHANGE
          </div>
          <textarea
            value={feedbackText}
            onChange={(e) => setFeedbackText(e.target.value)}
            placeholder="e.g. Bench at 82 kg is too heavy today, drop it &mdash; or &mdash; you misread last week, my squat working set was 110 kg not 130 kg"
            rows={3}
            disabled={busy}
            style={{
              width: "100%",
              background: "#0b1220",
              border: "1px solid #1e293b",
              borderRadius: "8px",
              color: "#f1f5f9",
              padding: "10px 12px",
              fontSize: "13px",
              fontFamily: "inherit",
              resize: "vertical",
              outline: "none",
              boxSizing: "border-box",
            }}
          />
          <div style={{ display: "flex", gap: "8px", marginTop: "8px" }}>
            <button
              onClick={() => { setShowFeedback(false); setFeedbackText(""); }}
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
              CANCEL
            </button>
            <button
              onClick={submitFeedback}
              disabled={!feedbackText.trim() || busy}
              style={{
                flex: 1,
                background: feedbackText.trim() && !busy ? "#fb923c" : "#334155",
                color: feedbackText.trim() && !busy ? "#0f172a" : "#64748b",
                border: "none",
                borderRadius: "8px",
                padding: "8px 14px",
                fontSize: "11px",
                fontWeight: 800,
                letterSpacing: "0.08em",
                cursor: feedbackText.trim() && !busy ? "pointer" : "default",
              }}
            >
              {busy ? "COACH IS REVISING…" : "↻ ASK COACH TO REVISE"}
            </button>
          </div>
        </div>
      )}

      <div style={{ display: "flex", gap: "8px", marginTop: "12px" }}>
        {!showFeedback && (
          <button
            onClick={() => setShowFeedback(true)}
            disabled={busy}
            style={{
              flex: 1,
              background: "#fb923c",
              border: "none",
              color: "#0f172a",
              borderRadius: "8px",
              padding: "8px",
              fontSize: "11px",
              fontWeight: 800,
              letterSpacing: "0.08em",
              cursor: busy ? "wait" : "pointer",
            }}
          >
            ✏️ REVISE
          </button>
        )}
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
          {busy ? "WORKING…" : "🔄 REGENERATE"}
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
