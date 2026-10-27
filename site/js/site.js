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
