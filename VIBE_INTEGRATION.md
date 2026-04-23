# Vibe-Trading Integration Roadmap

Source repo: https://github.com/HKUDS/Vibe-Trading (MIT License)

Vibe-Trading is a Python-based open-source multi-agent AI trading platform. We are NOT porting its full stack — only borrowing specific ideas and algorithms that fill real gaps in our system.

---

## Developer Workflow (Claude must follow this)

**Claude's role:** Edit files only. Never run git commands (add/commit/push).

**Deployment pipeline (user-managed):**
1. Claude edits files in `Add-TradingView-library` branch
2. User copies changed files to `main` branch manually
3. User commits + pushes via GitHub Desktop
4. User SSHs into DigitalOcean droplet → `git pull && pm2 restart fractal`

---

## Project Summary (Fractal AI Agent)

**Stack:** Node.js + Express (`server.js` ~3600+ lines), Vanilla JS frontend (`public/index.html` ~9700 lines), Supabase auth/DB, Stripe payments, Anthropic Claude API, DigitalOcean droplet deployment.

**Charting:** Custom HTML5 Canvas renderer — NOT TradingView, NOT any external chart library. Fully hand-drawn candlesticks, overlays, annotations via Canvas API.

**Data Sources:**
- Primary: TwelveData REST + WebSocket (crypto, forex, stocks, metals, indices)
- Secondary: MetaAPI / OANDA (51 premium symbols — broker-grade, disk-cached)
- tertiary: TwelveData REST cached (8 crypto + 11 forex — fast, reliable, disk-cached)

**AI Tools (11 endpoints, Claude API):**
- `/analyze` — fractal analysis, entry/SL/TP, wave structure (12 cr)
- `/bar-pattern` — self-similarity detection (12 cr)
- `/weierstrass` — Hurst exponent, fractal dimension, roughness (12 cr)
- `/mtf` — multi-timeframe confluence (20 cr)
- `/fractal-age` — fractal lifecycle age (15 cr)
- `/projection` — price path scenarios with probability (25 cr, saves to DB)
- `/fibonacci` — retracements + extensions (12 cr)
- `/smc` — Smart Money Concepts: order blocks, supply/demand (16 cr)
- `/volatility` — ATR regime + position sizing (12 cr)
- `/liquidity` — liquidity clusters, stop hunt targets (20 cr)
- `/journal` — automated trade review (20 cr)

**Algorithmic Engine (`sniper-engine.js` ~1288 lines):**
Pure math, zero AI cost. Detects: swing highs/lows (timeframe-adaptive params), market structure (HH/HL/LH/LL), order blocks (mitigation-aware), S/R clusters, Fibonacci confluence (capped at best 2 hits), harmonic patterns (Gartley/Bat/Butterfly/Crab), chart patterns (H&S, double top/bottom, triangles, broadening, candlestick patterns). Outputs: direction, entry, SL, TP1/TP2 (floors: 1.5:1 / 2.5:1 RR), confidence score (±30 pattern cap + ±5 pulse adjustment), context tags, patterns array, harmonic_prz.

**Outcome Tracking:**
- Sniper signals: auto-graded every 6h vs OANDA cached candles
- Prediction tool: daily 2AM cron checks actual price vs saved projection
- Admin dashboards: `/admin/sniper` (+ purge button), `/admin/scanner`, `/admin/cache-status`

**Subscription Tiers:** Free (50 cr) → Starter ($69, 500 cr) → Pro ($149, 1500 cr) → Elite ($299, 4000 cr) → Institutional ($999, 15000 cr)

---

## What Vibe-Trading Has That We Don't

| Gap | Vibe-Trading Feature | Our Status |
|-----|---------------------|------------|
| Chart pattern detection | H&S, double top/bottom, triangles, broadening, candlestick patterns | ✅ Closed |
| Harmonic patterns | Gartley, Bat, Butterfly, Crab (XABCD) | ✅ Closed |
| Backtesting | Monte Carlo, Sharpe, drawdown, walk-forward | ✅ Closed |
| Adaptive confidence | Historical win rates feeding back into scoring | ✅ Closed |
| Multi-agent AI chains | DAG-based specialized agent orchestration | Partial — `/projection` only |

