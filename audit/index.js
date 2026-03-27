const path = require('path');

function register(app) {
  try {
    const cookieParser = require('cookie-parser');
    const express = require('express');
    const auditRouter = require('./routes');

    // Serve dashboard static files
    app.use('/audit/static', express.static(path.join(__dirname, 'dashboard')));

    // Mount audit routes
    app.use('/audit', auditRouter);

    // Start scheduler
    require('./scheduler');

    console.log('[AUDIT] ✅ Audit module registered at /audit');
  } catch (err) {
    console.error('[AUDIT] ❌ Failed to register audit module:', err.message);
  }
}

module.exports = { register };  
