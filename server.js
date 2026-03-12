require("dotenv").config();
const express    = require("express");
const cors       = require("cors");
const fetch      = require("node-fetch");
const fs         = require("fs");
const path       = require("path");
const cron       = require("node-cron");
const nodemailer = require("nodemailer");

const app  = express();
const PORT = process.env.PORT || 3001;

// ─── Token persistence ────────────────────────────────────────────────────────
const TOKEN_FILE = path.join(__dirname, ".shopify_token");

function loadToken() {
  try {
    if (fs.existsSync(TOKEN_FILE)) {
      const t = fs.readFileSync(TOKEN_FILE, "utf8").trim();
      if (t) return t;
    }
  } catch (e) { console.warn("⚠️  Could not read token file:", e.message); }
  return process.env.SHOPIFY_ACCESS_TOKEN || null;
}

function saveToken(token) {
  try { fs.writeFileSync(TOKEN_FILE, token, "utf8"); console.log("💾 Token saved to disk"); }
  catch (e) { console.warn("⚠️  Could not save token to disk:", e.message); }
}

// ─── Config ───────────────────────────────────────────────────────────────────
const SHOPIFY_CLIENT_ID     = process.env.SHOPIFY_CLIENT_ID;
const SHOPIFY_CLIENT_SECRET = process.env.SHOPIFY_CLIENT_SECRET;
const SHOPIFY_STORE_DOMAIN  = process.env.SHOPIFY_STORE_DOMAIN;
const SHOPIFY_API_VERSION   = "2024-01";
const APP_URL               = process.env.APP_URL || "https://rk-seo-proxy.onrender.com";

let storedAccessToken = loadToken();

// ─── Pending approvals store ──────────────────────────────────────────────────
const pendingApprovals = new Map();
function generateApprovalToken() {
  return Math.random().toString(36).substring(2) + Date.now().toString(36);
}

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(cors({
  origin: true,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Store-Domain", "X-Access-Token"],
  credentials: true,
}));
app.use(express.json());

// ─── Email transporter ────────────────────────────────────────────────────────
const transporter = nodemailer.createTransport({
  host:   process.env.EMAIL_SMTP_HOST || "smtp.hostinger.com",
  port:   parseInt(process.env.EMAIL_SMTP_PORT || "465"),
  secure: true,
  auth: {
    user: process.env.EMAIL_SMTP_USER,
    pass: process.env.EMAIL_SMTP_PASS,
  },
});

async function sendEmail(subject, htmlBody) {
  try {
    await transporter.sendMail({
      from: `"RudraKailash SEO Agent" <${process.env.EMAIL_FROM}>`,
      to:   process.env.EMAIL_TO,
      subject,
      html: htmlBody,
    });
    console.log(`📧 Email sent: ${subject}`);
  } catch (e) {
    console.error("❌ Email send failed:", e.message);
  }
}

// ─── Health check ─────────────────────────────────────────────────────────────
app.get("/", (req, res) => {
  res.json({
    status:                 "ok",
    service:                "RudraKailash SEO Proxy",
    store:                  SHOPIFY_STORE_DOMAIN,
    tokenConfigured:        !!storedAccessToken,
    tokenSource:            fs.existsSync(TOKEN_FILE) ? "disk" : (process.env.SHOPIFY_ACCESS_TOKEN ? "env" : "none"),
    anthropicKeyConfigured: !!process.env.ANTHROPIC_API_KEY,
    serperConfigured:       !!process.env.SERPER_API_KEY,
    emailConfigured:        !!(process.env.EMAIL_SMTP_USER && process.env.EMAIL_SMTP_PASS),
    pendingApprovals:       pendingApprovals.size,
  });
});

// ─── OAuth Step 1 ─────────────────────────────────────────────────────────────
app.get("/auth/install", (req, res) => {
  const scopes      = "read_products,write_products,read_product_listings";
  const redirectUri = `${APP_URL}/auth/callback`;
  const state       = Math.random().toString(36).substring(7);
  const installUrl  = `https://${SHOPIFY_STORE_DOMAIN}/admin/oauth/authorize?client_id=${SHOPIFY_CLIENT_ID}&scope=${scopes}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}`;
  res.redirect(installUrl);
});

