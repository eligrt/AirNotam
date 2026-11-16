// AirNotam-ISR - IAA reading test v1.00.001
// One polite visit: open the root page, press Notams, open the cards, count, leave.
// Saves nothing to the repo. No retries. If blocked, it stops and reports.
import { chromium } from "playwright";
import { writeFileSync, appendFileSync } from "node:fs";

const URL = "https://aeroinfo.iaa.gov.il/";
const SUMMARY = process.env.GITHUB_STEP_SUMMARY;
const lines = [];
const say = (m) => { console.log(m); lines.push(m); };
const finish = (code) => {
  if (SUMMARY) appendFileSync(SUMMARY, "## IAA reading test v1.00.001\n\n" + lines.map(l => "- " + l).join("\n") + "\n");
  process.exit(code);
};

const browser = await chromium.launch({ headless: true });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();

try {
  say("Opening " + URL);
  const resp = await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 45000 });
  say("Server answered with status " + (resp ? resp.status() : "unknown"));
  await page.waitForTimeout(4000);

  const title = await page.title();
  const text = (await page.innerText("body").catch(() => "")).slice(0, 600);
  say("Page title: " + title);
  if (/block id|access denied|perfdrive|captcha|are you a bot/i.test(title + " " + text)) {
    say("RESULT: BLOCKED. IAA firewall refused this visit. Stopping, no retry.");
    say("Page text: " + text.replace(/\s+/g, " ").slice(0, 300));
    await page.screenshot({ path: "iaa-result.png" });
    writeFileSync("iaa-page.html", await page.content());
    await browser.close();
    finish(2);
  }

  // find the Notams button by its inner name or its visible text
  let btn = page.locator("#notamButton");
  if (await btn.count() === 0) btn = page.getByRole("button", { name: /notams/i });
  if (await btn.count() === 0) btn = page.getByText(/^\s*notams\s*$/i);
  if (await btn.count() === 0) {
    say("RESULT: Notams button not found on the page.");
    await page.screenshot({ path: "iaa-result.png" });
    writeFileSync("iaa-page.html", await page.content());
    await browser.close();
    finish(3);
  }
  say("Notams button found. Pressing it once.");
  await btn.first().click();

  await page.waitForSelector(".notamID", { timeout: 30000 });
  await page.waitForTimeout(2000);
  const total = await page.locator(".labelAeroinfoSameTitle", { hasText: "Total number" }).first().innerText().catch(() => "unknown");
  const cards = await page.locator(".notamID").count();
  say("List loaded. Page says: " + total.replace(/\s+/g, " ").trim() + ". Cards found: " + cards);

  // open each card gently, one every half second
  const arrows = page.locator('label[id^="lblArrow"]');
  const n = await arrows.count();
  let opened = 0;
  for (let i = 0; i < n; i++) {
    const a = arrows.nth(i);
    const t = (await a.innerText()).trim();
    if (t === "▼") {
      await a.click();
      opened++;
      await page.waitForTimeout(500);
    }
  }
  say("Cards opened: " + opened + " of " + n);
  await page.waitForTimeout(1500);

  const longs = await page.locator(".notamClassLong").allInnerTexts();
  const withQ = longs.filter(t => /Q\)/.test(t)).length;
  say("Cards with full text: " + longs.length + ". Of these with a Q line: " + withQ);
  if (longs[0]) say("Sample: " + longs[0].replace(/\s+/g, " ").trim().slice(0, 260));

  writeFileSync("iaa-page.html", await page.content());
  await page.screenshot({ path: "iaa-result.png" });
  say(longs.length === cards && withQ > 0 ? "RESULT: SUCCESS. IAA let this visit through and every card has full text." : "RESULT: PARTIAL. Page opened, but not every card has full text.");
  await browser.close();
  finish(0);
} catch (e) {
  say("RESULT: FAILED. " + String(e.message || e).split("\n")[0]);
  try { await page.screenshot({ path: "iaa-result.png" }); writeFileSync("iaa-page.html", await page.content()); } catch {}
  await browser.close();
  finish(1);
}
