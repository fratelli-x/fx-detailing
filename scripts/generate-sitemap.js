import fs from 'fs';
import path from 'path';

const SITE_URL = 'https://www.fxdetailing.co.uk';
const SITE_DIR = path.resolve('site');
const OUTPUT_PATH = path.join(SITE_DIR, 'sitemap.xml');
const TODAY = new Date().toISOString().split('T')[0];

function getIndexFiles(dir) {
  const results = [];
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) results.push(...getIndexFiles(full));
    else if (entry.name === 'index.html') results.push(full);
  }
  return results;
}

function routeFor(filePath) {
  const rel = path.relative(SITE_DIR, filePath).replace(/\\/g, '/');
  if (rel === 'index.html') return '/';
  return `/${rel.slice(0, -'index.html'.length)}`;
}

function priorityFor(route) {
  if (route === '/') return { changefreq: 'weekly', priority: '1.0' };
  if (['/detailing/', '/ceramic/', '/bodykits/', '/gallery/', '/contact/'].includes(route)) {
    return { changefreq: 'weekly', priority: '0.9' };
  }
  if (route.startsWith('/locations/')) return { changefreq: 'monthly', priority: '0.7' };
  if (route === '/projects/') return { changefreq: 'weekly', priority: '0.7' };
  if (route.startsWith('/projects/')) return { changefreq: 'monthly', priority: '0.6' };
  return { changefreq: 'yearly', priority: '0.4' };
}

function escapeXml(value) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

if (!fs.existsSync(SITE_DIR)) {
  console.error('site/ is missing. Sitemap was not written.');
  process.exit(1);
}

const routes = getIndexFiles(SITE_DIR)
  .map(routeFor)
  .filter((route) => route.endsWith('/') && !route.includes('/services/'))
  .sort((a, b) => a.localeCompare(b));

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${routes
  .map((route) => {
    const meta = priorityFor(route);
    return `  <url>
    <loc>${escapeXml(SITE_URL + route)}</loc>
    <lastmod>${TODAY}</lastmod>
    <changefreq>${meta.changefreq}</changefreq>
    <priority>${meta.priority}</priority>
  </url>`;
  })
  .join('\n')}
</urlset>
`;

fs.writeFileSync(OUTPUT_PATH, xml, 'utf8');
console.log(`Sitemap written to site/sitemap.xml with ${routes.length} URLs.`);
