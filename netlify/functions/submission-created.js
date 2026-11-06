// Netlify runs this on every verified form submission because the file is
// named submission-created. Built-in form notifications only email addresses
// set in the Netlify dashboard, so this sends two messages: an acknowledgement
// to the address on that submission, and the enquiry details to the studio.
//
// Mail goes out through Resend (https://api.resend.com/emails).
// Netlify environment variable required: RESEND_API_KEY
// Do not put the key in the repo. fxdetailing.co.uk is verified, so messages
// are sent from enquiries@fxdetailing.co.uk.

const FORM_NAMES = {
  enquiry: true,
  "detailing-booking": true,
  ceramic: true
};

const FROM = "FX Detailing <enquiries@fxdetailing.co.uk>";
const REPLY_TO = "enquiries@fxdetailing.co.uk";
const BUSINESS_INBOX = "enquiries@fxdetailing.co.uk";
const SUBJECT = "We have received your FX Detailing enquiry";
const NOTIFY_SUBJECT = "New FX Detailing enquiry";
const LOGO_URL = "https://www.fxdetailing.co.uk/images/logo.png";
const TEL_DISPLAY = "01293 981474";
const MOB_DISPLAY = "07548 703902";
const WEB_DISPLAY = "www.fxdetailing.co.uk";
const ADDRESS = "The Barn, Westcoats Farm, Stan Hill, Charlwood, Surrey, RH6 0ES";
const HOURS = "Monday to Friday, 9am to 5pm";

