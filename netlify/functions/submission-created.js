// Netlify runs this on every verified form submission because the file is
// named submission-created. Built-in form notifications only email addresses
// set in the Netlify dashboard, so this emails the enquiry to the studio.
//
// Mail goes out through Resend (https://api.resend.com/emails).
// Netlify environment variable required: RESEND_API_KEY
// Do not put the key in the repo.
//
// Temporary: fxdetailing.co.uk is not verified, so From is Resend's test
// sender. That sender can only deliver to the Resend account inbox, and a
// send to the enquirer returns 403. Once the domain is verified, turn the
// enquirer acknowledgement back on and switch From back to
// FX Detailing <enquiries@fxdetailing.co.uk>.

const FORM_NAMES = {
  enquiry: true,
  "detailing-booking": true,
  ceramic: true
};

const FROM = "FX Detailing <onboarding@resend.dev>";
const REPLY_TO = "enquiries@fxdetailing.co.uk";
const BUSINESS_INBOX = "enquiries@fxdetailing.co.uk";
const SUBJECT = "We have received your FX Detailing enquiry";
const NOTIFY_SUBJECT = "New FX Detailing enquiry";

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

  lines.push("", "You wrote:", enquiry.message || "", "", "FX Detailing", REPLY_TO, "07548 703902", "Monday to Friday, 9am to 5pm", "The Barn, Westcoats Farm, Stan Hill, Charlwood, Surrey, RH6 0ES");

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
    "<p>FX Detailing<br>" + REPLY_TO + "<br>07548 703902<br>Monday to Friday, 9am to 5pm<br>The Barn, Westcoats Farm, Stan Hill, Charlwood, Surrey, RH6 0ES</p>"
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
  lines.push("", "Message:", enquiry.message || "");

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
    "<p><strong>Message:</strong><br>" + messageHtml + "</p>"
  ].join("");

  return { subject: NOTIFY_SUBJECT, text, html };
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

  // onboarding@resend.dev can only deliver to the Resend account inbox.
  // Do not also email the enquirer until fxdetailing.co.uk is verified.
  // Then turn this acknowledgement back on (prepared.mail, to the enquirer)
  // and set FROM back to FX Detailing <enquiries@fxdetailing.co.uk>.
  const notificationSent = await deliver(apiKey, {
    to: [BUSINESS_INBOX],
    replyTo: prepared.email,
    subject: prepared.notification.subject,
    text: prepared.notification.text,
    html: prepared.notification.html
  }, "business notification");

  if (!notificationSent) {
    return jsonResult(502, "Email was not sent");
  }
  return jsonResult(200, "Sent");
};