---

## Integration Checklist

### Strategy 1 — Port Pattern Recognition into `sniper-engine.js`
> Pure math, no new dependencies. Directly extends the sniper engine.

- [x] **Head & Shoulders detection** ✅
- [x] **Double Top / Double Bottom detection** ✅
- [x] **Ascending / Descending / Symmetrical Triangle** ✅
- [x] **Broadening / Megaphone Pattern** ✅
- [x] **Candlestick Pattern Detection** ✅
- [x] **Trend Line Slope (linear fit)** ✅
- [x] **Integrate patterns into sniper confidence scoring** ✅
- [x] **Add `patterns` field to sniper signal output JSON** ✅
- [x] **Harmonic Pattern Detection (Gartley, Bat, Butterfly, Crab)** ✅
  - XABCD 5-point structure with Fibonacci ratio tolerance checks
  - PRZ (Potential Reversal Zone) at D point
  - ATR-based confluence tolerance — prevents all levels firing on tight swing ranges
  - `harmonic_prz` field added to signal output
  - Harmonic names included in `hasConfirmedReversal` check

---

### Strategy 2 — Build Backtest Engine
> Biggest feature gap. Closes the loop: Sniper → Backtest → Prediction Tracker → Admin.

- [x] **Design backtest runner module (`backtest-engine.js`)** ✅
- [x] **Implement trade simulation loop** ✅
- [x] **Calculate performance metrics** ✅
- [x] **Monte Carlo simulation** ✅
- [x] **Add `/backtest` API endpoint to `server.js`** ✅
- [x] **Frontend backtest panel** ✅
- [ ] **Store backtest results in Supabase**
- [ ] **Wire backtest into Admin dashboard**

---

### Strategy 3 — Condition Weight Feedback Loop ✅ CLOSED
> Closes the adaptive intelligence gap vs Vibe-Trading.

- [x] **Historical win rates bucketed by market condition** ✅
  - 7 granularities: `trend|session|vol|setup`, `trend|session|setup`, `session|setup`, `trend|setup`, session, direction, pair
  - Includes data_source bucket (oanda / td_forex / td_crypto)
  - Min 10 resolved signals per bucket before applying baseline adjustment
- [x] **Dual-Window "Pulse" Adjustment** ✅
  - Baseline (All-time) vs Pulse (Recent 14 days, min 5 samples)
  - If Pulse deviates by ≥10%, applies secondary adjustment capped at ±5 confidence points
- [x] **Applied on every `/sniper` call and every scanner signal** ✅
- [x] **Refreshed at startup + after every `checkSniperOutcomes()` run** ✅
- [x] **`/api/condition-weights` admin endpoint** (now includes Pulse data) ✅
- [x] **`DELETE /api/sniper/purge`** — wipes all signals + resets weights ✅

---

### Strategy 3.5 — Sniper Engine v2 Hardening ✅ CLOSED
> Bug fixes and structural improvements discovered through 6 real-world signal tests.

**Bugs fixed during testing (before this session):**
- [x] Direction-mismatched patterns counted as confirming (not conflicting) — 25pt confidence swing per pattern ✅
- [x] OB price display collapsing on forex (`toFixed(2)` rounding) ✅
- [x] SL validation rejecting valid signals (ATR buffer extends below candle lows by design) ✅
- [x] TP1 pulled below 1:1 RR by nearby S/R snap ✅

**Structural hardening (this session):**
- [x] **Timeframe-adaptive swing params** — 1m:`15,10`, 5m:`10,7`, 15m:`8,5`, 30m:`6,4`, 1H+:`5,3` ✅
- [x] **TP1 floor raised to 1.5:1 RR** (was 1:1) — prevents sub-EV targets from S/R snap ✅
- [x] **TP2 floor raised to 2.5:1 RR** (was 1.5:1) ✅
- [x] **Fib confluence capped at best 2 hits** — prevents score inflation on tight swing ranges ✅
- [x] **Ranging direction uses linreg slope** — replaces arbitrary `long` default ✅
- [x] **Pattern bonus capped ±30 pts** — prevents triple-pattern ceiling hits ✅
- [x] **Session uses candle timestamp** — backtest-accurate, handles both seconds and ms formats ✅
- [x] **OB reasoning uses `getDecimals()`** — unified precision, no more ad-hoc ladder ✅
- [x] **Server validation aligned** — TP1 ≥ 1.4:1, TP2 ≥ 2.4:1 (float-safe for engine floors) ✅
- [x] **Dashboard purge button** — double-confirm, deletes all signals + resets condition weights ✅
- [x] **OB Mitigation Tracking** — engine skips order blocks where price has already broken through the zone ✅
- [x] **Backtest Timeframe Passthrough** — logic now uses actual pair/TF instead of dummy values ✅
- [x] **Trend Null Guard Fix** — prevents `lastClose > null` returning false-positive uptrends ✅