function cleanLine(value, max) {
  return String(value == null ? "" : value)
    .replace(/[\u0000-\u001F\u007F]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function cleanMessage(value, max) {
  return String(value == null ? "" : value)
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .trim()
    .slice(0, max);
}

function fieldValue(data, key) {
  if (!data || data[key] == null) return "";
  const value = data[key];
  if (Array.isArray(value)) return value.map((item) => String(item)).join("\n");
  return String(value);
}

function isSingleEmail(value) {
  if (!value || value.length > 254) return false;
  if (/[\s,;<>]/.test(value)) return false;
  return /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(value);
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function readPayload(event) {
  const raw = event && event.body;
  const parsed = typeof raw === "string" ? JSON.parse(raw || "{}") : (raw || {});
  if (parsed && parsed.payload) return parsed.payload;
  return parsed || {};
}

function prepareSend(event) {
  let payload;
  try {
    payload = readPayload(event);
  } catch (error) {
    return { action: "error", statusCode: 400, body: "Invalid JSON" };
  }

  const data = payload.data || {};
  const formName = cleanLine(payload.form_name, 80) || cleanLine(data["form-name"], 80);
  if (!FORM_NAMES[formName]) {
    return { action: "skip", statusCode: 200, body: "Ignored form" };
  }
  if (cleanLine(fieldValue(data, "bot-field"), 500)) {
    return { action: "skip", statusCode: 200, body: "Ignored honeypot" };
  }

  const email = cleanLine(fieldValue(data, "email"), 254) || cleanLine(payload.email, 254);
  if (!isSingleEmail(email)) {
    return { action: "skip", statusCode: 200, body: "Ignored empty email" };
  }

  const enquiry = {
    firstName: cleanLine(fieldValue(data, "first-name"), 80),
    lastName: cleanLine(fieldValue(data, "last-name"), 80),
    vehicle: cleanLine(fieldValue(data, "vehicle"), 160),
    registration: cleanLine(fieldValue(data, "registration"), 20),
    phone: cleanLine(fieldValue(data, "phone"), 40),
    contactMethod: cleanLine(fieldValue(data, "contact-method"), 40),
    message: cleanMessage(fieldValue(data, "message"), 4000)
  };

  return {
    action: "send",
    email,
    mail: buildAcknowledgement(enquiry),
    notification: buildNotification(enquiry, email, formName)
  };
}

function buildAcknowledgement(enquiry) {
  const greeting = enquiry.firstName ? "Hello " + enquiry.firstName + "," : "Hello,";
  const fullName = [enquiry.firstName, enquiry.lastName].filter(Boolean).join(" ");
  const lines = [
    greeting,
    "",
    "We have received your message and will come back to you during opening hours, Monday to Friday, 9am to 5pm. If it is urgent, call 07548 703902.",
    "",
    "Your enquiry"
  ];

  if (fullName) lines.push("Name: " + fullName);
  if (enquiry.phone) lines.push("Phone: " + enquiry.phone);
  if (enquiry.vehicle) lines.push("Vehicle: " + enquiry.vehicle);
  if (enquiry.registration) lines.push("Registration: " + enquiry.registration);
  if (enquiry.contactMethod) lines.push("How you would like to be contacted: " + enquiry.contactMethod);

  lines.push("", "You wrote:", enquiry.message || "", "", signatureText());

  const text = lines.join("\n");
  const details = [];
  if (fullName) details.push("Name: " + escapeHtml(fullName));
  if (enquiry.phone) details.push("Phone: " + escapeHtml(enquiry.phone));
  if (enquiry.vehicle) details.push("Vehicle: " + escapeHtml(enquiry.vehicle));
  if (enquiry.registration) details.push("Registration: " + escapeHtml(enquiry.registration));
  if (enquiry.contactMethod) details.push("How you would like to be contacted: " + escapeHtml(enquiry.contactMethod));

  const messageHtml = escapeHtml(enquiry.message || "").replace(/\n/g, "<br>");
  const html = [
    "<p>" + escapeHtml(greeting) + "</p>",
    "<p>We have received your message and will come back to you during opening hours, Monday to Friday, 9am to 5pm. If it is urgent, call <a href=\"tel:07548703902\">07548 703902</a>.</p>",
    "<p><strong>Your enquiry</strong><br>" + details.join("<br>") + "</p>",
    "<p><strong>You wrote:</strong><br>" + messageHtml + "</p>",
    signatureHtml()
  ].join("");

  return { subject: SUBJECT, text, html };
}

function buildNotification(enquiry, email, formName) {
  const fullName = [enquiry.firstName, enquiry.lastName].filter(Boolean).join(" ");
  const lines = [
    "New enquiry from the website.",
    "Form: " + formName,
    ""
  ];

  if (fullName) lines.push("Name: " + fullName);
  lines.push("Email: " + email);
  if (enquiry.phone) lines.push("Phone: " + enquiry.phone);
  if (enquiry.vehicle) lines.push("Vehicle: " + enquiry.vehicle);
  if (enquiry.registration) lines.push("Registration: " + enquiry.registration);
  if (enquiry.contactMethod) lines.push("How they would like to be contacted: " + enquiry.contactMethod);
  lines.push("", "Message:", enquiry.message || "", "", signatureText());

  const text = lines.join("\n");
  const details = [];
  if (fullName) details.push("Name: " + escapeHtml(fullName));
  details.push("Email: " + escapeHtml(email));
  if (enquiry.phone) details.push("Phone: " + escapeHtml(enquiry.phone));
  if (enquiry.vehicle) details.push("Vehicle: " + escapeHtml(enquiry.vehicle));
  if (enquiry.registration) details.push("Registration: " + escapeHtml(enquiry.registration));
  if (enquiry.contactMethod) details.push("How they would like to be contacted: " + escapeHtml(enquiry.contactMethod));

  const messageHtml = escapeHtml(enquiry.message || "").replace(/\n/g, "<br>");
  const html = [
    "<p>New enquiry from the website.<br>Form: " + escapeHtml(formName) + "</p>",
    "<p>" + details.join("<br>") + "</p>",
    "<p><strong>Message:</strong><br>" + messageHtml + "</p>",
    signatureHtml()
  ].join("");

  return { subject: NOTIFY_SUBJECT, text, html };
}

function signatureText() {
  return [
    "FX Detailing",
    "Tel: " + TEL_DISPLAY,
    "Mob: " + MOB_DISPLAY,
    "Email: " + REPLY_TO,
    "Web: " + WEB_DISPLAY,
    ADDRESS,
    HOURS
  ].join("\n");
}

function signatureHtml() {
  return [
    "<table role=\"presentation\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\" width=\"560\" style=\"max-width:560px;width:100%;margin-top:24px;\">",
    "<tr><td bgcolor=\"#000000\" style=\"background-color:#000000;padding:18px 20px;\">",
    "<img src=\"" + LOGO_URL + "\" alt=\"FX Detailing\" width=\"160\" style=\"display:block;width:160px;max-width:100%;height:auto;border:0;\">",
    "</td></tr>",
    "<tr><td style=\"padding:12px 0 0;font-family:Arial,sans-serif;font-size:14px;line-height:1.5;color:#111111;\">",
    "Tel: <a href=\"tel:01293981474\">" + TEL_DISPLAY + "</a><br>",
    "Mob: <a href=\"tel:07548703902\">" + MOB_DISPLAY + "</a><br>",
    "Email: <a href=\"mailto:" + REPLY_TO + "\">" + REPLY_TO + "</a><br>",
    "Web: <a href=\"https://www.fxdetailing.co.uk\">" + WEB_DISPLAY + "</a><br>",
    ADDRESS + "<br>",
    HOURS,
    "</td></tr>",
    "</table>"
  ].join("");
}

function jsonResult(statusCode, body) {
  return { statusCode, body };
}

exports.prepareSend = prepareSend;
exports.buildAcknowledgement = buildAcknowledgement;
exports.buildNotification = buildNotification;
exports.SUBJECT = SUBJECT;
exports.FROM = FROM;
exports.REPLY_TO = REPLY_TO;
exports.BUSINESS_INBOX = BUSINESS_INBOX;

async function sendResend(apiKey, message) {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + apiKey,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from: FROM,
      to: message.to,
      reply_to: message.replyTo,
      subject: message.subject,
      text: message.text,
      html: message.html
    })
  });
  if (!response.ok) {
    const detail = await response.text();
    return { ok: false, status: response.status, detail: detail.slice(0, 500) };
  }
  return { ok: true };
}

async function deliver(apiKey, message, label) {
  try {
    const result = await sendResend(apiKey, message);
    if (!result.ok) {
      console.error("Resend rejected the " + label, result.status, result.detail);
      return false;
    }
    return true;
  } catch (error) {
    console.error(label + " email failed");
    return false;
  }
}

exports.handler = async function (event) {
  const prepared = prepareSend(event);
  if (prepared.action !== "send") {
    return jsonResult(prepared.statusCode, prepared.body);
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.error("Missing RESEND_API_KEY. Enquiry emails were not sent.");
    return jsonResult(500, "Missing RESEND_API_KEY");
  }

  const acknowledgementSent = await deliver(apiKey, {
    to: [prepared.email],
    replyTo: REPLY_TO,
    subject: prepared.mail.subject,
    text: prepared.mail.text,
    html: prepared.mail.html
  }, "acknowledgement");

  const notificationSent = await deliver(apiKey, {
    to: [BUSINESS_INBOX],
    replyTo: prepared.email,
    subject: prepared.notification.subject,
    text: prepared.notification.text,
    html: prepared.notification.html
  }, "business notification");

  if (!acknowledgementSent || !notificationSent) {
    return jsonResult(502, "Email was not sent");
  }
  return jsonResult(200, "Sent");
};