// ─── OAuth Step 2 ─────────────────────────────────────────────────────────────
app.get("/auth/callback", async (req, res) => {
  const { code, shop } = req.query;
  if (!code || !shop) return res.status(400).json({ error: "Missing code or shop" });
  try {
    const tokenRes  = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: SHOPIFY_CLIENT_ID, client_secret: SHOPIFY_CLIENT_SECRET, code }),
    });
    const tokenData = await tokenRes.json();
    if (tokenData.access_token) {
      storedAccessToken = tokenData.access_token;
      saveToken(storedAccessToken);
      await registerWebhooks();
      console.log("✅ Access token obtained, saved, webhooks registered");
      res.send(`<html><body style="font-family:sans-serif;background:#0D0500;color:#F5E6C8;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;">
        <div style="text-align:center;padding:40px;border:1px solid #D4A017;border-radius:12px;background:#1A0A00;">
          <div style="font-size:48px;margin-bottom:16px;">✅</div>
          <h2 style="color:#F0C84A;margin-bottom:8px;">RudraKailash SEO Agent Connected!</h2>
          <p style="color:#9A7050;">Store linked · Token saved · Webhooks registered · Weekly cron active</p>
          <p style="color:#9A7050;">You can close this tab and return to the SEO tool.</p>
        </div></body></html>`);
    } else {
      res.status(400).json({ error: "Failed to get access token", details: tokenData });
    }
  } catch (err) {
    res.status(500).json({ error: "OAuth callback failed", message: err.message });
  }
});

// ─── Auth status ──────────────────────────────────────────────────────────────
app.get("/auth/status", (req, res) => {
  res.json({
    connected:   !!storedAccessToken,
    store:       SHOPIFY_STORE_DOMAIN,
    tokenSource: fs.existsSync(TOKEN_FILE) ? "disk" : (process.env.SHOPIFY_ACCESS_TOKEN ? "env" : "memory"),
  });
});

// ─── Reveal token (protected) ─────────────────────────────────────────────────
app.get("/auth/token", (req, res) => {
  if (req.query.secret !== SHOPIFY_CLIENT_SECRET) return res.status(403).json({ error: "Forbidden" });
  if (!storedAccessToken) return res.status(404).json({ error: "No token. Visit /auth/install first." });
  res.json({ token: storedAccessToken });
});

// ─── GET /products ────────────────────────────────────────────────────────────
app.get("/products", async (req, res) => {
  if (!storedAccessToken) return res.status(401).json({ error: "Not authenticated. Visit /auth/install first." });
  try {
    const limit      = req.query.limit || 250;
    const shopifyRes = await fetch(
      `https://${SHOPIFY_STORE_DOMAIN}/admin/api/${SHOPIFY_API_VERSION}/products.json?limit=${limit}&fields=id,title,body_html,tags,handle,status,metafields_global_title_tag,metafields_global_description_tag`,
      { headers: { "X-Shopify-Access-Token": storedAccessToken, "Content-Type": "application/json" } }
    );
    const data = await shopifyRes.json();
    if (!shopifyRes.ok) return res.status(shopifyRes.status).json({ error: "Shopify API error", details: data });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch products", message: err.message });
  }
});

// ─── PUT /products/:id ────────────────────────────────────────────────────────
app.put("/products/:id", async (req, res) => {
  if (!storedAccessToken) return res.status(401).json({ error: "Not authenticated." });
  const { id } = req.params;
  try {
    const shopifyRes = await fetch(
      `https://${SHOPIFY_STORE_DOMAIN}/admin/api/${SHOPIFY_API_VERSION}/products/${id}.json`,
      {
        method: "PUT",
        headers: { "X-Shopify-Access-Token": storedAccessToken, "Content-Type": "application/json" },
        body: JSON.stringify({ product: { id, ...req.body } }),
      }
    );
    const data = await shopifyRes.json();
    if (!shopifyRes.ok) return res.status(shopifyRes.status).json({ error: "Shopify update failed", details: data });
    console.log(`✅ Product ${id} updated successfully`);
    res.json({ success: true, product: data.product });
  } catch (err) {
    res.status(500).json({ error: "Failed to update product", message: err.message });
  }
});

