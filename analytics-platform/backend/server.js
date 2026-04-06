const path = require("path");
const fs   = require("fs");
require("dotenv").config({ path: path.join(__dirname, ".env") });

const express    = require("express");
const cors       = require("cors");
const helmet     = require("helmet");
const rateLimit  = require("express-rate-limit");
const trackRoutes        = require("./routes/track");
const analyticsRoutes    = require("./routes/analytics");
const errorAlertingRoutes = require("./routes/errorAlerting");

const app = express();

// ── Security headers ──────────────────────────────────────────────────────────
app.use(helmet({
  // Allow the SDK and dashboard to be loaded cross-origin
  crossOriginResourcePolicy: { policy: "cross-origin" },
  // CSP would break embedded iframes — skip for now
  contentSecurityPolicy: false,
}));

// ── CORS ──────────────────────────────────────────────────────────────────────
// Tracking (write) endpoints are open to any origin so the SDK works on any site.
// Restrict read endpoints in production via ALLOWED_ORIGINS env var (comma-separated).
const rawAllowedOrigins = process.env.ALLOWED_ORIGINS;
const allowedOrigins = rawAllowedOrigins
  ? rawAllowedOrigins.split(",").map((o) => o.trim()).filter(Boolean)
  : null;

const corsOptions = {
  origin: allowedOrigins
    ? function (origin, callback) {
        // Allow server-to-server (no origin) and matching browser origins
        if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
        return callback(null, false);
      }
    : "*",
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
};

app.use(cors(corsOptions));
app.options("*", cors(corsOptions));

// ── Body parsing ──────────────────────────────────────────────────────────────
app.use(express.json({ limit: "40mb" }));

// ── Rate limiting ─────────────────────────────────────────────────────────────
// Tracking write endpoints — generous; SDK batches & uses sendBeacon
const trackingLimiter = rateLimit({
  windowMs: 60 * 1000,  // 1 minute
  max: 600,             // 600 req/min per IP (~10/sec — fine for batched SDK)
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests" },
  skip: (req) => req.method === "OPTIONS",
});

// Analytics read endpoints — tighter, dashboard only
const analyticsLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests" },
});

// ── Health check (no rate limit) ──────────────────────────────────────────────
app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "analytics-backend", ts: new Date().toISOString() });
});

// ── Serve the SDK script ──────────────────────────────────────────────────────
// External sites load: <script src="https://your-api.com/analytics.js"
//   data-project-id="xyz" data-endpoint="https://your-api.com/api"></script>
const SDK_CANDIDATES = [
  path.join(__dirname, "analytics.js"),                           // backend/analytics.js
  path.join(__dirname, "..", "dashboard", "public", "analytics.js"), // dashboard/public/analytics.js
  path.join(__dirname, "..", "analytics.js"),                     // monorepo root
  path.join(__dirname, "..", "..", "analytics.js"),
  path.join(__dirname, "..", "..", "..", "analytics.js"),
];
const SDK_PATH = SDK_CANDIDATES.find(fs.existsSync) || SDK_CANDIDATES[0];

app.get("/analytics.js", (_req, res) => {
  if (!fs.existsSync(SDK_PATH)) {
    return res.status(404).send("// analytics.js not found");
  }
  // Must be explicitly cross-origin so any site can load the SDK via <script src>
  res.setHeader("Content-Type", "text/javascript; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=300");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
  res.sendFile(SDK_PATH);
});

// ── Serve rrweb bundle (session recording) ────────────────────────────────────
const RRWEB_CANDIDATES = [
  path.join(__dirname, "node_modules", "rrweb", "dist", "rrweb.min.js"),
  path.join(__dirname, "node_modules", "rrweb", "dist", "rrweb.js"),
  path.join(__dirname, "node_modules", "rrweb", "dist", "rrweb.umd.cjs"),
  path.join(__dirname, "node_modules", "rrweb", "build", "rrweb.min.js"),
];

app.get("/rrweb.js", (_req, res) => {
  for (const candidate of RRWEB_CANDIDATES) {
    if (fs.existsSync(candidate)) {
      res.setHeader("Content-Type", "text/javascript");
      res.setHeader("Cache-Control", "public, max-age=86400"); // 1-day cache
      return res.sendFile(candidate);
    }
  }
  // Graceful fallback — SDK degrades without rrweb
  res.setHeader("Content-Type", "text/javascript");
  res.status(200).send("// rrweb not found — run: npm install in backend/");
});

// ── Request logging ───────────────────────────────────────────────────────────
const SKIP_LOG_PATHS = new Set(["/health", "/rrweb.js", "/analytics.js", "/"]);
app.use((req, _res, next) => {
  if (!SKIP_LOG_PATHS.has(req.path)) {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`);
  }
  next();
});

// ── Root health ───────────────────────────────────────────────────────────────
app.get("/", (_req, res) => {
  res.status(200).json({ status: "ok", service: "analytics-backend" });
});

// ── Routes ────────────────────────────────────────────────────────────────────
app.use("/api", trackingLimiter, trackRoutes);
app.use("/api", analyticsLimiter, analyticsRoutes);
app.use("/api", analyticsLimiter, errorAlertingRoutes);

// ── 404 ───────────────────────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ error: true, message: "Not found" });
});

// ── Global error handler (never leak stack traces to clients) ─────────────────
app.use((err, _req, res, _next) => {
  console.error("Unhandled error:", err.message);
  res.status(err.status || 500).json({ error: "Internal server error" });
});

// ── Port management — auto-retry on EADDRINUSE ────────────────────────────────
const BASE_PORT      = Number(process.env.PORT || 4001);
const MAX_PORT_TRIES = 5;

function startServer(port, attemptsLeft) {
  const server = app.listen(port, () => {
    console.log(`Analytics backend running on port ${port}`);
  });

  server.on("error", (error) => {
    if (error.code === "EADDRINUSE" && attemptsLeft > 0) {
      const nextPort = port + 1;
      console.warn(`Port ${port} in use — retrying on ${nextPort}...`);
      startServer(nextPort, attemptsLeft - 1);
      return;
    }
    throw error;
  });

  // ── Graceful shutdown ───────────────────────────────────────────────────────
  function shutdown(signal) {
    console.log(`${signal} received — shutting down gracefully`);
    server.close(() => {
      console.log("HTTP server closed");
      process.exit(0);
    });
    // Force-exit if still open after 10s
    setTimeout(() => {
      console.error("Forced shutdown after timeout");
      process.exit(1);
    }, 10000).unref();
  }

  process.once("SIGTERM", () => shutdown("SIGTERM"));
  process.once("SIGINT",  () => shutdown("SIGINT"));
}

startServer(BASE_PORT, MAX_PORT_TRIES);