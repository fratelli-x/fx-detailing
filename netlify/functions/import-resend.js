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
    .split(/\s+(?=(?:Name|Full name|Customer name|Customer|Email|E-mail|Phone|Telephone|Mobile|Contact number|Vehicle|Car|Vehicle details|Registration|Vehicle registration|Number plate|Reg|Page|Form|Message|You wrote|Your message|Enquiry|Notes|How they would like to be contacted|How you would like to be contacted|Contact method|Preferred contact|Contact preference|Kit already sourced|Monthly newsletter)\s*:)/i)[0]
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

function buildNotes(message, contactMethod) {
  const notes = [];
  const body = tidyMessage(message);
  if (body) notes.push(body);
  if (contactMethod) notes.push("Contact method: " + contactMethod);
  return notes.join("\n\n");
}

function newsletterAnswer(value) {
  const text = cleanLine(value, 8).toLowerCase();
  if (text === "yes") return "Yes";
  if (text === "no") return "No";
  return "";
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
  const registration = cleanLine(fieldAny(parts.preamble, ["Registration", "Vehicle registration", "Number plate", "Reg"]), 40);
  const newsletter = newsletterAnswer(fieldAny(parts.preamble, ["Monthly newsletter"]));
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
    notes: buildNotes(tidyMessage(parts.message), contactMethod),
    registration: registration,
    newsletter: newsletter,
    status: statusFor(createdAt),
    created_at: createdAt
  };
}

const DUPLICATE_WINDOW_MS = 15 * 60 * 1000;

function phoneKey(value) {
  return String(value || "").replace(/\D/g, "");
}

function sameVehicle(left, right) {
  const normalize = function (value) {
    return String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
  };
  return normalize(left) === normalize(right);
}

function sameNotes(left, right) {
  const normalize = function (value) {
    return String(value || "").replace(/\r\n/g, "\n").trim();
  };
  return normalize(left) === normalize(right);
}

function sameContact(leftEmail, leftPhone, rightEmail, rightPhone) {
  const email = String(leftEmail || "").trim().toLowerCase();
  const otherEmail = String(rightEmail || "").trim().toLowerCase();
  if (email && otherEmail && email === otherEmail) return true;
  const phone = phoneKey(leftPhone);
  const otherPhone = phoneKey(rightPhone);
  return Boolean(phone && otherPhone && phone === otherPhone);
}

function createdAtMs(value) {
  const time = Date.parse(normalizeCreatedAt(value) || value || "");
  return Number.isFinite(time) ? time : NaN;
}

function orderImports(rows) {
  return rows.slice().sort(function (a, b) {
    if (a.kind !== b.kind) return a.kind === "notification" ? -1 : 1;
    return Date.parse(a.created_at) - Date.parse(b.created_at);
  });
}

function isDuplicate(existing, row) {
  // Match only. Never updates a stored row, including Deleted rows and every folder.
  // The same person may enquire again later: email or phone alone is not enough.
  // Same enquiry when the Resend message id was already imported, created_at matches,
  // the same email or phone has the same notes, or the same email or phone has the
  // same vehicle and created_at is within 15 minutes.
  const rowId = String(row && row.resend_id || "");
  const rowTime = createdAtMs(row && row.created_at);
  for (let i = 0; i < existing.length; i++) {
    const item = existing[i] || {};
    const itemId = String(item.resend_id || "");
    if (rowId && itemId && rowId === itemId) return true;
    const itemTime = createdAtMs(item.created_at);
    if (Number.isFinite(rowTime) && rowTime === itemTime) return true;
    if (!sameContact(row && row.email, row && row.phone, item.email, item.phone)) continue;
    if (sameNotes(row && row.notes, item.notes)) return true;
    if (sameVehicle(row && row.vehicle, item.vehicle) && Number.isFinite(rowTime) && Number.isFinite(itemTime) && Math.abs(rowTime - itemTime) <= DUPLICATE_WINDOW_MS) {
      return true;
    }
  }
  return false;
}

function filledValue(value) {
  return String(value == null ? "" : value).trim() !== "";
}

function contactKeys(row) {
  const keys = [];
  const email = String(row && row.email || "").trim().toLowerCase();
  if (email) keys.push("e:" + email);
  const phone = phoneKey(row && row.phone);
  if (phone) keys.push("p:" + phone);
  return keys;
}

