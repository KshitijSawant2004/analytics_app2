const path = require("path");
const fs = require("fs");
require("dotenv").config({ path: path.join(__dirname, ".env") });

const express = require("express");
const cors = require("cors");
const trackRoutes = require("./routes/track");
const analyticsRoutes = require("./routes/analytics");
const errorAlertingRoutes = require("./routes/errorAlerting");

const app = express();
const PORT = process.env.PORT || 4001;

function resolveTrackerFile(fileName) {
  const candidatePaths = [
    // Preferred: backend-local assets (works when only backend is deployed).
    path.join(__dirname, "public", fileName),
    // Monorepo root assets (works in full-repo deployments).
    path.join(__dirname, "..", "..", "..", "tracker", fileName),
    // Fallback for alternate working directories.
    path.join(process.cwd(), "public", fileName),
    path.join(process.cwd(), "tracker", fileName),
  ];

  for (const filePath of candidatePaths) {
    if (fs.existsSync(filePath)) {
      return filePath;
    }
  }

  return null;
}

function sendTrackerFile(res, fileName) {
  const resolved = resolveTrackerFile(fileName);
  if (!resolved) {
    return res.status(404).json({
      error: true,
      message: `Tracker script not found: ${fileName}`,
    });
  }

  res.type("application/javascript");
  return res.sendFile(resolved);
}

// CORS
const corsOptions = {
  origin(origin, callback) {
    // Allow server-to-server calls and reflect browser origins for credentialed requests.
    if (!origin) return callback(null, true);
    return callback(null, origin);
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
};

app.use(cors(corsOptions));
app.options("*", cors(corsOptions));

// Body parser
app.use(express.json({ limit: "40mb" }));

// Health check
app.get("/", (_req, res) => {
  res.status(200).json({ status: "ok", service: "analytics-backend" });
});

// Logging
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`);
  next();
});

// Routes
app.use("/api", trackRoutes);
app.use("/api", analyticsRoutes);
app.use("/api", errorAlertingRoutes);

// Serve tracker scripts at stable root URLs for easy third-party embeds.
app.get("/sdk.js", (_req, res) => {
  sendTrackerFile(res, "sdk.js");
});

// Backward compatibility for older integrations.
app.get("/analytics.js", (_req, res) => {
  sendTrackerFile(res, "analytics.js");
});

app.get("/analytics-tracing.js", (_req, res) => {
  sendTrackerFile(res, "analytics-tracing.js");
});

// 404
app.use((req, res) => {
  res.status(404).json({ error: true, message: "Not found" });
});

// Error handler
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);
  res.status(err.status || 500).json({
    error: true,
    message: err.message || "Internal Server Error",
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`Analytics backend running on port ${PORT}`);
});