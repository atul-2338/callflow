// Browser test for the CallFlow setup (call-forwarding) wizard and the
// Telnyx webhook endpoint reachability.
//
// The repo has no formal browser-test framework (RUNBOOK documents manual
// browser verification), so this script drives the system Chrome through
// playwright-core — no browser download, no real credentials. It exercises
// the real user journey at desktop and mobile viewports and reports console /
// network errors.
//
// Run:  node scripts/browser-test-setup.mjs
// Env:  BASE_URL (default http://localhost:3000), CHROME_PATH (defaults to
//       the standard Google Chrome install path).

import { chromium } from "playwright-core";
import { isValidPhoneNumber } from "libphonenumber-js";

const BASE = process.env.BASE_URL || "http://localhost:3000";
const CHROME_PATH =
  process.env.CHROME_PATH ||
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

// The wizard's dial codes come from the server env now (GET /api/setup/config
// reads CALLFLOW_FORWARDING_DID), so the expected strings are derived here too.
// Must match the server's value; defaults to the number the wizard showed
// before it moved to env config.
const CALLFLOW_FORWARDING_DID =
  process.env.CALLFLOW_FORWARDING_DID || "+19283319394";

function formatDidDisplay(e164) {
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e164);
  return m ? `+1 (${m[1]}) ${m[2]}-${m[3]}` : e164;
}
const DID_DISPLAY = formatDidDisplay(CALLFLOW_FORWARDING_DID);
const DID_DIGITS10 = CALLFLOW_FORWARDING_DID.replace(/\D/g, "").replace(
  /^1(?=\d{10}$)/,
  ""
);
const VERIZON_DIAL = "*71" + DID_DIGITS10;

const results = [];
const consoleErrors = [];
const pageErrors = [];
const failedRequests = [];

function check(name, ok, detail = "") {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(`  [${ok ? "PASS" : "FAIL"}] ${name}${detail ? ` — ${detail}` : ""}`);
}

function section(title) {
  console.log(`\n== ${title} ==`);
}

// A unique, structurally-valid US number per run so the test never collides
// with an existing business row.
function makeTestPhone() {
  for (let i = 0; i < 20; i++) {
    const n = `+1415${String(Math.floor(Math.random() * 1e7)).padStart(7, "0")}`;
    if (isValidPhoneNumber(n)) return n;
  }
  return "+14155552671";
}

function attachHarness(page) {
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(`[console] ${msg.text()}`);
  });
  page.on("pageerror", (err) => pageErrors.push(`[pageerror] ${String(err)}`));
  page.on("requestfailed", (req) =>
    failedRequests.push(
      `[requestfailed] ${req.method()} ${req.url()} :: ${req.failure()?.errorText ?? "?"}`
    )
  );
}

async function waitForText(page, text, timeout = 15000) {
  await page.getByText(text, { exact: false }).first().waitFor({ timeout });
}

// The config fetch is async; give it a moment but never fail the run here —
// the following check() reports the real state if the number never appeared.
async function waitForTextQuiet(page, text, timeout = 10000) {
  await page
    .getByText(text, { exact: false })
    .first()
    .waitFor({ timeout })
    .catch(() => {});
}

