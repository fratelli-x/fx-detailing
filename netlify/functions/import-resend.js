// One-time import of FX Detailing enquiry emails already sent through Resend.
// POST only. Header x-admin-password must match ADMIN_PASSWORD.
// Uses RESEND_API_KEY, SUPABASE_URL, and SUPABASE_SERVICE_KEY.
// Same-origin only: do not add Access-Control-Allow-Origin.

const { createClient } = require("@supabase/supabase-js");

const BUSINESS_EMAIL = "enquiries@fxdetailing.co.uk";
const SIGNATURE = "\nFX Detailing\nTel: 01293 981474";
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const SUBJECT_SERVICE = {
  "Thanks for your ceramic enquiry": "ceramic",
  "Thanks for your detailing enquiry": "detailing",
  "Thanks for your bodykit enquiry": "bodykits",
  "Thanks for your contact enquiry": "contact",
  "Thanks for your reviews enquiry": "reviews",
  "Thanks for your enquiry": "enquiry"
};
const FORM_SERVICE = {
  "detailing-booking": "detailing",
  ceramic: "ceramic",
  bodykits: "bodykits"
};
const PAGE_SERVICE = {
  homepage: true,
  contact: true,
  reviews: true,
  ceramic: true,
  detailing: true,
  bodykits: true,
  enquiry: true
};

function emptyCounts() {
  return {
    listed: 0,
    imported: 0,
    skippedDuplicates: 0,
    skippedNotEnquiry: 0,
    failed: 0,
    resendStatus: null,
    error: null
  };
}

function respond(statusCode, body) {
  return {
    statusCode: statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    },
    body: JSON.stringify(body)
  };
}

function headerValue(event, name) {
  const headers = event && event.headers;
  if (!headers) return "";
  const wanted = name.toLowerCase();
  const keys = Object.keys(headers);
  for (let i = 0; i < keys.length; i++) {
    if (keys[i].toLowerCase() === wanted) {
      const value = headers[keys[i]];
      return typeof value === "string" ? value : "";
    }
  }
  return "";
}

function authorized(event) {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected || typeof expected !== "string") return false;
  return headerValue(event, "x-admin-password") === expected;
}

function cleanText(value, max) {
  return String(value == null ? "" : value)
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .trim()
    .slice(0, max);
}

function cleanLine(value, max) {
  return cleanText(value, max).replace(/\s+/g, " ").trim();
}

function isSingleEmail(value) {
  if (!value || value.length > 254) return false;
  if (/[\s,;<>]/.test(value)) return false;
  return /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(value);
}

function normalizeCreatedAt(value) {
  const raw = String(value == null ? "" : value).trim();
  if (!raw) return "";
  const match = raw.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(\.\d+)?(?:\s*([+-]\d{2}(?::?\d{2})?|Z))?$/);
  let parsed;
  if (match) {
    const fraction = match[3] ? match[3].slice(0, 4) : "";
    let offset = match[4] || "Z";
    if (offset === "+00" || offset === "-00" || offset === "+0000" || offset === "-0000" || offset === "+00:00" || offset === "-00:00") {
      offset = "Z";
    } else if (/^[+-]\d{2}$/.test(offset)) {
      offset = offset + ":00";
    } else if (/^[+-]\d{4}$/.test(offset)) {
      offset = offset.slice(0, 3) + ":" + offset.slice(3);
    }
    parsed = Date.parse(match[1] + "T" + match[2] + fraction + offset);
  } else {
    parsed = Date.parse(raw);
  }
  if (!Number.isFinite(parsed)) return "";
  return new Date(parsed).toISOString();
}

function statusFor(createdAt) {
  const time = Date.parse(createdAt);
  if (!Number.isFinite(time)) return "Completed";
  return Date.now() - time < WEEK_MS ? "New" : "Completed";
}

function htmlToText(html) {
  return String(html)
    .replace(/<img\b[^>]*\balt="([^"]*)"[^>]*>/gi, "$1\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
}