function vehiclesCompatible(left, right) {
  const normalize = function (value) {
    return String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
  };
  const a = normalize(left && left.vehicle);
  const b = normalize(right && right.vehicle);
  if (!a || !b) return true;
  return a === b;
}

function londonDay(ms) {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/London",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).format(new Date(ms));
  } catch (error) {
    return new Date(ms).toISOString().slice(0, 10);
  }
}

function duplicateTimes(left, right) {
  const leftTime = createdAtMs(left && left.created_at);
  const rightTime = createdAtMs(right && right.created_at);
  return {
    leftTime: leftTime,
    rightTime: rightTime,
    both: Number.isFinite(leftTime) && Number.isFinite(rightTime),
    gap: Number.isFinite(leftTime) && Number.isFinite(rightTime) ? Math.abs(leftTime - rightTime) : NaN
  };
}

// Same enquiry only. A later enquiry from the same person stays: different day,
// different vehicle, or different notes, unless the rows are the same created_at
// or the same vehicle within 15 minutes.
function duplicateCopy(left, right) {
  if (!left || !right || !sameContact(left.email, left.phone, right.email, right.phone)) return false;
  const times = duplicateTimes(left, right);
  const sameVehicleFilled = sameVehicle(left.vehicle, right.vehicle) && filledValue(left.vehicle);
  const sameTime = times.both && times.leftTime === times.rightTime;
  if (sameVehicleFilled && times.both && times.gap <= DUPLICATE_WINDOW_MS) return true;
  if (sameTime && vehiclesCompatible(left, right)) return true;
  if (sameNotes(left.notes, right.notes) && filledValue(left.notes) && vehiclesCompatible(left, right)) {
    if (!times.both || times.gap <= DUPLICATE_WINDOW_MS) return true;
    return londonDay(times.leftTime) === londonDay(times.rightTime);
  }
  return false;
}

function tightCopy(left, right) {
  if (!left || !right || !sameContact(left.email, left.phone, right.email, right.phone)) return false;
  const times = duplicateTimes(left, right);
  if (!times.both) return false;
  if (sameVehicle(left.vehicle, right.vehicle) && filledValue(left.vehicle) && times.gap <= DUPLICATE_WINDOW_MS) return true;
  return times.leftTime === times.rightTime && vehiclesCompatible(left, right);
}

function studioEdited(row) {
  // Import writes New or Completed, plus the customer's own notes, registration,
  // and newsletter. A studio edit is a different folder, or a field only the
  // inbox fills in. Registration alone is handled by the keeper choice so two
  // imported copies that both have a plate still collapse.
  if (!row || String(row.status || "") === "Deleted") return false;
  if (filledValue(row.our_notes) || filledValue(row.booking_date) || filledValue(row.courtesy_car)) return true;
  const status = String(row.status || "");
  if (!status) return true;
  return status !== statusFor(row.created_at);
}

function earlierRow(left, right) {
  const leftTime = createdAtMs(left && left.created_at);
  const rightTime = createdAtMs(right && right.created_at);
  const leftOk = Number.isFinite(leftTime);
  const rightOk = Number.isFinite(rightTime);
  if (leftOk && rightOk && leftTime !== rightTime) return leftTime < rightTime ? left : right;
  if (leftOk !== rightOk) return leftOk ? left : right;
  return String(left && left.id) <= String(right && right.id) ? left : right;
}

function earliestRow(rows) {
  let keeper = rows[0];
  for (let i = 1; i < rows.length; i++) keeper = earlierRow(keeper, rows[i]);
  return keeper;
}

