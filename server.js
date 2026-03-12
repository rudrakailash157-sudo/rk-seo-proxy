require("dotenv").config();
const express = require("express");
const cors    = require("cors");
const fetch   = require("node-fetch");
const fs      = require("fs");
const path    = require("path");

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

let storedAccessToken = loadToken();

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(cors({
  origin: true,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Store-Domain", "X-Access-Token"],
  credentials: true,
}));
app.use(express.json());

// ─── Health check ─────────────────────────────────────────────────────────────
app.get("/", (req, res) => {
  res.json({
    status:                 "ok",
    service:                "RudraKailash SEO Proxy",
    store:                  SHOPIFY_STORE_DOMAIN,
    tokenConfigured:        !!storedAccessToken,
    tokenSource:            fs.existsSync(TOKEN_FILE) ? "disk" : (process.env.SHOPIFY_ACCESS_TOKEN ? "env" : "none"),
    anthropicKeyConfigured: !!process.env.ANTHROPIC_API_KEY,
    anthropicKeyPrefix:     process.env.ANTHROPIC_API_KEY ? process.env.ANTHROPIC_API_KEY.substring(0,10)+"..." : "NOT SET",
    serperConfigured:       !!process.env.SERPER_API_KEY,
  });
});

// ─── OAuth Step 1 ─────────────────────────────────────────────────────────────
app.get("/auth/install", (req, res) => {
  const shop        = SHOPIFY_STORE_DOMAIN;
  const scopes      = "read_products,write_products,read_product_listings";
  const redirectUri = `${process.env.APP_URL}/auth/callback`;
  const state       = Math.random().toString(36).substring(7);
  const installUrl  = `https://${shop}/admin/oauth/authorize?client_id=${SHOPIFY_CLIENT_ID}&scope=${scopes}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}`;
  res.redirect(installUrl);
});

// ─── OAuth Step 2 ─────────────────────────────────────────────────────────────
app.get("/auth/callback", async (req, res) => {
  const { code, shop } = req.query;
  if (!code || !shop) return res.status(400).json({ error: "Missing code or shop" });
  try {
    const tokenRes = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: SHOPIFY_CLIENT_ID, client_secret: SHOPIFY_CLIENT_SECRET, code }),
    });
    const tokenData = await tokenRes.json();
    if (tokenData.access_token) {
      storedAccessToken = tokenData.access_token;
      saveToken(storedAccessToken);
      console.log("✅ Access token obtained and saved to disk");
      res.send(`<html><body style="font-family:sans-serif;background:#0D0500;color:#F5E6C8;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;">
        <div style="text-align:center;padding:40px;border:1px solid #D4A017;border-radius:12px;background:#1A0A00;">
          <div style="font-size:48px;margin-bottom:16px;">✅</div>
          <h2 style="color:#F0C84A;margin-bottom:8px;">RudraKailash SEO Agent Connected!</h2>
          <p style="color:#9A7050;">Your Shopify store is now linked and token saved permanently.</p>
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
  const secret = req.query.secret;
  if (!secret || secret !== SHOPIFY_CLIENT_SECRET) return res.status(403).json({ error: "Forbidden" });
  if (!storedAccessToken) return res.status(404).json({ error: "No token. Visit /auth/install first." });
  res.json({ token: storedAccessToken });
});

// ─── GET /products ────────────────────────────────────────────────────────────
app.get("/products", async (req, res) => {
  if (!storedAccessToken) return res.status(401).json({ error: "Not authenticated. Visit /auth/install first." });
  try {
    const limit      = req.query.limit || 50;
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
  const { id }  = req.params;
  const updates = req.body;
  try {
    const shopifyRes = await fetch(
      `https://${SHOPIFY_STORE_DOMAIN}/admin/api/${SHOPIFY_API_VERSION}/products/${id}.json`,
      {
        method:  "PUT",
        headers: { "X-Shopify-Access-Token": storedAccessToken, "Content-Type": "application/json" },
        body:    JSON.stringify({ product: { id, ...updates } }),
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
    console.log(`🤖 AI generate: ${user ? user.substring(0,60) : ""}...`);
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method:  "POST",
      headers: {
        "Content-Type":      "application/json",
        "x-api-key":         ANTHROPIC_KEY.trim(),
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model:      "claude-haiku-4-5-20251001",
        max_tokens,
        system,
        messages: [{ role: "user", content: user }],
      }),
    });
    const data = await response.json();
    if (!response.ok) {
      console.error("❌ Anthropic error:", JSON.stringify(data));
      return res.status(response.status).json({ error: "Anthropic API error", details: data });
    }
    const text = data.content?.map(b => b.text || "").join("") || "";
    console.log(`✅ AI response: ${text.length} chars`);
    res.json({ success: true, text });
  } catch (err) {
    res.status(500).json({ error: "AI generation failed", message: err.message });
  }
});