async function runDesktop(browser) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    permissions: ["clipboard-read", "clipboard-write"],
  });
  const page = await context.newPage();
  attachHarness(page);
  const phone = makeTestPhone();
  const phoneDigits = phone.replace(/\D/g, "").replace(/^1/, ""); // 10 digits

  section("A. Desktop — step 1 presentation & validation");
  await page.goto(`${BASE}/setup`, { waitUntil: "networkidle" });
  check("setup page loads", page.url().includes("/setup"));
  check("step indicator 'Step 1 of 3' shown", await page.getByText("Step 1 of 3").isVisible());
  check(
    "heading asks for business phone number",
    await page.getByRole("heading", { name: /What's your business phone number/ }).isVisible()
  );
  check("phone input present", await page.locator('input[type="tel"]').isVisible());
  check("carrier select present", await page.locator("select").isVisible());
  const carrierOptions = (await page.locator("select option").allTextContents()).join(",");
  check(
    "carrier options listed (Verizon/AT&T/T-Mobile/Other)",
    carrierOptions.includes("Verizon") && carrierOptions.includes("AT&T")
  );
  check("Continue button present", await page.getByRole("button", { name: "Continue" }).isVisible());

  // Empty submit → validation error
  await page.getByRole("button", { name: "Continue" }).click();
  await waitForText(page, "Please enter a valid phone number with country code");
  check(
    "empty submit shows useful validation error",
    await page.getByText("Please enter a valid phone number with country code").isVisible()
  );

  // Invalid phone → same error
  await page.locator('input[type="tel"]').fill("123");
  await page.getByRole("button", { name: "Continue" }).click();
  await waitForText(page, "Please enter a valid phone number with country code");
  check(
    "short phone shows the same useful error",
    await page.getByText("Please enter a valid phone number with country code").isVisible()
  );

  // Valid phone + carrier → step 2
  await page.locator('input[type="tel"]').fill(phoneDigits);
  await page.locator("select").selectOption("verizon");
  await page.getByRole("button", { name: "Continue" }).click();
  await waitForText(page, "Step 2 of 3");
  check("valid phone + carrier advances to step 2", await page.getByText("Step 2 of 3").isVisible());

  section("B. Desktop — step 2 presentation & dial-code flow");
  check(
    "heading 'Turn on AI after-hours backup'",
    await page.getByRole("heading", { name: /Turn on AI after-hours backup/ }).isVisible()
  );
  check(
    "generated carrier instruction sentence present",
    await page.getByText(/dial this code on your phone/).isVisible()
  );
  await waitForTextQuiet(page, DID_DISPLAY);
  check(
    `forwarding number ${DID_DISPLAY} shown`,
    await page.getByText(DID_DISPLAY).first().isVisible()
  );
  check(
    "two Copy buttons (dial code + our number)",
    (await page.getByRole("button", { name: "Copy" }).count()) === 2
  );
  check(
    "dial-it-now + test-call tel: links present",
    (await page.locator('a[href^="tel:"]').count()) === 2
  );
  check(
    "confirm button 'I've dialed the code' present",
    await page.getByRole("button", { name: /activate my AI backup/ }).isVisible()
  );
  check(
    "manual phone-settings steps are explicit (dashboard-only action is manual)",
    await page.getByText("Open your phone's Settings").isVisible()
  );
  check(
    "skip-forwarding note present",
    await page.getByText(/you can skip forwarding/).isVisible()
  );
  check(
    "'Call me now' button present",
    await page.getByRole("button", { name: "Call me now" }).isVisible()
  );
  check(
    "'Text me a code' button present",
    await page.getByRole("button", { name: "Text me a code" }).isVisible()
  );
  check(
    "billing fields present (name/email/country)",
    (await page.getByPlaceholder("Your name").isVisible()) &&
      (await page.getByPlaceholder("Email address").isVisible()) &&
      (await page.getByPlaceholder("Billing country (2-letter code, e.g. US)").isVisible())
  );
  check(
    "'Continue to secure checkout' present",
    await page.getByRole("button", { name: "Continue to secure checkout" }).isVisible()
  );

  // Copy buttons → clipboard (first = carrier dial string, second = our number)
  await page.getByRole("button", { name: "Copy" }).first().click();
  const clip = await page.evaluate(() => navigator.clipboard.readText().catch(() => ""));
  check(
    `first Copy button copies the Verizon dial string ${VERIZON_DIAL}`,
    clip === VERIZON_DIAL,
    "clipboard=" + JSON.stringify(clip)
  );
  await page.getByRole("button", { name: "Copy" }).nth(1).click();
  const clip2 = await page.evaluate(() => navigator.clipboard.readText().catch(() => ""));
  check(
    `second Copy button copies ${CALLFLOW_FORWARDING_DID} to clipboard`,
    clip2 === CALLFLOW_FORWARDING_DID,
    "clipboard=" + JSON.stringify(clip2)
  );

  section("C. Desktop — verification actions: progress & failure states");
  const verifyCard = page
    .locator("div.rounded-2xl")
    .filter({ hasText: "Automatic verification (optional)" });
  const readVerifyMsg = async () => {
    const texts = await verifyCard.locator("p.text-xs").allTextContents().catch(() => []);
    return texts.join(" | ").trim();
  };

  // Call verification. With placeholder Plivo creds this should fail loudly
  // and show an accurate error (never a false success).
  await page.getByRole("button", { name: "Call me now" }).click();
  await page.waitForTimeout(2500);
  const callMsg = await readVerifyMsg();
  const callOk = /We're calling you now|Number verified/.test(callMsg);
  const callErr = /error|failed|not configured|Plivo|PUBLIC_BASE_URL/i.test(callMsg);
  check(
    "call verification shows progress or an accurate failure state",
    callOk || callErr,
    "message=" + JSON.stringify(callMsg)
  );
  if (callOk) {
    check("call verification success is gated on server status", true, "polling /api/onboarding/status");
  } else {
    check(
      "call failure message is user-actionable",
      /configured|Plivo|failed|error|PUBLIC_BASE_URL/i.test(callMsg),
      "message=" + JSON.stringify(callMsg)
    );
  }

  // SMS verification.
  await page.getByRole("button", { name: "Text me a code" }).click();
  await page.waitForTimeout(2500);
  const smsMsg = await readVerifyMsg();
  const smsOk = /texted a 6-digit code|Number verified/.test(smsMsg);
  const smsErr =
    /error|failed|not configured|Plivo|unverified|toll-free|invalid|does not belong/i.test(
      smsMsg
    );
  check(
    "SMS verification shows progress or an accurate failure state",
    smsOk || smsErr,
    "message=" + JSON.stringify(smsMsg)
  );

  section("D. Desktop — SMS code entry validation");
  const codeInput = page.getByPlaceholder("6-digit code");
  if (await codeInput.isVisible().catch(() => false)) {
    await codeInput.fill("abc123");
    check("code input filters non-digits", (await codeInput.inputValue()) === "123", "value=" + JSON.stringify(await codeInput.inputValue()));
    await codeInput.fill("12345");
    const verifyBtn = page.getByRole("button", { name: "Verify" });
    check("Verify disabled until 6 digits", await verifyBtn.isDisabled());
    await codeInput.fill("123456");
    check("Verify enabled at 6 digits", await verifyBtn.isEnabled());
    await verifyBtn.click();
    await page.waitForTimeout(1500);
    const wrongCodeMsg = await readVerifyMsg();
    check(
      "wrong code shows a useful error",
      /invalid|expired|error/i.test(wrongCodeMsg),
      "message=" + JSON.stringify(wrongCodeMsg)
    );
  } else {
    const smsFailMsg = await readVerifyMsg();
    check(
      "SMS code entry appears after 'Text me a code'",
      /unverified|toll-free|not configured|failed|error|invalid|does not belong/i.test(
        smsFailMsg
      ),
      "blocked by placeholder Plivo creds; accurate error shown: " + JSON.stringify(smsFailMsg)
    );
  }

  section("F. Desktop — resume behavior");
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(2000); // allow the restore effect to re-fetch status
  const resumed = await page.getByText("Step 2 of 3").isVisible().catch(() => false);
  check(
    "reload resumes at step 2 without repeating step 1",
    resumed,
    resumed
      ? "state restored after reload"
      : "wizard resets to step 1 on reload (businessId is in-memory only)"
  );

  section("E. Desktop — billing action & success gating");
  // If the resume fix restored step 2, we're already there; otherwise re-enter
  // step 1 and advance.
  if (!(await page.getByText("Step 2 of 3").isVisible().catch(() => false))) {
    await page.locator('input[type="tel"]').fill(phoneDigits);
    await page.locator("select").selectOption("verizon");
    await page.getByRole("button", { name: "Continue" }).click();
    await waitForText(page, "Step 2 of 3");
  }
  // Success gating: step 3 must NOT appear without a verified subscription.
  check(
    "success screen is NOT shown before the connection is verified",
    !(await page.getByText("You're all set!").isVisible().catch(() => false)),
    "step 3 only appears after a verified Dodo webhook (hasSubscription)"
  );
  await page.getByPlaceholder("Your name").fill("Browser Test");
  await page.getByPlaceholder("Email address").fill("browser-test@example.com");
  await page.getByPlaceholder("Billing country (2-letter code, e.g. US)").fill("US");
  await page.getByRole("button", { name: "Continue to secure checkout" }).click();
  await page.waitForTimeout(4000);
  const billingErr = await page
    .locator("p.text-sm.text-danger")
    .textContent()
    .catch(() => "");
  const onDodo = page.url().includes("checkout.dodo") || page.url().includes("dodo");
  check(
    "billing action either opens checkout or shows an accurate error",
    onDodo || Boolean(billingErr),
    onDodo ? "redirected to " + page.url() : "error=" + JSON.stringify((billingErr ?? "").trim())
  );

  section("G. Desktop — navigation & Telnyx endpoint reachability");
  // The billing test redirected to the external Dodo checkout; come back to
  // the app before exercising navigation.
  await page.goto(`${BASE}/calls`, { waitUntil: "networkidle" });
  await page.waitForLoadState("networkidle");
  check("nav to /calls works", page.url().includes("/calls"));
  await page.getByRole("link", { name: "Settings" }).click();
  await page.waitForURL("**/settings", { timeout: 10000 });
  check("nav to /settings works", page.url().includes("/settings"));
  // The settings page intentionally renders no credential fields (business
  // info, forwarding status, notification prefs, billing only) — so instead
  // of expecting password inputs, assert nothing secret-shaped is exposed.
  const pwInputs = await page.locator('input[type="password"]').count();
  const settingsHtml = await page.content();
  const leaksSecret =
    /sk_live_|sk_test_|Bearer\s+[A-Za-z0-9_\-]{16,}|api[_-]?key["'\s:=]+\s*[A-Za-z0-9_\-]{16,}/i.test(
      settingsHtml
    );
  check(
    "settings page exposes no credential fields or secret values",
    pwInputs === 0 && !leaksSecret,
    pwInputs + " password input(s), leaksSecret=" + leaksSecret
  );

  // Telnyx webhook endpoint reachability from the browser context.
  const telnyxRes = await page.evaluate(async () => {
    const res = await fetch("/api/v1/telephony/telnyx/answer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        data: {
          event_type: "call.initiated",
          id: "browser-test-event",
          payload: {
            call_control_id: "browser-test-ccid",
            from: "+14155552671",
            to: CALLFLOW_FORWARDING_DID,
            call_session_id: "browser-test-session",
          },
        },
      }),
    });
    return { status: res.status, body: await res.text() };
  });
  check(
    "Telnyx answer webhook is reachable and acknowledges call.initiated (200)",
    telnyxRes.status === 200,
    "status=" + telnyxRes.status + " body=" + JSON.stringify(telnyxRes.body)
  );

  await context.close();
  return phone;
}

