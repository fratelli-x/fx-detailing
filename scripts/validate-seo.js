import fs from 'fs';
import path from 'path';

const SITE_DIR = path.resolve('site');
const SITEMAP_PATH = path.join(SITE_DIR, 'sitemap.xml');
const SITE_URL = 'https://www.fxdetailing.co.uk';

let errors = 0;

function logError(msg) {
  console.error(`[SEO ERROR] ${msg}`);
  errors++;
}

function logSuccess(msg) {
  console.log(msg);
}

function getMetaContent(html, attrName, attrValue) {
  const regex1 = new RegExp(`<meta[^>]*${attrName}=["']${attrValue}["'][^>]*content=["']([^"']*)["'][^>]*>`, 'i');
  const regex2 = new RegExp(`<meta[^>]*content=["']([^"']*)["'][^>]*${attrName}=["']${attrValue}["'][^>]*>`, 'i');
  const match = html.match(regex1) || html.match(regex2);
  return match ? match[1].trim() : null;
}

function schemaNodes(parsed) {
  const items = Array.isArray(parsed) ? parsed : [parsed];
  const nodes = [];
  for (const item of items) {
    if (item && Array.isArray(item['@graph'])) {
      if (!item['@context']) logError('JSON-LD @graph is missing @context.');
      for (const node of item['@graph']) {
        nodes.push({ ...node, '@context': node['@context'] || item['@context'] });
      }
    } else if (item) {
      nodes.push(item);
    }
  }
  return nodes;
}

if (!fs.existsSync(SITEMAP_PATH)) {
  logError(`Missing sitemap.xml at ${SITEMAP_PATH}`);
} else {
  const sitemap = fs.readFileSync(SITEMAP_PATH, 'utf8');
  const locMatches = [...sitemap.matchAll(/<loc>(.*?)<\/loc>/g)].map((m) => m[1]);
  locMatches.forEach((url) => {
    if (!url.startsWith(SITE_URL)) logError(`Sitemap URL domain mismatch: ${url}`);
    if (!url.endsWith('/')) logError(`Sitemap URL missing trailing slash: ${url}`);
    if (url.includes('/services/')) logError(`Sitemap lists a /services/ URL that this site does not publish: ${url}`);
  });
  logSuccess(`Validated ${locMatches.length} sitemap URLs.`);
}

function getHtmlFiles(dir) {
  const results = [];
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) results.push(...getHtmlFiles(full));
    else if (entry.name.endsWith('.html')) results.push(full);
  }
  return results;
}

const htmlFiles = getHtmlFiles(SITE_DIR);
const validRoutes = new Set(['/']);
htmlFiles.forEach((filePath) => {
  const relPath = path.relative(SITE_DIR, filePath).replace(/\\/g, '/');
  if (relPath === 'index.html') validRoutes.add('/');
  else if (relPath.endsWith('/index.html')) validRoutes.add(`/${relPath.replace(/\/index\.html$/, '')}/`);
  else validRoutes.add(`/${relPath.replace(/\.html$/, '')}/`);
});

let schemaCount = 0;
let linkCount = 0;

htmlFiles.forEach((filePath) => {
  const relPath = path.relative(SITE_DIR, filePath).replace(/\\/g, '/');
  const html = fs.readFileSync(filePath, 'utf8');
  if (relPath.includes('404')) return;

  const titleMatch = html.match(/<title>(.*?)<\/title>/is);
  if (!titleMatch || !titleMatch[1].trim()) logError(`${relPath}: Missing <title>`);
  if (!getMetaContent(html, 'name', 'description')) logError(`${relPath}: Missing meta description`);

  const canonicalMatch = html.match(/<link[^>]*rel=["']canonical["'][^>]*href=["']([^"']*)["'][^>]*>/i)
    || html.match(/<link[^>]*href=["']([^"']*)["'][^>]*rel=["']canonical["'][^>]*>/i);
  const canonicalUrl = canonicalMatch ? canonicalMatch[1].trim() : null;

  if (!canonicalUrl || !canonicalUrl.startsWith(SITE_URL) || !canonicalUrl.endsWith('/')) {
    logError(`${relPath}: Invalid or missing canonical URL.`);
  }

  const ogTitle = getMetaContent(html, 'property', 'og:title');
  const ogImage = getMetaContent(html, 'property', 'og:image');
  const ogUrl = getMetaContent(html, 'property', 'og:url');

  if (!ogTitle) logError(`${relPath}: Missing og:title`);
  if (!ogImage || !ogImage.startsWith('https://')) logError(`${relPath}: Missing or non-HTTPS og:image`);
  if (canonicalUrl && ogUrl !== canonicalUrl) logError(`${relPath}: og:url does not match canonical URL.`);

  const ldMatches = [...html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  ldMatches.forEach((match, idx) => {
    schemaCount++;
    try {
      const parsed = JSON.parse(match[1].trim());
      schemaNodes(parsed).forEach((item) => {
        if (!item['@context'] || !item['@type']) {
          logError(`${relPath} (Schema #${idx + 1}): Missing @context or @type.`);
        }
      });
    } catch (err) {
      logError(`${relPath} (Schema #${idx + 1}): Invalid JSON -> ${err.message}`);
    }
  });

  const linkMatches = [...html.matchAll(/<a\b[^>]*\bhref=["']([^"'#]+)["'][^>]*>/gi)];
  linkMatches.forEach((match) => {
    const rawHref = match[1].trim();
    if (/^(tel:|mailto:|sms:|javascript:|#)/i.test(rawHref)) return;
    if (/^https?:\/\//i.test(rawHref) && !rawHref.startsWith(SITE_URL)) return;

    linkCount++;
    const relativePath = rawHref.replace(SITE_URL, '').split('?')[0];
    if (/\.[a-z0-9]{2,5}$/i.test(relativePath) && !relativePath.endsWith('.html')) return;
    if (relativePath !== '/' && !relativePath.endsWith('/')) {
      logError(`${relPath}: Internal link missing trailing slash -> ${rawHref}`);
      return;
    }
    if (!validRoutes.has(relativePath)) {
      logError(`${relPath}: Broken internal link (404) -> ${rawHref}`);
    }
  });
});

logSuccess(`Scanned ${htmlFiles.length} pages in site/, ${linkCount} links, and ${schemaCount} schemas.`);

if (errors > 0) {
  console.error(`\nSEO check failed with ${errors} error(s).`);
  process.exit(1);
}

console.log('\nAll FX Detailing SEO checks passed.');
