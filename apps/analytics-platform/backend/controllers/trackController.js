const eventService = require("../services/eventService");
const { getRequestIp, getLocationByIp } = require("../services/ipLocationService");
const { processErrorPayload } = require("./errorAlertingController");

async function trackEvent(req, res) {
  try {
    const {
      project_id,
      user_id,
      session_id,
      event_name,
      page,
      properties,
    } = req.body;

    const ip = getRequestIp(req);
    const location = await getLocationByIp(ip);

    console.log(`Event received: ${event_name}`);

    let eventPersisted = true;
    try {
      await eventService.createEvent({
        project_id,
        user_id,
        session_id,
        event_name,
        page,
        properties,
        country: location.country,
        city: location.city,
        region: location.region,
        timezone: location.timezone,
      });
    } catch (persistError) {
      eventPersisted = false;
      console.warn("Track event persistence skipped:", persistError?.message || persistError);
    }

    // Keep fatal alerting in sync with tracked error events.
    if (String(event_name || "").toLowerCase() === "error") {
      try {
        await processErrorPayload({
          project_id,
          event_name,
          user_id,
          session_id,
          page,
          timestamp: (req.body && req.body.timestamp) || new Date().toISOString(),
          properties,
        });
      } catch (alertError) {
        console.warn("Error alert processing failed for tracked error event:", alertError?.message || alertError);
      }
    }

    return res.status(200).json({ success: true, persisted: eventPersisted });
  } catch (error) {
    console.error("Track event error:", error.message);
    return res.status(500).json({ error: "Failed to track event" });
  }
}

module.exports = {
  trackEvent,
};
