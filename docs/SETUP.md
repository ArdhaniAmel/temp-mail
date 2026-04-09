# Pakasir TempMail (Vercel + Cloudflare Email Routing)

This package is already converted for a **serverless** setup:

- **Vercel** serves the static frontend at `www.pakasir.dev`
- **Cloudflare Email Routing** receives incoming mail for `@pakasir.dev`
- **Cloudflare Email Worker** parses each message
- **Cloudflare D1** stores inbox data

The old Node/SMTP backend is left in the repository only as a reference. It is **not** used in this deployment model.

## Folder overview

```text
frontend/             Static app for Vercel
cloudflare-worker/    Email Worker + D1 API
backend/              Legacy server version (not used)
```

## 1) Deploy the frontend to Vercel

Import this repo into Vercel and keep the root as the project directory.
The included `vercel.json` rewrites `/` to `frontend/index.html` and serves the rest of the frontend files from `frontend/`.

### Add these domains in Vercel

- `www.pakasir.dev` as the primary domain
- `pakasir.dev` redirected to `https://www.pakasir.dev`

## 2) Point your DNS in Cloudflare

Keep DNS for `pakasir.dev` in Cloudflare.

### Website records

Add the exact Vercel records shown in the Vercel domain panel. In most setups this means:

- `www` -> CNAME -> target shown by Vercel
- `@` -> A or redirect based on what Vercel asks for

### API route

Create a Worker route for `mailapi.pakasir.dev/*` after you deploy the Worker.

## 3) Enable Cloudflare Email Routing

In Cloudflare:

1. Open **Email > Email Routing**
2. Click **Enable Email Routing**
3. Let Cloudflare add the required MX/TXT records
4. Create a **catch-all** rule
5. Set its action to **Send to a Worker**
6. Choose the Worker you deploy from `cloudflare-worker/`

## 4) Create the D1 database

Inside `cloudflare-worker/`:

```bash
npm install
npx wrangler d1 create pakasir-tempmail
```

Copy the returned `database_id` into `cloudflare-worker/wrangler.jsonc`.

Then apply the schema:

```bash
npx wrangler d1 migrations apply pakasir-tempmail --remote
```

## 5) Deploy the Cloudflare Worker

Inside `cloudflare-worker/`:

```bash
npm install
npx wrangler login
npx wrangler deploy
```

Then in the Cloudflare dashboard:

- assign route `mailapi.pakasir.dev/*` to this Worker
- use the same Worker in Email Routing's catch-all rule

## 6) Frontend configuration

The frontend is already configured to use:

```text
https://mailapi.pakasir.dev/api
```

If you want a different API domain, edit:

```text
frontend/config.js
cloudflare-worker/wrangler.jsonc   -> CORS_ORIGIN
```

## Local testing

### Frontend only

```bash
npm run dev
```

Then open `http://127.0.0.1:8080/frontend/`.

### Worker locally

```bash
cd cloudflare-worker
npm install
npx wrangler dev
```

## Notes

- Attachments are stored as metadata only in D1 in this version.
- Emails are deleted automatically by a scheduled cleanup job every hour.
- Allowed recipient domains come from `ALLOWED_DOMAINS` in `wrangler.jsonc`.
- The default allowed domain is `pakasir.dev`.
