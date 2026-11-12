import fs from 'fs';
import path from 'path';

const SITE_DIR = path.resolve('site');
const EXPECTED_PARENT_URL = 'https://www.fratelli-x.com/';

let errors = 0;

function logError(msg) {
  console.error(`[SCHEMA RELATION ERROR] ${msg}`);
  errors++;
}

function logSuccess(msg) {
  console.log(msg);
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

function entities(parsed) {
  if (Array.isArray(parsed)) return parsed.flatMap(entities);
  if (parsed && Array.isArray(parsed['@graph'])) return parsed['@graph'];
  return parsed ? [parsed] : [];
}

const htmlFiles = getHtmlFiles(SITE_DIR);

if (htmlFiles.length === 0) {
  console.error(`No HTML files found in ${SITE_DIR}.`);
  process.exit(1);
}

let homepageChecked = false;

htmlFiles.forEach((filePath) => {
  const relPath = path.relative(SITE_DIR, filePath).replace(/\\/g, '/');
  const html = fs.readFileSync(filePath, 'utf8');
  const isHomepage = relPath === 'index.html';
  const ldMatches = [...html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];

  ldMatches.forEach((match) => {
    try {
      const parsed = JSON.parse(match[1].trim());
      entities(parsed).forEach((item) => {
        const type = item['@type'];
        const isDetailingBusiness = type === 'AutoDetailing' || (Array.isArray(type) && type.includes('AutoDetailing'));
        if (!isDetailingBusiness) return;

        if (isHomepage) homepageChecked = true;
        const parentOrg = item.parentOrganization;
        if (!parentOrg) {
          logError(`${relPath}: AutoDetailing entity is missing parentOrganization linking to Fratelli X.`);
          return;
        }
        const parentUrl = parentOrg.url;
        if (parentUrl !== EXPECTED_PARENT_URL) {
          logError(`${relPath}: parentOrganization URL mismatch. Expected '${EXPECTED_PARENT_URL}', found '${parentUrl}'.`);
        } else if (parentOrg['@type'] !== 'Organization' || parentOrg.name !== 'Fratelli X') {
          logError(`${relPath}: parentOrganization must be Organization named Fratelli X.`);
        } else {
          logSuccess(`Verified parentOrganization link: FX Detailing -> Fratelli X (${parentUrl})`);
        }
      });
    } catch {
      // JSON parsing errors are reported by validate-seo.js.
    }
  });
});

if (!homepageChecked) {
  logError('site/index.html has no AutoDetailing schema entity.');
}

if (errors > 0) {
  console.error(`\nSchema relationship audit failed with ${errors} error(s).`);
  process.exit(1);
}

console.log('\nSchema relationship verification passed.');
