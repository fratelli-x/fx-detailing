import https from 'https';
import http from 'http';
import zlib from 'zlib';

const targetDomain = (process.argv[2] || 'https://www.fxdetailing.co.uk').replace(/\/$/, '');
const sitemapUrl = `${targetDomain}/sitemap.xml`;
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

let errors = 0;

function logError(msg) {
  console.error(`[MONITOR ERROR] ${msg}`);
  errors++;
}

function logSuccess(msg) {
  console.log(msg);
}

function decodeBody(buffer, encoding) {
  const value = (encoding || '').toLowerCase();
  if (value.includes('gzip')) return zlib.gunzipSync(buffer);
  if (value.includes('deflate')) {
    try {
      return zlib.inflateSync(buffer);
    } catch {
      return zlib.inflateRawSync(buffer);
    }
  }
  return buffer;
}

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    const request = client.get(url, {
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Encoding': 'gzip, deflate'
      }
    }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        try {
          const body = decodeBody(Buffer.concat(chunks), response.headers['content-encoding']).toString('utf8');
          resolve({ status: response.statusCode, body });
        } catch (err) {
          reject(err);
        }
      });
    });
    request.setTimeout(20000, () => {
      request.destroy(new Error('Request timed out after 20s'));
    });
    request.on('error', reject);
  });
}

function decodeXml(value) {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

async function runMonitor() {
  console.log(`Fetching sitemap: ${sitemapUrl}`);
  try {
    const sitemapRes = await fetchUrl(sitemapUrl);
    if (sitemapRes.status !== 200) {
      console.error(`Failed to fetch sitemap.xml. Status: ${sitemapRes.status}`);
      process.exit(1);
    }

    const locMatches = [...sitemapRes.body.matchAll(/<loc>(.*?)<\/loc>/g)].map((match) => decodeXml(match[1].trim()));
    if (locMatches.length === 0) {
      console.error('No <loc> URLs found in sitemap.xml');
      process.exit(1);
    }

    console.log(`Found ${locMatches.length} URLs in sitemap.`);

    for (const url of locMatches) {
      try {
        const pageRes = await fetchUrl(url);
        if (pageRes.status !== 200) {
          logError(`${url} returned HTTP status ${pageRes.status}`);
          continue;
        }

        const canonicalMatch = pageRes.body.match(/<link[^>]*rel=["']canonical["'][^>]*href=["']([^"']*)["'][^>]*>/i)
          || pageRes.body.match(/<link[^>]*href=["']([^"']*)["'][^>]*rel=["']canonical["'][^>]*>/i);
        const canonicalUrl = canonicalMatch ? canonicalMatch[1].trim() : null;

        if (!canonicalUrl) {
          logError(`${url}: Missing <link rel="canonical"> in live HTML.`);
        } else if (canonicalUrl !== url) {
          logError(`${url}: Live canonical mismatch. Found '${canonicalUrl}', expected '${url}'.`);
        } else {
          logSuccess(`Verified: ${url} (200 OK + valid canonical)`);
        }
      } catch (err) {
        logError(`${url} request failed -> ${err.message}`);
      }
    }

    if (errors > 0) {
      console.error(`Monitoring finished with ${errors} error(s).`);
      process.exit(1);
    }
    console.log('All live URLs returned 200 OK with matching canonical tags.');
  } catch (err) {
    console.error(`Error running monitor: ${err.message}`);
    process.exit(1);
  }
}

runMonitor();