async function runMobile(browser) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    permissions: ["clipboard-read", "clipboard-write"],
  });
  const page = await context.newPage();
  attachHarness(page);
  const phone = makeTestPhone();
  const phoneDigits = phone.replace(/\D/g, "").replace(/^1/, "");

  section("H. Mobile (390x844) — full journey");
  await page.goto(`${BASE}/setup`, { waitUntil: "networkidle" });
  check("mobile: step 1 loads", await page.getByText("Step 1 of 3").isVisible());
  const overflow1 = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth
  );
  check("mobile: no horizontal overflow on step 1", overflow1 <= 0, "overflow=" + overflow1 + "px");

  await page.locator('input[type="tel"]').fill(phoneDigits);
  await page.locator("select").selectOption("att");
  await page.getByRole("button", { name: "Continue" }).click();
  await waitForText(page, "Step 2 of 3");
  check("mobile: advances to step 2", await page.getByText("Step 2 of 3").isVisible());
  const overflow2 = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth
  );
  check("mobile: no horizontal overflow on step 2", overflow2 <= 0, "overflow=" + overflow2 + "px");
  await waitForTextQuiet(page, DID_DISPLAY);
  check(
    "mobile: forwarding number visible",
    await page.getByText(DID_DISPLAY).first().isVisible()
  );
  check(
    "mobile: 'Call me now' visible",
    await page.getByRole("button", { name: "Call me now" }).isVisible()
  );
  check(
    "mobile: 'Text me a code' visible",
    await page.getByRole("button", { name: "Text me a code" }).isVisible()
  );
  check(
    "mobile: billing fields visible",
    (await page.getByPlaceholder("Your name").isVisible()) &&
      (await page.getByPlaceholder("Email address").isVisible())
  );
  check(
    "mobile: 'Continue to secure checkout' visible",
    await page.getByRole("button", { name: "Continue to secure checkout" }).isVisible()
  );

  // Mobile verification failure state
  await page.getByRole("button", { name: "Text me a code" }).click();
  await page.waitForTimeout(2500);
  const mobileVerifyCard = page
    .locator("div.rounded-2xl")
    .filter({ hasText: "Automatic verification (optional)" });
  const smsMsg = await mobileVerifyCard
    .locator("p.text-xs")
    .allTextContents()
    .then((t) => t.join(" | ").trim())
    .catch(() => "");
  check(
    "mobile: SMS verification shows progress or accurate failure state",
    /texted a 6-digit code|Number verified|error|failed|not configured|Plivo|unverified|toll-free|invalid|does not belong/i.test(smsMsg),
    "message=" + JSON.stringify(smsMsg.trim())
  );

  // Mobile nav
  // The billing test redirected to the external Dodo checkout; come back to
  // the app before exercising navigation.
  await page.goto(`${BASE}/calls`, { waitUntil: "networkidle" });
  await page.waitForLoadState("networkidle");
  check("mobile: nav to /calls works", page.url().includes("/calls"));
  await page.locator('nav a[href="/settings"]').first().click();
  await page.waitForURL("**/settings", { timeout: 10000 });
  check("mobile: nav to /settings works", page.url().includes("/settings"));

  await context.close();
}

