const express = require('express');
const crypto = require('crypto');
const http = require('http');
const { exec } = require('child_process');

const app = express();
const PORT = process.env.PORT || 3000;

// ============================================================
// CONFIGURATION — EDIT THESE BEFORE RUNNING
// ============================================================

const REDIRECT_KEY_HEX = '8ab50feca8cb21db27f7f9984a13ca9c3c87e56e4b0f5e5d3470e04d123ace11';
const DESTINATION      = 'https://www.facebook.com';
const PUBLIC_BASE_URL  = 'https://inreal.space';
const REDIRECT_PATH    = 'article';

// ============================================================
// ALLOWED DESTINATION DOMAINS
// ============================================================

const ALLOWED_HOSTS = new Set([
  'facebook.com',
  'www.facebook.com'
]);

// ============================================================
// INTERNAL SETUP
// ============================================================

const ALGORITHM = 'aes-256-gcm';
const KEY = Buffer.from(REDIRECT_KEY_HEX, 'hex');

if (KEY.length !== 32) {
  throw new Error('REDIRECT_KEY_HEX must be exactly 32 bytes / 64 hex characters');
}

// ============================================================
// ENCRYPTION
// ============================================================

function encrypt(text) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, KEY, iv);
  const encrypted = Buffer.concat([
    cipher.update(text, 'utf8'),
    cipher.final()
  ]);
  const authTag = cipher.getAuthTag();
  return [
    iv.toString('base64url'),
    authTag.toString('base64url'),
    encrypted.toString('base64url')
  ].join('.');
}

// ============================================================
// DECRYPTION
// ============================================================

function decrypt(token) {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Invalid token format');
  const [ivEncoded, authTagEncoded, encryptedEncoded] = parts;
  const iv        = Buffer.from(ivEncoded,        'base64url');
  const authTag   = Buffer.from(authTagEncoded,   'base64url');
  const encrypted = Buffer.from(encryptedEncoded, 'base64url');
  const decipher  = crypto.createDecipheriv(ALGORITHM, KEY, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([
    decipher.update(encrypted),
    decipher.final()
  ]);
  return decrypted.toString('utf8');
}

// ============================================================
// DESTINATION VALIDATION
// ============================================================

function isAllowedDestination(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return false;
    if (!ALLOWED_HOSTS.has(parsed.hostname)) return false;
    return true;
  } catch {
    return false;
  }
}

// ============================================================
// HOME PAGE — shows a clickable link in browser
// ============================================================

app.get('/', (req, res) => {
  // Generate a fresh token every time someone visits /
  const token = encrypt(DESTINATION);
  const redirectUrl = `${PUBLIC_BASE_URL}/${REDIRECT_PATH}/${token}`;

  // Return a simple HTML page with a clickable link
  res.send(`
    <!DOCTYPE html>
    <html>
      <head>
        <title>Redirect Service</title>
        <style>
          body { font-family: Arial, sans-serif; padding: 40px; }
          a { 
            display: inline-block;
            padding: 12px 24px;
            background: #0066cc;
            color: white;
            text-decoration: none;
            border-radius: 6px;
            font-size: 16px;
          }
          a:hover { background: #0052a3; }
          p { color: #555; word-break: break-all; }
        </style>
      </head>
      <body>
        <h2>Your Redirect Link</h2>
        <p>Click the button below to test your redirect:</p>
        <a href="${redirectUrl}">Click to Redirect</a>
        <br><br>
        <p><strong>Your tracking link:</strong><br>${redirectUrl}</p>
        <p><small>This link is valid for 30 days.</small></p>
      </body>
    </html>
  `);
});

// ============================================================
// CREATE LINK ENDPOINT
// ============================================================

app.get('/create-link', (req, res) => {
  const destination = req.query.destination;

  if (!destination) {
    return res.status(400).json({ error: 'Destination is required' });
  }

  if (!isAllowedDestination(destination)) {
    return res.status(400).json({ error: 'Invalid destination' });
  }

  const token      = encrypt(destination);
  const redirectUrl = `${PUBLIC_BASE_URL}/${REDIRECT_PATH}/${token}`;

  console.log(`\nNew link created -> ${redirectUrl}`);

  return res.json({
    redirectUrl,
    tokenLength: token.length,
    destination
  });
});

// ============================================================
// REDIRECT ENDPOINT — decrypts token and redirects
// ============================================================

app.get(`/${REDIRECT_PATH}/:token`, (req, res) => {
  try {
    const { token }   = req.params;
    const destination = decrypt(token);

    console.log(`\nRedirecting to: ${destination}`);

    if (!isAllowedDestination(destination)) {
      console.log('Destination not allowed:', destination);
      return res.status(400).send('Not found');
    }

    // Redirect to real destination
    return res.redirect(302, destination);

  } catch (error) {
    console.error('Decrypt error:', error.message);
    return res.status(404).send('Not found');
  }
});

// ============================================================
// START SERVER
// ============================================================

app.listen(PORT, () => {
  console.log('');
  console.log('================================================');
  console.log(` Redirect service running on port ${PORT}`);
  console.log('================================================');
  console.log('');
  console.log('Open this in your browser to test:');
  console.log(`http://localhost:${PORT}`);
  console.log('');
  console.log('Or generate a link directly:');
  console.log(`http://localhost:${PORT}/create-link?destination=${encodeURIComponent(DESTINATION)}`);
  console.log('');
});
