import { useState, useEffect } from "react";
import WorkoutTracker from "./WorkoutTracker.jsx";
import Dashboard from "./tabs/Dashboard.jsx";
import Food from "./tabs/Food.jsx";
import Alcohol from "./tabs/Alcohol.jsx";
import Settings from "./tabs/Settings.jsx";

// Tab definitions — order = display order in the bottom bar.
const TABS = [
  { id: "dashboard", label: "Today", icon: DashIcon, Component: Dashboard },
  { id: "workout",   label: "Workout", icon: DumbellIcon, Component: WorkoutTracker },
  { id: "food",      label: "Food", icon: ForkIcon, Component: Food },
  { id: "alcohol",   label: "Alcohol", icon: GlassIcon, Component: Alcohol },
  { id: "settings",  label: "Settings", icon: GearIcon, Component: Settings },
];

const T = {
  bg: "#f8fafc",
  border: "#e2e8f0",
  text: "#0f172a",
  textMuted: "#94a3b8",
  accent: "#ea580c",
};

const LAST_TAB_KEY = "coach-claude:last-tab";

export default function App() {
  // Remember which tab was last open across sessions
  const [active, setActive] = useState(() => {
    try {
      const v = localStorage.getItem(LAST_TAB_KEY);
      return v && TABS.some((t) => t.id === v) ? v : "workout";
    } catch {
      return "workout";
    }
  });

  useEffect(() => {
    try { localStorage.setItem(LAST_TAB_KEY, active); } catch {}
  }, [active]);

  const Active = TABS.find((t) => t.id === active)?.Component ?? WorkoutTracker;

  return (
    <div style={{ minHeight: "100vh", background: T.bg, color: T.text }}>
      <div style={{ paddingBottom: "70px" }}>
        <Active />
      </div>

      {/* Bottom tab bar — fixed */}
      <nav
        style={{
          position: "fixed",
          left: 0,
          right: 0,
          bottom: 0,
          background: "rgba(255,255,255,0.95)",
          backdropFilter: "saturate(180%) blur(8px)",
          WebkitBackdropFilter: "saturate(180%) blur(8px)",
          borderTop: `1px solid ${T.border}`,
          display: "grid",
          gridTemplateColumns: `repeat(${TABS.length}, 1fr)`,
          paddingBottom: "env(safe-area-inset-bottom)",
          zIndex: 100,
        }}
      >
        {TABS.map((t) => {
          const isActive = t.id === active;
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              onClick={() => setActive(t.id)}
              style={{
                background: "transparent",
                border: "none",
                padding: "8px 4px 10px",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: "3px",
                color: isActive ? T.accent : T.textMuted,
                cursor: "pointer",
                fontFamily: "inherit",
                fontSize: "10px",
                fontWeight: 600,
                letterSpacing: "0.06em",
                textTransform: "uppercase",
              }}
              aria-current={isActive ? "page" : undefined}
            >
              <Icon active={isActive} />
              {t.label}
            </button>
          );
        })}
      </nav>
    </div>
  );
}

// --- Inline icons (no external dependency) ---
function DashIcon({ active }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2.4 : 2}>
      <rect x="3" y="3" width="7" height="9" rx="1.5" />
      <rect x="14" y="3" width="7" height="5" rx="1.5" />
      <rect x="14" y="12" width="7" height="9" rx="1.5" />
      <rect x="3" y="16" width="7" height="5" rx="1.5" />
    </svg>
  );
}
function DumbellIcon({ active }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2.4 : 2}>
      <rect x="2" y="9" width="3" height="6" rx="1" />
      <rect x="19" y="9" width="3" height="6" rx="1" />
      <rect x="6" y="7" width="3" height="10" rx="1" />
      <rect x="15" y="7" width="3" height="10" rx="1" />
      <line x1="9" y1="12" x2="15" y2="12" />
    </svg>
  );
}
function ForkIcon({ active }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2.4 : 2} strokeLinecap="round">
      <path d="M7 2v8" />
      <path d="M4 2v6a3 3 0 0 0 3 3" />
      <path d="M10 2v6a3 3 0 0 1-3 3" />
      <line x1="7" y1="11" x2="7" y2="22" />
      <path d="M17 2c-2 0-3 2-3 5s1 5 3 5v10" />
    </svg>
  );
}
function GlassIcon({ active }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2.4 : 2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 3h12l-1.5 11a3 3 0 0 1-3 2.6h-3a3 3 0 0 1-3-2.6z" />
      <line x1="12" y1="16.5" x2="12" y2="21" />
      <line x1="9" y1="21" x2="15" y2="21" />
    </svg>
  );
}
function GearIcon({ active }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2.4 : 2}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}
