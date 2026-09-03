const express = require('express');
const crypto = require('crypto');
const http = require('http');

const app = express();
const PORT = process.env.PORT || 3000;

// ============================================================
// CONFIGURATION — EDIT THESE BEFORE RUNNING
// ============================================================

const REDIRECT_KEY_HEX = '8ab50feca8cb21db27f7f9984a13ca9c3c87e56e4b0f5e5d3470e04d123ace11';

const DESTINATION = 'https://www.facebook.com';

const PUBLIC_BASE_URL = 'https://redirect-service-pn5w.onrender.com';

// ============================================================
// EMAIL DELIVERABILITY — path looks like a real webpage,
// not a redirect tracker. Change this to anything natural
// that fits your brand e.g. 'article', 'post', 'news', 'view'
// ============================================================

const REDIRECT_PATH = 'article';

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
// MASK destination for terminal printing
// Shows only enough to confirm it works without exposing the
// full link in plain text (protects from screen-scrapers/bots)
// ============================================================

function maskDestination(url) {
  try {
    const parsed = new URL(url);
    const host   = parsed.hostname;
    // Show only first 3 chars and last 3 chars of hostname
    const masked = host.length > 8
      ? host.slice(0, 3) + '*'.repeat(host.length - 6) + host.slice(-3)
      : '*'.repeat(host.length);
    return `${parsed.protocol}//${masked}/***`;
  } catch {
    return '***';
  }
}

// ============================================================
// MASK redirect URL for terminal — hides the token too
// ============================================================

function maskRedirectUrl(url) {
  const parts = url.split('/');
  const token = parts[parts.length - 1];
  const visible = token.slice(0, 6);
  return url.replace(token, `${visible}${'*'.repeat(20)}[hidden]`);
}

// ============================================================
// BUILD PAYLOAD — all variables bundled into the token
// ============================================================

function buildPayload(destination, extra = {}) {
  return JSON.stringify({
    destination,
    campaignId:  extra.campaignId  || 'cmp_' + crypto.randomBytes(8).toString('hex'),
    userId:      extra.userId      || 'usr_' + crypto.randomBytes(8).toString('hex'),
    sessionId:   extra.sessionId   || 'ses_' + crypto.randomBytes(10).toString('hex'),
    source:      extra.source      || 'direct',
    medium:      extra.medium      || 'email',
    referrer:    extra.referrer    || 'none',
    clickId:     extra.clickId     || 'clk_' + crypto.randomBytes(12).toString('hex'),
    region:      extra.region      || 'us-east-1',
    device:      extra.device      || 'unknown',
    createdAt:   Date.now(),
    expiresAt:   Date.now() + (30 * 24 * 60 * 60 * 1000),
    nonce:       crypto.randomBytes(16).toString('hex'),
  });
}

// ============================================================
// AES-256-GCM ENCRYPTION
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
// AES-256-GCM DECRYPTION
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

function isAllowedDestination(destination) {
  try {
    const url = new URL(destination);
    if (url.protocol !== 'https:') return false;
    if (!ALLOWED_HOSTS.has(url.hostname)) return false;
    return true;
  } catch {
    return false;
  }
}

// ============================================================
// CREATE AN ENCRYPTED REDIRECT TOKEN
// ============================================================

app.get('/create-link', (req, res) => {
  const destination = req.query.destination;

  if (!destination) {
    return res.status(400).json({ error: 'Destination is required' });
  }

  if (!isAllowedDestination(destination)) {
    return res.status(400).json({ error: 'Invalid destination' });
  }

  const payload     = buildPayload(destination, {
    source:     req.query.source     || 'email',
    medium:     req.query.medium     || 'campaign',
    campaignId: req.query.campaignId || undefined,
    userId:     req.query.userId     || undefined,
    device:     req.query.device     || undefined,
    region:     req.query.region     || undefined,
  });

  const token       = encrypt(payload);

  // Use natural-looking path instead of /CL0/ for email deliverability
  const redirectUrl = `${PUBLIC_BASE_URL}/${REDIRECT_PATH}/${token}`;
  const tokenLength = token.length;

  // Print masked versions only — never expose full destination or token
  console.log('\nNew redirect link created');
  console.log(`Destination : ${maskDestination(destination)}`);
  console.log(`Token length: ${tokenLength} characters`);
  console.log(`Link        : ${maskRedirectUrl(redirectUrl)}`);
  console.log('');

  return res.json({
    redirectUrl,
    tokenLength,
  });
});

// ============================================================
// REDIRECT ENDPOINT — uses natural path
// ============================================================

app.get(`/${REDIRECT_PATH}/:token`, (req, res) => {
  try {
    const { token } = req.params;
    const raw       = decrypt(token);
    const data      = JSON.parse(raw);
    const destination = data.destination;

    if (!isAllowedDestination(destination)) {
      return res.status(400).send('Not found');
    }

    if (data.expiresAt && Date.now() > data.expiresAt) {
      return res.status(410).send('Not found');
    }

    // Log click details — destination masked in logs too
    console.log('\n--- Click ---');
    console.log(`Time     : ${new Date().toISOString()}`);
    console.log(`Dest     : ${maskDestination(destination)}`);
    console.log(`Campaign : ${data.campaignId || 'n/a'}`);
    console.log(`User     : ${data.userId     || 'n/a'}`);
    console.log(`Source   : ${data.source     || 'n/a'}`);
    console.log(`Click ID : ${data.clickId    || 'n/a'}`);
    console.log(`Expires  : ${new Date(data.expiresAt).toISOString()}`);
    console.log('-------------\n');

    return res.redirect(302, destination);

  } catch (error) {
    // Generic error message — never reveal internals to the outside
    return res.status(404).send('Not found');
  }
});

// ============================================================
// START SERVER + AUTO-GENERATE LINK ON STARTUP
// ============================================================

app.listen(PORT, () => {
  console.log('');
  console.log('================================================');
  console.log(` Redirect service running on port ${PORT}`);
  console.log('================================================');
  console.log('');

  const requestUrl =
    `http://localhost:${PORT}/create-link` +
    `?destination=${encodeURIComponent(DESTINATION)}`;

  http.get(requestUrl, (res) => {
    let data = '';
    res.on('data', (chunk) => { data += chunk; });
    res.on('end', () => {
      try {
        const parsed = JSON.parse(data);
        if (parsed.redirectUrl) {
          console.log('Your tracking link is ready.');
          console.log('');
          console.log('Full link (copy this):');
          console.log('');
          // Print the FULL real link only once here, locally
          // — this is your copy moment, not logged anywhere else
          console.log(parsed.redirectUrl);
          console.log('');
          console.log(`Token length: ${parsed.tokenLength} characters`);
          console.log('');
          console.log('Test with curl (copy and run in a new window):');
          console.log('');
          console.log(`curl -Lv "${parsed.redirectUrl}"`);
          console.log('');
          console.log('================================================');
          console.log(' After copying your link, close this window to');
          console.log(' stop exposing it in an open terminal session.');
          console.log('================================================');
          console.log('');
        } else {
          console.log('Could not generate link:', parsed.error);
        }
      } catch (e) {
        console.log('Parse error:', e.message);
      }
    });
  }).on('error', (e) => {
    console.log('Internal request error:', e.message);
  });
});