// ─── POST /ai/generate ────────────────────────────────────────────────────────
app.post("/ai/generate", async (req, res) => {
  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_KEY) return res.status(500).json({ error: "ANTHROPIC_API_KEY not configured" });
  try {
    const { system, user, max_tokens = 1200 } = req.body;
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": ANTHROPIC_KEY.trim(), "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens, system, messages: [{ role: "user", content: user }] }),
    });
    const data = await response.json();
    if (!response.ok) return res.status(response.status).json({ error: "Anthropic API error", details: data });
    const text = data.content?.map(b => b.text || "").join("") || "";
    res.json({ success: true, text });
  } catch (err) {
    res.status(500).json({ error: "AI generation failed", message: err.message });
  }
});

// ─── Competitor research ──────────────────────────────────────────────────────
const MARKETPLACE_DOMAINS = [
  "amazon.", "flipkart.", "snapdeal.", "meesho.", "myntra.", "indiamart.",
  "alibaba.", "ebay.", "etsy.", "walmart.", "paytmmall.", "shopclues.",
  "tatacliq.", "ajio.", "nykaa.", "jiomart.",
];

function isMarketplace(url) {
  return MARKETPLACE_DOMAINS.some(d => url.toLowerCase().includes(d));
}

function extractTextFromHTML(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<nav[\s\S]*?<\/nav>/gi, "")
    .replace(/<footer[\s\S]*?<\/footer>/gi, "")
    .replace(/<header[\s\S]*?<\/header>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ").trim().slice(0, 3000);
}

async function fetchPageText(url) {
  try {
    const controller = new AbortController();
    const timeout    = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; RudraKailashSEOBot/1.0)", "Accept": "text/html" },
    });
    clearTimeout(timeout);
    if (!res.ok) return null;
    return extractTextFromHTML(await res.text());
  } catch (e) { return null; }
}

