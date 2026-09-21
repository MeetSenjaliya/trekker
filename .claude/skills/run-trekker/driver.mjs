// Headless-Chromium REPL for driving the Trekker dev server.
// Agent tooling, not product surface. Pipe commands on stdin:
//
//   node .claude/skills/run-trekker/driver.mjs <<'EOF'
//   nav /explore
//   wait-text Explore
//   ss explore
//   errors
//   EOF
//
// Exits at EOF (or `quit`). Screenshots land in $SHOT_DIR (default ./.shots).
// Uses the repo's own @playwright/test - no chromium-cli needed.
import { chromium } from '@playwright/test';
import * as readline from 'node:readline';
import * as fs from 'node:fs';
import * as path from 'node:path';

const APP_DIR = path.resolve(import.meta.dirname, '../../..');
const BASE = process.env.BASE_URL || 'http://localhost:3000';
const SHOT_DIR = path.resolve(process.env.SHOT_DIR || path.join(APP_DIR, '.shots'));
fs.mkdirSync(SHOT_DIR, { recursive: true });

let browser = null;
let context = null;
let page = null;
const consoleErrors = [];
const pageErrors = [];
const failedResponses = [];

const abs = (u) => (/^https?:\/\//.test(u) ? u : BASE + (u.startsWith('/') ? u : '/' + u));

async function launch() {
  if (browser) return console.log('already launched');
  browser = await chromium.launch({ args: ['--no-sandbox'] });
  context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  page = await context.newPage();
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => pageErrors.push(e.message));
  page.on('response', (r) => { if (r.status() >= 400) failedResponses.push(`${r.status()} ${r.request().method()} ${r.url()}`); });
  console.log('launched', BASE);
}
const need = async () => { if (!page) await launch(); return page; };

const COMMANDS = {
  launch,

  async nav(url) {
    const res = await (await need()).goto(abs(url || '/'), { waitUntil: 'domcontentloaded', timeout: 60_000 });
    console.log('nav', page.url(), '->', res?.status());
  },

  async wait(sel) {
    await (await need()).waitForSelector(sel, { timeout: 30_000 });
    console.log('found:', sel);
  },

  async 'wait-text'(text) {
    await (await need()).getByText(text, { exact: false }).first().waitFor({ timeout: 30_000 });
    console.log('found text:', JSON.stringify(text));
  },

  async 'wait-url'(fragment) {
    await (await need()).waitForURL((u) => u.href.includes(fragment), { timeout: 30_000 });
    console.log('url:', page.url());
  },

  async ss(name) {
    const f = path.join(SHOT_DIR, (name || `ss-${Date.now()}`) + '.png');
    await (await need()).screenshot({ path: f, fullPage: false });
    console.log('screenshot:', f);
  },

  async click(sel) {
    await (await need()).locator(sel).first().click({ timeout: 10_000 });
    console.log('click', sel);
  },

  async 'click-text'(text) {
    await (await need()).getByText(text, { exact: false }).first().click({ timeout: 10_000 });
    console.log('click-text', JSON.stringify(text));
  },

  // fill <selector> | <value>  (or `fill <selector> <value>` when the selector
  // has no spaces). Goes through Playwright's input pipeline so React
  // controlled inputs see the change.
  async fill(args) {
    let sel, value;
    if (args.includes('|')) [sel, value] = args.split('|').map((s) => s.trim());
    else { const [a, ...rest] = args.split(/\s+/); sel = a; value = rest.join(' '); }
    await (await need()).locator(sel).first().fill(value, { timeout: 10_000 });
    console.log('fill', sel);
  },

  async type(text) { await (await need()).keyboard.type(text, { delay: 20 }); console.log('typed'); },
  // framer-motion entrance fades take ~1s; screenshot after one of these.
  async sleep(ms) { await new Promise((r) => setTimeout(r, Number(ms) || 1000)); },
  async press(key) { await (await need()).keyboard.press(key); console.log('press', key); },

  async eval(expr) {
    try { console.log(JSON.stringify(await (await need()).evaluate(expr))); }
    catch (e) { console.log('ERROR:', e.message); }
  },

  async text(sel) {
    const t = await (await need()).evaluate(
      (s) => (s ? document.querySelector(s) : document.body)?.innerText ?? '(null)',
      sel || null,
    );
    console.log(t.slice(0, 4000));
  },

  async url() { console.log((await need()).url()); },
  async title() { console.log(await (await need()).title()); },

  // Sign in through the real form (default account kind = trekker). The app
  // does a hard `window.location` redirect ~800ms after success.
  async login(args) {
    const [email, password] = args.split(/\s+/);
    if (!email || !password) throw new Error('usage: login <email> <password>');
    const p = await need();
    await p.goto(abs('/auth/login'), { waitUntil: 'domcontentloaded' });
    await p.locator('input[type="email"]:visible').first().fill(email);
    await p.locator('input[type="password"]:visible').first().fill(password);
    await p.locator('button[type="submit"]:visible').first().click();
    await p.waitForURL((u) => !u.pathname.startsWith('/auth/login'), { timeout: 30_000 });
    console.log('signed in ->', p.url());
  },

  async cookies() {
    await need();
    for (const c of await context.cookies()) console.log(`${c.name}=${c.value.slice(0, 24)}... (${c.domain})`);
  },

  // Console errors, page errors and >=400 responses since the last `errors`.
  errors() {
    if (!consoleErrors.length && !pageErrors.length && !failedResponses.length) return console.log('no errors');
    for (const e of pageErrors) console.log('PAGE ERROR:', e);
    for (const e of failedResponses) console.log('HTTP', e.slice(0, 300));
    for (const e of consoleErrors) console.log('console.error:', e.split('\n')[0].slice(0, 200));
    consoleErrors.length = 0; pageErrors.length = 0; failedResponses.length = 0;
  },

  async quit() { await browser?.close().catch(() => {}); browser = context = page = null; },
  help() { console.log('commands:', Object.keys(COMMANDS).join(', ')); },
};

const rl = readline.createInterface({ input: process.stdin, terminal: false });
let failed = false;

for await (const line of rl) {
  // `$NAME` tokens expand from the environment so a quoted heredoc can carry
  // credentials without the shell (or this file) ever holding them.
  const trimmed = line.trim().replace(/\$([A-Z_][A-Z0-9_]*)/g, (_, k) => process.env[k] ?? '');
  if (!trimmed || trimmed.startsWith('#')) continue;
  const [cmd, ...rest] = trimmed.split(/\s+/);
  const fn = COMMANDS[cmd];
  if (!fn) { console.log('unknown:', cmd, '- try: help'); continue; }
  try { await fn(rest.join(' ')); }
  catch (e) { failed = true; console.log(`FAIL ${cmd}: ${e.message.split('\n')[0]}`); }
  if (cmd === 'quit') break;
}
await COMMANDS.quit();
process.exit(failed ? 1 : 0);
