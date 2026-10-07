# WashQuote standalone API

This is the backend replacement for the Hatchable API.

## Endpoints
- POST /api/event
- POST /api/waitlist

## Storage
Cloudflare D1 is used for production persistence.

## Deploy
1. Create a Cloudflare D1 database named `washquote`.
2. Put its database ID in `wrangler.toml`.
3. Authenticate Wrangler with the WashQuote Cloudflare account.
4. Run `wrangler deploy`.

The frontend should point its API base URL at the deployed Worker.

The old Hatchable project is not required by this backend.