require("dotenv").config();
const express = require("express");
const cors = require("cors");
const fetch = require("node-fetch");

const app = express();
const PORT = process.env.PORT || 3001;

// ─── CORS ─────────────────────────────────────────────────────────────────────
// Allow all origins — this proxy is private (no sensitive data exposed)
// Access is controlled by the Shopify token stored server-side
app.use(cors({
  origin: true, // Allow all origins including file:// local HTML files
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Store-Domain", "X-Access-Token"],
  credentials: true,
}));

app.use(express.json());

// ─── Config ───────────────────────────────────────────────────────────────────
const SHOPIFY_CLIENT_ID     = process.env.SHOPIFY_CLIENT_ID;
const SHOPIFY_CLIENT_SECRET = process.env.SHOPIFY_CLIENT_SECRET;
const SHOPIFY_STORE_DOMAIN  = process.env.SHOPIFY_STORE_DOMAIN; // e.g. rudrakailash.myshopify.com
const SHOPIFY_API_VERSION   = "2024-01";

// In-memory token store (persists for life of server process)
let storedAccessToken = process.env.SHOPIFY_ACCESS_TOKEN || null;

// ─── Health check ─────────────────────────────────────────────────────────────
app.get("/", (req, res) => {
  res.json({
    status: "ok",
    service: "RudraKailash SEO Proxy",
    store: SHOPIFY_STORE_DOMAIN,
    tokenConfigured: !!storedAccessToken,
  });
});

// ─── OAuth Step 1: Generate install URL ───────────────────────────────────────
app.get("/auth/install", (req, res) => {
  const shop = SHOPIFY_STORE_DOMAIN;
  const scopes = "read_products,write_products,read_product_listings";
  const redirectUri = `${process.env.APP_URL}/auth/callback`;
  const state = Math.random().toString(36).substring(7);

  const installUrl = `https://${shop}/admin/oauth/authorize?client_id=${SHOPIFY_CLIENT_ID}&scope=${scopes}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}`;
  res.redirect(installUrl);
});

// ─── OAuth Step 2: Handle callback & exchange code for token ──────────────────
app.get("/auth/callback", async (req, res) => {
  const { code, shop } = req.query;

  if (!code || !shop) {
    return res.status(400).json({ error: "Missing code or shop parameter" });
  }

  try {
    const tokenRes = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: SHOPIFY_CLIENT_ID,
        client_secret: SHOPIFY_CLIENT_SECRET,
        code,
      }),
    });

    const tokenData = await tokenRes.json();

    if (tokenData.access_token) {
      storedAccessToken = tokenData.access_token;
      console.log("✅ Access token obtained and stored successfully");
      res.send(`
        <html>
          <body style="font-family:sans-serif;background:#0D0500;color:#F5E6C8;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;">
            <div style="text-align:center;padding:40px;border:1px solid #D4A017;border-radius:12px;background:#1A0A00;">
              <div style="font-size:48px;margin-bottom:16px;">✅</div>
              <h2 style="color:#F0C84A;margin-bottom:8px;">RudraKailash SEO Agent Connected!</h2>
              <p style="color:#9A7050;">Your Shopify store is now linked. You can close this tab and return to the SEO tool.</p>
            </div>
          </body>
        </html>
      `);
    } else {
      res.status(400).json({ error: "Failed to get access token", details: tokenData });
    }
  } catch (err) {
    res.status(500).json({ error: "OAuth callback failed", message: err.message });
  }
});

// ─── Check if token is available ──────────────────────────────────────────────
app.get("/auth/status", (req, res) => {
  res.json({
    connected: !!storedAccessToken,
    store: SHOPIFY_STORE_DOMAIN,
  });
});

// ─── GET /products — fetch all products ───────────────────────────────────────
app.get("/products", async (req, res) => {
  if (!storedAccessToken) {
    return res.status(401).json({ error: "Not authenticated. Visit /auth/install first." });
  }

  try {
    const limit = req.query.limit || 50;
    const shopifyRes = await fetch(
      `https://${SHOPIFY_STORE_DOMAIN}/admin/api/${SHOPIFY_API_VERSION}/products.json?limit=${limit}&fields=id,title,body_html,tags,handle,status,metafields_global_title_tag,metafields_global_description_tag`,
      {
        headers: {
          "X-Shopify-Access-Token": storedAccessToken,
          "Content-Type": "application/json",
        },
      }
    );

    const data = await shopifyRes.json();

    if (!shopifyRes.ok) {
      return res.status(shopifyRes.status).json({ error: "Shopify API error", details: data });
    }

    res.json(data);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch products", message: err.message });
  }
});

// ─── PUT /products/:id — update a product ─────────────────────────────────────
app.put("/products/:id", async (req, res) => {
  if (!storedAccessToken) {
    return res.status(401).json({ error: "Not authenticated. Visit /auth/install first." });
  }

  const { id } = req.params;
  const updates = req.body;

  try {
    const shopifyRes = await fetch(
      `https://${SHOPIFY_STORE_DOMAIN}/admin/api/${SHOPIFY_API_VERSION}/products/${id}.json`,
      {
        method: "PUT",
        headers: {
          "X-Shopify-Access-Token": storedAccessToken,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ product: { id, ...updates } }),
      }
    );

    const data = await shopifyRes.json();

    if (!shopifyRes.ok) {
      return res.status(shopifyRes.status).json({ error: "Shopify update failed", details: data });
    }

    console.log(`✅ Product ${id} updated successfully`);
    res.json({ success: true, product: data.product });
  } catch (err) {
    res.status(500).json({ error: "Failed to update product", message: err.message });
  }
});

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`🚀 RudraKailash SEO Proxy running on port ${PORT}`);
  console.log(`   Store: ${SHOPIFY_STORE_DOMAIN}`);
  console.log(`   Token: ${storedAccessToken ? "✅ Configured" : "⚠️  Not yet — visit /auth/install"}`);
});

// ─── POST /ai/generate — proxy Anthropic API calls ───────────────────────────
app.post("/ai/generate", async (req, res) => {
  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_KEY) {
    return res.status(500).json({ error: "ANTHROPIC_API_KEY not configured on server" });
  }
  try {
    const { system, user, max_tokens = 1000 } = req.body;
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-5",
        max_tokens,
        system,
        messages: [{ role: "user", content: user }],
      }),
    });
    const data = await response.json();
    if (!response.ok) {
      return res.status(response.status).json({ error: "Anthropic API error", details: data });
    }
    const text = data.content?.map(b => b.text || "").join("") || "";
    res.json({ success: true, text });
  } catch (err) {
    res.status(500).json({ error: "AI generation failed", message: err.message });
  }
});