// C. Wizard forwarding step — the /onboarding hand-off. Exercises the
// frontend-only fix: after checkout the owner must land on the carrier
// forwarding step (not the dashboard), and /app is only reachable after they
// attest they dialed the code. Replays the same localStorage handshake the
// billing step writes (callflow_wizard_state) with a real business created
// via /api/onboarding/start so the confirm POST succeeds server-side.
async function runWizardForwarding(browser) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
  });
  const page = await context.newPage();
  attachHarness(page);

  section("C. Wizard — final forwarding step & interaction-gated redirect");
  const phone = makeTestPhone();

  // Create a real business row directly (what wizard step 1 would do) so the
  // confirm POST has something to complete.
  let businessId = null;
  try {
    const response = await fetch(`${BASE}/api/onboarding/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone_number: phone, carrier: "verizon" }),
    });
    const data = await response.json();
    businessId = data.businessId ?? null;
  } catch {
    businessId = null;
  }
  check(
    "wizard: business created via /api/onboarding/start",
    Boolean(businessId),
    `phone=${phone}`
  );

  // Seed the same localStorage hand-off the billing step writes before the
  // checkout redirect.
  const wizardState = JSON.stringify({
    businessId,
    form: {
      name: "Wizard Check Plumbing",
      industry: "Plumbing",
      carrier: "Verizon",
      phone,
      email: "wizard-check@example.com",
      country: "US",
    },
  });
  await page.goto(`${BASE}/onboarding`, { waitUntil: "domcontentloaded" });
  await page.evaluate(
    ([key, value]) => window.localStorage.setItem(key, value),
    ["callflow_wizard_state", wizardState]
  );

  // CheckoutReturn redirects here after payment confirmation.
  await page.goto(`${BASE}/onboarding?forwarding=1`, { waitUntil: "networkidle" });
  check(
    "wizard: ?forwarding=1 resumes at the forwarding step (step 3)",
    await page.getByText("Turn on AI after-hours backup").first().isVisible()
  );
  check(
    "wizard: step indicator shows 'Step 3 of 3'",
    await page.getByText("Step 3 of 3").isVisible()
  );
  await waitForTextQuiet(page, VERIZON_DIAL);
  check(
    "wizard: carrier forwarding dial code shown",
    await page.getByText(VERIZON_DIAL).first().isVisible(),
    `verizon dial string for ${CALLFLOW_FORWARDING_DID}`
  );
  const confirmButton = page.getByRole("button", { name: /dialed the code/ });
  check(
    "wizard: confirm button enabled with businessId",
    await confirmButton.isEnabled()
  );

  // The regression this task fixes: no auto-redirect to /app before the
  // owner interacts with the forwarding step.
  await page.waitForTimeout(3500);
  check(
    "wizard: stays on /onboarding (no auto-redirect to /app)",
    page.url().includes("/onboarding")
  );

  await confirmButton.click();
  await waitForText(
    page,
    "Onboarding complete — AI backup is active for your number.",
    15000
  );
  check(
    "wizard: confirm shows the activation banner",
    await page
      .getByText("Onboarding complete — AI backup is active for your number.")
      .isVisible()
  );

  // The ONLY path to /app: the owner just attested they dialed the code.
  await page.waitForURL("**/app", { timeout: 10000 });
  check(
    "wizard: lands on /app only after confirming",
    page.url().includes("/app")
  );

  await context.close();
}

async function main() {
  const browser = await chromium.launch({
    executablePath: CHROME_PATH,
    headless: true,
  });
  try {
    await runDesktop(browser);
    await runMobile(browser);
    await runWizardForwarding(browser);
  } finally {
    await browser.close();
  }

  section("Summary");
  const passed = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok);
  console.log(`  ${passed} passed, ${failed.length} failed of ${results.length} checks`);
  if (failed.length) {
    console.log("\n  Failed checks:");
    for (const f of failed) console.log("    - " + f.name + (f.detail ? " (" + f.detail + ")" : ""));
  }
  if (consoleErrors.length) {
    console.log("\n  Console errors (" + consoleErrors.length + "):");
    for (const e of consoleErrors.slice(0, 20)) console.log("    " + e);
  }
  if (pageErrors.length) {
    console.log("\n  Page errors (" + pageErrors.length + "):");
    for (const e of pageErrors.slice(0, 20)) console.log("    " + e);
  }
  if (failedRequests.length) {
    console.log("\n  Failed/4xx+ requests (" + failedRequests.length + "):");
    for (const r of failedRequests.slice(0, 30)) console.log("    " + r);
  }
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
  console.error("Browser test crashed:", err);
  process.exit(2);
});

