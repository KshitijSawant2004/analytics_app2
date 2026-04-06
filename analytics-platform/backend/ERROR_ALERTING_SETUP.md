# Error Alerting System Documentation

## Overview

The error alerting system automatically detects critical frontend errors and notifies the development team in real-time. It features intelligent error aggregation, deduplication, and configurable alert rules.

## Features

### 1. Error Aggregation
- Groups errors by: message, source code location (file + line)
- Tracks: error count, unique user count, first/last occurrence timestamps
- Stores events in `error_aggregates` table for analysis

### 2. Fatal Detection Rules
Alerts trigger automatically when:

**Frequency Rule**
- Same error occurs 10+ times within 1 minute
- Detects sudden error spikes

**User Impact Rule**
- Error affects 5+ unique users
- Catches widespread issues early

**Critical Page Rule**
- Error occurs on sensitive pages: `/checkout`, `/payment`, `/confirm`, `/submit-application`
- Always alerts regardless of frequency

### 3. Smart Deduplication
- 10-minute cooldown between duplicate alerts for the same error
- Prevents alert fatigue while ensuring critical issues aren't missed
- Tracked in `alert_logs` table

### 4. Email Alerting
- Powered by Nodemailer
- Supports Gmail, custom SMTP servers, or other email services
- Email includes:
  - Error message and stack trace location
  - Impact metrics (total occurrences, unique users)
  - Affected page URL
  - Link to session replays for debugging
  - Beautiful HTML template

### 5. Logging
- All alerts logged to prevent duplicates within cooldown window
- Historical alert data for compliance and analysis

## Setup Instructions

### Step 1: Run Database Migration

```bash
cd backend
psql -U postgres -d analytics -f migrations/013_create_error_alerting_tables.sql
```

Or if using your own DB connection:
```bash
psql -c "$(cat migrations/013_create_error_alerting_tables.sql)" $DATABASE_URL
```

### Step 2: Install Dependencies

```bash
cd backend
npm install
```

This installs `nodemailer` required for email alerts.

### Step 3: Configure Email

Edit `.env` file with your email configuration:

**Option A: Gmail** (Recommended for testing)
```env
EMAIL_SERVICE=gmail
EMAIL_USER=your-email@gmail.com
EMAIL_PASSWORD=your-app-specific-password
ALERT_EMAIL_RECIPIENTS=team@company.com
DASHBOARD_URL=http://localhost:3001
```

**Option B: Custom SMTP Server**
```env
EMAIL_HOST=smtp.yourdomain.com
EMAIL_PORT=587
EMAIL_SECURE=false
EMAIL_USER=alerts@yourdomain.com
EMAIL_PASSWORD=your-password
ALERT_EMAIL_RECIPIENTS=team@company.com
DASHBOARD_URL=http://localhost:3001
```

### Step 4: Test Email Configuration

```bash
curl http://localhost:4001/errors/test-alert
```

Expected response:
```json
{ "success": true, "message": "Email configuration verified" }
```

## API Endpoints

### Process Error Event
**POST /errors**

Accepts error events from your frontend tracker.

Request:
```json
{
  "project_id": "proj_123",
  "event_name": "error",
  "user_id": "user_456",
  "page": "/checkout",
  "url": "https://example.com/checkout",
  "timestamp": 1684756800000,
  "properties": {
    "message": "Cannot read property 'total' of undefined",
    "source": "https://example.com/js/checkout.js",
    "line": 145
  }
}
```

Response:
```json
{
  "success": true,
  "aggregateId": 42,
  "isFatal": true,
  "rulesTriggered": 2
}
```

### Get Error Statistics
**GET /errors/stats?project_id=proj_123&minutes=60**

Returns aggregated error metrics for the time window.

Response:
```json
{
  "success": true,
  "project_id": "proj_123",
  "timeWindowMinutes": 60,
  "stats": {
    "total_errors": 15,
    "total_occurrences": 47,
    "max_single_error_count": 12,
    "high_impact_errors": 3
  }
}
```

### Get Critical Errors
**GET /errors/critical?project_id=proj_123&limit=10**

Returns recent errors that triggered rules.