async function runCompetitorResearch(productTitle) {
  const SERPER_KEY = process.env.SERPER_API_KEY;
  if (!SERPER_KEY) return [];
  try {
    const queries    = [`${productTitle} buy online authentic certified`, `${productTitle} spiritual benefits Vedic`];
    const seenUrls   = new Set();
    const allResults = [];
    for (const query of queries) {
      const serperRes  = await fetch("https://google.serper.dev/search", {
        method: "POST", headers: { "X-API-KEY": SERPER_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({ q: query, gl: "in", hl: "en", num: 10 }),
      });
      const serperData = await serperRes.json();
      for (const result of (serperData.organic || [])) {
        const url = result.link || "";
        if (url && !isMarketplace(url) && !url.includes("rudrakailash.com") && !seenUrls.has(url)) {
          seenUrls.add(url);
          allResults.push({ url, title: result.title || "", snippet: result.snippet || "" });
        }
      }
    }
    const competitors = [];
    for (const result of allResults.slice(0, 5)) {
      const text = await fetchPageText(result.url);
      competitors.push({ ...result, content: text || result.snippet, fetched: !!text });
    }
    return competitors;
  } catch (e) { console.warn("Competitor research error:", e.message); return []; }
}

app.post("/competitor/research", async (req, res) => {
  const { productTitle } = req.body;
  if (!productTitle) return res.status(400).json({ error: "productTitle required" });
  try {
    const competitors = await runCompetitorResearch(productTitle);
    res.json({ success: true, competitors, totalFound: competitors.length });
  } catch (err) {
    res.status(500).json({ error: "Competitor research failed", message: err.message });
  }
});

// ─── Core SEO pipeline ────────────────────────────────────────────────────────
function cleanAIOutput(text) {
  return text.replace(/^```(?:html)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
}

async function callClaude(system, user, max_tokens = 1200) {
  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": ANTHROPIC_KEY.trim(), "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens, system, messages: [{ role: "user", content: user }] }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || "Anthropic API error");
  return cleanAIOutput(data.content?.map(b => b.text || "").join("") || "");
}

function scoreSEO(metaTitle, metaDesc, tags, desc) {
  const titleLen = (metaTitle || "").length;
  const descLen  = (metaDesc  || "").length;
  const tagCount = (tags || "").split(",").filter(Boolean).length;
  const descText = (desc || "").replace(/<[^>]+>/g, "");
  const checks = [
    titleLen > 0, titleLen >= 40 && titleLen <= 60, /(rudrakailash)/i.test(metaTitle || ""),
    descLen > 0, descLen >= 130 && descLen <= 155, /shop|buy|order|get|explore/i.test(metaDesc || ""),
    tagCount > 0, tagCount >= 6, /rkrtl|certified|authentic/i.test(tags || ""),
    descText.length > 100, descText.split(/\s+/).length >= 300, /<h[23]/i.test(desc || ""),
    /rkrtl|certified|x-ray/i.test(descText),
  ];
  const pts = [10, 10, 5, 10, 10, 5, 5, 8, 7, 10, 10, 5, 5];
  const earned = checks.reduce((s, c, i) => s + (c ? pts[i] : 0), 0);
  const total  = pts.reduce((s, p) => s + p, 0);
  return Math.round((earned / total) * 100);
}

async function runSEOPipeline(product) {
  console.log(`🤖 SEO pipeline: ${product.title}`);
  const descPlain   = (product.body_html || "").replace(/<[^>]+>/g, "").slice(0, 400);
  const competitors = await runCompetitorResearch(product.title);

  const compSummary = competitors.length > 0
    ? `Top ${competitors.length} ranking competitors: ${competitors.map(c => c.title).join(", ")}`
    : "No competitor data.";

  let gapSummary = "Cover all key topics comprehensively.";
  if (competitors.length > 0) {
    try {
      const compTexts = competitors.map((c, i) =>
        `Competitor ${i + 1} (${c.url}):\n${(c.content || c.snippet).slice(0, 500)}`
      ).join("\n\n---\n\n");
      const gapRaw = await callClaude(
        `SEO content strategist. Output ONLY a JSON array of gap strings. No explanation, no markdown.`,
        `Product: "${product.title}". Our description: "${descPlain}". Competitors:\n${compTexts}\nIdentify 5-8 content gaps. Output ONLY JSON array: ["gap1","gap2"]`,
        600
      );
      try {
        const gaps = JSON.parse(gapRaw.replace(/^```json\s*/i, "").replace(/\s*```$/, "").trim());
        gapSummary = `Fill these gaps: ${gaps.join("; ")}`;
      } catch (e) {
        gapSummary = gapRaw.slice(0, 300);
      }
    } catch (e) { console.warn("Gap analysis failed:", e.message); }
  }

  const [description, metaTitle, metaDesc, tags] = await Promise.allSettled([
    callClaude(
      `Senior content strategist for RudraKailash.com. E-E-A-T writing (Feb 2026 Google update). NEVER make direct benefit claims. Use experience framing: "Seekers drawn to this bead often describe…", "In Vedic tradition…". Output clean HTML only, no markdown, no code fences.`,
      `Write full SEO product description for "${product.title}". ${compSummary}. ${gapSummary}. Current: "${descPlain}". Structure: <h2> seeker opening, <h3>Spiritual Significance & Vedic Context</h3>, <h3>What Seekers Experience</h3>, <h3>RKRTL Certification — X-Ray Verified</h3>, <h3>Who Is Drawn to This Bead</h3> with <ul>, <h3>How to Wear & Energise</h3>, <h3>Frequently Asked Question</h3>. Output ONLY clean HTML.`
    ),
    callClaude(`SEO specialist. Output ONLY meta title text. No quotes, no markdown.`, `Meta title for "${product.title}" on RudraKailash.com. Max 60 chars. Include keyword + RudraKailash brand.`),
    callClaude(`SEO specialist. Output ONLY meta description text. No quotes, no markdown.`, `Meta description for "${product.title}" on RudraKailash.com. 145-155 chars. Include RKRTL certified + strong CTA.`),
    callClaude(`Shopify SEO expert. Output ONLY comma-separated tags.`, `10-12 tags for "${product.title}" on RudraKailash.com. Current: "${product.tags || "none"}". Include mukhi variants, certified authentic, RKRTL, spiritual terms.`),
  ]);

  const result = {
    description: description.status === "fulfilled" ? description.value : "<p>Generation failed</p>",
    metaTitle:   metaTitle.status   === "fulfilled" ? metaTitle.value   : product.title,
    metaDesc:    metaDesc.status    === "fulfilled" ? metaDesc.value    : "",
    tags:        tags.status        === "fulfilled" ? tags.value        : product.tags || "",
  };

  const scoreBefore = scoreSEO(product.metafields_global_title_tag, product.metafields_global_description_tag, product.tags, product.body_html);
  const scoreAfter  = scoreSEO(result.metaTitle, result.metaDesc, result.tags, result.description);

  console.log(`✅ ${product.title}: ${scoreBefore} → ${scoreAfter}`);
  return { ...result, scoreBefore, scoreAfter };
}

// ─── Approval endpoint ────────────────────────────────────────────────────────
app.get("/approve/:token", async (req, res) => {
  const approval = pendingApprovals.get(req.params.token);
  if (!approval) {
    return res.send(`<html><body style="font-family:sans-serif;background:#0D0500;color:#F5E6C8;display:flex;align-items:center;justify-content:center;height:100vh">
      <div style="text-align:center;padding:40px;border:1px solid #7B1C1C;border-radius:12px;background:#1A0A00;">
        <div style="font-size:48px">❌</div><h2 style="color:#F08080;margin:16px 0">Link Expired or Already Used</h2>
        <p style="color:#9A7050">This approval link has expired or was already actioned.</p>
      </div></body></html>`);
  }
  try {
    const shopifyRes = await fetch(
      `https://${SHOPIFY_STORE_DOMAIN}/admin/api/${SHOPIFY_API_VERSION}/products/${approval.productId}.json`,
      { method: "PUT", headers: { "X-Shopify-Access-Token": storedAccessToken, "Content-Type": "application/json" },
        body: JSON.stringify({ product: { id: approval.productId, ...approval.payload } }) }
    );
    const data = await shopifyRes.json();
    pendingApprovals.delete(req.params.token);
    if (shopifyRes.ok) {
      console.log(`✅ Approved & pushed: ${approval.productTitle}`);
      res.send(`<html><body style="font-family:sans-serif;background:#0D0500;color:#F5E6C8;display:flex;align-items:center;justify-content:center;height:100vh">
        <div style="text-align:center;padding:40px;border:1px solid #D4A017;border-radius:12px;background:#1A0A00;max-width:500px">
          <div style="font-size:48px">✅</div><h2 style="color:#F0C84A;margin:16px 0">Successfully Pushed!</h2>
          <p style="color:#9A7050"><strong style="color:#F5E6C8">${approval.productTitle}</strong> is now live on RudraKailash.com</p>
          <p style="color:#9A7050;margin-top:12px;font-size:13px">SEO: ${approval.scoreBefore} → ${approval.scoreAfter} (+${approval.scoreAfter - approval.scoreBefore} pts)</p>
        </div></body></html>`);
    } else throw new Error(JSON.stringify(data));
  } catch (err) {
    res.send(`<html><body style="font-family:sans-serif;background:#0D0500;color:#F5E6C8;display:flex;align-items:center;justify-content:center;height:100vh">
      <div style="text-align:center;padding:40px;border:1px solid #7B1C1C;border-radius:12px;background:#1A0A00;">
        <div style="font-size:48px">❌</div><h2 style="color:#F08080;margin:16px 0">Push Failed</h2>
        <p style="color:#9A7050">${err.message}</p>
      </div></body></html>`);
  }
});

