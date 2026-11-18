// Password-protected inbox for the enquiries table.
// Requires ADMIN_PASSWORD, SUPABASE_URL, and SUPABASE_SERVICE_KEY.
// Same-origin only: do not add Access-Control-Allow-Origin.

const { createClient } = require("@supabase/supabase-js");

const STATUSES = { New: true, Quoted: true, Booked: true, Completed: true };

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
      return respond(200, data || []);
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
      const row = {
        name: name,
        phone: cleanLine(body.phone, 40),
        email: email,
        vehicle: cleanLine(body.vehicle, 160),
        service: cleanLine(body.service, 80),
        source: cleanLine(body.source, 80),
        notes: cleanText(body.notes, 4000),
        status: "New"
      };
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
      if (!hasStatus && !hasNotes) return respond(400, { error: "Nothing to update" });
      const patch = {};
      if (hasStatus) {
        const status = cleanLine(body.status, 40);
        if (!STATUSES[status]) return respond(400, { error: "Invalid status" });
        patch.status = status;
      }
      if (hasNotes) patch.notes = cleanText(body.notes, 4000);
      const { data, error } = await supabase
        .from("enquiries")
        .update(patch)
        .eq("id", id)
        .select()
        .single();
      if (error) {
        if (error.code === "PGRST116") return respond(404, { error: "Enquiry not found" });
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
      const { data, error } = await supabase
        .from("enquiries")
        .delete()
        .eq("id", id)
        .select("id");
      if (error) return respond(500, { error: "Inbox unavailable" });
      if (!data || data.length !== 1) return respond(404, { error: "Enquiry not found" });
      return respond(200, { id: data[0].id });
    }

    return respond(405, { error: "Method not allowed" });
  } catch (error) {
    console.error("Enquiries request failed");
    return respond(500, { error: "Inbox unavailable" });
  }
};