Response:
```json
{
  "success": true,
  "project_id": "proj_123",
  "errors": [
    {
      "id": 42,
      "error_message": "Cannot read property 'total' of undefined",
      "error_source": "https://example.com/js/checkout.js",
      "error_line": 145,
      "error_count": 12,
      "unique_user_count": 6,
      "last_seen": "2026-03-23T10:45:30.123Z"
    }
  ]
}
```

### Test Alert Configuration
**GET /errors/test-alert**

Validates email configuration. No alerts are sent.

Response:
```json
{
  "success": true,
  "message": "Email configuration verified"
}
```

## Frontend Integration

Update your tracking script to send error events:

```javascript
// In analytics.js or your error handler
window.addEventListener("error", function (e) {
  track("error", {
    message: e.message,
    source: e.filename,
    line: e.lineno,
  });
});
```

Or manually trigger alerts:

```javascript
window.analytics.track("error", {
  message: "Custom error message",
  source: "checkout.js",
  line: 123,
});
```

## Configuration Reference

### Fatal Error Rules (in `errorAggregationService.js`)

```javascript
FATAL_ERROR_RULES = {
  FREQUENCY_THRESHOLD: 10,        // min errors in time window
  FREQUENCY_WINDOW_MS: 60000,     // 1 minute
  USER_IMPACT_THRESHOLD: 5,       // unique user count
  ALERT_COOLDOWN_MS: 600000,      // 10 minute cooldown
  CRITICAL_PAGES: ["/checkout", "/payment", "/confirm", "/submit-application"],
};
```

Edit these values in `backend/services/errorAggregationService.js` to customize alert sensitivity.

## Monitoring

### Check Recent Alerts
```sql
SELECT project_id, error_aggregate_id, alert_type, sent_at 
FROM alert_logs 
ORDER BY sent_at DESC 
LIMIT 20;
```

### View High-Impact Errors
```sql
SELECT error_message, error_source, error_line, error_count, unique_user_count 
FROM error_aggregates 
WHERE unique_user_count >= 5 
ORDER BY last_seen DESC;
```

### Clear Old Data (Optional)
```sql
DELETE FROM error_aggregates 
WHERE created_at < NOW() - INTERVAL '30 days';
```

## Debugging

### Email not being sent?

1. Check ALERT_EMAIL_RECIPIENTS is set in .env
2. Run test endpoint: `curl http://localhost:4001/errors/test-alert`
3. Verify email credentials are correct
4. If using Gmail, ensure app-specific password is generated
5. Check backend logs for detailed error messages

### Missing database tables?

Run migration again:
```bash
psql -c "$(cat backend/migrations/013_create_error_alerting_tables.sql)" $DATABASE_URL
```

### Testing with curl

```bash
curl -X POST http://localhost:4001/errors \
  -H "Content-Type: application/json" \
  -d '{
    "project_id": "test_proj",
    "event_name": "error",
    "user_id": "test_user",
    "page": "/checkout",
    "url": "http://localhost:3000/checkout",
    "timestamp": '$(date +%s)'000,
    "properties": {
      "message": "Test error message",
      "source": "test.js",
      "line": 42
    }
  }'
```

## Best Practices

1. **Set reasonable thresholds** - Adjust frequency/user thresholds based on your traffic volume
2. **Monitor the dashboard** - Regularly check `/errors/stats` and `/errors/critical`
3. **Archive old data** - Use the cleanup query to maintain database performance
4. **Test alerts** - Run test-alert endpoint after config changes
5. **Update critical pages** - Add any sensitive pages to CRITICAL_PAGES list
6. **Coordinate alerts** - Set ALERT_EMAIL_RECIPIENTS to multiple team members

## Limitations & Future Improvements

Current:
- Email-only alerting (can add Slack, PagerDuty, etc.)
- Single project per API call (can aggregate multi-project alerts)
- No alert templates customization
- Manual cooldown configuration

Improvements to consider:
- Webhook support for custom integrations
- Configurable email templates per project
- Severity levels (warning, critical, blocker)
- Alert routing rules
- Integration with error tracking (Sentry, Rollbar)
- Mobile push notifications
