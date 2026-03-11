# RudraKailash SEO Proxy

A lightweight Express proxy that connects the RudraKailash Agentic SEO tool to the Shopify Admin API.

## Deploy to Render (Free)

### Step 1: Push to GitHub
1. Create a new repository at github.com (name: `rk-seo-proxy`)
2. Upload all these files to the repository

### Step 2: Deploy on Render
1. Go to render.com and sign up (free)
2. Click "New +" → "Web Service"
3. Connect your GitHub account → select `rk-seo-proxy` repo
4. Settings:
   - Name: `rk-seo-proxy`
   - Environment: `Node`
   - Build Command: `npm install`
   - Start Command: `npm start`
   - Plan: `Free`
5. Add Environment Variables:
   - `SHOPIFY_CLIENT_ID` → your Dev Dashboard Client ID
   - `SHOPIFY_CLIENT_SECRET` → your Dev Dashboard Secret
   - `SHOPIFY_STORE_DOMAIN` → `rudrakailash.myshopify.com`
   - `APP_URL` → your Render URL (e.g. https://rk-seo-proxy.onrender.com)
6. Click "Create Web Service"

### Step 3: Add Redirect URL in Dev Dashboard
1. Go to Dev Dashboard → RK SEO Agent → Versions → your version
2. Add to Redirect URLs: `https://rk-seo-proxy.onrender.com/auth/callback`
3. Release the version

### Step 4: Authorize the app
1. Visit: `https://rk-seo-proxy.onrender.com/auth/install`
2. Approve the installation on your Shopify store
3. You'll see a success screen — your proxy is now connected!

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | / | Health check |
| GET | /auth/install | Start OAuth flow |
| GET | /auth/callback | OAuth callback |
| GET | /auth/status | Check connection status |
| GET | /products | Fetch all products |
| PUT | /products/:id | Update a product |
