# Error Alerting System - Quick Start

## What Was Built

A production-ready error detection and alerting system with:
- ✅ Automatic error aggregation and grouping
- ✅ Smart fatal error rule evaluation  
- ✅ Email notifications via Nodemailer
- ✅ Alert deduplication (10-minute cooldown)
- ✅ Dashboard API endpoints for monitoring

## Files Created/Modified

**New Files:**
- `backend/migrations/013_create_error_alerting_tables.sql` - Database schema
- `backend/services/errorAggregationService.js` - Error aggregation logic
- `backend/services/alertingService.js` - Email alerting engine
- `backend/controllers/errorAlertingController.js` - API request handlers
- `backend/routes/errorAlerting.js` - API route definitions
- `backend/ERROR_ALERTING_SETUP.md` - Full documentation

**Modified Files:**
- `backend/server.js` - Integrated error alerting routes
- `backend/package.json` - Added nodemailer dependency

## Quick Setup (5 minutes)

1. **Install dependency**
```bash
cd backend && npm install
```

2. **Create database tables**
```bash
psql -d your-db-name -f migrations/013_create_error_alerting_tables.sql
```

3. **Configure email** (add to `.env`)
```env
EMAIL_SERVICE=gmail
EMAIL_USER=your-email@gmail.com
EMAIL_PASSWORD=your-app-password
ALERT_EMAIL_RECIPIENTS=team@company.com
DASHBOARD_URL=http://localhost:3001
```

4. **Test configuration**
```bash
curl http://localhost:4001/errors/test-alert
```

5. **Start sending errors** from your frontend tracker to `POST /errors`

## Fatal Detection Rules

Alert automatically when:
1. **Frequency** - Same error 10+ times in 1 minute
2. **User Impact** - Error affects 5+ unique users  
3. **Critical Page** - Error on `/checkout`, `/payment`, `/confirm`, `/submit-application`

## Key Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/errors` | POST | Submit error event |
| `/errors/stats` | GET | Get error statistics |
| `/errors/critical` | GET | Get critical errors |
| `/errors/test-alert` | GET | Test email config |

## Example: Send Error Event

```bash
curl -X POST http://localhost:4001/errors \
  -H "Content-Type: application/json" \
  -d '{
    "project_id": "proj_123",
    "event_name": "error",
    "user_id": "user_456",
    "page": "/checkout",
    "url": "https://example.com/checkout",
    "timestamp": '$(($(date +%s)*1000))',
    "properties": {
      "message": "Cannot read property x of undefined",
      "source": "https://example.com/js/app.js",
      "line": 145
    }
  }'
```

## Email Alert Format

Emails include:
- Error message & stack trace
- Affected page URL
- Total occurrences & unique user count
- Timestamp 
- Link to session replays for debugging
- Beautiful HTML template

## Database Schema

3 new tables created:
- `error_aggregates` - Grouped errors with counts
- `error_users` - Track which users encountered each error
- `alert_logs` - Alert history to prevent duplicates

## Advanced Configuration

Edit `backend/services/errorAggregationService.js`:

```javascript
FATAL_ERROR_RULES = {
  FREQUENCY_THRESHOLD: 10,        // Change from 10 errors
  FREQUENCY_WINDOW_MS: 60000,     // ...in 60 seconds
  USER_IMPACT_THRESHOLD: 5,       // Or 5 users
  ALERT_COOLDOWN_MS: 600000,      // 10 minute cooldown
  CRITICAL_PAGES: ["/checkout", "/payment"],  // Add/remove pages
};
```

## Next Steps

1. Run migrations to create database tables
2. Update `.env` with email configuration
3. Test alert system with `/errors/test-alert` endpoint
4. Update frontend tracker to send error events to `/errors`
5. Monitor via `/errors/stats` and `/errors/critical` endpoints
6. Check received emails when rules trigger

## Support

See `backend/ERROR_ALERTING_SETUP.md` for:
- Detailed configuration options
- Multiple SMTP server examples
- SQL monitoring queries
- Troubleshooting guide
- API request/response examples
