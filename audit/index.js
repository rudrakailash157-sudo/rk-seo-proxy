const path = require('path');
const cookieParser = require('cookie-parser');

function register(app) {
  try {
    const express = require('express');

    // Must apply cookie-parser FIRST before any routes
    app.use(cookieParser());

    // Serve dashboard static files
    app.use('/audit/static', express.static(path.join(__dirname, 'dashboard')));

    // Mount audit routes
    const auditRouter = require('./routes');
    app.use('/audit', auditRouter);

    // Start scheduler
    require('./scheduler');

    console.log('[AUDIT] ✅ Audit module registered at /audit');
  } catch(e) {
    console.error('[AUDIT] ❌ Failed:', e.message);
    console.error(e.stack);
  }
}

module.exports = { register };
