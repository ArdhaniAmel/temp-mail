# Launch checklist

## Vercel
- Import the repo
- Add `www.pakasir.dev`
- Redirect `pakasir.dev` -> `https://www.pakasir.dev`

## Cloudflare D1
- Run `npx wrangler d1 create pakasir-tempmail`
- Paste `database_id` into `cloudflare-worker/wrangler.jsonc`
- Run `npx wrangler d1 migrations apply pakasir-tempmail --remote`

## Cloudflare Worker
- Run `cd cloudflare-worker && npm install`
- Run `npx wrangler login`
- Run `npx wrangler deploy`
- Attach route `mailapi.pakasir.dev/*`

## Cloudflare Email Routing
- Enable Email Routing
- Turn on catch-all
- Action: Send to a Worker
- Choose the deployed Worker

## Test
- Open `https://www.pakasir.dev`
- Generate an address like `abc123@pakasir.dev`
- Send a test email from Gmail
- Confirm the inbox updates
