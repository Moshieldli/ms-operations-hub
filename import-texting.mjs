/**
 * One-time import of the Aerialink texting export into your existing Neon database.
 *
 * Run it locally, once:
 *   1. vercel env pull .env.local      (so POSTGRES_URL is available)
 *   2. node --env-file=.env.local import-texting.mjs <messages.csv> <conversations.csv>
 *
 * It creates two read-only tables — texting_messages and texting_contacts — and
 * loads everything in. Safe to re-run: it drops and rebuilds the tables each time.
 *
 * Requires the @neondatabase/serverless package, which your dashboard already uses.
 */

import { readFileSync } from 'node:fs';
import { neon } from '@neondatabase/serverless';

const [, , messagesPath, contactsPath] = process.argv;
if (!messagesPath) {
  console.error('Usage: node --env-file=.env.local import-texting.mjs <messages.csv> [conversations.csv]');
  process.exit(1);
}

const DB =
  process.env.POSTGRES_URL_NON_POOLING ||
  process.env.DATABASE_URL ||
  process.env.POSTGRES_URL;
if (!DB) {
  console.error('No database URL in env. Run "vercel env pull .env.local" first.');
  process.exit(1);
}
const sql = neon(DB);

/* ---------- small, robust CSV parser (handles quotes, commas, newlines) ---------- */
function parseCSV(text) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const rows = [];
  let row = [], field = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  const headers = rows.shift() || [];
  return rows.map(r => Object.fromEntries(headers.map((h, i) => [h, r[i] ?? ''])));
}

const onlyDigits = s => String(s || '').replace(/\D/g, '');
const last10 = s => { const d = onlyDigits(s); return d.length >= 10 ? d.slice(-10) : d; };
const toISO = s => { const d = s ? new Date(s) : null; return d && !isNaN(d.getTime()) ? d.toISOString() : null; };

/* ---------- figure out which columns hold the body / date / direction ---------- */
function detectColumns(rows) {
  const headers = Object.keys(rows[0] || {});
  const find = re => headers.find(h => re.test(h.toLowerCase()));
  const phone = headers.includes('mobile_user') ? 'mobile_user' : find(/mobile|msisdn|phone|number/);
  const cid = headers.includes('conversation_id') ? 'conversation_id' : find(/conversation|thread/);
  let body = find(/(^|\.)body$|message|(^|\.)text$|content|summary|^note$/);
  if (!body) {
    let best = null, bestLen = -1;
    for (const h of headers) {
      if (h === phone || h === cid) continue;
      const len = rows.slice(0, 300).reduce((a, r) => a + String(r[h] || '').length, 0);
      if (len > bestLen) { bestLen = len; best = h; }
    }
    body = best;
  }
  const date = find(/created_at|sent_at|^date$|timestamp|^time$|updated_at/);
  const dir = find(/direction|inbound|outbound|^from$|sender|message_from|source|^type$|sent_by/);
  return { phone, cid, body, date, dir };
}

function inboundGuess(rawVal, header, phoneLast10) {
  const w = String(rawVal ?? '').trim().toLowerCase();
  if (!w) return null;
  const h = header.toLowerCase();
  if (/^(true|t|1|yes|y)$/.test(w)) return /inbound|incoming|from_phone/.test(h) ? true : (/outbound|outgoing/.test(h) ? false : null);
  if (/^(false|f|0|no|n)$/.test(w)) return /inbound|incoming|from_phone/.test(h) ? false : (/outbound|outgoing/.test(h) ? true : null);
  if (w.includes('@')) return false;
  if (/inbound|incoming/.test(w)) return true;
  if (/outbound|outgoing/.test(w)) return false;
  if (/\bin\b|customer|mobile|phone|contact/.test(w)) return true;
  if (/out|agent|staff|user|service|system|reply|admin/.test(w)) return false;
  const d = onlyDigits(w);
  if (d.length >= 10) return d.slice(-10) === phoneLast10;
  return null;
}

async function insertBatches(table, cols, records) {
  const B = 800;
  for (let i = 0; i < records.length; i += B) {
    const batch = records.slice(i, i + B);
    const params = [];
    const tuples = batch.map((rec, j) => {
      const base = j * cols.length;
      cols.forEach(c => params.push(rec[c]));
      return '(' + cols.map((_, k) => '$' + (base + k + 1)).join(',') + ')';
    });
    const conflict = table === 'texting_contacts' ? ' ON CONFLICT (conversation_id) DO NOTHING' : '';
    await sql.query(`INSERT INTO ${table} (${cols.join(',')}) VALUES ${tuples.join(',')}${conflict}`, params);
    process.stdout.write(`\r  ${table}: ${Math.min(i + B, records.length)}/${records.length}`);
  }
  process.stdout.write('\n');
}

