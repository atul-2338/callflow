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

console.log("─".repeat(60));
console.log(`\nResults: ${passed} passed, ${failed} failed\n`);

process.exit(failed > 0 ? 1 : 0);
