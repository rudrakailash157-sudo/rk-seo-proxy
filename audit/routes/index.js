const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const path = require('path');

const AUDIT_PASSWORD = process.env.AUDIT_PASSWORD || 'rudrakailash2024';
const SESSION_DURATION_MS = 24 * 60 * 60 * 1000;

// ─── IN-MEMORY SESSIONS ───────────────────────────────────────────────────────
const sessions = new Map();

function createSession() {
  const id = crypto.randomBytes(32).toString('hex');
  sessions.set(id, { createdAt: Date.now(), expiresAt: Date.now() + SESSION_DURATION_MS });
  return id;
}

function validateSession(id) {
  if (!id) return false;
  const session = sessions.get(id);
  if (!session) return false;
  if (Date.now() > session.expiresAt) { sessions.delete(id); return false; }
  return true;
}

function requireAuth(req, res, next) {
  const sessionId = req.cookies?.audit_session;
  if (!validateSession(sessionId)) return res.redirect('/audit/login');
  next();
}

// ─── LOGIN PAGE ───────────────────────────────────────────────────────────────
router.get('/login', (req, res) => {
  res.send(`<!DOCTYPE html>
<html><head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>RudraKailash Audit — Login</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{min-height:100vh;display:flex;align-items:center;justify-content:center;
    background:linear-gradient(135deg,#1A0A00 0%,#3D1515 50%,#1A0A00 100%);
    font-family:Georgia,serif;}
  .card{background:rgba(255,251,240,0.05);border:1px solid rgba(212,160,23,0.3);
    border-radius:16px;padding:48px 40px;width:360px;text-align:center;
    backdrop-filter:blur(10px);}
  h1{color:#D4A017;font-size:22px;margin-bottom:4px;}
  p{color:#FDE68A;font-size:13px;margin-bottom:28px;opacity:0.8;}
  input{width:100%;padding:12px 16px;border-radius:8px;border:1px solid rgba(212,160,23,0.4);
    background:rgba(255,251,240,0.08);color:#FFFBF0;font-size:15px;margin-bottom:16px;}
  input::placeholder{color:rgba(253,230,138,0.4);}
  button{width:100%;padding:13px;background:#7B1C1C;color:#D4A017;border:none;
    border-radius:8px;font-size:15px;font-weight:bold;cursor:pointer;letter-spacing:0.5px;}
  button:hover{background:#991B1B;}
  .error{color:#FCA5A5;font-size:13px;margin-bottom:16px;}
  .om{font-size:40px;margin-bottom:12px;}
</style>
</head><body>
<div class="card">
  <div class="om">🕉️</div>
  <h1>RudraKailash Audit</h1>
  <p>Site Health Dashboard</p>
  ${req.query.error ? '<div class="error">Incorrect password. Please try again.</div>' : ''}
  <form method="POST" action="/audit/login">
    <input type="password" name="password" placeholder="Enter password" autofocus>
    <button type="submit">Enter Dashboard</button>
  </form>
</div>
</body></html>`);
});

// ─── LOGIN POST ───────────────────────────────────────────────────────────────
router.post('/login', (req, res) => {
  const { password } = req.body;
  if (!password || password.trim() !== AUDIT_PASSWORD.trim()) {
    return res.redirect('/audit/login?error=1');
  }
  const sessionId = createSession();
  const expiresAt = new Date(Date.now() + SESSION_DURATION_MS);
  res.cookie('audit_session', sessionId, {
    httpOnly: true,
    expires: expiresAt,
    sameSite: 'lax',
    path: '/'
  });
  res.redirect('/audit/dashboard');
});

// ─── LOGOUT ───────────────────────────────────────────────────────────────────
router.get('/logout', (req, res) => {
  const sessionId = req.cookies?.audit_session;
  if (sessionId) sessions.delete(sessionId);
  res.clearCookie('audit_session', { path: '/' });
  res.redirect('/audit/login');
});

// ─── API ROUTES ───────────────────────────────────────────────────────────────
router.post('/api/start', requireAuth, async (req, res) => {
  try {
    const { runAudit } = require('../engine');
    runAudit('manual').catch(err => console.error('Audit error:', err));
    res.json({ success: true, message: 'Audit started' });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.get('/api/status', requireAuth, (req, res) => {
  try {
    const { getStatus } = require('../engine');
    res.json(getStatus());
  } catch(e) {
    res.json({ is_running: false, current_run_id: null, progress: [] });
  }
});

router.get('/api/runs', requireAuth, async (req, res) => {
  try {
    const db = require('../db');
    const runs = await db.getRecentRuns(20);
    res.json(runs);
  } catch(e) { res.json([]); }
});

router.get('/api/runs/:id', requireAuth, async (req, res) => {
  try {
    const db = require('../db');
    const run = await db.getRunWithStats(req.params.id);
    if (!run) return res.status(404).json({ error: 'Run not found' });
    res.json(run);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.get('/api/runs/:id/issues', requireAuth, async (req, res) => {
  try {
    const db = require('../db');
    const { category, severity } = req.query;
    const issues = await db.getRunIssues(req.params.id, { category, severity });
    res.json(issues);
  } catch(e) { res.json([]); }
});

router.get('/api/runs/:id/summary', requireAuth, async (req, res) => {
  try {
    const db = require('../db');
    const summary = await db.getIssueSummary(req.params.id);
    res.json(summary);
  } catch(e) { res.json([]); }
});

router.get('/api/runs/:id/pages', requireAuth, async (req, res) => {
  try {
    const db = require('../db');
    const pages = await db.getRunPages(req.params.id);
    res.json(pages);
  } catch(e) { res.json([]); }
});

// ─── DASHBOARD ────────────────────────────────────────────────────────────────
router.get('/dashboard', requireAuth, (req, res) => {
  res.sendFile('index.html', { root: path.join(__dirname, '../dashboard') });
});

router.get('/', (req, res) => {
  res.redirect('/audit/login');
});

module.exports = router;
