const toggle = document.querySelector(".menu-toggle");
const nav = document.querySelector(".nav");
if (toggle && nav) {
  toggle.addEventListener("click", () => {
    const open = nav.classList.toggle("open");
    toggle.setAttribute("aria-expanded", open ? "true" : "false");
  });
  nav.querySelectorAll("a").forEach((link) => {
    link.addEventListener("click", () => {
      nav.classList.remove("open");
      toggle.setAttribute("aria-expanded", "false");
    });
  });
}

const workGalleries = document.querySelectorAll("[data-work-gallery]");
if (workGalleries.length) {
  const overlay = document.createElement("div");
  overlay.className = "lightbox";
  overlay.hidden = true;
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-label", "Enlarged photo");

  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "lightbox-close";
  closeBtn.setAttribute("aria-label", "Close");
  closeBtn.textContent = "\u00d7";

  const prevBtn = document.createElement("button");
  prevBtn.type = "button";
  prevBtn.className = "lightbox-nav lightbox-prev";
  prevBtn.setAttribute("aria-label", "Previous photo");
  prevBtn.textContent = "\u2039";

  const nextBtn = document.createElement("button");
  nextBtn.type = "button";
  nextBtn.className = "lightbox-nav lightbox-next";
  nextBtn.setAttribute("aria-label", "Next photo");
  nextBtn.textContent = "\u203a";

  const picture = document.createElement("img");
  picture.alt = "";
  const caption = document.createElement("p");
  caption.className = "lightbox-caption";

  overlay.append(closeBtn, prevBtn, picture, nextBtn, caption);
  document.body.append(overlay);

  let thumbs = [];
  let index = 0;
  let lastTrigger = null;

  function show(i) {
    if (!thumbs.length) return;
    index = (i + thumbs.length) % thumbs.length;
    const source = thumbs[index].querySelector("img");
    const label = thumbs[index].querySelector("span");
    picture.src = source.currentSrc || source.src;
    picture.alt = source.alt;
    caption.textContent = label ? label.textContent : "";
    const multiple = thumbs.length > 1;
    prevBtn.hidden = !multiple;
    nextBtn.hidden = !multiple;
  }

  function open(list, i, trigger) {
    thumbs = list;
    lastTrigger = trigger;
    show(i);
    overlay.hidden = false;
    document.body.classList.add("lightbox-open");
    closeBtn.focus();
  }

  function close() {
    overlay.hidden = true;
    picture.removeAttribute("src");
    picture.alt = "";
    caption.textContent = "";
    document.body.classList.remove("lightbox-open");
    if (lastTrigger) lastTrigger.focus();
  }

  workGalleries.forEach((gallery) => {
    const list = Array.from(gallery.querySelectorAll("button"));
    list.forEach((button, i) => {
      button.addEventListener("click", () => open(list, i, button));
    });
  });
  closeBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    close();
  });
  prevBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    show(index - 1);
  });
  nextBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    show(index + 1);
  });
  picture.addEventListener("click", (event) => {
    event.stopPropagation();
    close();
  });
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) close();
  });
  document.addEventListener("keydown", (event) => {
    if (overlay.hidden) return;
    if (event.key === "Escape") {
      event.preventDefault();
      close();
    } else if (event.key === "ArrowLeft" && thumbs.length > 1) {
      event.preventDefault();
      show(index - 1);
    } else if (event.key === "ArrowRight" && thumbs.length > 1) {
      event.preventDefault();
      show(index + 1);
    }
  });
}

const galleryCards = document.querySelectorAll(".page-gallery .fx-gallery-card");
if (galleryCards.length) {
  const overlay = document.createElement("div");
  overlay.className = "lightbox";
  overlay.hidden = true;
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-label", "Enlarged photo");

  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "lightbox-close";
  closeBtn.setAttribute("aria-label", "Close");
  closeBtn.textContent = "\u00d7";

  const picture = document.createElement("img");
  picture.alt = "";

  overlay.append(closeBtn, picture);
  document.body.append(overlay);

  let openCard = null;

  function closeGallery() {
    overlay.hidden = true;
    picture.removeAttribute("src");
    picture.alt = "";
    document.body.classList.remove("lightbox-open");
    const card = openCard;
    openCard = null;
    if (card) card.focus();
  }

  function openGallery(card) {
    const source = card.querySelector("img");
    if (!source) return;
    picture.src = source.currentSrc || source.src;
    picture.alt = source.alt || "";
    openCard = card;
    overlay.hidden = false;
    document.body.classList.add("lightbox-open");
  }

  galleryCards.forEach((card) => {
    card.addEventListener("click", (event) => {
      event.preventDefault();
      if (!overlay.hidden && openCard === card) closeGallery();
      else openGallery(card);
    });
  });

  picture.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    closeGallery();
  });
  closeBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    closeGallery();
  });
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) closeGallery();
  });
  document.addEventListener("keydown", (event) => {
    if (overlay.hidden || event.key !== "Escape") return;
    event.preventDefault();
    closeGallery();
  });
}