// ─── Email report builder ─────────────────────────────────────────────────────
function buildApprovalEmail(results, triggerType) {
  const totalProducts = results.length;
  const avgBefore     = Math.round(results.reduce((s, r) => s + r.scoreBefore, 0) / totalProducts);
  const avgAfter      = Math.round(results.reduce((s, r) => s + r.scoreAfter,  0) / totalProducts);
  const triggered     = triggerType === "webhook" ? "New Product Added" : triggerType === "manual" ? "Manual Trigger" : "Weekly Scheduled Run";

  const productRows = results.map(r => {
    const approvalToken = generateApprovalToken();
    pendingApprovals.set(approvalToken, {
      productId: r.productId, productTitle: r.productTitle,
      payload: r.payload, scoreBefore: r.scoreBefore, scoreAfter: r.scoreAfter,
      createdAt: new Date(),
    });
    const approveUrl = `${APP_URL}/approve/${approvalToken}`;
    return `
    <tr style="border-bottom:1px solid #2E1500">
      <td style="padding:12px 16px;color:#F5E6C8;font-family:Georgia,serif;font-size:13px">${r.productTitle}</td>
      <td style="padding:12px 16px;text-align:center;color:#F08080;font-weight:bold">${r.scoreBefore}</td>
      <td style="padding:12px 16px;text-align:center;color:#7FD48A;font-weight:bold">${r.scoreAfter}</td>
      <td style="padding:12px 16px;text-align:center;color:#F0C84A;font-weight:bold">+${r.scoreAfter - r.scoreBefore}</td>
      <td style="padding:12px 16px;text-align:center">
        <a href="${approveUrl}" style="background:#D4A017;color:#0D0500;padding:6px 16px;border-radius:5px;text-decoration:none;font-size:12px;font-weight:bold;display:inline-block">✓ Approve & Push</a>
      </td>
    </tr>`;
  }).join("");

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"/></head>
<body style="margin:0;padding:0;background:#0D0500;font-family:Georgia,serif">
<div style="max-width:680px;margin:0 auto;padding:32px 20px">
  <div style="text-align:center;margin-bottom:32px">
    <div style="font-size:36px;margin-bottom:8px">ॐ</div>
    <h1 style="color:#F0C84A;font-size:22px;margin:0">RudraKailash SEO Agent</h1>
    <p style="color:#9A7050;font-size:13px;margin:4px 0">Automated Optimisation Report · ${triggered}</p>
    <p style="color:#5A3020;font-size:12px">${new Date().toLocaleString("en-IN",{timeZone:"Asia/Kolkata"})} IST</p>
  </div>
  <div style="background:#1A0A00;border:1px solid #2E1500;border-radius:10px;padding:20px;margin-bottom:24px;text-align:center">
    <table width="100%"><tr>
      <td style="text-align:center"><div style="color:#9A7050;font-size:11px;letter-spacing:1px">PRODUCTS</div><div style="color:#F0C84A;font-size:28px;font-weight:bold">${totalProducts}</div></td>
      <td style="text-align:center"><div style="color:#9A7050;font-size:11px;letter-spacing:1px">AVG BEFORE</div><div style="color:#F08080;font-size:28px;font-weight:bold">${avgBefore}</div></td>
      <td style="text-align:center"><div style="color:#9A7050;font-size:11px;letter-spacing:1px">AVG AFTER</div><div style="color:#7FD48A;font-size:28px;font-weight:bold">${avgAfter}</div></td>
      <td style="text-align:center"><div style="color:#9A7050;font-size:11px;letter-spacing:1px">IMPROVEMENT</div><div style="color:#F0C84A;font-size:28px;font-weight:bold">+${avgAfter-avgBefore}</div></td>
    </tr></table>
  </div>
  <div style="background:#1A0A00;border:1px solid #5A2A00;border-radius:8px;padding:14px 18px;margin-bottom:20px">
    <p style="color:#F0C060;font-size:13px;margin:0">✦ Review each product below and click <strong>Approve & Push</strong> to publish live on RudraKailash.com. Links expire in 7 days.</p>
  </div>
  <table style="width:100%;border-collapse:collapse;background:#120600;border:1px solid #2E1500;border-radius:10px;overflow:hidden">
    <thead><tr style="background:#160800">
      <th style="padding:10px 16px;text-align:left;color:#9A7050;font-size:11px;letter-spacing:1px;font-weight:normal">PRODUCT</th>
      <th style="padding:10px 16px;text-align:center;color:#9A7050;font-size:11px;font-weight:normal">BEFORE</th>
      <th style="padding:10px 16px;text-align:center;color:#9A7050;font-size:11px;font-weight:normal">AFTER</th>
      <th style="padding:10px 16px;text-align:center;color:#9A7050;font-size:11px;font-weight:normal">GAIN</th>
      <th style="padding:10px 16px;text-align:center;color:#9A7050;font-size:11px;font-weight:normal">ACTION</th>
    </tr></thead>
    <tbody>${productRows}</tbody>
  </table>
  <div style="text-align:center;margin-top:32px;padding-top:20px;border-top:1px solid #2E1500">
    <p style="color:#5A3020;font-size:11px">RudraKailash Agentic SEO · rk-seo-proxy.onrender.com · Approval links expire in 7 days</p>
  </div>
</div></body></html>`;
}

// ─── Weekly cron: Sunday 11pm IST = 17:30 UTC ─────────────────────────────────
cron.schedule("30 17 * * 0", async () => {
  console.log("⏰ Weekly SEO cron started — Sunday 11pm IST");
  if (!storedAccessToken) { console.error("❌ Cron: No Shopify token."); return; }
  try {
    const res      = await fetch(
      `https://${SHOPIFY_STORE_DOMAIN}/admin/api/${SHOPIFY_API_VERSION}/products.json?limit=250&fields=id,title,body_html,tags,handle,status,metafields_global_title_tag,metafields_global_description_tag`,
      { headers: { "X-Shopify-Access-Token": storedAccessToken } }
    );
    const data     = await res.json();
    const products = (data.products || []).filter(p => p.status === "active");
    console.log(`⏰ Cron: Processing ${products.length} active products…`);
    const results = [];
    for (const product of products) {
      try {
        const r = await runSEOPipeline(product);
        results.push({
          productId: product.id, productTitle: product.title,
          scoreBefore: r.scoreBefore, scoreAfter: r.scoreAfter,
          payload: { body_html: r.description, metafields_global_title_tag: r.metaTitle, metafields_global_description_tag: r.metaDesc, tags: r.tags },
        });
        await new Promise(r => setTimeout(r, 3000)); // rate limiting
      } catch (e) { console.error(`❌ Cron failed for ${product.title}:`, e.message); }
    }
    if (results.length > 0) {
      await sendEmail(`🔱 RudraKailash SEO Weekly Report — ${results.length} products optimised`, buildApprovalEmail(results, "cron"));
      console.log(`⏰ Cron complete: ${results.length} products, email sent.`);
    }
  } catch (e) { console.error("❌ Cron error:", e.message); }
}, { timezone: "UTC" });