function emailBody(detail) {
  if (detail && typeof detail.text === "string" && detail.text.trim()) {
    return detail.text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  }
  if (detail && typeof detail.html === "string" && detail.html.trim()) return htmlToText(detail.html);
  return "";
}

function field(preamble, label) {
  const prefix = label + ": ";
  const lines = preamble.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].indexOf(prefix) === 0) return lines[i].slice(prefix.length).trim();
  }
  return "";
}

function cutSignature(text) {
  const at = text.lastIndexOf(SIGNATURE);
  if (at === -1) return text.replace(/\n+$/, "");
  return text.slice(0, at).replace(/\n+$/, "");
}

function splitMessage(text, label) {
  const marker = "\n" + label + "\n";
  const at = text.indexOf(marker);
  if (at === -1) return null;
  return {
    preamble: text.slice(0, at),
    message: cutSignature(text.slice(at + marker.length))
  };
}

function addresses(value) {
  const list = Array.isArray(value) ? value : (value ? [value] : []);
  const found = [];
  for (let i = 0; i < list.length; i++) {
    const raw = String(list[i] || "");
    const angled = raw.match(/<([^<>\s]+)>/);
    const email = cleanLine(angled ? angled[1] : raw, 254);
    if (isSingleEmail(email)) found.push(email);
  }
  return found;
}

function customerAddress(value) {
  const found = addresses(value);
  for (let i = 0; i < found.length; i++) {
    if (found[i].toLowerCase() !== BUSINESS_EMAIL) return found[i];
  }
  return found.length === 1 ? found[0] : "";
}

function serviceFrom(preamble, subject) {
  const page = field(preamble, "Page").toLowerCase();
  if (PAGE_SERVICE[page]) return page;
  const formName = field(preamble, "Form");
  if (FORM_SERVICE[formName]) return FORM_SERVICE[formName];
  return SUBJECT_SERVICE[subject] || "";
}

function buildNotes(message, registration, contactMethod) {
  const notes = [];
  if (message) notes.push(message);
  if (registration) notes.push("Registration: " + registration);
  if (contactMethod) notes.push("Contact method: " + contactMethod);
  return notes.join("\n\n");
}

function classify(text, subject) {
  const lines = text.split("\n");
  const thanks = SUBJECT_SERVICE[subject] ? subject + "." : "";
  if (lines[0] === thanks && /^Page: /.test(lines[1] || "") && /^Form: /.test(lines[2] || "")) {
    return "notification";
  }
  if ((/^Hello /.test(lines[0]) || lines[0] === "Hello,") && text.indexOf("\nYour enquiry\n") !== -1 && text.indexOf("\nYou wrote:\n") !== -1 && text.indexOf("We have received your message and will come back to you during opening hours") !== -1) {
    return "acknowledgement";
  }
  return "";
}

function parseEnquiryEmail(email) {
  const subject = cleanLine(email && email.subject, 120);
  if (!SUBJECT_SERVICE[subject]) return null;
  const text = emailBody(email);
  if (!text) return null;
  const kind = classify(text, subject);
  if (!kind) return null;
  const parts = splitMessage(text, kind === "notification" ? "Message:" : "You wrote:");
  if (!parts) return null;
  const registration = field(parts.preamble, "Registration");
  const contactMethod = field(parts.preamble, "How they would like to be contacted") || field(parts.preamble, "How you would like to be contacted");
  const emailAddress = kind === "notification"
    ? (field(parts.preamble, "Email") || customerAddress(email.reply_to))
    : customerAddress(email.to);
  if (!isSingleEmail(emailAddress)) return null;
  const createdAt = normalizeCreatedAt(email.created_at);
  if (!createdAt) return null;
  const service = serviceFrom(parts.preamble, subject);
  if (!service) return null;
  return {
    kind: kind,
    name: cleanLine(field(parts.preamble, "Name"), 160),
    phone: cleanLine(field(parts.preamble, "Phone"), 40),
    email: emailAddress,
    vehicle: cleanLine(field(parts.preamble, "Vehicle"), 160),
    service: service,
    source: "Website Form",
    notes: buildNotes(parts.message, registration, contactMethod),
    status: statusFor(createdAt),
    created_at: createdAt
  };
}

