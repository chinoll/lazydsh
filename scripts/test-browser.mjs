// SPDX-License-Identifier: GPL-3.0-only
import { build } from 'esbuild';
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
await mkdir('dist/preview', { recursive: true });
await build({ entryPoints: ['test/browser/preview.jsx'], outfile: 'dist/preview/app.js',
  bundle: true, platform: 'browser', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' } });
await writeFile('dist/preview/index.html', '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>lazydsh source preview</title><div id="root"></div><script src="app.js"></script></html>');
const browser = await chromium.launch({ headless: true,
  ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}) });
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 950 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(pathToFileURL(resolve('dist/preview/index.html')).href);
  const root = page.locator('.lazydsh-links');
  const summary = root.locator(':scope > summary');
  const unread = page.locator('.lazydsh-unread');
  await summary.waitFor();
  assert.equal(await root.evaluate(el => el.open), false);
  await summary.focus();
  await page.keyboard.press('Enter');
  assert.equal(await root.evaluate(el => el.open), true);
  assert.equal(await summary.locator('svg').count(), 1);
  assert.equal(await root.locator('.lazydsh-note').count(), 0);
  assert.equal(await root.getByText('网页内容已读入', { exact: true }).count(), 0);
  assert.equal(await root.getByText('仅搜索摘要已读入，未读取正文', { exact: true }).count(), 0);
  assert.equal(await unread.evaluate(el => el.open), false);
  assert.equal(await root.locator('a:visible').count(), 3);
  await unread.locator('summary').focus();
  await page.keyboard.press('Enter');
  assert.equal(await root.locator('a:visible').count(), 6);
  assert.ok(await root.locator('a').evaluateAll(links => links.every(a => a.rel.includes('noopener') && a.rel.includes('noreferrer'))));
  await page.keyboard.press('Enter');
  assert.equal(await unread.locator('a:visible').count(), 0);
  await page.screenshot({ path: 'dist/preview/light.png', fullPage: true });
  await page.getByRole('checkbox').uncheck();
  assert.equal(await root.count(), 0);
  await page.getByRole('checkbox').check();
  assert.equal(await root.count(), 1);
  assert.equal(await unread.evaluate(el => el.open), false);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: 'dark' });
  await summary.click();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: 'dist/preview/dark-mobile.png', fullPage: true });
  assert.deepEqual(errors, []);
  console.log('Browser passed: keyboard disclosure, live toggle, safe links, light/dark, mobile layout.');
} finally { await browser.close(); }
