const { crawl, fetchSitemapUrls } = require('./crawler');
const { runAllCheckers } = require('./checkers');

let currentRunId = null;
let isRunning    = false;
let progressLog  = [];

function addProgress(msg) {
  const entry = { time: new Date().toISOString(), msg };
  progressLog.push(entry);
  if (progressLog.length > 500) progressLog.shift();
  console.log(`[AUDIT] ${msg}`);
}

async function runAudit(triggeredBy = 'manual') {
  if (isRunning) throw new Error('Audit already running');

  isRunning    = true;
  progressLog  = [];
  currentRunId = null;

  try {
    const db = require('./db');

    // Test DB first
    addProgress('Testing database connection...');
    try {
      await db.query('SELECT 1');
      addProgress('✅ Database connected');
    } catch (dbErr) {
      addProgress(`❌ Database connection failed: ${dbErr.message}`);
      isRunning = false;
      return null;
    }

    const runId = await db.createRun(triggeredBy);
    currentRunId = runId;
    addProgress(`Audit run #${runId} started`);

    const pages      = [];
    const rawHtmlMap = new Map();
    const pageIdMap  = new Map();
    let   totalPages = 0;

    // ── Crawl ─────────────────────────────────────────────────────────────────
    addProgress('Fetching sitemap URLs...');
    const sitemapUrls = await fetchSitemapUrls();
    addProgress(`Found ${sitemapUrls.size} sitemap URLs`);

    await crawl(
      async (pageData) => {
        totalPages++;
        if (pageData.data) {
          rawHtmlMap.set(pageData.url, pageData.data);
          delete pageData.data;
        }
        delete pageData.links;

        try {
          const pageId = await db.savePage(runId, pageData);
          pageIdMap.set(pageData.url, pageId);
          pages.push({ ...pageData, id: pageId });
        } catch (e) {
          pages.push({ ...pageData });
        }

        // ── FIXED: use correct column name 'pages_crawled' ──────────────────
        await db.updateRun(runId, { pages_crawled: totalPages }).catch(() => {});
        addProgress(`[${totalPages}] ${pageData.status_code} ${pageData.url}`);
      },
      (msg) => addProgress(msg)
    );

    addProgress(`Crawl complete — ${totalPages} pages. Running checks...`);

    // ── Checks ────────────────────────────────────────────────────────────────
    const sitemapUrlsSet = await fetchSitemapUrls();
    const allIssues      = await runAllCheckers(pages, rawHtmlMap, sitemapUrlsSet);

    addProgress(`Found ${allIssues.length} issues. Saving...`);

    let critical = 0, warning = 0, info = 0;
    for (const issue of allIssues) {
      const pageId = issue.page_url ? pageIdMap.get(issue.page_url) : null;
      try {
        await db.saveIssue(runId, pageId, {
          category:     issue.category,
          severity:     issue.severity,
          check_name:   issue.check_name,
          description:  issue.description,
          affected_url: issue.affected_url,
          extra_data:   issue.extra_data,
        });
      } catch (e) { /* non-fatal */ }
      if      (issue.severity === 'critical') critical++;
      else if (issue.severity === 'warning')  warning++;
      else                                    info++;
    }

    // ── FIXED: column names now match schema exactly ──────────────────────────
    // Schema uses: pages_crawled, issues_found, critical_count, warning_count, info_count
    await db.updateRun(runId, {
      completed_at:   new Date(),
      status:         'completed',
      pages_crawled:  totalPages,
      issues_found:   allIssues.length,
      critical_count: critical,
      warning_count:  warning,
      info_count:     info,
    }).catch((e) => console.warn('[AUDIT] updateRun final failed:', e.message));

    addProgress(`✅ Audit #${runId} complete! ${totalPages} pages · ${allIssues.length} issues (${critical} critical, ${warning} warnings, ${info} info)`);
    return runId;

  } catch (err) {
    addProgress(`❌ Audit failed: ${err.message}`);
    console.error('[AUDIT] Fatal error:', err);
    if (currentRunId) {
      try {
        const db = require('./db');
        await db.updateRun(currentRunId, {
          status:        'failed',
          completed_at:  new Date(),
          error_message: err.message,
        });
      } catch (e) { /* ignore */ }
    }
    return null;
  } finally {
    isRunning = false;
  }
}

function getStatus() {
  return {
    isRunning,
    currentRunId,
    progressLog: progressLog.slice(-100),
  };
}

function resetState() {
  isRunning    = false;
  currentRunId = null;
  progressLog  = [];
}

// Stop a running audit gracefully — saves what's been collected so far
async function stopAudit() {
  if (!isRunning) return { stopped: false, message: 'No audit running' };
  const runId = currentRunId;
  isRunning = false;  // signal crawl loop to stop
  addProgress('⏹ Audit stopped manually');
  if (runId) {
    try {
      const db = require('./db');
      const pages  = await db.query('SELECT COUNT(*) as c FROM audit_pages  WHERE run_id = ?', [runId]);
      const issues = await db.query('SELECT COUNT(*) as c FROM audit_issues WHERE run_id = ?', [runId]);
      const critical = await db.query('SELECT COUNT(*) as c FROM audit_issues WHERE run_id = ? AND severity = "critical"', [runId]);
      const warning  = await db.query('SELECT COUNT(*) as c FROM audit_issues WHERE run_id = ? AND severity = "warning"',  [runId]);
      const info     = await db.query('SELECT COUNT(*) as c FROM audit_issues WHERE run_id = ? AND severity = "info"',     [runId]);
      await db.updateRun(runId, {
        status:         'stopped',
        completed_at:   new Date(),
        pages_crawled:  pages[0].c,
        issues_found:   issues[0].c,
        critical_count: critical[0].c,
        warning_count:  warning[0].c,
        info_count:     info[0].c,
      });
    } catch(e) { console.warn('[AUDIT] stopAudit DB update failed:', e.message); }
  }
  return { stopped: true, runId };
}

module.exports = { runAudit, getStatus, resetState, stopAudit };