**Test results:** 50/50 signals pass RR floors, backtest runs clean, OB mitigation verified by smoke test.

---

### Strategy 4 — TwelveData Cache Expansion ✅ NEW
> Extends scanner/sniper coverage beyond OANDA's 51 symbols. Fast REST-based caching.

- [x] **TD Crypto Cache (8 symbols)** ✅
  - BNB, XRP, DOGE, DOT, LINK, AVAX, MATIC, ATOM
  - Stored in `oandaCandles` → auto-included in scanner + sniper
  - TFs: 1m / 1h / 4h / 1d — same depth as OANDA (10k–17k candles)
  - Paginated fetch with `end_date` walking backwards
  - Disk-cached (`oanda_cache/`), incremental refresh every 12h

- [x] **TD Forex Cache (11 symbols)** ✅
  - EUR/USD, GBP/USD, USD/JPY, USD/CHF, AUD/USD, USD/CAD, NZD/USD, EUR/JPY, GBP/JPY, EUR/GBP
  - **USD/BRL** (exotic — not in OANDA at all, TD only source)
  - Same TFs and depth as crypto cache
  - Startup: 10s after server boot (staggered after crypto)
  - Cron: every 12h at :30 offset (crypto runs at :00)
  - `Force TD Forex Refresh` button in admin cache dashboard

- [x] **Source tagging on scanner signals** ✅
  - `source` column in `sniper_signals`: `scanner_oanda` / `scanner_td_crypto` / `scanner_td_forex`
  - All DB queries updated to use `.like('source', 'scanner%')`
  - `getDataSource(sym)` function classifies any symbol at runtime
  - Condition weights now bucket by data source (learns which source performs better)

- [x] **Admin cache dashboard** ✅
  - 3 separate cards: OANDA, TwelveData Crypto, TwelveData Forex
  - Each shows 1m/1h/4h/1d candle counts, last candle time, status badge
  - Individual force-refresh buttons per section
  - Live refresh indicator when fetch is in progress

- [x] **Admin sniper dashboard** ✅
  - New "Performance by Data Source" card (OANDA vs TD Forex vs TD Crypto win rates)
  - Scanner live signals table now shows source badge per signal

---

### Strategy 3.6 — Signal Pipeline Hardening ✅ CLOSED
> Bug fixes discovered during real-world testing and OANDA infrastructure change.