// ─── Shopify webhook: products/create ─────────────────────────────────────────
app.post("/webhooks/products/create", async (req, res) => {
  res.status(200).json({ received: true }); // Acknowledge immediately
  const product = req.body;
  if (!product?.id) return;
  console.log(`🔔 Webhook: New product — ${product.title}`);
  await new Promise(r => setTimeout(r, 5000)); // Let Shopify finish
  try {
    const productRes  = await fetch(
      `https://${SHOPIFY_STORE_DOMAIN}/admin/api/${SHOPIFY_API_VERSION}/products/${product.id}.json?fields=id,title,body_html,tags,handle,status,metafields_global_title_tag,metafields_global_description_tag`,
      { headers: { "X-Shopify-Access-Token": storedAccessToken } }
    );
    const fullProduct = (await productRes.json()).product;
    if (!fullProduct) return;
    const r = await runSEOPipeline(fullProduct);
    const results = [{
      productId: fullProduct.id, productTitle: fullProduct.title,
      scoreBefore: r.scoreBefore, scoreAfter: r.scoreAfter,
      payload: { body_html: r.description, metafields_global_title_tag: r.metaTitle, metafields_global_description_tag: r.metaDesc, tags: r.tags },
    }];
    await sendEmail(`🔔 New Product SEO Ready — "${fullProduct.title}" — Approve to Push`, buildApprovalEmail(results, "webhook"));
    console.log(`✅ Webhook: Email sent for ${fullProduct.title}`);
  } catch (e) { console.error("❌ Webhook error:", e.message); }
});

