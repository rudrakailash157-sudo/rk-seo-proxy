const mysql = require('mysql2/promise');

// No SSL — Hostinger shared MySQL does not support SSL from external connections
// Pool is created lazily on first query, not on module load
let pool = null;

function getPool() {
  if (!pool) {
    pool = mysql.createPool({
      host:             process.env.AUDIT_DB_HOST,
      port:             parseInt(process.env.AUDIT_DB_PORT || '3306'),
      user:             process.env.AUDIT_DB_USER,
      password:         process.env.AUDIT_DB_PASSWORD,
      database:         process.env.AUDIT_DB_NAME,
      waitForConnections: true,
      connectionLimit:  5,
      queueLimit:       0,
      connectTimeout:   30000,
      // NO ssl option — Hostinger shared MySQL rejects SSL from Render
    });
  }
  return pool;
}

async function query(sql, params = []) {
  const [rows] = await getPool().execute(sql, params);
  return rows;
}

// ─── Test connection (called at startup, failure is non-fatal) ────────────────
async function testConnection() {
  try {
    console.log('[AUDIT] Testing database connection...');
    await query('SELECT 1');
    console.log('[AUDIT] ✅ Database connected successfully');
    return true;
  } catch (e) {
    console.error('[AUDIT] ✕ Database connection failed:', e.message);
    console.error('[AUDIT] Running in no-DB mode — results will not be saved');
    return false;
  }
}

async function createRun(triggeredBy = 'manual') {
  const [result] = await getPool().execute(
    'INSERT INTO audit_runs (started_at, triggered_by, status) VALUES (NOW(), ?, "running")',
    [triggeredBy]
  );
  return result.insertId;
}

async function updateRun(runId, data) {
  const fields = Object.keys(data).map(k => `${k} = ?`).join(', ');
  const values = Object.values(data);
  await getPool().execute(`UPDATE audit_runs SET ${fields} WHERE id = ?`, [...values, runId]);
}

async function savePage(runId, pageData) {
  const [result] = await getPool().execute(`
    INSERT INTO audit_pages (
      run_id, url, status_code, redirect_url, redirect_chain, content_type,
      page_size_bytes, load_time_ms, title, meta_description, h1, canonical_url,
      word_count, image_count, internal_link_count, external_link_count,
      is_in_sitemap, is_indexable, robots_directive, schema_types,
      og_title, og_description, og_image, crawled_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
  `, [
    runId,
    pageData.url,
    pageData.status_code     || null,
    pageData.redirect_url    || null,
    pageData.redirect_chain  ? JSON.stringify(pageData.redirect_chain) : null,
    pageData.content_type    || null,
    pageData.page_size_bytes || 0,
    pageData.load_time_ms    || 0,
    pageData.title           || null,
    pageData.meta_description|| null,
    pageData.h1              || null,
    pageData.canonical_url   || null,
    pageData.word_count      || 0,
    pageData.image_count     || 0,
    pageData.internal_link_count  || 0,
    pageData.external_link_count  || 0,
    pageData.is_in_sitemap   ? 1 : 0,
    pageData.is_indexable    ? 1 : 0,
    pageData.robots_directive|| null,
    pageData.schema_types    ? JSON.stringify(pageData.schema_types) : null,
    pageData.og_title        || null,
    pageData.og_description  || null,
    pageData.og_image        || null,
  ]);
  return result.insertId;
}

async function saveIssue(runId, pageId, issue) {
  await getPool().execute(`
    INSERT INTO audit_issues (run_id, page_id, category, severity, check_name, description, affected_url, extra_data)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    runId,
    pageId || null,
    issue.category,
    issue.severity,
    issue.check_name,
    issue.description,
    issue.affected_url || null,
    issue.extra_data   ? JSON.stringify(issue.extra_data) : null,
  ]);
}

async function getRunWithStats(runId) {
  const runs = await query('SELECT * FROM audit_runs WHERE id = ?', [runId]);
  return runs[0] || null;
}

async function getRecentRuns(limit = 10) {
  return query('SELECT * FROM audit_runs ORDER BY id DESC LIMIT ?', [limit]);
}

async function getRunIssues(runId) {
  return query('SELECT * FROM audit_issues WHERE run_id = ? ORDER BY FIELD(severity,"critical","warning","info"), category', [runId]);
}

async function getRunPages(runId) {
  return query('SELECT * FROM audit_pages WHERE run_id = ? ORDER BY url', [runId]);
}

async function getIssueSummary(runId) {
  return query(`
    SELECT category, severity, check_name, COUNT(*) as count
    FROM audit_issues WHERE run_id = ?
    GROUP BY category, severity, check_name
    ORDER BY FIELD(severity,'critical','warning','info'), count DESC
  `, [runId]);
}

async function getPreviousRun(currentRunId) {
  const runs = await query(
    'SELECT * FROM audit_runs WHERE id < ? AND status = "completed" ORDER BY id DESC LIMIT 1',
    [currentRunId]
  );
  return runs[0] || null;
}

module.exports = {
  query, testConnection, createRun, updateRun, savePage, saveIssue,
  getRunWithStats, getRecentRuns, getRunIssues, getRunPages,
  getIssueSummary, getPreviousRun
};