**Validation fixes:**
- [x] **SL removed from price range check** — ATR buffer intentionally extends SL below candle lows; removed from `validateSniper()` ✅
- [x] **TP RR thresholds aligned** — server validation uses 1.4/2.4 (float-safe floors for engine's 1.5/2.5) ✅
- [x] **Price range computed from full candles array** — prevents "outside data range" on zoomed-in views ✅
- [x] **Frontend candle cap raised 80→300** — ensures enough history for server-side range check ✅

**Search / UI fixes:**
- [x] **TwelveData search deduplication** — Map keyed by symbol, first (primary US exchange) result wins; eliminates 8× AAPL duplicates ✅
- [x] **`isSelected` source check** — compares both symbol AND data source (oanda vs TD); prevents all variants highlighting ✅

**OANDA infrastructure fix:**
- [x] **`_discoverBrokerSymbols()` auto-discovery** — on every MetaAPI connect, fetches live broker symbol list and remaps `_maSymMap` to current names ✅
  - Handles OANDA suffix renames (`.pro` → `.sml` → anything future)
  - Base-name matching strips any suffix (`.`, `-`, `_`)
  - Gap: if base name itself changes, manual `_maSymMap` update needed

**Admin dashboard fix:**
- [x] **Emoji → ASCII in `<script>` blocks** — encoding issues causing `Uncaught SyntaxError` on admin sniper page ✅

---

### Strategy 3.7 — OANDA Data Integrity + Crossover Dashboard ✅ CLOSED
> Fixes for OANDA broker symbol renames breaking chart data + crossover scanner improvements.

**OANDA symbol discovery hardening:**
- [x] **Dual-pass broker matching** — pass 1: internal base (XAUUSD→XAUUSD.sml), pass 2: old broker base (GOLD.pro→GOLD.sml) ✅
- [x] **`_lastBrokerSymbolList` cache** — full broker symbol list stored in memory after each discovery run ✅
- [x] **`/api/admin/broker-symbols` endpoint** — returns `{symMap, brokerList, unmapped}`; `unmapped` shows exactly which symbols are broken ✅
- [x] **Warning logs for unmatched symbols** — `No broker match for X (was: Y)` in pm2 logs when remap fails ✅

**`forceOanda` data-integrity fix:**
- [x] **`forceOanda` conditional on actual data** — only forces OANDA source if `oandaCandles[sym]` has candles; falls through to TwelveData if broker renamed and cache is empty ✅
  - Prevents: OANDA historical candles + TwelveData live ticks merging on same chart
  - Applies to both `/candles/:symbol` REST endpoint and `/subscribe/:symbol` SSE endpoint
  - Pattern: `_maSymMap[key] && oandaCandles[key] && Object.values(oandaCandles[key]).some(arr => arr.length > 0)`

**SMA crossover dashboard:**
- [x] **Purge endpoint** `DELETE /api/crossovers/purge` — uses `.neq('id', '00000000-...')` pattern (UUID-safe) ✅
- [x] **Source badge per row** — OANDA (blue) / TD Forex (green) / TD Crypto (purple), computed on-the-fly via `getDataSource()` in API response (no DB schema change needed) ✅
- [x] **Purge button** — double-confirm, red button on dashboard ✅
- [x] **Subtitle updated** — now shows "OANDA + TD Forex + TD Crypto" ✅

---

### Strategy 3.8 — Chart Timezone + Cache Integrity ✅ CLOSED
> Timezone display parity with MT5 + systemic fix for deploy-time candle corruption.

**Timezone selector:**
- [x] **Timezone dropdown in chart toolbar** — all timezones UTC-12 to UTC+12, half-hours included (UTC+5:30 India, UTC+9:30 Adelaide) ✅
- [x] **`tzDate(ts)` helper** — shifts UTC timestamp by `chartTzOffsetHours * 3600000`, then all rendering uses `.getUTC*()` methods ✅
- [x] **Persists via localStorage** — selection survives page refresh ✅
- [x] **All rendering updated** — X-axis labels, crosshair date badge, drawing tool date tags all use timezone-aware display ✅
- Note: MT5 OANDA broker is UTC+5 relative to Fractal's UTC display — set to UTC+5 for exact label match

**OANDA cache deduplication fix:**
- [x] **Root cause identified** — race condition between `startOandaTicker` (runs every 2s immediately on restart) and `fetchOandaHistory` (async incremental fetch) — ticker pushes a candle at current time, then incremental fetch appends older candles after it → out-of-order timestamps ✅
- [x] **`_dedupSortArr(arr)`** — deduplicates by timestamp + sorts chronologically; used at all cache boundaries ✅
- [x] **`saveCacheToDisk` hardened** — deduplicates + sorts every TF before writing to disk, also fixes in-memory array ✅
- [x] **`loadCacheFromDisk` hardened** — deduplicates + sorts every TF after reading from disk → auto-heals any existing corrupted files on next restart ✅
- [x] **Incremental appends hardened** — sort before push + only push if `c.t > arr[arr.length-1].t`; applied to both OANDA and TD Crypto incremental paths ✅
- Result: no more duplicate/out-of-order candles after deploys without needing manual cache purge

---

### Strategy 5 — Multi-Agent Analysis Chains
> Scoped decision: only `/projection` is worth chaining.

- [ ] **Refactor `/projection` endpoint** ✦ NEXT TASK
  - Agent 1 (free): run sniperSignal → clean structured JSON
  - Agent 2 (Sonnet): 3 price path scenarios with key levels
  - Agent 3 (Opus): final probability assessment
  - Raise credit cost from 25 → 40 cr

---

### Strategy 6 — Canvas UI Improvements ✅ CLOSED

- [x] **Bar pattern tool rewritten — TradingView 2-point model** ✅
  - Replaced 8 square handles with 2 circle handles (p1 top-left, p2 bottom-right)
  - Drag p1 → p2 fixed; drag p2 → p1 fixed; drag body → both move
  - Vertical + horizontal mirroring (negative gw/gh handled with Math.abs — bars mirror instead of disappearing)
  - No dashed border box — clean bars only
  - Drawing object simplified to `{ candles, p1:{bi,price}, p2:{bi,price} }`
  - State: `_bpDrag` (replaced `_ghostDrag` + `_ghostResize`)

- [x] **Native cursor hidden on canvas** ✅
  - `cursor: none` for all crosshair/drawing tools — OS cursor invisible, only canvas dot shows
  - Eliminates latency perception between OS cursor and canvas-drawn dot
  - Native cursor preserved for `arrow_cur` tool and resize/grab handles

- [x] **Crosshair lines more visible** ✅
  - Opacity `0.3 → 0.55`, lineWidth `0.6 → 0.9`

- [x] **Watermark more visible** ✅
  - Opacity `0.04 → 0.18`

- [x] **SMA 200 / 400 / 900 toolbar toggle buttons** ✅
  - 3 buttons added next to SMA CROSS in the chart toolbar
  - Colors: SMA 200 teal `#26a69a`, SMA 400 blue `#3498db`, SMA 900 purple `#9b8fe8`
  - Button highlights in its own color when active, dims when off

- [x] **Full-chart SMA rendering at any zoom** ✅
  - `computeFullSMA()` pre-computes over all candles once per frame
  - SMAs draw correctly when zoomed in tight (fixed bad early bail on `startIdx+period>candles.length`)

- [x] **SMA crossover diamond markers** ✅
  - White diamond with gold border drawn at every crossover between any two active SMAs (200×400, 200×900, 400×900)
  - Faint dotted horizontal guide line extends across chart at the exact cross price
  - Stored in `window._smaSnapPrices` array each render frame

- [x] **SMA crossover magnet snap** ✅
  - Cursor within 12px of a crossover price level snaps to it automatically in `getCoords()`
  - Works for all drawing tools (horizontal line, trend line, etc.) — no toggle needed
  - Allows designing a horizontal or vertical line exactly from the crossover price

- [x] **Crossover price DB bug fix (server.js)** ✅
  - `sma_crossovers.cross_price` was candle close — meaningless for actual SMA intersection
  - Fixed to `(sma200 + sma400) / 2` — the actual price where the two SMAs meet
  - New crossover records will now match what you see on chart

---

### Strategy 7 — Alert System
> Notify users when scanner fires high-confidence signals. Currently signals save to DB but users must manually check the app.

- [ ] **Discord webhook** — user pastes webhook URL in profile, server POSTs formatted signal embed when scanner fires. Free, instant, traders love it. ~3-4h work.
- [ ] **Browser push notifications** — Web Push API + service worker. Works even when tab is closed. Free. ~1 day work.
- [ ] **Telegram bot** — users link Telegram, bot DMs them on signal. Free via Telegram Bot API.
- [ ] **Webhook output (power users)** — user provides any URL, scanner POSTs signal JSON (entry/SL/TP/confidence) when threshold hit. Same model TradingView uses. Lets users pipe signals into their own bots/systems.
- [ ] **Gate by tier** — Starter: email digest · Pro: Discord · Elite/Institutional: all channels

---

## What We Are NOT Doing From Vibe-Trading

- FractalScript export — we have our own Canvas chart, not TradingView
- Python sidecar service — adds deployment complexity to DigitalOcean droplet
- React frontend rewrite — our Canvas frontend is custom and intentional
- Switching LLM providers — committed to Claude API
- Chinese market data (AKShare/Tushare) — not our market
- Their data sources (yfinance, CCXT, OKX) — TwelveData + OANDA are higher quality
