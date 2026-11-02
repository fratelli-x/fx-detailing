const crypto = require("crypto");

const PIXEL_ID = process.env.META_PIXEL_ID || "2042805043235208";

function hashData(value) {
  if (value === undefined || value === null) return "";
  const normalised = String(value).trim().toLowerCase();
  if (!normalised) return "";
  return crypto.createHash("sha256").update(normalised).digest("hex");
}

function normalizePhone(value) {
  let digits = String(value || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("44")) return digits;
  if (digits.startsWith("0")) digits = digits.slice(1);
  return "44" + digits;
}

function isAllowedRequest(headers) {
  const origin = headers.origin || headers.referer || headers.referrer || "";
  if (!origin) return false;
  let host = "";
  try {
    host = new URL(origin).hostname;
  } catch (error) {
    return false;
  }
  return host === "www.fxdetailing.co.uk"
    || host === "fxdetailing.co.uk"
    || host.endsWith(".netlify.app")
    || host === "localhost"
    || host === "127.0.0.1";
}

function json(statusCode, body) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  };
}

const PAGE_EVENTS = {
  LeadHomepage: { label: "Homepage", path: "/" },
  LeadContact: { label: "Contact", path: "/contact/" },
  LeadReviews: { label: "Reviews", path: "/reviews/" },
  LeadCeramic: { label: "Ceramic", path: "/ceramic/" },
  LeadDetailing: { label: "Detailing", path: "/detailing/" },
  LeadBodykits: { label: "Bodykits", path: "/bodykits/" }
};

const FORM_NAMES = { enquiry: true, ceramic: true, "detailing-booking": true, bodykits: true };

function eventSourceUrl(value) {
  return typeof value === "string" && value.startsWith("https://www.fxdetailing.co.uk")
    ? value.slice(0, 500)
    : "https://www.fxdetailing.co.uk/";
}

function buildLeadEvents(payload, userData) {
  const page = PAGE_EVENTS[payload.pageEvent];
  const customData = {
    content_name: page ? page.label : "Enquiry",
    source_page: page ? page.path : "/"
  };
  if (FORM_NAMES[payload.contentCategory]) customData.content_category = payload.contentCategory;

  const source = eventSourceUrl(payload.eventSourceUrl);
  const eventTime = Math.floor(Date.now() / 1000);
  const lead = {
    event_name: "Lead",
    event_time: eventTime,
    event_id: payload.eventId,
    action_source: "website",
    event_source_url: source,
    user_data: userData,
    custom_data: customData
  };
  if (!page) return [lead];
  return [
    lead,
    {
      event_name: payload.pageEvent,
      event_time: eventTime,
      event_id: payload.eventId,
      action_source: "website",
      event_source_url: source,
      user_data: userData,
      custom_data: customData
    }
  ];
}

exports.hashData = hashData;
exports.normalizePhone = normalizePhone;
exports.buildLeadEvents = buildLeadEvents;

exports.handler = async function (event) {
  if (event.httpMethod !== "POST") {
    return json(405, { error: "Method not allowed" });
  }

  const headers = event.headers || {};
  if (!isAllowedRequest(headers)) {
    return json(403, { error: "Forbidden" });
  }

  const accessToken = process.env.META_CAPI_TOKEN;
  if (!accessToken) {
    return json(500, { error: "Missing META_CAPI_TOKEN" });
  }

  let payload;
  try {
    payload = JSON.parse(event.body || "");
  } catch (error) {
    return json(400, { error: "Invalid JSON" });
  }

  if (!payload || payload.eventName !== "Lead" || typeof payload.eventId !== "string" || !/^[A-Za-z0-9_-]{8,80}$/.test(payload.eventId)) {
    return json(400, { error: "Invalid lead" });
  }

  const userData = {};
  const email = hashData(payload.email);
  const phone = hashData(normalizePhone(payload.phone));
  const firstName = hashData(payload.firstName);
  const lastName = hashData(payload.lastName);
  if (email) userData.em = [email];
  if (phone) userData.ph = [phone];
  if (firstName) userData.fn = [firstName];
  if (lastName) userData.ln = [lastName];
  if (payload.fbp) userData.fbp = String(payload.fbp).slice(0, 200);
  if (payload.fbc) userData.fbc = String(payload.fbc).slice(0, 200);

  const clientIp = headers["x-nf-client-connection-ip"] || headers["client-ip"];
  const userAgent = headers["user-agent"];
  if (clientIp) userData.client_ip_address = clientIp;
  if (userAgent) userData.client_user_agent = userAgent;

  const capiData = {
    data: buildLeadEvents(payload, userData)
  };

  if (process.env.META_TEST_EVENT_CODE) {
    capiData.test_event_code = process.env.META_TEST_EVENT_CODE;
  }

  try {
    const response = await fetch("https://graph.facebook.com/v19.0/" + encodeURIComponent(PIXEL_ID) + "/events?access_token=" + encodeURIComponent(accessToken), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(capiData)
    });
    if (!response.ok) {
      return json(502, { error: "Meta did not accept the event" });
    }
    return json(200, { ok: true });
  } catch (error) {
    return json(502, { error: "Meta did not accept the event" });
  }
};
