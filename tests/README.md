# Stress Tests

Two tests, run them in this order:

1. **load-test.js** — HTTP load (homepage, candles, history, price, search)
2. **sse-stress-test.js** — SSE concurrent connections (the real bottleneck)

---

## One-time setup

### 1. Install k6

**Windows (PowerShell as admin):**
```
choco install k6
```
Or download the MSI from https://k6.io/docs/get-started/installation/

Verify: `k6 version`

### 2. Install eventsource (for the SSE test)

From the `Add-TradingView-library` folder:
```
npm install --no-save eventsource
```

### 3. Set a load-test key

Pick any random string and add it to your `.env` file in `Add-TradingView-library`:
```
LOAD_TEST_KEY=pick-any-random-string-here-123abc
```

Then restart your server (`node server.js`). Without this, the per-IP rate limits will block your test traffic.

---

## Test 1: HTTP load (k6)

### Against your live site
```
cd "c:\Users\karim\OneDrive\Desktop\fractal agent\fractal ai agent clone\Add-TradingView-library"
k6 run -e BASE_URL=https://fractalaiagent.com -e LOAD_TEST_KEY=pick-any-random-string-here-123abc tests/load-test.js
```

### Against your local server
```
k6 run -e BASE_URL=http://localhost:8080 -e LOAD_TEST_KEY=pick-any-random-string-here-123abc tests/load-test.js
```

**What it does:** ramps from 0 → 100 → 300 → 500 users over 7 minutes, hitting random symbols + timeframes. Total run: ~7 minutes.

**What to look at:**
- `http_req_duration p(95)` — should stay under 3s
- `http_req_failed` — should stay under 2%
- `checks` — should stay above 95%

---

## Test 2: SSE stress (Node)

### Against your live site
```
set BASE_URL=https://fractalaiagent.com
set LOAD_TEST_KEY=pick-any-random-string-here-123abc
set CONNECTIONS=500
node tests/sse-stress-test.js
```

### Against your local server
```
set BASE_URL=http://localhost:8080
set LOAD_TEST_KEY=pick-any-random-string-here-123abc
set CONNECTIONS=500
node tests/sse-stress-test.js
```

**What it does:** opens 500 concurrent SSE streams over 30 seconds, holds them for 2 minutes, then closes them. Prints live stats every 5 seconds.

**What to look at:**
- `live` should equal CONNECTIONS — if it drops, your server is dropping connections
- `failed` should be 0
- `mem` shows the load-test client memory, not your server's. Watch your server's memory separately.

---

## Tuning

Test more or fewer users:
- k6: edit `stages` in `load-test.js` (e.g. change `target: 500` to `target: 1000`)
- SSE: change `CONNECTIONS=500` to any number

Test longer:
- SSE: `set HOLD_SECONDS=600` (10 minutes)

---

## Watching your server during the test

In a second terminal, while the test is running:
```
# Live process stats
tasklist /fi "imagename eq node.exe" /v
```

Or open Windows Task Manager → Details tab → find `node.exe` → watch CPU + Memory columns.

If you're testing locally and want deeper profiling:
```
npm install -g clinic
clinic doctor -- node server.js
```
Then run the load test, stop the server (Ctrl+C), and clinic will open an HTML report in your browser.

---

## What to remove after testing

When you're done, **remove `LOAD_TEST_KEY` from your `.env`** and restart the server. With the key absent, the bypass is fully disabled and your rate limits work normally for real users.
