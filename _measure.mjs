import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const chrome = "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe";
const port = 9333;
const pages = ["/", "/detailing/", "/ceramic/", "/bodykits/"];
const sizes = [
  { width: 390, height: 800 },
  { width: 1200, height: 800 },
];

const dir = await mkdtemp(join(tmpdir(), "fxd-measure-"));
const proc = spawn(chrome, [
  "--headless=new",
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${dir}`,
  "--no-first-run",
  "--disable-gpu",
  "about:blank",
], { stdio: "ignore" });

let ws;
try {
  let version;
  for (let i = 0; i < 40; i++) {
    try {
      version = await fetch(`http://127.0.0.1:${port}/json/version`).then((r) => r.json());
      break;
    } catch {
      await delay(250);
    }
  }
  if (!version) throw new Error("Chrome DevTools did not start");
  ws = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", reject, { once: true });
  });

  let id = 0;
  const pending = new Map();
  ws.addEventListener("message", (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(JSON.stringify(msg.error)));
      else resolve(msg.result);
    }
  });
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const msgId = ++id;
    pending.set(msgId, { resolve, reject });
    ws.send(JSON.stringify({ id: msgId, method, params, sessionId }));
  });

  const { targetId } = await send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
  await send("Page.enable", {}, sessionId);
  await send("Runtime.enable", {}, sessionId);

  const expr = `(() => {
    const doc = document.documentElement;
    let widest = null;
    for (const el of document.querySelectorAll("body *")) {
      const r = el.getBoundingClientRect();
      if (!widest || r.width > widest.w) {
        widest = {
          w: Math.round(r.width),
          right: Math.round(r.right),
          tag: el.tagName,
          cls: String(el.className || "").slice(0, 80)
        };
      }
    }
    return {
      scroll: doc.scrollWidth,
      client: doc.clientWidth,
      inner: window.innerWidth
    , widest};
  })()`;

  const results = [];
  for (const size of sizes) {
    await send("Emulation.setDeviceMetricsOverride", {
      width: size.width,
      height: size.height,
      deviceScaleFactor: 1,
      mobile: size.width < 500,
    }, sessionId);
    for (const path of pages) {
      const url = `http://localhost:4173${path}?nocache=${Date.now()}`;
      await send("Page.navigate", { url }, sessionId);
      await send("Page.reload", { ignoreCache: true }, sessionId);
      await delay(400);
      const evaled = await send("Runtime.evaluate", {
        expression: expr,
        returnByValue: true,
      }, sessionId);
      results.push({ path, ...size, value: evaled.result.value });
    }
  }
  await send("Emulation.clearDeviceMetricsOverride", {}, sessionId);
  console.log(JSON.stringify(results, null, 2));
} finally {
  try { ws?.close(); } catch {}
  proc.kill();
  await delay(300);
  await rm(dir, { recursive: true, force: true });
}
