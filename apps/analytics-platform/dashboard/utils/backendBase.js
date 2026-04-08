const DEFAULT_ANALYTICS_BASE = "https://analyticsapp2-production.up.railway.app";
const LOCAL_BACKEND_BASE = "http://localhost:4001";
const CONFIGURED_BACKEND_BASE = process.env.NEXT_PUBLIC_ANALYTICS_BASE;

export function getBackendBase() {
  const isLocalHost =
    typeof window !== "undefined" &&
    (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1");

  const preferred = isLocalHost
    ? [LOCAL_BACKEND_BASE, CONFIGURED_BACKEND_BASE, DEFAULT_ANALYTICS_BASE]
    : [CONFIGURED_BACKEND_BASE, DEFAULT_ANALYTICS_BASE, LOCAL_BACKEND_BASE];

  return preferred.find((base) => Boolean(base)) || DEFAULT_ANALYTICS_BASE;
}

export function buildApiUrl(path) {
  const normalizedPath = String(path || "").startsWith("/") ? String(path || "") : `/${String(path || "")}`;
  return `${getBackendBase()}/api${normalizedPath}`;
}