function clusterBy(rows, linked) {
  const parent = rows.map(function (_, index) { return index; });
  function find(index) {
    while (parent[index] !== index) {
      parent[index] = parent[parent[index]];
      index = parent[index];
    }
    return index;
  }
  const buckets = {};
  for (let i = 0; i < rows.length; i++) {
    const keys = contactKeys(rows[i]);
    for (let k = 0; k < keys.length; k++) {
      if (!buckets[keys[k]]) buckets[keys[k]] = [];
      buckets[keys[k]].push(i);
    }
  }
  const bucketKeys = Object.keys(buckets);
  for (let b = 0; b < bucketKeys.length; b++) {
    const indexes = buckets[bucketKeys[b]];
    for (let i = 0; i < indexes.length; i++) {
      for (let j = i + 1; j < indexes.length; j++) {
        if (!linked(rows[indexes[i]], rows[indexes[j]])) continue;
        const left = find(indexes[i]);
        const right = find(indexes[j]);
        if (left !== right) parent[right] = left;
      }
    }
  }
  const groups = {};
  for (let i = 0; i < rows.length; i++) {
    const root = String(find(i));
    if (!groups[root]) groups[root] = [];
    groups[root].push(rows[i]);
  }
  const result = [];
  const roots = Object.keys(groups);
  for (let i = 0; i < roots.length; i++) {
    if (groups[roots[i]].length > 1) result.push(groups[roots[i]]);
  }
  return result;
}

function groupIsOneEnquiry(rows) {
  const times = [];
  for (let i = 0; i < rows.length; i++) {
    const time = createdAtMs(rows[i].created_at);
    if (Number.isFinite(time)) times.push(time);
  }
  if (!times.length) return false;
  let min = times[0];
  let max = times[0];
  for (let i = 1; i < times.length; i++) {
    if (times[i] < min) min = times[i];
    if (times[i] > max) max = times[i];
  }
  if (max - min <= DUPLICATE_WINDOW_MS) return true;
  if (!filledValue(rows[0].notes)) return false;
  for (let i = 1; i < rows.length; i++) {
    if (!sameNotes(rows[i].notes, rows[0].notes)) return false;
  }
  const day = londonDay(min);
  for (let i = 0; i < times.length; i++) {
    if (londonDay(times[i]) !== day) return false;
  }
  for (let i = 1; i < rows.length; i++) {
    if (!vehiclesCompatible(rows[i], rows[0])) return false;
  }
  return true;
}

function hideIdsForGroup(group) {
  if (!group || group.length < 2) return [];
  const studio = [];
  for (let i = 0; i < group.length; i++) {
    if (studioEdited(group[i])) studio.push(group[i]);
  }
  let keeper = null;
  if (studio.length === 1) {
    keeper = studio[0];
  } else if (studio.length === 0) {
    const withReg = [];
    for (let i = 0; i < group.length; i++) {
      if (filledValue(group[i].registration)) withReg.push(group[i]);
    }
    if (withReg.length === 1) {
      keeper = withReg[0];
    } else {
      const withNews = [];
      for (let i = 0; i < group.length; i++) {
        if (filledValue(group[i].newsletter)) withNews.push(group[i]);
      }
      keeper = withNews.length === 1 ? withNews[0] : earliestRow(group);
    }
  }
  const hide = [];
  for (let i = 0; i < group.length; i++) {
    const row = group[i];
    if (keeper && row === keeper) continue;
    if (studioEdited(row)) continue;
    if (row.id == null || row.id === "") continue;
    hide.push(row.id);
  }
  return hide;
}

function planDuplicateHides(rows) {
  // Read every folder, including Deleted. Deleted rows are not candidates and
  // are never written back, so a later import cannot resurrect them.
  if (!Array.isArray(rows) || !rows.length) return [];
  const live = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.id == null || row.id === "") continue;
    if (String(row.status || "") === "Deleted") continue;
    live.push(row);
  }
  const groups = clusterBy(live, duplicateCopy);
  const hide = [];
  const seen = {};
  for (let g = 0; g < groups.length; g++) {
    const parts = groupIsOneEnquiry(groups[g]) ? [groups[g]] : clusterBy(groups[g], tightCopy);
    for (let p = 0; p < parts.length; p++) {
      const ids = hideIdsForGroup(parts[p]);
      for (let k = 0; k < ids.length; k++) {
        const id = String(ids[k]);
        if (seen[id]) continue;
        seen[id] = true;
        hide.push(ids[k]);
      }
    }
  }
  return hide;
}

