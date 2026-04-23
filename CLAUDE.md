# My Orbit Health — Claude Instructions

## Cloudflare Deployment

This project deploys to **Shubh's Cloudflare account** (Shubh@myorbithealth.com).

Before running ANY wrangler or Cloudflare API command, set the token:

```bash
export CLOUDFLARE_API_TOKEN="$CF_SHUBH_TOKEN"
```

- Account ID: `5e602c6fafc8da19fc415f90771e1f2a`
- Worker name: `my-orbit-health`
- Routes: `onboard.myorbithealth.com/*`, `portal.myorbithealth.com/*`

**DO NOT** use Bryan's OAuth login or Bryan's API token for this project — it will deploy to the wrong account.

## Public URLs — which host resolves where

Both subdomains point at the same Worker and serve every path. Use whichever
reads cleaner for the audience.

- **Intake / partner quiz iframes**: `https://onboard.myorbithealth.com/form/{partnerSlug}/{serviceType}`
- **Doctor portal**: `https://portal.myorbithealth.com/doctor/login` (also reachable at `https://onboard.myorbithealth.com/doctor/login`)
- **Admin / partner dashboard / setup links**: same — either host works

**History note:** `portal.myorbithealth.com` had a Worker route in `wrangler.toml`
from day one, but no matching DNS record existed until 2026-04-23. Before that
date the portal was only reachable via `onboard.myorbithealth.com/doctor/*`.
It was re-enabled by adding a Workers Custom Domain on the MOH zone
(`be3214ab0e821653512c0ab2639d0d75`) through the account-scoped API:

```bash
curl -X PUT -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  -H "Content-Type: application/json" \
  "https://api.cloudflare.com/client/v4/accounts/5e602c6fafc8da19fc415f90771e1f2a/workers/domains" \
  -d '{"environment":"production","hostname":"portal.myorbithealth.com","service":"my-orbit-health","zone_id":"be3214ab0e821653512c0ab2639d0d75"}'
```

When adding new vanity subdomains (e.g. `portal.kingdomlongevitylabs.com`),
either add a DNS record proxied through Cloudflare or register a Workers
Custom Domain the same way. Adding a `[[routes]]` entry in `wrangler.toml`
alone is NOT enough — DNS must exist too.

## Partner Sites (Cross-Repo Dependencies)

Partner quiz pages embed MOH intake forms via iframe at:
`https://onboard.myorbithealth.com/form/{partnerSlug}/{serviceType}`

If you rename or remove a service ID in `src/lib/services.ts`, you MUST
also update the quiz files in these repos:

- **Thriving Again** (`~/Documents/GitHub/Thriving-Again`) — slug: `thriving-again`
- **Kingdom** (`~/Documents/GitHub/kingdom-longevity-labs-version-2`) — slug: `kingdom-longevity-labs`
- **Peptide Fairy** (`~/Documents/GitHub/the-peptide-fairy`) — slug: `the-peptide-fairy` (not yet onboarded)

Those sites deploy via Cloudflare Pages (PNP account) connected to GitHub.
To deploy them, **push to main** — do NOT use `wrangler pages deploy`.
