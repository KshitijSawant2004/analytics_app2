const CONFIGURED_BACKEND_BASE = process.env.NEXT_PUBLIC_ANALYTICS_BASE;
const FALLBACK_BACKEND_BASES = [4001, 4002, 4003, 4004, 4005, 4006, 4000].map(
  (port) => `http://localhost:${port}`
);

const BACKEND_BASES = [CONFIGURED_BACKEND_BASE, ...FALLBACK_BACKEND_BASES].filter(
  (base, index, values) => Boolean(base) && values.indexOf(base) === index
);

let resolvedBackendBase = null;
const GET_CACHE_TTL_MS = 15000;
const getResponseCache = new Map();

function uniqueBases(values) {
  return values.filter((base, index, list) => Boolean(base) && list.indexOf(base) === index);
}

function getRuntimeBackendBases() {
  const runtimeBases = [];

  if (typeof window !== "undefined" && window?.location) {
    const protocol = window.location.protocol || "http:";
    const hostname = window.location.hostname || "localhost";
    const hostPortBases = [4001, 4002, 4003, 4004, 4005, 4006, 4000].map(
      (port) => `${protocol}//${hostname}:${port}`
    );
    runtimeBases.push(...hostPortBases);
  }

  return uniqueBases([resolvedBackendBase, CONFIGURED_BACKEND_BASE, ...runtimeBases, ...FALLBACK_BACKEND_BASES]);
}

function buildGetCacheKey(path, options) {
  const method = String(options.method || "GET").toUpperCase();
  if (method !== "GET") return null;

  if (options.skipCache === true) return null;
  if (String(options.cache || "").toLowerCase() === "no-store") return null;

  if (options.body != null) return null;

  const headers = options.headers ? JSON.stringify(options.headers) : "";
  return `${method}:${path}:${headers}`;
}

function sleep(delayMs) {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

export async function fetchAnalytics(path, options = {}) {
  if (options.skipCache === true || String(options.cache || "").toLowerCase() === "no-store") {
    const cacheKeyToDelete = `GET:${path}:${options.headers ? JSON.stringify(options.headers) : ""}`;
    getResponseCache.delete(cacheKeyToDelete);
  }

  const cacheKey = buildGetCacheKey(path, options);
  if (cacheKey) {
    const cached = getResponseCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < GET_CACHE_TTL_MS) {
      return cached.data;
    }
  }

  const timeout = Number(options.timeout || 10000);
  const attempts = Number(options.attempts || 2);
  const candidateBases = getRuntimeBackendBases();

  let lastError = null;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    for (const base of candidateBases) {
      let timeoutId;
      try {
        const controller = new AbortController();
        timeoutId = setTimeout(() => controller.abort(), timeout);

        const response = await fetch(`${base}/analytics${path}`, {
          ...options,
          signal: controller.signal,
        });

        if (!response.ok) {
          lastError = new Error(`Server ${base} returned status ${response.status}`);
          continue;
        }

        resolvedBackendBase = base;
        const data = await response.json();
        if (cacheKey) {
          getResponseCache.set(cacheKey, { data, timestamp: Date.now() });
        }
        return data;
      } catch (error) {
        lastError = error;
      } finally {
        clearTimeout(timeoutId);
      }
    }

    if (attempt < attempts - 1) {
      await sleep(500);
    }
  }

  throw lastError || new Error("Could not reach any backend server");
}

export function toQuery(params) {
  const query = new URLSearchParams();
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") return;
    query.set(key, String(value));
  });
  return query.toString();
}
