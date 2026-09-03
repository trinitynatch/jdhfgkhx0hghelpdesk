# Redirect Service

An encrypted, allow-listed URL redirect service built with Node.js and Express. Generates opaque, tamper-proof short links that redirect to a fixed set of approved destination domains.

## Features

- AES-256-GCM authenticated encryption for redirect tokens (tamper-proof)
- Allow-list validation of destination domains (prevents open-redirect abuse)
- HTTPS-only destinations enforced
- Simple two-endpoint API: create a link, then redirect on click

## Requirements

- Node.js 18 or newer
- npm

## Setup

1. Clone or download this repository.
2. Install dependencies:
   ```bash
   npm install
   ```
3. Generate an encryption key:
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```
4. Create a `.env` file in the project root (see `.env.example`) and add:
   ```
   REDIRECT_KEY=<paste-your-generated-key-here>
   ```
5. Update the `ALLOWED_HOSTS` list in `server.js` to match your real destination domain(s).

## Running locally

```bash
npm start
```

The server starts on port 3000 by default (or `PORT` from your environment).

## API

### Create a redirect link

```
GET /create-link?destination=https://yoursite.com/page
```

Returns:
```json
{ "redirectUrl": "https://your-deployed-domain.com/CL0/<token>" }
```

### Follow a redirect link

```
GET /CL0/:token
```

Decrypts the token, validates the destination is still on the allow-list, logs the click, and issues a 302 redirect.

## Deployment

This service is stateless and works well on:
- **Render / Railway / Fly.io** — connect the repo, set `REDIRECT_KEY` as an environment variable, deploy.
- **Docker / Cloud Run / ECS** — containerize with a standard Node base image.

Set the `REDIRECT_KEY` environment variable on your host's dashboard — never commit it to the repository.

## Security notes

- Keep `REDIRECT_KEY` secret. If it leaks, rotate it immediately (note: all previously issued links will stop working after rotation).
- `.env` is excluded from version control via `.gitignore` — never remove that entry.
- Only HTTPS destinations on the configured allow-list are accepted, both at link creation and at redirect time.

## License

See `LICENSE`.
