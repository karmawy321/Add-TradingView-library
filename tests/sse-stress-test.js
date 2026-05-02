// SSE stress test — opens N concurrent EventSource connections.
// This is your real bottleneck: each connection is a long-lived socket
// holding memory + a slot in the SSE broadcast loop.
//
// Install once:
//   npm install --no-save eventsource
//
// Run:
//   BASE_URL=https://fractalaiagent.com LOAD_TEST_KEY=yourkey CONNECTIONS=500 node tests/sse-stress-test.js
// or local:
//   BASE_URL=http://localhost:8080 LOAD_TEST_KEY=yourkey CONNECTIONS=500 node tests/sse-stress-test.js

const EventSource = require('eventsource');

const BASE_URL      = process.env.BASE_URL      || 'http://localhost:8080';
const LOAD_TEST_KEY = process.env.LOAD_TEST_KEY || '';
const CONNECTIONS   = parseInt(process.env.CONNECTIONS || '500', 10);
const HOLD_SECONDS  = parseInt(process.env.HOLD_SECONDS || '120', 10);
const RAMP_SECONDS  = parseInt(process.env.RAMP_SECONDS || '30', 10);

const SYMBOLS = ['BTCUSD', 'ETHUSD', 'EURUSD', 'GBPUSD', 'XAUUSD', 'GOLD'];

const stats = {
  opened: 0,
  failed: 0,
  messages: 0,
  errors: 0,
  closed: 0,
};

const sources = [];

function openOne(idx) {
  const symbol = SYMBOLS[idx % SYMBOLS.length];
  const url    = `${BASE_URL}/subscribe/${symbol}`;
  const opts   = LOAD_TEST_KEY ? { headers: { 'x-load-test-key': LOAD_TEST_KEY } } : {};

  const es = new EventSource(url, opts);

  es.onopen    = () => { stats.opened++; };
  es.onmessage = () => { stats.messages++; };
  es.onerror   = (err) => {
    stats.errors++;
    if (es.readyState === EventSource.CLOSED) stats.failed++;
  };

  sources.push(es);
}

function printStats() {
  const live = stats.opened - stats.closed;
  console.log(
    `[t+${Math.floor((Date.now() - start) / 1000)}s] ` +
    `opened=${stats.opened} live=${live} failed=${stats.failed} ` +
    `msgs=${stats.messages} errors=${stats.errors} ` +
    `mem=${Math.round(process.memoryUsage().rss / 1024 / 1024)}MB`
  );
}

const start = Date.now();
console.log(`SSE stress test → ${BASE_URL}`);
console.log(`Target: ${CONNECTIONS} connections, ramp ${RAMP_SECONDS}s, hold ${HOLD_SECONDS}s\n`);

const rampInterval = (RAMP_SECONDS * 1000) / CONNECTIONS;
let i = 0;
const ramp = setInterval(() => {
  if (i >= CONNECTIONS) { clearInterval(ramp); console.log(`\n✓ All ${CONNECTIONS} connections opened\n`); return; }
  openOne(i++);
}, rampInterval);

const ticker = setInterval(printStats, 5000);

setTimeout(() => {
  console.log('\nClosing all connections...');
  clearInterval(ticker);
  for (const es of sources) { try { es.close(); stats.closed++; } catch (_) {} }
  printStats();
  console.log('\n=== RESULTS ===');
  console.log(`Peak connections : ${stats.opened}`);
  console.log(`Failed           : ${stats.failed}`);
  console.log(`Messages received: ${stats.messages}`);
  console.log(`Total errors     : ${stats.errors}`);
  process.exit(0);
}, (RAMP_SECONDS + HOLD_SECONDS) * 1000);