// ─── Register webhooks ────────────────────────────────────────────────────────
async function registerWebhooks() {
  if (!storedAccessToken) return;
  try {
    const webhookUrl = `${APP_URL}/webhooks/products/create`;
    const listRes    = await fetch(`https://${SHOPIFY_STORE_DOMAIN}/admin/api/${SHOPIFY_API_VERSION}/webhooks.json`, { headers: { "X-Shopify-Access-Token": storedAccessToken } });
    const listData   = await listRes.json();
    if ((listData.webhooks || []).find(w => w.address === webhookUrl)) {
      console.log("✅ Webhook already registered"); return;
    }
    const createRes = await fetch(`https://${SHOPIFY_STORE_DOMAIN}/admin/api/${SHOPIFY_API_VERSION}/webhooks.json`, {
      method: "POST", headers: { "X-Shopify-Access-Token": storedAccessToken, "Content-Type": "application/json" },
      body: JSON.stringify({ webhook: { topic: "products/create", address: webhookUrl, format: "json" } }),
    });
    const createData = await createRes.json();
    console.log(createData.webhook ? `✅ Webhook registered: ${webhookUrl}` : `⚠️  Webhook issue: ${JSON.stringify(createData)}`);
  } catch (e) { console.error("❌ Webhook registration failed:", e.message); }
}

