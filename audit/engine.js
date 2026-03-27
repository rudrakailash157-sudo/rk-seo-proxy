const { crawl, fetchSitemapUrls, BASE_URL } = require('./crawler');
const { runAllCheckers } = require('./checkers');

let currentRunId = null;
let isRunning = false;
let progressLog = [];

function addProgress(msg) {
  const entry = { time: new Date().toISOString(), msg };
  progressLog.push(entry);
  if (progressLog.length > 500) progressLog.shift();
  console.log(`[AUDIT] ${msg}`);
}

async function runAudit(triggeredBy = 'manual') {
  if (isRunning) throw new Error('Audit already running');

  isRunning = true;
  progressLog = [];
  currentRunId = null;

  try {
    const db = require('./db');

    // Test DB connection first
    addProgress('Testing database connection...');
    try {
      await db.query('SELECT 1');
      addProgress('✅ Database connected');
    } catch(dbErr) {
      addProgress(`❌ Database connection failed: ${dbErr.message}`);
      addProgress('Running in no-DB mode — results will not be saved');
      isRunning = false;
      return null;
    }

    const runId = await db.createRun(triggeredBy);
    currentRunId = runId;
    addProgress(`Audit run #${runId} started (triggered by: ${triggeredBy})`);

    const pages = [];
    const rawHtmlMap = new Map();
    const pageIdMap = new Map();
    let totalPages = 0;

    // Fetch sitemap URLs first
    addProgress('Fetching sitemap URLs...');
    const sitemapUrls = await fetchSitemapUrls();
    addProgress(`Found ${sitemapUrls.size} sitemap URLs`);

    // Crawl all pages
    await crawl(
      async (pageData) => {
        totalPages++;
        if (pageData.data) {
          rawHtmlMap.set(pageData.url, pageData.data);
          delete pageData.data;
        }
        const links = pageData.links;
        delete pageData.links;

        try {
          const pageId = await db.savePage(runId, pageData);
          pageIdMap.set(pageData.url, pageId);
          pages.push({ ...pageData, id: pageId });
        } catch(e) {
          pages.push({ ...pageData });
        }

        await db.updateRun(runId, { total_pages: totalPages }).catch(() => {});
        addProgress(`[${totalPages}] ${pageData.status_code} ${pageData.url}`);
      },
      (msg) => addProgress(msg)
    );

    addProgress(`Crawl complete. ${totalPages} pages crawled. Running checks...`);

    const sitemapUrlsSet = await fetchSitemapUrls();
    const allIssues = await runAllCheckers(pages, rawHtmlMap, sitemapUrlsSet);

    addProgress(`Found ${allIssues.length} issues. Saving to database...`);

    let critical = 0, warning = 0, info = 0;
    for (const issue of allIssues) {
      const pageId = issue.page_url ? pageIdMap.get(issue.page_url) : null;
      try {
        await db.saveIssue(runId, pageId, {
          category: issue.category,
          severity: issue.severity,
          check_name: issue.check_name,
          description: issue.description,
          affected_url: issue.affected_url,
          extra_data: issue.extra_data
        });
      } catch(e) {}
      if (issue.severity === 'critical') critical++;
      else if (issue.severity === 'warning') warning++;
      else info++;
    }

    await db.updateRun(runId, {
      completed_at: new Date(),
      status: 'completed',
      total_pages: totalPages,
      total_issues: allIssues.length,
      critical_issues: critical,
      warning_issues: warning,
      info_issues: info
    }).catch(() => {});

    addProgress(`✅ Audit #${runId} complete! ${critical} critical, ${warning} warnings, ${info} info issues found.`);

    // Send email report
    try {
      const { sendAuditReport } = require('./email');
      const run = await db.getRunWithStats(runId);
      const summary = await db.getIssueSummary(runId);
      const prevRun = await db.getPreviousRun(runId);
      await sendAuditReport(run, summary, prevRun);
      addProgress('📧 Email report sent successfully');
    } catch (emailErr) {
      addProgress(`⚠️ Email report failed: ${emailErr.message}`);
    }

    return runId;

  } catch (err) {
    addProgress(`❌ Audit failed: ${err.message}`);
    console.error('[AUDIT] Fatal error:', err);
    return null;
  } finally {
    isRunning = false;
  }
}

function resetAudit() {
  isRunning = false;
  currentRunId = null;
  progressLog = [];
  addProgress('Audit state reset manually');
}

function getStatus() {
  return {
    is_running: isRunning,
    current_run_id: currentRunId,
    progress: progressLog.slice(-50)
  };
}

module.exports = { runAudit, getStatus, resetAudit };
