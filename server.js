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
  } catch (e) {
    console.warn("⚠️  Could not read token file:", e.message);
  }
  return process.env.SHOPIFY_ACCESS_TOKEN || null;
}

function saveToken(token) {
  try {
    fs.writeFileSync(TOKEN_FILE, token, "utf8");
    console.log("💾 Token saved to disk");
  } catch (e) {
    console.warn("⚠️  Could not save token to disk:", e.message);
  }
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
    status:                  "ok",
    service:                 "RudraKailash SEO Proxy",
    store:                   SHOPIFY_STORE_DOMAIN,
    tokenConfigured:         !!storedAccessToken,
    tokenSource:             fs.existsSync(TOKEN_FILE) ? "disk" : (process.env.SHOPIFY_ACCESS_TOKEN ? "env" : "none"),
    anthropicKeyConfigured:  !!process.env.ANTHROPIC_API_KEY,
    anthropicKeyPrefix:      process.env.ANTHROPIC_API_KEY
                               ? process.env.ANTHROPIC_API_KEY.substring(0, 10) + "..."
                               : "NOT SET",
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
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({
        client_id:     SHOPIFY_CLIENT_ID,
        client_secret: SHOPIFY_CLIENT_SECRET,
        code,
      }),
    });
    const tokenData = await tokenRes.json();
    if (tokenData.access_token) {
      storedAccessToken = tokenData.access_token;
      saveToken(storedAccessToken);           // 💾 persist to disk
      console.log("✅ Access token obtained and saved to disk");
      res.send(`
        <html><body style="font-family:sans-serif;background:#0D0500;color:#F5E6C8;
          display:flex;align-items:center;justify-content:center;height:100vh;margin:0;">
          <div style="text-align:center;padding:40px;border:1px solid #D4A017;
            border-radius:12px;background:#1A0A00;">
            <div style="font-size:48px;margin-bottom:16px;">✅</div>
            <h2 style="color:#F0C84A;margin-bottom:8px;">RudraKailash SEO Agent Connected!</h2>
            <p style="color:#9A7050;">Your Shopify store is now linked and token saved permanently.</p>
            <p style="color:#9A7050;">You can close this tab and return to the SEO tool.</p>
          </div>
        </body></html>
      `);
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
  if (!secret || secret !== SHOPIFY_CLIENT_SECRET) {
    return res.status(403).json({ error: "Forbidden — invalid secret" });
  }
  if (!storedAccessToken) {
    return res.status(404).json({ error: "No token stored. Visit /auth/install first." });
  }
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
  const { id }    = req.params;
  const updates   = req.body;
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
  console.log(`🤖 AI generate called. Key present: ${!!ANTHROPIC_KEY}, prefix: ${ANTHROPIC_KEY ? ANTHROPIC_KEY.substring(0, 15) : "NONE"}`);

  if (!ANTHROPIC_KEY) {
    return res.status(500).json({ error: "ANTHROPIC_API_KEY not configured on server" });
  }
  try {
    const { system, user, max_tokens = 1000 } = req.body;
    console.log(`🤖 Calling Anthropic for: ${user ? user.substring(0, 60) : "no user msg"}...`);

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
    console.log(`🤖 Anthropic response status: ${response.status}`);

    if (!response.ok) {
      console.error(`❌ Anthropic error:`, JSON.stringify(data));
      return res.status(response.status).json({ error: "Anthropic API error", details: data });
    }

    const text = data.content?.map(b => b.text || "").join("") || "";
    console.log(`✅ AI response generated, length: ${text.length}`);
    res.json({ success: true, text });
  } catch (err) {
    console.error(`❌ AI generate exception:`, err.message);
    res.status(500).json({ error: "AI generation failed", message: err.message });
  }
});

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`🚀 RudraKailash SEO Proxy running on port ${PORT}`);
  console.log(`   Store:         ${SHOPIFY_STORE_DOMAIN}`);
  console.log(`   Token:         ${storedAccessToken ? "✅ Loaded (" + (fs.existsSync(TOKEN_FILE) ? "disk" : "env") + ")" : "⚠️  Not yet — visit /auth/install"}`);
  console.log(`   Anthropic Key: ${process.env.ANTHROPIC_API_KEY ? "✅ " + process.env.ANTHROPIC_API_KEY.substring(0, 15) + "..." : "❌ NOT SET"}`);
});