(async () => {
  /* ---------- contacts (names/emails + last-activity date for the list) ---------- */
  let phoneByCid = new Map();
  if (contactsPath) {
    console.log('Reading contacts file...');
    const crows = parseCSV(readFileSync(contactsPath, 'utf8'));
    const seen = new Set();
    const contacts = [];
    for (const c of crows) {
      const cid = c.id || '';
      if (!cid || seen.has(cid)) continue;
      seen.add(cid);
      phoneByCid.set(cid, c['phone.number']);
      contacts.push({
        conversation_id: cid,
        phone: last10(c['phone.number']),
        phone_full: onlyDigits(c['phone.number']),
        first_name: c['phone.first_name'] || '',
        last_name: c['phone.last_name'] || '',
        email: c['phone.email'] || '',
        address: [c['phone.address'], c['phone.address_2']].filter(Boolean).join(' '),
        city: c['phone.city'] || '',
        state: c['phone.state'] || '',
        zip: c['phone.zip'] || '',
        last_message: c['last_message'] || '',
        status: c['status'] || '',
        updated_at: toISO(c['updated_at']) || toISO(c['created_at']),
      });
    }
    await sql`DROP TABLE IF EXISTS texting_contacts`;
    await sql`CREATE TABLE texting_contacts (
      conversation_id TEXT PRIMARY KEY,
      phone TEXT, phone_full TEXT,
      first_name TEXT, last_name TEXT, email TEXT,
      address TEXT, city TEXT, state TEXT, zip TEXT,
      last_message TEXT, status TEXT,
      updated_at TIMESTAMPTZ
    )`;
    await sql`CREATE INDEX idx_tc_phone ON texting_contacts(phone)`;
    await sql`CREATE INDEX idx_tc_updated ON texting_contacts(updated_at DESC NULLS LAST)`;
    await insertBatches('texting_contacts',
      ['conversation_id','phone','phone_full','first_name','last_name','email','address','city','state','zip','last_message','status','updated_at'],
      contacts);
    console.log(`Contacts loaded: ${contacts.length}`);
  }

  /* ---------- messages ---------- */
  console.log('Reading messages file...');
  const mrows = parseCSV(readFileSync(messagesPath, 'utf8'));
  if (!mrows.length) { console.error('No rows found in messages file.'); process.exit(1); }
  const M = detectColumns(mrows);
  console.log('Detected message columns ->', M);

  const records = mrows.map(r => {
    const cid = r[M.cid] || '';
    // Prefer the contact's phone (keyed by conversation_id). The message column
    // (e.g. "mobile_user") actually holds our business line, so falling back to it
    // first tagged every message with the same number. Use it only when the
    // contacts file has no phone for this conversation.
    const rawPhone = phoneByCid.get(cid) || (M.phone && r[M.phone]) || '';
    const p10 = last10(rawPhone);
    return {
      conversation_id: cid,
      phone: p10,
      phone_full: onlyDigits(rawPhone),
      body: M.body ? r[M.body] : '',
      sent_at: M.date ? toISO(r[M.date]) : null,
      direction: M.dir ? (r[M.dir] || null) : null,
      is_inbound: M.dir ? inboundGuess(r[M.dir], M.dir, p10) : null,
    };
  });

  await sql`DROP TABLE IF EXISTS texting_messages`;
  await sql`CREATE TABLE texting_messages (
    id BIGSERIAL PRIMARY KEY,
    conversation_id TEXT,
    phone TEXT,
    phone_full TEXT,
    body TEXT,
    sent_at TIMESTAMPTZ,
    direction TEXT,
    is_inbound BOOLEAN
  )`;
  await sql`CREATE INDEX idx_tm_phone ON texting_messages(phone)`;
  await sql`CREATE INDEX idx_tm_cid ON texting_messages(conversation_id)`;
  await insertBatches('texting_messages',
    ['conversation_id','phone','phone_full','body','sent_at','direction','is_inbound'],
    records);

  const distinct = new Set(records.map(r => r.phone)).size;
  console.log(`\nDone. ${records.length} messages across ${distinct} phone numbers loaded into Neon.`);
})().catch(e => { console.error('\nImport failed:', e); process.exit(1); });