const ceramicFaq = document.querySelector(".ceramic-faq");
if (ceramicFaq) {
  ceramicFaq.querySelectorAll(".faq-question").forEach((button) => {
    button.addEventListener("click", () => {
      const item = button.closest(".faq-item");
      const willOpen = !item.classList.contains("open");
      ceramicFaq.querySelectorAll(".faq-item").forEach((other) => {
        const open = other === item && willOpen;
        other.classList.toggle("open", open);
        const question = other.querySelector(".faq-question");
        if (question) question.setAttribute("aria-expanded", open ? "true" : "false");
      });
    });
  });
}

const reviewTexts = document.querySelectorAll(".page-reviews .reviews-card-text");
if (reviewTexts.length) {
  const reviewToggles = new WeakMap();

  function longerThanFourLines(text) {
    const wasClamped = text.classList.contains("is-clamped");
    if (wasClamped) text.classList.remove("is-clamped");
    const lineHeight = parseFloat(getComputedStyle(text).lineHeight);
    const height = text.scrollHeight;
    if (wasClamped) text.classList.add("is-clamped");
    return lineHeight > 0 && height > lineHeight * 4 + 1;
  }

  function setReviewOpen(text, button, open) {
    text.classList.toggle("is-clamped", !open);
    button.setAttribute("aria-expanded", open ? "true" : "false");
    button.textContent = open ? "\u2212" : "+";
    button.setAttribute("aria-label", open ? "Collapse review" : "Expand review");
  }

  function syncReview(text, keepOpen) {
    const long = longerThanFourLines(text);
    let button = reviewToggles.get(text);
    if (!long) {
      text.classList.remove("is-clamped");
      if (button) {
        button.remove();
        reviewToggles.delete(text);
      }
      return;
    }
    if (!button) {
      button = document.createElement("button");
      button.type = "button";
      button.className = "reviews-toggle";
      button.addEventListener("click", () => {
        setReviewOpen(text, button, button.getAttribute("aria-expanded") !== "true");
      });
      text.after(button);
      reviewToggles.set(text, button);
    }
    setReviewOpen(text, button, Boolean(keepOpen));
  }

  reviewTexts.forEach((text) => syncReview(text, false));

  let reviewResizeTimer;
  window.addEventListener("resize", () => {
    clearTimeout(reviewResizeTimer);
    reviewResizeTimer = setTimeout(() => {
      reviewTexts.forEach((text) => {
        const button = reviewToggles.get(text);
        const open = button && button.getAttribute("aria-expanded") === "true";
        syncReview(text, open);
      });
    }, 150);
  });
}

