/* eslint-disable @typescript-eslint/no-require-imports -- plain CommonJS node script */
// Sends ONE sample "new call" alert email so you can prove SMTP works.
//
// Usage:
//   npm run test-email                → to the email saved in the business
//                                       record (Settings → Business
//                                       information → Email → Save changes)
//   npm run test-email -- you@mail.com → to an explicit address
//   npm run test-email -- you@mail.com emergency → EMERGENCY subject variant
//
// Reads SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM from .env.local
// (or .env). Secret values are never printed.
const fs = require('fs');
const path = require('path');

// Load .env files without printing any values. Real process env always wins
// over the files; .env.local wins over .env.
function readEnvFile(filePath) {
  const values = {};
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      if (line.trim().startsWith('#')) continue;
      const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
      if (!match) continue;
      let value = match[2].trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      values[match[1]] = value;
    }
  } catch {
    /* file missing is fine */
  }
  return values;
}

const fileEnv = {
  ...readEnvFile(path.join(__dirname, '..', '.env')),
  ...readEnvFile(path.join(__dirname, '..', '.env.local')),
};
for (const [key, value] of Object.entries(fileEnv)) {
  if (process.env[key] === undefined || process.env[key] === '') {
    process.env[key] = value;
  }
}

// Recipient: CLI argument, else the saved business notification email.
const overrideTo =
  process.argv[2] &&
  process.argv[2] !== 'emergency' &&
  !process.argv[2].startsWith('--') &&
  process.argv[2].includes('@')
    ? process.argv[2].trim()
    : null;
const emergency = process.argv.includes('emergency');

let db;
let recipient = null;
let recipientSource = '';
try {
  const Database = require('better-sqlite3');
  const dbPath =
    (process.env.DATABASE_PATH && process.env.DATABASE_PATH.trim()) ||
    path.join(__dirname, '..', 'data', 'callflow.db');

  // Ensure the notificationEmail column exists — the same idempotent
  // migration the app applies at boot (src/lib/database.ts), so this script
  // also works before the dev/production server has restarted.
  try {
    const rw = new Database(dbPath);
    const cols = rw.pragma('table_info(businesses)').map((c) => c.name);
    if (cols.length && !cols.includes('notificationEmail')) {
      rw.exec('ALTER TABLE businesses ADD COLUMN notificationEmail TEXT');
    }
    rw.close();
  } catch {
    /* read-only disk or missing table — the app migrates on its next boot */
  }

  db = new Database(dbPath, { readonly: true });

  if (overrideTo) {
    recipient = overrideTo;
    recipientSource = 'command line';
  } else {
    const rows = db
      .prepare(
        `SELECT id, phoneNumber, notificationEmail FROM businesses
          WHERE notificationEmail IS NOT NULL AND notificationEmail <> ''
          ORDER BY createdAt ASC`
      )
      .all();
    if (rows.length === 0) {
      console.log(
        'No notification email saved yet. Save the owner email first:\n' +
          '  open the dashboard -> Settings -> Business information -> Email -> Save changes,\n' +
          '  or pass one explicitly:  npm run test-email -- owner@example.com'
      );
      process.exit(1);
    }
    recipient = rows[0].notificationEmail;
    recipientSource =
      rows.length === 1
        ? `business record (${rows[0].phoneNumber})`
        : `business record (${rows[0].phoneNumber}; note: ${rows.length} businesses have emails saved — pass an address to choose)`;
  }
} catch (err) {
  console.log(`Could not read the saved business email: ${err.message}`);
  process.exit(1);
} finally {
  if (db) db.close();
}

// --- part 2 (SMTP check + send) continues below ---

// SMTP configuration check — all five values, exactly like the webhook.
const required = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM'];
const missing = required.filter((name) => !(process.env[name] || '').trim());
if (missing.length) {
  console.log(
    `SMTP is not configured: missing ${missing.join(', ')}. Fill them in in .env.local` +
      ' (placeholders are listed in .env.example), then run npm run test-email again.'
  );
  process.exit(1);
}

// Build the sample alert — same subject/body shape the webhook sends.
const name = 'Sam Sample';
const subject = emergency
  ? `EMERGENCY call from ${name}`
  : `New call from ${name} (today)`;
const callbackNumber = '+15550102030';
const telHref = `tel:${callbackNumber}`;
const baseUrl = (process.env.PUBLIC_BASE_URL || 'http://localhost:3000')
  .trim()
  .replace(/\/+$/, '');
const dashboardUrl = `${baseUrl}/calls`;
const callTime = `${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC`;
const text = [
  'This is a TEST alert from npm run test-email — no real call arrived.',
  '',
  'What they need: Leaking kitchen faucet (sample reason)',
  `Call them back: ${callbackNumber}`,
  `Call time: ${callTime}`,
  'Listen to the recording: https://example.com/sample-recording',
  `Open the dashboard: ${dashboardUrl}`,
].join('\n');
const html = [
  '<p>This is a <strong>TEST</strong> alert from <code>npm run test-email</code> — no real call arrived.</p>',
  '<p><strong>What they need:</strong> Leaking kitchen faucet (sample reason)</p>',
  `<p><strong>Call them back:</strong> <a href="${telHref}">${callbackNumber}</a></p>`,
  `<p><strong>Call time:</strong> ${callTime}</p>`,
  '<p><strong>Listen to the recording:</strong> <a href="https://example.com/sample-recording">sample recording</a></p>',
  `<p><a href="${dashboardUrl}">Open the dashboard</a></p>`,
].join('\n');

const nodemailer = require('nodemailer');
const port = Number(process.env.SMTP_PORT.trim());
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST.trim(),
  port,
  secure: port === 465,
  auth: {
    user: process.env.SMTP_USER.trim(),
    pass: process.env.SMTP_PASS.trim(),
  },
});

console.log(`Sending one sample alert to ${recipient} (${recipientSource})...`);
transporter
  .sendMail({
    from: process.env.SMTP_FROM.trim(),
    to: recipient,
    subject,
    text,
    html,
  })
  .then((info) => {
    transporter.close();
    console.log(
      `SUCCESS — email sent. Subject: "${subject}". Check the inbox (and the spam folder).`
    );
    if (info && info.messageId) console.log(`Message id: ${info.messageId}`);
    process.exit(0);
  })
  .catch((err) => {
    transporter.close();
    console.log(`FAILED — the email did not go out: ${err.message}`);
    if (err.code) console.log(`Error code: ${err.code}`);
    if (err.response) console.log(`Server said: ${err.response}`);
    process.exit(1);
  });