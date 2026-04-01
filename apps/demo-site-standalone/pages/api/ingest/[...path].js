const DEFAULT_UPSTREAM_BASE = "https://diamond-proamateur-imputably.ngrok-free.dev";

const ALLOWED_PATHS = new Set([
  "/track",
  "/session-record",
  "/frontend-error",
  "/dead-click",
  "/heatmap/click",
  "/heatmap/hover",
  "/heatmap/scroll",
  "/heatmap/snapshot",
]);

function normalizeUpstreamBase(value) {
  const base = String(value || DEFAULT_UPSTREAM_BASE).trim().replace(/\/+$/, "");
  return base || DEFAULT_UPSTREAM_BASE;
}

function normalizeTargetPath(pathParam) {
  const parts = Array.isArray(pathParam)
    ? pathParam
    : pathParam
      ? [pathParam]
      : [];

  const cleaned = parts
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .map((segment) => segment.replace(/^\/+|\/+$/g, ""));

  return `/${cleaned.join("/")}`;
}

function setCorsHeaders(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

async function readResponseBody(upstreamResponse) {
  const contentType = String(upstreamResponse.headers.get("content-type") || "").toLowerCase();
  if (contentType.includes("application/json")) {
    return upstreamResponse.json();
  }

  const text = await upstreamResponse.text();
  return text ? { message: text } : { success: upstreamResponse.ok };
}

export default async function handler(req, res) {
  setCorsHeaders(res);

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const targetPath = normalizeTargetPath(req.query.path);
  if (!ALLOWED_PATHS.has(targetPath)) {
    return res.status(404).json({ error: "Endpoint not found" });
  }

  const upstreamBase = normalizeUpstreamBase(process.env.ANALYTICS_UPSTREAM_BASE);
  const targetUrl = `${upstreamBase}${targetPath}`;

  try {
    const upstreamResponse = await fetch(targetUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "ngrok-skip-browser-warning": "true",
      },
      body: JSON.stringify(req.body || {}),
    });

    const body = await readResponseBody(upstreamResponse);
    return res.status(upstreamResponse.status).json(body);
  } catch (error) {
    return res.status(502).json({
      error: "Upstream analytics endpoint unreachable",
      details: error && error.message ? error.message : "Unknown error",
    });
  }
}
