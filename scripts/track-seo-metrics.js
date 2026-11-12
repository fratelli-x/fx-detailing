import fs from 'fs';
import path from 'path';

const LOG_FILE = path.resolve('seo-metrics-log.csv');
const HEADER = 'Date,Domain,Clicks,Impressions,Avg Position,Indexed Pages';
const USAGE = 'Usage: node scripts/track-seo-metrics.js --domain fxdetailing.co.uk --clicks <n> --impressions <n> --position <n> --indexed <n>';

function usage() {
  console.error(USAGE);
  process.exit(1);
}

const flags = {};
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i += 1) {
  const token = args[i];
  if (!token.startsWith('--')) usage();
  const name = token.slice(2);
  const value = args[i + 1];
  if (value === undefined || value.startsWith('--')) usage();
  flags[name] = value;
  i += 1;
}

const domain = flags.domain || 'fxdetailing.co.uk';
const required = ['clicks', 'impressions', 'position', 'indexed'];
if (required.some((name) => flags[name] === undefined || flags[name] === '')) usage();

const date = new Date().toISOString().split('T')[0];
const row = [date, domain, flags.clicks, flags.impressions, flags.position, flags.indexed].join(',');

if (!fs.existsSync(LOG_FILE)) {
  fs.writeFileSync(LOG_FILE, `${HEADER}\n${row}\n`, 'utf8');
} else {
  fs.appendFileSync(LOG_FILE, `${row}\n`, 'utf8');
}

console.log(`Logged ${date} for ${domain}.`);
