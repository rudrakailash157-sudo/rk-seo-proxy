const cron = require('node-cron');
const { runAudit } = require('./engine');

// Weekly audit: Every Sunday at 11:00 PM IST (17:30 UTC)
// IST = UTC+5:30, so 11pm IST = 5:30pm UTC
cron.schedule('30 17 * * 0', async () => {
  console.log('[SCHEDULER] Starting weekly scheduled audit...');
  try {
    await runAudit('scheduled');
    console.log('[SCHEDULER] Weekly audit completed successfully');
  } catch (err) {
    console.error('[SCHEDULER] Weekly audit failed:', err.message);
  }
}, {
  timezone: 'Asia/Kolkata'
});

console.log('[SCHEDULER] Audit scheduler initialized — weekly run every Sunday at 11:00 PM IST');