(function () {
  const PIXEL_ID = "2042805043235208";
  const CONSENT_KEY = "fxd-meta-consent";
  const PENDING_KEY = "fxd-lead-pending";
  const MAX_AGE_MS = 3 * 60 * 1000;

  function isThanksPage() {
    const path = location.pathname.replace(/\/index\.html$/, "");
    return /\/thanks\/?$/.test(path);
  }

  function readConsent() {
    try {
      return localStorage.getItem(CONSENT_KEY);
    } catch (error) {
      return null;
    }
  }

  function writeConsent(value) {
    try {
      localStorage.setItem(CONSENT_KEY, value);
    } catch (error) {
      /* Private browsing can block storage. The choice still applies to this page. */
    }
  }

  function readPending() {
    try {
      const raw = sessionStorage.getItem(PENDING_KEY);
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (!data || typeof data.eventId !== "string" || typeof data.form !== "string" || typeof data.at !== "number") return null;
      if (Date.now() - data.at > MAX_AGE_MS) return null;
      return data;
    } catch (error) {
      return null;
    }
  }

  function clearPending() {
    try {
      sessionStorage.removeItem(PENDING_KEY);
    } catch (error) {
      /* Ignore storage failures. A missing token simply does not count a lead. */
    }
  }

  function navigationType() {
    const nav = performance.getEntriesByType && performance.getEntriesByType("navigation")[0];
    return nav && nav.type ? nav.type : "navigate";
  }

  function createEventId() {
    if (window.crypto && typeof crypto.randomUUID === "function") return crypto.randomUUID();
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (character) => {
      const random = Math.random() * 16 | 0;
      const value = character === "x" ? random : (random & 0x3) | 0x8;
      return value.toString(16);
    });
  }

  function savePending(record) {
    try {
      sessionStorage.setItem(PENDING_KEY, JSON.stringify(record));
      return true;
    } catch (error) {
      return false;
    }
  }

  // The token is written only after Netlify accepts the form, then read once on the thank-you page.
  let pendingLead = null;
  if (isThanksPage()) {
    if (navigationType() === "navigate") pendingLead = readPending();
    clearPending();
  } else {
    clearPending();
    window.addEventListener("pageshow", (event) => {
      if (event.persisted) clearPending();
    });
  }

  function showFormError(form) {
    const note = form.querySelector(".dx-form-note");
    if (!note) return;
    note.textContent = "We couldn’t send that. Please try again, or call 07548 703902.";
  }

  document.querySelectorAll("form[data-netlify='true']").forEach((form) => {
    form.addEventListener("submit", (event) => {
      const trap = form.querySelector("[name='bot-field']");
      if (trap && trap.value) return;
      if (!window.fetch || !window.FormData || !window.URLSearchParams) return;

      event.preventDefault();
      if (form.getAttribute("data-submitting") === "true") return;
      form.setAttribute("data-submitting", "true");

      const record = {
        eventId: createEventId(),
        form: form.getAttribute("name") || "enquiry",
        at: Date.now()
      };
      const body = new URLSearchParams(new FormData(form));

      fetch("/", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString()
      }).then((response) => {
        if (!response.ok) throw new Error("rejected");
        savePending(record);
        window.location.assign("/thanks/");
      }).catch(() => {
        form.removeAttribute("data-submitting");
        showFormError(form);
      });
    });
  });

  let pixelStarted = false;

  function startPixel() {
    if (pixelStarted) return;
    pixelStarted = true;

    !function (f, b, e, v, n, t, s) {
      if (f.fbq) return;
      n = f.fbq = function () {
        n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments);
      };
      if (!f._fbq) f._fbq = n;
      n.push = n;
      n.loaded = !0;
      n.version = "2.0";
      n.queue = [];
      t = b.createElement(e);
      t.async = !0;
      t.src = v;
      s = b.getElementsByTagName(e)[0];
      s.parentNode.insertBefore(t, s);
    }(window, document, "script", "https://connect.facebook.net/en_US/fbevents.js");

    window.fbq("init", PIXEL_ID);
    window.fbq("track", "PageView");

    if (!pendingLead) return;
    const lead = pendingLead;
    pendingLead = null;
    window.fbq("track", "Lead", { content_name: lead.form }, { eventID: lead.eventId });
  }

  function removeBanner() {
    const banner = document.querySelector(".fx-consent");
    if (banner) banner.remove();
  }

  function showBanner() {
    if (document.querySelector(".fx-consent")) return;
    const banner = document.createElement("div");
    banner.className = "fx-consent";
    banner.setAttribute("role", "dialog");
    banner.setAttribute("aria-label", "Cookie choices");
    banner.innerHTML = "<p>We use a Meta cookie to measure which adverts lead to enquiries. The site works if you reject this.</p><div class=\"fx-consent-actions\"><button type=\"button\" class=\"fx-consent-reject\">Reject</button><button type=\"button\" class=\"fx-consent-accept\">Accept</button></div>";
    banner.querySelector(".fx-consent-reject").addEventListener("click", () => {
      writeConsent("rejected");
      pendingLead = null;
      removeBanner();
    });
    banner.querySelector(".fx-consent-accept").addEventListener("click", () => {
      writeConsent("accepted");
      removeBanner();
      startPixel();
    });
    document.body.appendChild(banner);
  }

  const consent = readConsent();
  if (consent === "accepted") startPixel();
  else if (consent === "rejected") pendingLead = null;
  else showBanner();
})();
