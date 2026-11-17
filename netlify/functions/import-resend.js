// One-time import of FX Detailing enquiry emails already sent through Resend.
// POST only. Header x-admin-password must match ADMIN_PASSWORD.
// Uses RESEND_API_KEY, SUPABASE_URL, and SUPABASE_SERVICE_KEY.
// Same-origin only: do not add Access-Control-Allow-Origin.

const { createClient } = require("@supabase/supabase-js");

const BUSINESS_EMAIL = "enquiries@fxdetailing.co.uk";
const SIGNATURE = "\nFX Detailing\nTel: 01293 981474";
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const OLD_ACK_SUBJECT = "We have received your FX Detailing enquiry";
const OLD_NOTIFY_SUBJECT = "New FX Detailing enquiry";
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
  bodykits: "bodykits",
  enquiry: "enquiry",
  contact: "contact",
  reviews: "reviews"
};

function enquirySubject(subject) {
  return Boolean(SUBJECT_SERVICE[subject] || subject === OLD_ACK_SUBJECT || subject === OLD_NOTIFY_SUBJECT);
}
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
  const prefix = String(label || "").toLowerCase() + ":";
  const lines = String(preamble || "").split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.toLowerCase().indexOf(prefix) === 0) return line.slice(prefix.length).trim();
  }
  return "";
}

function fieldAny(preamble, labels) {
  for (let i = 0; i < labels.length; i++) {
    const value = field(preamble, labels[i]);
    if (value) return value;
  }
  return "";
}

function cutSignature(text) {
  let source = String(text || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const known = source.lastIndexOf(SIGNATURE);
  if (known !== -1) source = source.slice(0, known);
  const at = source.lastIndexOf("\nFX Detailing");
  if (at === -1) return source.replace(/\n+$/, "");
  const after = source.slice(at);
  if (/Tel:|Mob:|enquiries@fxdetailing\.co\.uk|07548\s*703902|01293\s*981474|Monday to Friday|The Barn|www\.fxdetailing/.test(after)) {
    return source.slice(0, at).replace(/\n+$/, "");
  }
  return source.replace(/\n+$/, "");
}

function splitMessage(text, label) {
  const source = String(text || "");
  const newlineMarker = "\n" + label + "\n";
  let at = source.indexOf(newlineMarker);
  let skip = newlineMarker.length;
  if (at === -1) {
    const lineMarker = "\n" + label;
    at = source.indexOf(lineMarker);
    skip = lineMarker.length;
  }
  if (at === -1 && source.indexOf(label) === 0) {
    at = 0;
    skip = label.length;
  }
  if (at === -1) return null;
  return {
    preamble: source.slice(0, at),
    message: cutSignature(source.slice(at + skip).replace(/^\n/, ""))
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
  const body = tidyMessage(message);
  if (body) notes.push(body);
  if (registration) notes.push("Registration: " + registration);
  if (contactMethod) notes.push("Contact method: " + contactMethod);
  return notes.join("\n\n");
}

function classify(text, subject) {
  const body = text || "";
  const lines = body.split("\n");
  const first = (lines[0] || "").trim();
  if (subject === OLD_NOTIFY_SUBJECT || first === "New enquiry from the website.") return "notification";
  const thanks = SUBJECT_SERVICE[subject] ? subject + "." : "";
  if (thanks && first === thanks && /^Page:\s/.test(lines[1] || "") && /^Form:\s/.test(lines[2] || "")) {
    return "notification";
  }
  if (subject === OLD_ACK_SUBJECT) return "acknowledgement";
  if ((/^Hello /.test(first) || first === "Hello,") && body.indexOf("You wrote:") !== -1) return "acknowledgement";
  if (body.indexOf("\nMessage:") !== -1 && (body.indexOf("Page:") !== -1 || body.indexOf("Form:") !== -1)) return "notification";
  if (body.indexOf("You wrote:") !== -1 || body.indexOf("Your enquiry") !== -1) return "acknowledgement";
  if (body.indexOf("\nMessage:") !== -1) return "notification";
  if (enquirySubject(subject)) return "notification";
  return "";
}

function takeParts(text, labels) {
  for (let i = 0; i < labels.length; i++) {
    const parts = splitMessage(text, labels[i]);
    if (parts) return parts;
  }
  return { preamble: text || "", message: "" };
}

function tidyMessage(value) {
  return String(value || "").replace(/\n{3,}/g, "\n\n").trim();
}

function parseEnquiryEmail(email) {
  const subject = cleanLine(email && email.subject, 160);
  if (!enquirySubject(subject)) return null;
  const text = cutSignature(emailBody(email));
  const kind = classify(text, subject) || "notification";
  const labels = kind === "acknowledgement"
    ? ["You wrote:", "Your message:", "Message:", "Enquiry:", "Notes:"]
    : ["Message:", "Your message:", "You wrote:", "Enquiry:", "Notes:"];
  const parts = takeParts(text, labels);
  const registration = fieldAny(parts.preamble, ["Registration", "Vehicle registration", "Number plate", "Reg"]);
  const contactMethod = fieldAny(parts.preamble, [
    "How they would like to be contacted",
    "How you would like to be contacted",
    "Contact method",
    "Preferred contact",
    "Contact preference"
  ]);
  let emailAddress = kind === "notification"
    ? (fieldAny(parts.preamble, ["Email", "E-mail"]) || customerAddress(email && email.reply_to))
    : (customerAddress(email && email.to) || fieldAny(parts.preamble, ["Email", "E-mail"]));
  if (!isSingleEmail(emailAddress) || emailAddress.toLowerCase() === BUSINESS_EMAIL) emailAddress = "";
  const createdAt = normalizeCreatedAt(email && email.created_at);
  return {
    kind: kind,
    name: cleanLine(fieldAny(parts.preamble, ["Name", "Full name", "Customer name", "Customer"]), 160),
    phone: cleanLine(fieldAny(parts.preamble, ["Phone", "Telephone", "Mobile", "Contact number"]), 40),
    email: emailAddress,
    vehicle: cleanLine(fieldAny(parts.preamble, ["Vehicle", "Car", "Vehicle details"]), 160),
    service: serviceFrom(parts.preamble, subject),
    source: "Website Form",
    notes: buildNotes(tidyMessage(parts.message), registration, contactMethod),
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
  if (!email || !email.id || !/^[A-Za-z0-9-]+$/.test(String(email.id))) return false;
  const subject = cleanLine(email.subject, 160);
  if (!subject) return true;
  return enquirySubject(subject);
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
