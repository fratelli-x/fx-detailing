// Password-protected inbox for the enquiries table.
// Requires ADMIN_PASSWORD, SUPABASE_URL, and SUPABASE_SERVICE_KEY.
// Same-origin only: do not add Access-Control-Allow-Origin.

const { createClient } = require("@supabase/supabase-js");

const STATUSES = { New: true, Replied: true, Quoted: true, Booked: true, Completed: true, "Not Interested": true };

function cleanText(value, max) {
  return String(value == null ? "" : value)
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .trim()
    .slice(0, max);
}

function cleanLine(value, max) {
  return cleanText(value, max).replace(/[\s\u0009\u000A\u000D]+/g, " ").trim();
}

function isSingleEmail(value) {
  if (!value || value.length > 254) return false;
  if (/[\s,;<>]/.test(value)) return false;
  return /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(value);
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
  const provided = headerValue(event, "x-admin-password");
  return provided === expected;
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

function readJson(event) {
  const raw = event && event.body ? event.body : "";
  const text = event && event.isBase64Encoded ? Buffer.from(raw, "base64").toString("utf8") : raw;
  if (!text) return {};
  const parsed = JSON.parse(text);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  return parsed;
}

function supabaseClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
}

function cleanId(value) {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  const id = cleanLine(value, 80);
  if (!id || !/^[A-Za-z0-9-]+$/.test(id)) return "";
  return id;
}

function cleanBookingDate(value) {
  if (value == null) return null;
  const text = cleanLine(value, 40);
  if (!text) return null;
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const utc = new Date(Date.UTC(year, month - 1, day));
  if (utc.getUTCFullYear() !== year || utc.getUTCMonth() !== month - 1 || utc.getUTCDate() !== day) return false;
  return match[1] + "-" + match[2] + "-" + match[3];
}

function cleanCourtesy(value) {
  if (value == null) return null;
  const text = cleanLine(value, 8);
  if (!text) return null;
  if (text !== "Yes" && text !== "No") return false;
  return text;
}

function cleanRegistration(value) {
  if (value == null) return null;
  const text = cleanLine(value, 40);
  return text || null;
}

function cleanNewsletter(value) {
  if (value == null) return null;
  const text = cleanLine(value, 8);
  if (!text) return null;
  if (text.toLowerCase() === "yes") return "Yes";
  if (text.toLowerCase() === "no") return "No";
  return false;
}

function cleanEnquiryCreatedAt(value) {
  if (value == null) return null;
  const text = cleanLine(value, 40);
  if (!text) return null;
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const utc = new Date(Date.UTC(year, month - 1, day));
  if (utc.getUTCFullYear() !== year || utc.getUTCMonth() !== month - 1 || utc.getUTCDate() !== day) return false;
  return match[1] + "-" + match[2] + "-" + match[3] + "T12:00:00.000Z";
}