function phoneKey(value) {
  return String(value || "").replace(/\D/g, "");
}

function orderImports(rows) {
  return rows.slice().sort(function (a, b) {
    if (a.kind !== b.kind) return a.kind === "notification" ? -1 : 1;
    return Date.parse(a.created_at) - Date.parse(b.created_at);
  });
}

function isDuplicate(existing, row) {
  const rowTime = Date.parse(row.created_at);
  const rowEmail = String(row.email || "").trim().toLowerCase();
  const rowPhone = phoneKey(row.phone);
  const rowNotes = String(row.notes || "").replace(/\r\n/g, "\n");
  for (let i = 0; i < existing.length; i++) {
    const item = existing[i] || {};
    const itemTime = Date.parse(normalizeCreatedAt(item.created_at) || item.created_at);
    if (Number.isFinite(rowTime) && rowTime === itemTime) return true;
    const notes = String(item.notes || "").replace(/\r\n/g, "\n");
    if (notes !== rowNotes) continue;
    const itemEmail = String(item.email || "").trim().toLowerCase();
    const itemPhone = phoneKey(item.phone);
    if ((rowEmail && itemEmail && rowEmail === itemEmail) || (rowPhone && itemPhone && rowPhone === itemPhone)) return true;
  }
  return false;
}

function resendFailure(status) {
  if (status === 403) return "The Resend key needs Full access, not Sending access only.";
  return "Resend did not return the sent emails.";
}

async function resendGet(apiKey, url) {
  const response = await fetch(url, {
    headers: {
      Authorization: "Bearer " + apiKey,
      Accept: "application/json"
    }
  });
  let body = null;
  try {
    body = await response.json();
  } catch (error) {
    body = null;
  }
  return { ok: response.ok, status: response.status, body: body };
}

async function listSentEmails(apiKey) {
  const emails = [];
  const seen = {};
  let url = "https://api.resend.com/emails?limit=100";
  let previousCursor = "";
  for (let page = 0; page < 200; page++) {
    const result = await resendGet(apiKey, url);
    if (!result.ok) return { ok: false, status: result.status, emails: emails };
    const body = result.body || {};
    const data = Array.isArray(body.data) ? body.data : [];
    let added = 0;
    for (let i = 0; i < data.length; i++) {
      const email = data[i];
      if (!email || !email.id || seen[email.id]) continue;
      seen[email.id] = true;
      emails.push(email);
      added += 1;
    }
    const next = typeof body.next === "string" ? body.next : "";
    if (/^https:\/\/api\.resend\.com\//.test(next)) {
      if (next === url) break;
      url = next;
      continue;
    }
    const fullPage = data.length >= 100;
    const hasMore = body.has_more === true || (body.has_more == null && fullPage);
    if (!hasMore) break;
    const cursor = data.length ? data[data.length - 1].id : next;
    if (!cursor || cursor === previousCursor || added === 0) break;
    previousCursor = cursor;
    url = "https://api.resend.com/emails?limit=100&after=" + encodeURIComponent(cursor);
  }
  return { ok: true, status: 200, emails: emails };
}

function isCandidate(email) {
  if (!email || !email.id || !/^[A-Za-z0-9-]+$/.test(email.id)) return false;
  const subject = cleanLine(email.subject, 120);
  if (!SUBJECT_SERVICE[subject]) return false;
  const from = String(email.from || "").toLowerCase();
  if (from && from.indexOf(BUSINESS_EMAIL) === -1) return false;
  return true;
}

async function mapPool(items, limit, fn) {
  const results = new Array(items.length);
  let index = 0;
  async function worker() {
    while (index < items.length) {
      const current = index;
      index += 1;
      results[current] = await fn(items[current]);
    }
  }
  const workers = [];
  const count = Math.min(limit, items.length);
  for (let i = 0; i < count; i++) workers.push(worker());
  await Promise.all(workers);
  return results;
}

function supabaseClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
}

