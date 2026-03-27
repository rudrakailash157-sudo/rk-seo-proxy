const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host: process.env.AUDIT_DB_HOST,
  port: parseInt(process.env.AUDIT_DB_PORT || '3306'),
  user: process.env.AUDIT_DB_USER,
  password: process.env.AUDIT_DB_PASSWORD,
  database: process.env.AUDIT_DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  connectTimeout: 30000,
  acquireTimeout: 30000,
  ssl: { rejectUnauthorized: false }
});

async function query(sql, params = []) {
  const [rows] = await pool.execute(sql, params);
  return rows;
}

async function createRun(triggeredBy = 'manual') {
  const [result] = await pool.execute(
    'INSERT INTO audit_runs (started_at, triggered_by, status) VALUES (NOW(), ?, "running")',
    [triggeredBy]
  );
  return result.insertId;
}

async function updateRun(runId, data) {
  const fields = Object.keys(data).map(k => `${k} = ?`).join(', ');
  const values = Object.values(data);
  await pool.execute(`UPDATE audit_runs SET ${fields} WHERE id = ?`, [...values, runId]);
}

async function savePage(runId, pageData) {
  const [result] = await pool.execute(`
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
    pageData.status_code || null,
    pageData.redirect_url || null,
    pageData.redirect_chain ? JSON.stringify(pageData.redirect_chain) : null,
    pageData.content_type || null,
    pageData.page_size_bytes || 0,
    pageData.load_time_ms || 0,
    pageData.title || null,
    pageData.meta_description || null,
    pageData.h1 || null,
    pageData.canonical_url || null,
    pageData.word_count || 0,
    pageData.image_count || 0,
    pageData.internal_link_count || 0,
    pageData.external_link_count || 0,
    pageData.is_in_sitemap ? 1 : 0,
    pageData.is_indexable ? 1 : 0,
    pageData.robots_directive || null,
    pageData.schema_types ? JSON.stringify(pageData.schema_types) : null,
    pageData.og_title || null,
    pageData.og_description || null,
    pageData.og_image || null
  ]);
  return result.insertId;
}

async function saveIssue(runId, pageId, issue) {
  await pool.execute(`
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
    issue.extra_data ? JSON.stringify(issue.extra_data) : null
  ]);
}

async function getRunWithStats(runId) {
  const runs = await query('SELECT * FROM audit_runs WHERE id = ?', [runId]);
  return runs[0] || null;
}

async function getRecentRuns(limit = 10) {
  return query('SELECT * FROM audit_runs ORDER BY started_at DESC LIMIT ?', [limit]);
}

async function getRunIssues(runId, filters = {}) {
  let sql = `
    SELECT ai.*, ap.url as page_url 
    FROM audit_issues ai
    LEFT JOIN audit_pages ap ON ai.page_id = ap.id
    WHERE ai.run_id = ?
  `;
  const params = [runId];
  if (filters.category) { sql += ' AND ai.category = ?'; params.push(filters.category); }
  if (filters.severity) { sql += ' AND ai.severity = ?'; params.push(filters.severity); }
  sql += ' ORDER BY FIELD(ai.severity,"critical","warning","info"), ai.category LIMIT 1000';
  return query(sql, params);
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

async function createSession(sessionId, expiresAt) {
  await pool.execute(
    'INSERT INTO audit_sessions (id, expires_at) VALUES (?, ?)',
    [sessionId, expiresAt]
  );
}

async function getSession(sessionId) {
  const rows = await query(
    'SELECT * FROM audit_sessions WHERE id = ? AND expires_at > NOW()',
    [sessionId]
  );
  return rows[0] || null;
}

async function deleteSession(sessionId) {
  await pool.execute('DELETE FROM audit_sessions WHERE id = ?', [sessionId]);
}

module.exports = {
  query, createRun, updateRun, savePage, saveIssue,
  getRunWithStats, getRecentRuns, getRunIssues, getRunPages,
  getIssueSummary, getPreviousRun, createSession, getSession, deleteSession
};
