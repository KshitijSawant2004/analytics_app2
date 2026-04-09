export const DEFAULT_ANALYTICS_PROJECT_ID = "finfinity_website_UAT";
export const ACTIVE_PROJECT_STORAGE_KEY = "analytics_active_project_id";

export function getDefaultAnalyticsProjectId() {
  return DEFAULT_ANALYTICS_PROJECT_ID;
}

function normalizeProjectId(value) {
  const next = String(value || "").trim();
  return next || "";
}

export function getActiveProjectId() {
  if (typeof window === "undefined") {
    return DEFAULT_ANALYTICS_PROJECT_ID;
  }

  const stored = normalizeProjectId(window.localStorage.getItem(ACTIVE_PROJECT_STORAGE_KEY));
  return stored || DEFAULT_ANALYTICS_PROJECT_ID;
}

export function resolveActiveProjectId(candidate) {
  const explicit = normalizeProjectId(candidate);
  if (explicit) return explicit;
  return getActiveProjectId();
}

export function setActiveProjectId(nextProjectId) {
  if (typeof window === "undefined") return;
  const value = normalizeProjectId(nextProjectId) || DEFAULT_ANALYTICS_PROJECT_ID;
  window.localStorage.setItem(ACTIVE_PROJECT_STORAGE_KEY, value);
}

