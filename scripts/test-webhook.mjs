/**
 * Test script: verifies the IVR (voicemail fallback) endpoints handle mock payloads.
 * Run with: node scripts/test-webhook.mjs
 * Requires the dev server to be running on port 3000.
 */

const BASE_URL = process.env.TEST_URL || "http://localhost:3000";

const testCases = [
  {
    name: "IVR incoming-call returns Dial LaML",
    method: "POST",
    url: `${BASE_URL}/api/ivr/incoming-call`,
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: "From=%2B15559876543&To=%2B15551234567&CallSid=CA_ivr_incoming_001",
    expectedStatus: 200,
    expectContains: "<Dial",
  },
  {
    name: "IVR dial-result (no-answer) returns Say+Record LaML",
    method: "POST",
    url: `${BASE_URL}/api/ivr/dial-result`,
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: "DialCallStatus=no-answer&From=%2B15559876543&To=%2B15551234567&CallSid=CA_ivr_missed_002",
    expectedStatus: 200,
    expectContains: "<Record",
  },
  {
    name: "IVR dial-result (completed) returns empty Response",
    method: "POST",
    url: `${BASE_URL}/api/ivr/dial-result`,
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: "DialCallStatus=completed&From=%2B15551112222&To=%2B15551234567&CallSid=CA_ivr_answered_003",
    expectedStatus: 200,
    expectContains: "<Response></Response>",
  },
  {
    name: "IVR recording-complete saves voicemail + returns goodbye",
    method: "POST",
    url: `${BASE_URL}/api/ivr/recording-complete`,
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: "RecordingUrl=https%3A%2F%2Fexample.com%2Frec.wav&TranscriptionText=hello%20please%20call%20back&From=%2B15553334444&CallSid=CA_ivr_missed_002",
    expectedStatus: 200,
    expectContains: "<Hangup",
  },
  {
    name: "GET contacts API",
    method: "GET",
    url: `${BASE_URL}/api/contacts`,
    body: null,
    expectedStatus: 200,
  },
  {
    name: "GET settings API",
    method: "GET",
    url: `${BASE_URL}/api/settings`,
    body: null,
    expectedStatus: 200,
  },
  {
    name: "GET calls API",
    method: "GET",
    url: `${BASE_URL}/api/calls`,
    body: null,
    expectedStatus: 200,
  },
];

let passed = 0;
let failed = 0;

console.log(`\n🧪 CallFlow IVR Test Suite — ${BASE_URL}\n`);
console.log("─".repeat(60));
for (const test of testCases) {
  try {
    const options = {
      method: test.method,
      headers: test.headers || {},
    };
    if (test.body) {
      options.body = test.body;
    }

    const res = await fetch(test.url, options);
    const text = await res.text();

    const ok =
      res.status === test.expectedStatus &&
      (!test.expectContains || text.includes(test.expectContains));

    if (ok) {
      passed++;
      console.log(`✅ ${test.name} (${res.status})`);
    } else {
      failed++;
      console.log(`❌ ${test.name} — expected ${test.expectedStatus}, got ${res.status}`);
      console.log(`   Response: ${text.slice(0, 300)}`);
    }
  } catch (err) {
    failed++;
    console.log(`❌ ${test.name} — ${err.message}`);
    if (err.cause?.code === "ECONNREFUSED") {
      console.log("   → Is the dev server running? Start with: npm run dev");
      break;
    }
  }
}

// Onboarding end-to-end simulation (no real phone or Plivo needed):
// start -> simulate the forwarded call landing on the Plivo number ->
// status flips to "active".
const SIM_PHONE = "+15550100100";
const SIM_PHONE_TYPE = "android";

async function runOnboardingSimulation() {
  console.log("\n📞 Onboarding end-to-end simulation\n");

  const startRes = await fetch(`${BASE_URL}/api/onboarding/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      phone_number: SIM_PHONE,
      phone_type: SIM_PHONE_TYPE,
    }),
  });
  const start = await startRes.json().catch(() => ({}));
  if (startRes.status !== 200 || !start.businessId) {
    failed++;
    console.log(
      `❌ onboarding start — HTTP ${startRes.status}: ${JSON.stringify(start).slice(0, 200)}`
    );
    return;
  }
  passed++;
  console.log(
    `✅ onboarding start — businessId ${start.businessId}, forward to ${start.plivo_number}`
  );

  const completeRes = await fetch(`${BASE_URL}/api/onboarding/complete`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ businessId: start.businessId }),
  });
  const complete = await completeRes.json().catch(() => ({}));
  if (completeRes.status !== 200 || complete.forwarding_status !== "active") {
    failed++;
    console.log(
      `❌ onboarding complete — HTTP ${completeRes.status}: ${JSON.stringify(complete).slice(0, 200)}`
    );
    return;
  }
  passed++;
  console.log(`✅ onboarding complete — active, saved_at ${complete.saved_at}`);

  const statusRes = await fetch(`${BASE_URL}/api/onboarding/status/${start.businessId}`);
  const status = await statusRes.json().catch(() => ({}));
  if (statusRes.status === 200 && status.forwarding_status === "active") {
    passed++;
    console.log(`✅ onboarding status — active (${status.phone_number})`);
  } else {
    failed++;
    console.log(
      `❌ onboarding status — expected active, got ${status.forwarding_status || statusRes.status}`
    );
  }
}

await runOnboardingSimulation();

console.log("─".repeat(60));
console.log(`\nResults: ${passed} passed, ${failed} failed\n`);

process.exit(failed > 0 ? 1 : 0);