exports.handler = async function (event) {
  if (!authorized(event)) return respond(401, { error: "Unauthorized" });

  const method = event && event.httpMethod ? event.httpMethod.toUpperCase() : "";
  const supabase = supabaseClient();
  if (!supabase) return respond(500, { error: "Inbox unavailable" });

  try {
    if (method === "GET") {
      const { data, error } = await supabase
        .from("enquiries")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) return respond(500, { error: "Inbox unavailable" });
      const visible = (data || []).filter(function (row) {
        return row && String(row.status || "") !== "Deleted";
      });
      return respond(200, visible);
    }

    if (method === "POST") {
      let body;
      try {
        body = readJson(event);
      } catch (error) {
        return respond(400, { error: "Invalid JSON" });
      }
      const name = cleanLine(body.name, 160);
      if (!name) return respond(400, { error: "Name is required" });
      const email = cleanLine(body.email, 254);
      if (email && !isSingleEmail(email)) return respond(400, { error: "Invalid email" });
      const createdAt = cleanEnquiryCreatedAt(body.enquiry_date);
      if (createdAt === false) return respond(400, { error: "Invalid enquiry date" });
      const newsletter = cleanNewsletter(body.newsletter);
      if (newsletter === false) return respond(400, { error: "Invalid newsletter" });
      const row = {
        name: name,
        phone: cleanLine(body.phone, 40),
        email: email,
        vehicle: cleanLine(body.vehicle, 160),
        service: cleanLine(body.service, 80),
        source: cleanLine(body.source, 80),
        notes: cleanText(body.notes, 4000),
        registration: cleanRegistration(body.registration),
        our_notes: cleanText(body.our_notes, 4000) || null,
        address: cleanText(body.address, 2000) || null,
        newsletter: newsletter,
        status: "New"
      };
      if (createdAt) row.created_at = createdAt;
      const { data, error } = await supabase.from("enquiries").insert(row).select().single();
      if (error) return respond(500, { error: "Inbox unavailable" });
      return respond(201, data);
    }

    if (method === "PATCH") {
      let body;
      try {
        body = readJson(event);
      } catch (error) {
        return respond(400, { error: "Invalid JSON" });
      }
      const id = cleanId(body.id);
      if (!id) return respond(400, { error: "Missing id" });
      const hasStatus = Object.prototype.hasOwnProperty.call(body, "status");
      const hasNotes = Object.prototype.hasOwnProperty.call(body, "notes");
      const hasBooking = Object.prototype.hasOwnProperty.call(body, "booking_date");
      const hasCourtesy = Object.prototype.hasOwnProperty.call(body, "courtesy_car");
      const hasRegistration = Object.prototype.hasOwnProperty.call(body, "registration");
      const hasOurNotes = Object.prototype.hasOwnProperty.call(body, "our_notes");
      const hasNewsletter = Object.prototype.hasOwnProperty.call(body, "newsletter");
      const hasName = Object.prototype.hasOwnProperty.call(body, "name");
      const hasPhone = Object.prototype.hasOwnProperty.call(body, "phone");
      const hasEmail = Object.prototype.hasOwnProperty.call(body, "email");
      const hasVehicle = Object.prototype.hasOwnProperty.call(body, "vehicle");
      const hasService = Object.prototype.hasOwnProperty.call(body, "service");
      const hasSource = Object.prototype.hasOwnProperty.call(body, "source");
      const hasAddress = Object.prototype.hasOwnProperty.call(body, "address");
      if (!hasStatus && !hasNotes && !hasBooking && !hasCourtesy && !hasRegistration && !hasOurNotes && !hasNewsletter && !hasName && !hasPhone && !hasEmail && !hasVehicle && !hasService && !hasSource && !hasAddress) {
        return respond(400, { error: "Nothing to update" });
      }
      const patch = {};
      if (hasStatus) {
        const status = cleanLine(body.status, 40);
        if (status === "Deleted" || !STATUSES[status]) return respond(400, { error: "Invalid status" });
        patch.status = status;
      }
      if (hasName) patch.name = cleanLine(body.name, 160);
      if (hasPhone) patch.phone = cleanLine(body.phone, 40);
      if (hasEmail) {
        const email = cleanLine(body.email, 254);
        if (email && !isSingleEmail(email)) return respond(400, { error: "Invalid email" });
        patch.email = email;
      }
      if (hasVehicle) patch.vehicle = cleanLine(body.vehicle, 160);
      if (hasService) patch.service = cleanLine(body.service, 80);
      if (hasSource) patch.source = cleanLine(body.source, 80);
      if (hasNotes) patch.notes = cleanText(body.notes, 4000);
      if (hasBooking) {
        const booking = cleanBookingDate(body.booking_date);
        if (booking === false) return respond(400, { error: "Invalid booking date" });
        patch.booking_date = booking;
      }
      if (hasCourtesy) {
        const courtesy = cleanCourtesy(body.courtesy_car);
        if (courtesy === false) return respond(400, { error: "Invalid courtesy car" });
        patch.courtesy_car = courtesy;
      }
      if (hasRegistration) patch.registration = cleanRegistration(body.registration);
      if (hasOurNotes) patch.our_notes = cleanText(body.our_notes, 4000) || null;
      if (hasAddress) patch.address = cleanText(body.address, 2000) || null;
      if (hasNewsletter) {
        const newsletter = cleanNewsletter(body.newsletter);
        if (newsletter === false) return respond(400, { error: "Invalid newsletter" });
        patch.newsletter = newsletter;
      }
      const request = supabase.from("enquiries").update(patch).eq("id", id).or("status.is.null,status.neq.Deleted");
      const { data, error } = await request.select().single();
      if (error) {
        if (error.code === "PGRST116") {
          const lookup = await supabase.from("enquiries").select("status").eq("id", id).limit(1);
          if (!lookup.error && lookup.data && lookup.data[0] && lookup.data[0].status === "Deleted") {
            return respond(400, { error: hasStatus ? "Invalid status" : "Enquiry not found" });
          }
          return respond(404, { error: "Enquiry not found" });
        }
        return respond(500, { error: "Inbox unavailable" });
      }
      return respond(200, data);
    }

    if (method === "DELETE") {
      let body = {};
      if (event && event.body) {
        try {
          body = readJson(event);
        } catch (error) {
          return respond(400, { error: "Invalid JSON" });
        }
      }
      const query = event && event.queryStringParameters ? event.queryStringParameters : null;
      const queryId = query && !Array.isArray(query.id) ? query.id : "";
      const rawId = body && Object.prototype.hasOwnProperty.call(body, "id") && body.id != null && body.id !== ""
        ? body.id
        : queryId;
      if (Array.isArray(rawId)) return respond(400, { error: "Missing id" });
      const id = cleanId(rawId);
      if (!id) return respond(400, { error: "Missing id" });
      const found = await supabase.from("enquiries").select("id,status").eq("id", id).limit(1);
      if (found.error) return respond(500, { error: "Inbox unavailable" });
      if (!found.data || found.data.length !== 1) return respond(404, { error: "Enquiry not found" });
      if (found.data[0].status === "Deleted") return respond(200, { id: found.data[0].id });
      const updated = await supabase
        .from("enquiries")
        .update({ status: "Deleted" })
        .eq("id", id)
        .select("id");
      if (updated.error) return respond(500, { error: "Inbox unavailable" });
      if (!updated.data || updated.data.length !== 1) return respond(404, { error: "Enquiry not found" });
      return respond(200, { id: updated.data[0].id });
    }

    return respond(405, { error: "Method not allowed" });
  } catch (error) {
    console.error("Enquiries request failed");
    return respond(500, { error: "Inbox unavailable" });
  }
};
