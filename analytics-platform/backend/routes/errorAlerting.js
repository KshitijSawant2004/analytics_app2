const express = require("express");
const {
  processError,
  getErrorStats,
  getCriticalErrors,
  testAlert,
  getAlertSettings,
  updateAlertSettings,
} = require("../controllers/errorAlertingController");

const router = express.Router();

// Process incoming error event
router.post("/errors", processError);

// Get error statistics
router.get("/errors/stats", getErrorStats);

// Get recent critical errors
router.get("/errors/critical", getCriticalErrors);

// Test email alert configuration
router.get("/errors/test-alert", testAlert);

// Alert settings API
router.get("/alerts/settings", getAlertSettings);
router.post("/alerts/settings", updateAlertSettings);

module.exports = router;
