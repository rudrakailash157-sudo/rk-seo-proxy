const { crawl, fetchSitemapUrls, BASE_URL } = require('./crawler');
const { runAllCheckers } = require('./checkers');
const db = require('./db');

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
  const runId = await db.createRun(triggeredBy);
  currentRunId = runId;

  addProgress(`Audit run #${runId} started (triggered by: ${triggeredBy})`);

  const pages = [];
  const rawHtmlMap = new Map();
  const pageIdMap = new Map();
  let totalPages = 0;

  try {
    // Fetch sitemap URLs first
    addProgress('Fetching sitemap URLs...');
    const sitemapUrls = await fetchSitemapUrls();
    addProgress(`Found ${sitemapUrls.size} sitemap URLs`);

    // Crawl all pages
    await crawl(
      async (pageData) => {
        totalPages++;
        // Save raw HTML for checker use
        if (pageData.data) {
          rawHtmlMap.set(pageData.url, pageData.data);
          delete pageData.data; // Don't store full HTML in pages array
        }
        const links = pageData.links;
        delete pageData.links;

        const pageId = await db.savePage(runId, pageData);
        pageIdMap.set(pageData.url, pageId);
        pages.push({ ...pageData, id: pageId });

        await db.updateRun(runId, { total_pages: totalPages });
        addProgress(`[${totalPages}] ${pageData.status_code} ${pageData.url}`);
      },
      (msg) => addProgress(msg)
    );

    addProgress(`Crawl complete. ${totalPages} pages crawled. Running checks...`);

    // Run all 80+ checks
    const sitemapUrlsSet = await fetchSitemapUrls();
    const allIssues = await runAllCheckers(pages, rawHtmlMap, sitemapUrlsSet);

    addProgress(`Found ${allIssues.length} issues. Saving to database...`);

    // Save issues
    let critical = 0, warning = 0, info = 0;
    for (const issue of allIssues) {
      const pageId = issue.page_url ? pageIdMap.get(issue.page_url) : null;
      await db.saveIssue(runId, pageId, {
        category: issue.category,
        severity: issue.severity,
        check_name: issue.check_name,
        description: issue.description,
        affected_url: issue.affected_url,
        extra_data: issue.extra_data
      });
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
    });

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

  } catch (err) {
    addProgress(`❌ Audit failed: ${err.message}`);
    await db.updateRun(runId, { status: 'failed', completed_at: new Date() });
    throw err;
  } finally {
    isRunning = false;
  }

  return runId;
}

function getStatus() {
  return {
    is_running: isRunning,
    current_run_id: currentRunId,
    progress: progressLog.slice(-50)
  };
}

module.exports = { runAudit, getStatus };
