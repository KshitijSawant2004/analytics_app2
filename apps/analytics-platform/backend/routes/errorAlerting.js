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

// Manage email alert recipients per project
router.get("/errors/alert-settings", getAlertSettings);
router.put("/errors/alert-settings", updateAlertSettings);

// New alert settings API
router.get("/alerts/settings", getAlertSettings);
router.post("/alerts/settings", updateAlertSettings);

module.exports = router;