// ─── Manual cron trigger (for testing) ───────────────────────────────────────
app.post("/cron/trigger", async (req, res) => {
  if (req.query.secret !== SHOPIFY_CLIENT_SECRET) return res.status(403).json({ error: "Forbidden" });
  res.json({ message: "Manual cron triggered — email will arrive in a few minutes." });
  setTimeout(async () => {
    try {
      const fetchRes = await fetch(
        `https://${SHOPIFY_STORE_DOMAIN}/admin/api/${SHOPIFY_API_VERSION}/products.json?limit=250&fields=id,title,body_html,tags,handle,status,metafields_global_title_tag,metafields_global_description_tag`,
        { headers: { "X-Shopify-Access-Token": storedAccessToken } }
      );
      const data     = await fetchRes.json();
      const products = (data.products || []).filter(p => p.status === "active");
      const results  = [];
      for (const product of products) {
        try {
          const r = await runSEOPipeline(product);
          results.push({
            productId: product.id, productTitle: product.title,
            scoreBefore: r.scoreBefore, scoreAfter: r.scoreAfter,
            payload: { body_html: r.description, metafields_global_title_tag: r.metaTitle, metafields_global_description_tag: r.metaDesc, tags: r.tags },
          });
          await new Promise(r => setTimeout(r, 3000));
        } catch (e) { console.error(`Manual cron failed for ${product.title}:`, e.message); }
      }
      if (results.length > 0) {
        await sendEmail(`🔱 RudraKailash SEO Manual Report — ${results.length} products`, buildApprovalEmail(results, "manual"));
      }
    } catch (e) { console.error("Manual cron error:", e.message); }
  }, 100);
});

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, async () => {
  console.log(`🚀 RudraKailash SEO Proxy running on port ${PORT}`);
  console.log(`   Store:         ${SHOPIFY_STORE_DOMAIN}`);
  console.log(`   Token:         ${storedAccessToken ? "✅ Loaded (" + (fs.existsSync(TOKEN_FILE) ? "disk" : "env") + ")" : "⚠️  Not yet — visit /auth/install"}`);
  console.log(`   Anthropic Key: ${process.env.ANTHROPIC_API_KEY ? "✅ Configured" : "❌ NOT SET"}`);
  console.log(`   Serper Key:    ${process.env.SERPER_API_KEY    ? "✅ Configured" : "❌ NOT SET"}`);
  console.log(`   Email:         ${process.env.EMAIL_SMTP_USER   ? "✅ " + process.env.EMAIL_SMTP_USER : "❌ NOT SET"}`);
  console.log(`   Cron:          ✅ Sunday 11pm IST (17:30 UTC)`);
  if (storedAccessToken) await registerWebhooks();
});
