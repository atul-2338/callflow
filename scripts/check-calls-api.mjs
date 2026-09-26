// Fetch /api/calls through the tunnel to confirm the simulated call landed.
const r = await fetch("https://expanse-grunge-glass.ngrok-free.dev/api/calls");
const text = await r.text();
console.log(`status: ${r.status}`);
console.log(text.slice(0, 4000));