// ─── POST /competitor/research ────────────────────────────────────────────────
const MARKETPLACE_DOMAINS = [
  "amazon.", "flipkart.", "snapdeal.", "meesho.", "myntra.", "indiamart.",
  "alibaba.", "ebay.", "etsy.", "walmart.", "paytmmall.", "shopclues.",
  "tatacliq.", "ajio.", "nykaa.", "jiomart.", "bigbasket.",
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
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 3000);
}

async function fetchPageText(url) {
  try {
    const controller = new AbortController();
    const timeout    = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(url, {
      signal:  controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; RudraKailashSEOBot/1.0)",
        "Accept":     "text/html,application/xhtml+xml",
      },
    });
    clearTimeout(timeout);
    if (!res.ok) return null;
    const html = await res.text();
    return extractTextFromHTML(html);
  } catch (e) {
    console.warn(`⚠️  Could not fetch ${url}: ${e.message}`);
    return null;
  }
}

app.post("/competitor/research", async (req, res) => {
  const SERPER_KEY = process.env.SERPER_API_KEY;
  if (!SERPER_KEY) return res.status(500).json({ error: "SERPER_API_KEY not configured on server" });

  const { productTitle, mukhiType } = req.body;
  if (!productTitle) return res.status(400).json({ error: "productTitle required" });

  try {
    console.log(`🔍 Competitor research for: "${productTitle}"`);

    // Two targeted queries for broader SERP coverage
    const queries = [
      `${productTitle} buy online authentic certified`,
      `${mukhiType || productTitle} spiritual benefits Vedic`,
    ];

    const seenUrls  = new Set();
    const allResults = [];

    for (const query of queries) {
      console.log(`  🔎 Searching: "${query}"`);
      const serperRes = await fetch("https://google.serper.dev/search", {
        method:  "POST",
        headers: { "X-API-KEY": SERPER_KEY, "Content-Type": "application/json" },
        body:    JSON.stringify({ q: query, gl: "in", hl: "en", num: 10 }),
      });

      if (!serperRes.ok) {
        const err = await serperRes.text();
        throw new Error(`Serper API error ${serperRes.status}: ${err}`);
      }

      const serperData = await serperRes.json();
      const organic    = serperData.organic || [];

      for (const result of organic) {
        const url = result.link || "";
        if (
          url &&
          !isMarketplace(url) &&
          !url.includes("rudrakailash.com") &&
          !seenUrls.has(url)
        ) {
          seenUrls.add(url);
          allResults.push({
            url,
            title:   result.title   || "",
            snippet: result.snippet || "",
          });
        }
      }
    }

    console.log(`  📋 Found ${allResults.length} unique non-marketplace results`);

    // Fetch full page content for top 5
    const top5       = allResults.slice(0, 5);
    const competitors = [];

    for (const result of top5) {
      console.log(`  📄 Fetching: ${result.url}`);
      const text = await fetchPageText(result.url);
      competitors.push({
        url:     result.url,
        title:   result.title,
        snippet: result.snippet,
        content: text || result.snippet,
        fetched: !!text,
      });
      console.log(`     ${text ? "✓ " + text.length + " chars" : "⚠ snippet only"}`);
    }

    console.log(`✅ Competitor research complete: ${competitors.length} pages analysed`);
    res.json({ success: true, competitors, totalFound: allResults.length });

  } catch (err) {
    console.error("❌ Competitor research error:", err.message);
    res.status(500).json({ error: "Competitor research failed", message: err.message });
  }
});

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`🚀 RudraKailash SEO Proxy running on port ${PORT}`);
  console.log(`   Store:         ${SHOPIFY_STORE_DOMAIN}`);
  console.log(`   Token:         ${storedAccessToken ? "✅ Loaded (" + (fs.existsSync(TOKEN_FILE) ? "disk" : "env") + ")" : "⚠️  Not yet — visit /auth/install"}`);
  console.log(`   Anthropic Key: ${process.env.ANTHROPIC_API_KEY ? "✅ " + process.env.ANTHROPIC_API_KEY.substring(0,15) + "..." : "❌ NOT SET"}`);
  console.log(`   Serper Key:    ${process.env.SERPER_API_KEY ? "✅ Configured" : "❌ NOT SET"}`);
});
