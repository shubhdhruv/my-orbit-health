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
