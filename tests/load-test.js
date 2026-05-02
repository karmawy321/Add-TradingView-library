// HTTP load test — simulates real user browsing patterns.
// Run:
//   k6 run -e BASE_URL=https://fractalaiagent.com -e LOAD_TEST_KEY=yourkey tests/load-test.js
// or against local dev:
//   k6 run -e BASE_URL=http://localhost:8080 -e LOAD_TEST_KEY=yourkey tests/load-test.js

import http from 'k6/http';
import { sleep, check, group } from 'k6';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:8080';
const LOAD_TEST_KEY = __ENV.LOAD_TEST_KEY || '';

const params = {
  headers: LOAD_TEST_KEY ? { 'x-load-test-key': LOAD_TEST_KEY } : {},
};

// Symbols a real user might browse
const SYMBOLS = ['BTCUSD', 'ETHUSD', 'EURUSD', 'GBPUSD', 'XAUUSD', 'GOLD', 'AAPL', 'TSLA'];
const TIMEFRAMES = ['1m', '5m', '15m', '1h', '4h', '1d'];

export const options = {
  stages: [
    { duration: '1m', target: 100 },   // ramp to 100 users
    { duration: '2m', target: 300 },   // ramp to 300
    { duration: '3m', target: 500 },   // hold 500 users for 3 minutes
    { duration: '1m', target: 0 },     // ramp down
  ],
  thresholds: {
    http_req_duration: ['p(95)<3000'], // 95% under 3s
    http_req_failed:   ['rate<0.02'],  // less than 2% errors
    checks:            ['rate>0.95'],  // 95%+ checks pass
  },
};

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

export default function () {
  const symbol = pick(SYMBOLS);
  const tf     = pick(TIMEFRAMES);

  group('homepage', () => {
    const r = http.get(`${BASE_URL}/`, params);
    check(r, { 'home 200': (res) => res.status === 200 });
  });

  sleep(1);

  group('health', () => {
    const r = http.get(`${BASE_URL}/health`, params);
    check(r, { 'health 200': (res) => res.status === 200 });
  });

  group('candles', () => {
    const r = http.get(`${BASE_URL}/candles/${symbol}?tf=${tf}`, params);
    check(r, {
      'candles 200':       (res) => res.status === 200,
      'candles has body':  (res) => res.body && res.body.length > 0,
    });
  });

  sleep(1);

  group('price', () => {
    const r = http.get(`${BASE_URL}/price/${symbol}`, params);
    check(r, { 'price 200': (res) => res.status === 200 });
  });

  group('search', () => {
    const r = http.get(`${BASE_URL}/search?q=${symbol.slice(0, 3)}`, params);
    check(r, { 'search 200': (res) => res.status === 200 });
  });

  sleep(2);

  group('history-scroll', () => {
    const endTime = Date.now();
    const r = http.get(`${BASE_URL}/history/${symbol}?tf=${tf}&endTime=${endTime}`, params);
    check(r, { 'history 200': (res) => res.status === 200 });
  });

  sleep(2);
}