async function loadCleanupRows(supabase) {
  const rows = [];
  const pageSize = 1000;
  for (let from = 0; from < 20000; from += pageSize) {
    const result = await supabase
      .from("enquiries")
      .select("id,created_at,email,phone,notes,vehicle,status,our_notes,booking_date,courtesy_car,registration,newsletter")
      .range(from, from + pageSize - 1);
    if (result.error) return null;
    const batch = result.data || [];
    for (let i = 0; i < batch.length; i++) rows.push(batch[i]);
    if (batch.length < pageSize) break;
  }
  return rows;
}

async function hideExtraCopies(supabase) {
  // Status only, and only on the extra copy. Safe to repeat: once that copy is
  // Deleted it is no longer a live row, so the next import hides nothing new.
  try {
    const rows = await loadCleanupRows(supabase);
    if (!rows) {
      console.error("Duplicate cleanup failed");
      return;
    }
    const ids = planDuplicateHides(rows);
    for (let from = 0; from < ids.length; from += 50) {
      const chunk = ids.slice(from, from + 50);
      const updated = await supabase
        .from("enquiries")
        .update({ status: "Deleted" })
        .in("id", chunk)
        .in("status", ["New", "Completed"]);
      if (updated.error) console.error("Duplicate cleanup failed");
    }
  } catch (error) {
    console.error("Duplicate cleanup failed");
  }
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
  // Every stored enquiry, including Deleted and every folder. Read only.
  const rows = [];
  const pageSize = 1000;
  for (let from = 0; from < 20000; from += pageSize) {
    const { data, error } = await supabase
      .from("enquiries")
      .select("created_at,email,phone,notes,vehicle")
      .range(from, from + pageSize - 1);
    if (error) return { ok: false, rows: rows };
    const batch = data || [];
    for (let i = 0; i < batch.length; i++) rows.push(batch[i]);
    if (batch.length < pageSize) break;
  }
  return { ok: true, rows: rows };
}

function rememberImported(existing, stored, resendId, source) {
  // In-memory only. created_at and vehicle stay available for the duplicate check
  // even when the insert had to omit created_at.
  const from = source || {};
  const remembered = Object.assign({}, from, stored);
  const messageId = resendId || from.resend_id || remembered.resend_id;
  if (messageId) remembered.resend_id = messageId;
  delete remembered.kind;
  existing.push(remembered);
}

async function insertParsed(supabase, existing, row, counts) {
  if (isDuplicate(existing, row)) {
    counts.skippedDuplicates += 1;
    // Keep the seen message in this run so the paired acknowledgement is not inserted.
    // This does not write to the stored row.
    rememberImported(existing, row, row && row.resend_id, row);
    return;
  }
  // Insert only. Never update status, notes, our_notes, registration, newsletter,
  // booking_date, courtesy_car, name, phone, email, vehicle, service, source, or created_at.
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
  if (row.registration) insert.registration = row.registration;
  if (row.newsletter) insert.newsletter = row.newsletter;
  if (row.created_at) insert.created_at = row.created_at;
  const stored = await storeNewEnquiry(supabase, insert);
  if (!stored) {
    console.error("Supabase import insert failed");
    counts.failed += 1;
    return;
  }
  rememberImported(existing, stored, row.resend_id, row);
  counts.imported += 1;
}

function withoutColumns(row, keys) {
  const copy = Object.assign({}, row);
  for (let i = 0; i < keys.length; i++) delete copy[keys[i]];
  return copy;
}

async function storeNewEnquiry(supabase, insert) {
  // New row only. Drop created_at only when that insert is rejected, then drop
  // registration and newsletter only when those columns are rejected.
  const attempts = [insert];
  if (insert.created_at) attempts.push(withoutColumns(insert, ["created_at"]));
  if (insert.registration || insert.newsletter) {
    const dropFields = withoutColumns(insert, ["registration", "newsletter"]);
    attempts.push(dropFields);
    if (dropFields.created_at) attempts.push(withoutColumns(dropFields, ["created_at"]));
  }
  for (let i = 0; i < attempts.length; i++) {
    const result = await supabase.from("enquiries").insert(attempts[i]);
    if (!result.error) return attempts[i];
  }
  return null;
}

exports.parseEnquiryEmail = parseEnquiryEmail;
exports.isDuplicate = isDuplicate;
exports.planDuplicateHides = planDuplicateHides;
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
    await hideExtraCopies(supabase);
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
