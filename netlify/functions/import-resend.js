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

function bareSubject(subject) {
  return String(subject || "").trim().replace(/[.!\s]+$/, "");
}

function enquirySubject(subject) {
  const bare = bareSubject(subject);
  return Boolean(
    SUBJECT_SERVICE[subject] ||
    SUBJECT_SERVICE[bare] ||
    subject === OLD_ACK_SUBJECT ||
    subject === OLD_NOTIFY_SUBJECT ||
    bare === OLD_ACK_SUBJECT ||
    bare === OLD_NOTIFY_SUBJECT
  );
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

function labelScore(text) {
  const body = String(text || "").toLowerCase();
  const labels = ["name:", "email:", "phone:", "vehicle:", "message:", "you wrote:", "page:", "form:", "registration:"];
  let score = 0;
  for (let i = 0; i < labels.length; i++) {
    if (body.indexOf(labels[i]) !== -1) score += 1;
  }
  return score;
}

function emailBody(detail) {
  const text = detail && typeof detail.text === "string"
    ? detail.text.replace(/\r\n/g, "\n").replace(/\r/g, "\n")
    : "";
  const html = detail && typeof detail.html === "string" && detail.html.trim() ? htmlToText(detail.html) : "";
  if (labelScore(html) > labelScore(text)) return html;
  if (text.trim()) return text;
  return html;
}

function field(preamble, label) {
  const source = String(preamble || "");
  const prefix = String(label || "").toLowerCase() + ":";
  const lines = source.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.toLowerCase().indexOf(prefix) === 0) return line.slice(prefix.length).trim();
  }
  const escaped = String(label || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = source.match(new RegExp("(?:^|\\s)" + escaped + "\\s*:\\s*([^\\n]+)", "i"));
  if (!match) return "";
  return match[1]
    .split(/\s+(?=(?:Name|Full name|Customer name|Customer|Email|E-mail|Phone|Telephone|Mobile|Contact number|Vehicle|Car|Vehicle details|Registration|Vehicle registration|Number plate|Reg|Page|Form|Message|You wrote|Your message|Enquiry|Notes|How they would like to be contacted|How you would like to be contacted|Contact method|Preferred contact|Contact preference|Kit already sourced)\s*:)/i)[0]
    .trim();
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
  if (at === -1) {
    const inline = source.toLowerCase().indexOf(String(label || "").toLowerCase());
    if (inline === -1) return null;
    return {
      preamble: source.slice(0, inline),
      message: cutSignature(source.slice(inline + label.length).replace(/^[\s:]+/, ""))
    };
  }
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
  return SUBJECT_SERVICE[subject] || SUBJECT_SERVICE[bareSubject(subject)] || "";
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
  // Match only. Never updates a stored row, including Deleted and both folders.
  // Skip when created_at matches, or the same email or phone has the same notes,
  // or this Resend message was already seen. Email or phone alone is not enough.
  const rowId = String(row && row.resend_id || "");
  const rowTime = Date.parse(row.created_at);
  const rowEmail = String(row.email || "").trim().toLowerCase();
  const rowPhone = phoneKey(row.phone);
  const rowNotes = String(row.notes || "").replace(/\r\n/g, "\n");
  for (let i = 0; i < existing.length; i++) {
    const item = existing[i] || {};
    if (rowId && item.resend_id && rowId === String(item.resend_id)) return true;
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

function resendFailure(status, body) {
  const message = body && typeof body.message === "string" ? body.message : "";
  const lowered = message.toLowerCase();
  if (status === 403 || /full access|sending access|restricted_api_key|restricted to only send/.test(lowered)) {
    return "The Resend key needs Full access, not Sending access only.";
  }
  const clean = message
    .replace(/re_[A-Za-z0-9_-]+/g, "")
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (clean) return clean.slice(0, 240);
  return "Resend did not return the sent emails.";
}

function delay(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

async function resendGet(apiKey, url) {
  let last = { ok: false, status: 0, body: null };
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
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
      last = { ok: response.ok, status: response.status, body: body };
      if (response.ok || (response.status !== 429 && response.status < 500)) return last;
    } catch (error) {
      last = { ok: false, status: 0, body: null };
    }
    await delay(300 * (attempt + 1));
  }
  return last;
}

function listPayload(body) {
  if (Array.isArray(body)) return { data: body, hasMore: null };
  const root = body && typeof body === "object" ? body : {};
  if (Array.isArray(root.data)) return { data: root.data, hasMore: root.has_more };
  if (root.data && typeof root.data === "object" && Array.isArray(root.data.data)) {
    const nestedMore = root.data.has_more != null ? root.data.has_more : root.has_more;
    return { data: root.data.data, hasMore: nestedMore };
  }
  return { data: [], hasMore: root.has_more };
}

function hasMoreFalse(value) {
  return value === false || value === "false" || value === 0;
}

function emailTime(value) {
  const time = Date.parse(normalizeCreatedAt(value) || value || "");
  return Number.isFinite(time) ? time : 0;
}

async function listSentEmails(apiKey, options) {
  // Resend returns the list newest first. `after` then walks older pages.
  const recent = !!(options && options.recent);
  const knownTime = options && options.knownTime;
  const emails = [];
  const seen = {};
  let after = "";
  let previousCursor = "";
  const pageLimit = recent ? 8 : 200;
  for (let page = 0; page < pageLimit; page++) {
    const url = "https://api.resend.com/emails?limit=100" + (after ? "&after=" + encodeURIComponent(after) : "");
    const result = await resendGet(apiKey, url);
    if (!result.ok) {
      const message = resendFailure(result.status, result.body);
      if (!emails.length) return { ok: false, status: result.status, message: message, emails: emails };
      return { ok: true, status: 200, emails: emails, warning: message, warningStatus: result.status };
    }
    const payload = listPayload(result.body);
    const data = payload.data;
    let added = 0;
    let candidateCount = 0;
    let unknownCount = 0;
    for (let i = 0; i < data.length; i++) {
      const email = data[i];
      if (!email || !email.id || seen[email.id]) continue;
      seen[email.id] = true;
      added += 1;
      if (recent && knownTime) {
        if (!isCandidate(email)) continue;
        candidateCount += 1;
        if (knownTime(emailTime(email.created_at))) continue;
        unknownCount += 1;
      }
      emails.push(email);
    }
    const cursor = data.length ? String(data[data.length - 1].id || "") : "";
    if (!cursor || cursor === previousCursor || added === 0) break;
    if (recent && candidateCount > 0 && unknownCount === 0) break;
    if (hasMoreFalse(payload.hasMore) && data.length < 20) break;
    previousCursor = cursor;
    after = cursor;
  }
  return { ok: true, status: 200, emails: emails };
}

function isCandidate(email) {
  if (!email || !email.id || !/^[A-Za-z0-9_-]+$/.test(String(email.id))) return false;
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
      try {
        results[current] = await fn(items[current]);
      } catch (error) {
        results[current] = { failed: true };
      }
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
  // Every stored enquiry, including Deleted and both folders. Read only.
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

function rememberImported(existing, stored, resendId) {
  const remembered = Object.assign({}, stored);
  if (resendId) remembered.resend_id = resendId;
  existing.push(remembered);
}

async function insertParsed(supabase, existing, row, counts) {
  if (isDuplicate(existing, row)) {
    counts.skippedDuplicates += 1;
    return;
  }
  // Insert only. Never update status, notes, booking_date, courtesy_car,
  // name, phone, email, vehicle, service, source, or created_at.
  const insert = {
    name: row.name,
    phone: row.phone,
    email: row.email,
    vehicle: row.vehicle,
    service: row.service,
    source: "Website Form",
    notes: String(row.notes || "").slice(0, 8000),
    status: row.status
  };
  if (row.created_at) insert.created_at = row.created_at;
  let result = await supabase.from("enquiries").insert(insert);
  if (result.error && insert.created_at) {
    const fallback = {
      name: insert.name,
      phone: insert.phone,
      email: insert.email,
      vehicle: insert.vehicle,
      service: insert.service,
      source: insert.source,
      notes: insert.notes,
      status: insert.status
    };
    const retry = await supabase.from("enquiries").insert(fallback);
    if (!retry.error) {
      rememberImported(existing, fallback, row.resend_id);
      counts.imported += 1;
      return;
    }
  }
  if (result.error) {
    console.error("Supabase import insert failed");
    counts.failed += 1;
    return;
  }
  rememberImported(existing, insert, row.resend_id);
  counts.imported += 1;
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

  let recent = false;
  if (event && event.body) {
    try {
      const raw = event.isBase64Encoded ? Buffer.from(event.body, "base64").toString("utf8") : event.body;
      const parsed = raw ? JSON.parse(raw) : {};
      recent = !!(parsed && parsed.recent === true);
    } catch (error) {
      recent = false;
    }
  }

  try {
    const existingResult = await loadExisting(supabase);
    if (!existingResult.ok) return respond(500, Object.assign(counts, { error: "Inbox unavailable" }));
    const existing = existingResult.rows;
    const known = {};
    for (let i = 0; i < existing.length; i++) {
      const time = emailTime(existing[i] && existing[i].created_at);
      if (time) known[time] = true;
    }
    const listed = await listSentEmails(apiKey, {
      recent: recent,
      knownTime: recent ? function (time) { return !!known[time]; } : null
    });
    if (!listed.ok) {
      counts.resendStatus = listed.status;
      counts.error = listed.message || resendFailure(listed.status, null);
      return respond(listed.status || 502, counts);
    }
    if (listed.warning) {
      counts.error = listed.warning;
      counts.resendStatus = listed.warningStatus || null;
    }
    counts.listed = listed.emails.length;
    const candidates = listed.emails.filter(isCandidate).sort(function (a, b) {
      return Date.parse(a.created_at || 0) - Date.parse(b.created_at || 0);
    });
    counts.skippedNotEnquiry = counts.listed - candidates.length;

    const acknowledgements = [];
    let insertChain = Promise.resolve();
    let blockedStatus = 0;

    function queueInsert(row) {
      insertChain = insertChain.then(function () {
        return insertParsed(supabase, existing, row, counts);
      });
      return insertChain;
    }

    await mapPool(candidates, 4, async function (item) {
      if (blockedStatus) return { blocked: true };
      const result = await resendGet(apiKey, "https://api.resend.com/emails/" + encodeURIComponent(item.id));
      if (result.status === 403) {
        blockedStatus = 403;
        return { blocked: true };
      }
      if (!result.ok) return { failed: true, status: result.status };
      const detail = result.body || {};
      if (!detail.created_at) detail.created_at = item.created_at;
      if (!detail.subject) detail.subject = item.subject;
      if (!detail.to) detail.to = item.to;
      if (!detail.reply_to) detail.reply_to = item.reply_to;
      const parsed = parseEnquiryEmail(detail);
      if (!parsed) return { skip: true };
      parsed.resend_id = String((detail && detail.id) || item.id || "");
      if (parsed.kind === "acknowledgement") {
        acknowledgements.push(parsed);
        return { held: true };
      }
      await queueInsert(parsed);
      return { saved: true };
    }).then(function (details) {
      for (let i = 0; i < details.length; i++) {
        const item = details[i];
        if (!item || item.blocked || item.saved || item.held) continue;
        if (item.failed) {
          counts.failed += 1;
          if (!counts.resendStatus) counts.resendStatus = item.status;
          continue;
        }
        if (item.skip) counts.skippedNotEnquiry += 1;
      }
    });

    await insertChain;
    const orderedAcks = orderImports(acknowledgements);
    for (let i = 0; i < orderedAcks.length; i++) {
      await insertParsed(supabase, existing, orderedAcks[i], counts);
    }

    if (blockedStatus === 403) {
      counts.resendStatus = 403;
      counts.error = resendFailure(403, null);
      return respond(403, counts);
    }

    return respond(200, counts);
  } catch (error) {
    console.error("Resend import failed");
    return respond(500, Object.assign(counts, { error: "Inbox unavailable" }));
  }
};