async function loadExisting(supabase) {
  const rows = [];
  const pageSize = 1000;
  for (let from = 0; from < 20000; from += pageSize) {
    const { data, error } = await supabase
      .from("enquiries")
      .select("created_at,email,phone,notes")
      .range(from, from + pageSize - 1);
    if (error) return { ok: false, rows: rows };
    const batch = data || [];
    for (let i = 0; i < batch.length; i++) rows.push(batch[i]);
    if (batch.length < pageSize) break;
  }
  return { ok: true, rows: rows };
}

exports.parseEnquiryEmail = parseEnquiryEmail;
exports.isDuplicate = isDuplicate;
exports.orderImports = orderImports;
exports.normalizeCreatedAt = normalizeCreatedAt;
exports.statusFor = statusFor;

exports.handler = async function (event) {
  const counts = emptyCounts();
  if (!authorized(event)) return respond(401, Object.assign(counts, { error: "Unauthorized" }));
  const method = event && event.httpMethod ? String(event.httpMethod).toUpperCase() : "";
  if (method !== "POST") return respond(405, Object.assign(counts, { error: "Method not allowed" }));

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return respond(500, Object.assign(counts, { error: "Missing RESEND_API_KEY" }));
  const supabase = supabaseClient();
  if (!supabase) return respond(500, Object.assign(counts, { error: "Inbox unavailable" }));

  try {
    const listed = await listSentEmails(apiKey);
    if (!listed.ok) {
      counts.resendStatus = listed.status;
      counts.error = resendFailure(listed.status);
      return respond(listed.status || 502, counts);
    }
    counts.listed = listed.emails.length;
    const candidates = listed.emails.filter(isCandidate);
    counts.skippedNotEnquiry = counts.listed - candidates.length;

    let blockedStatus = 0;
    const details = await mapPool(candidates, 6, async function (item) {
      if (blockedStatus) return null;
      const result = await resendGet(apiKey, "https://api.resend.com/emails/" + encodeURIComponent(item.id));
      if (result.status === 403) {
        blockedStatus = 403;
        return null;
      }
      if (!result.ok) return { failed: true, status: result.status };
      const detail = result.body || {};
      if (!detail.created_at) detail.created_at = item.created_at;
      if (!detail.subject) detail.subject = item.subject;
      if (!detail.to) detail.to = item.to;
      if (!detail.reply_to) detail.reply_to = item.reply_to;
      const parsed = parseEnquiryEmail(detail);
      if (!parsed) return { skip: true };
      return { row: parsed };
    });

    if (blockedStatus === 403) {
      counts.resendStatus = 403;
      counts.error = resendFailure(403);
      return respond(403, counts);
    }

    const parsed = [];
    for (let i = 0; i < details.length; i++) {
      const item = details[i];
      if (!item) {
        counts.failed += 1;
        continue;
      }
      if (item.failed) {
        counts.failed += 1;
        if (!counts.resendStatus) counts.resendStatus = item.status;
        continue;
      }
      if (item.skip || !item.row) {
        counts.skippedNotEnquiry += 1;
        continue;
      }
      parsed.push(item.row);
    }

    const ordered = orderImports(parsed);

    const existingResult = await loadExisting(supabase);
    if (!existingResult.ok) return respond(500, Object.assign(counts, { error: "Inbox unavailable" }));
    const existing = existingResult.rows;

    for (let i = 0; i < ordered.length; i++) {
      const row = ordered[i];
      if (isDuplicate(existing, row)) {
        counts.skippedDuplicates += 1;
        continue;
      }
      const insert = {
        name: row.name,
        phone: row.phone,
        email: row.email,
        vehicle: row.vehicle,
        service: row.service,
        source: "Website Form",
        notes: row.notes,
        status: row.status,
        created_at: row.created_at
      };
      const { error } = await supabase.from("enquiries").insert(insert);
      if (error) {
        console.error("Supabase import insert failed");
        counts.failed += 1;
        continue;
      }
      existing.push(insert);
      counts.imported += 1;
    }

    return respond(200, counts);
  } catch (error) {
    console.error("Resend import failed");
    return respond(500, Object.assign(counts, { error: "Inbox unavailable" }));
  }
};
