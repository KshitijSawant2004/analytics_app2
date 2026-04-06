import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { setActiveProjectId } from "@/utils/backendClient";

const WorkspaceContext = createContext(null);

const ACTIVE_PROJECT_KEY = "analytics_active_project";

export const RANGE_PRESETS = {
  "24h": { label: "Last 24 hours", days: 1 },
  "7d": { label: "Last 7 days", days: 7 },
  "30d": { label: "Last 30 days", days: 30 },
  custom: { label: "Custom range", days: null },
};

function todayISO() {
  return new Date().toISOString().split("T")[0];
}

function daysAgoISO(days) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().split("T")[0];
}

function resolveRange(rangePreset, customRange) {
  if (rangePreset !== "custom") {
    const preset = RANGE_PRESETS[rangePreset] || RANGE_PRESETS["7d"];
    return {
      startDate: daysAgoISO(preset.days),
      endDate: todayISO(),
      label: preset.label,
    };
  }

  return {
    startDate: customRange.startDate || daysAgoISO(7),
    endDate: customRange.endDate || todayISO(),
    label: RANGE_PRESETS.custom.label,
  };
}

function readPersistedProject() {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem(ACTIVE_PROJECT_KEY) || null;
  } catch {
    return null;
  }
}

function persistProject(id) {
  if (typeof window === "undefined") return;
  try {
    if (id) {
      localStorage.setItem(ACTIVE_PROJECT_KEY, id);
    } else {
      localStorage.removeItem(ACTIVE_PROJECT_KEY);
    }
  } catch {}
}

export function WorkspaceProvider({ children }) {
  const [rangePreset, setRangePreset] = useState("7d");
  const [customRange, setCustomRange] = useState({
    startDate: daysAgoISO(7),
    endDate: todayISO(),
  });
  const [searchText, setSearchText] = useState("");
  const [environment, setEnvironment] = useState("production");
  // Initialise from localStorage so the selection survives page refresh
  const [projectId, setProjectIdState] = useState(() => readPersistedProject());

  const resolvedRange = useMemo(
    () => resolveRange(rangePreset, customRange),
    [customRange, rangePreset]
  );

  // Keep backendClient in sync whenever projectId changes
  useEffect(() => {
    setActiveProjectId(projectId);
  }, [projectId]);

  function setProjectId(id) {
    const normalized = id || null;
    setProjectIdState(normalized);
    persistProject(normalized);
  }

  const value = useMemo(
    () => ({
      rangePreset,
      setRangePreset,
      customRange,
      setCustomRange,
      resolvedRange,
      searchText,
      setSearchText,
      environment,
      setEnvironment,
      projectId,
      setProjectId,
    }),
    [customRange, environment, projectId, rangePreset, resolvedRange, searchText]
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace() {
  const value = useContext(WorkspaceContext);
  if (!value) {
    throw new Error("useWorkspace must be used within a WorkspaceProvider");
  }

  return value;
}
