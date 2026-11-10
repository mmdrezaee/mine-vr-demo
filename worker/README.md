# Sam proxy (optional)

Lets the Pit Shift Trainer (V3) answer questions with Claude when it runs from GitHub Pages or on the Quest 3. Without it, Sam still answers, using offline answers built from the procedure.

The API key never goes into the web page. It is stored as a secret in this Cloudflare Worker.

## Set up (about 15 minutes)

1. Get a Claude API key at console.anthropic.com (API usage is billed separately from a Claude subscription).
2. Create a free Cloudflare account, then in a terminal in this folder:
   ```
   npx wrangler login
   npx wrangler secret put ANTHROPIC_API_KEY   # paste the key when asked
   npx wrangler deploy
   ```
3. Wrangler prints the Worker address, for example `https://sam-proxy.<your-subdomain>.workers.dev`.
4. In `v3/index.html`, set `window.SAM_CONFIG = { proxyUrl: 'https://sam-proxy.<your-subdomain>.workers.dev' }`, commit and push.

## Settings

- `MODEL` in `wrangler.toml`: `claude-sonnet-5-5` (requested) or `claude-haiku-5-5` (faster replies, lower cost; better for voice).
- `ALLOWED_ORIGINS`: the sites allowed to call the proxy.
- Answers are capped at 220 tokens and the conversation at the last 7 turns.

For anything beyond a demo, add Cloudflare rate limiting or Turnstile, because the Origin check alone can be bypassed outside a browser.
