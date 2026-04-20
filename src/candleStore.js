'use strict';

const fs   = require('fs');
const path = require('path');

// ─── Config ──────────────────────────────────────────────────────────────────
const CACHE_DIR   = path.join(__dirname, '..', 'candle_cache');
const LOG_FILE    = path.join(__dirname, '..', 'logs', 'candle_store.log');
const FLUSH_MS    = 60_000;   // flush dirty entries to disk every 60s
const MAX_CANDLES = 20_000;   // max candles kept in memory per sym/tf

// ─── Store ───────────────────────────────────────────────────────────────────
// Key: `${source}:${sym}`  e.g. "oanda:XAUUSD"  "binance:BTCUSDT"
// Value: { [tf]: candle[] }  candle = { t, o, h, l, c, v }
const _store  = {};

// Tracks which keys have unsaved changes
const _dirty  = new Set();

// Subscribers: source:sym → Set of callback fns  (used by sse.js)
const _subs   = {};

// ─── Logging ─────────────────────────────────────────────────────────────────
function _log(level, msg, meta) {
  const line = JSON.stringify({ ts: Date.now(), level, msg, ...(meta || {}) });
  try { fs.appendFileSync(LOG_FILE, line + '\n'); } catch (_) {}
  if (level === 'error') console.error(`[candleStore] ${msg}`, meta || '');
}

// ─── Dedup + sort ─────────────────────────────────────────────────────────────
function _dedup(arr) {
  if (!arr || !arr.length) return arr;
  const seen = new Set();
  const out  = [];
  for (const c of arr) {
    if (!seen.has(c.t)) { seen.add(c.t); out.push(c); }
  }
  out.sort((a, b) => a.t - b.t);
  return out;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────
function _key(source, sym) { return `${source}:${sym}`; }

function _getArr(source, sym, tf) {
  const k = _key(source, sym);
  if (!_store[k])       _store[k]       = {};
  if (!_store[k][tf])   _store[k][tf]   = [];
  return _store[k][tf];
}

function _setArr(source, sym, tf, arr) {
  const k = _key(source, sym);
  if (!_store[k]) _store[k] = {};
  _store[k][tf] = arr;
}

function _notify(source, sym, tf, candle) {
  const k = _key(source, sym);
  if (_subs[k]) {
    for (const cb of _subs[k]) {
      try { cb(source, sym, tf, candle); } catch (e) {
        _log('error', 'subscriber threw', { source, sym, tf, err: e.message });
      }
    }
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Write a single live tick (partial candle update or new bar).
 * tf: timeframe string  e.g. '1m' '4h' '1d'
 * tfMs: milliseconds per bar for that tf
 * price, vol: numbers
 * tickTs (optional): broker-provided tick timestamp in ms. Use this to place
 *   the tick in the correct bucket regardless of network/relay latency.
 *   Falls back to Date.now() when not supplied.
 */
function writeTick(source, sym, tf, tfMs, price, vol, tickTs) {
  if (!source || !sym || !tf || !tfMs || price == null) {
    _log('warn', 'writeTick: missing args', { source, sym, tf });
    return;
  }
  const ts     = (typeof tickTs === 'number' && tickTs > 0) ? tickTs : Date.now();
  const bucket = Math.floor(ts / tfMs) * tfMs;
  const arr    = _getArr(source, sym, tf);
  const cur    = arr.length ? arr[arr.length - 1] : null;

  if (!cur || cur.t !== bucket) {
    arr.push({ t: bucket, o: price, h: price, l: price, c: price, v: vol || 0 });
    if (arr.length > MAX_CANDLES) arr.splice(0, arr.length - MAX_CANDLES);
  } else {
    cur.c = price;
    if (price > cur.h) cur.h = price;
    if (price < cur.l) cur.l = price;
    if (vol) cur.v += vol;
  }

  _dirty.add(_key(source, sym));
  _notify(source, sym, tf, arr[arr.length - 1]);
}

/**
 * Write a complete closed bar (from WebSocket kline close or REST history).
 * candle = { t, o, h, l, c, v }  where t is bar open timestamp (ms)
 */
function writeBar(source, sym, tf, candle) {
  if (!source || !sym || !tf || !candle || candle.t == null) {
    _log('warn', 'writeBar: missing args', { source, sym, tf });
    return;
  }
  const arr = _getArr(source, sym, tf);
  const cur = arr.length ? arr[arr.length - 1] : null;

  if (!cur) {
    arr.push({ ...candle });
  } else if (candle.t > cur.t) {
    arr.push({ ...candle });
    if (arr.length > MAX_CANDLES) arr.splice(0, arr.length - MAX_CANDLES);
  } else if (candle.t === cur.t) {
    // update in-place (live bar update)
    Object.assign(cur, candle);
  } else {
    // candle is older than latest — insert in order (history prepend)
    const idx = arr.findIndex(c => c.t === candle.t);
    if (idx === -1) {
      arr.push({ ...candle });
      arr.sort((a, b) => a.t - b.t);
      if (arr.length > MAX_CANDLES) arr.splice(0, arr.length - MAX_CANDLES);
    }
    // if idx !== -1 existing wins (streamed candle takes priority)
  }

  _dirty.add(_key(source, sym));
  _notify(source, sym, tf, arr[arr.length - 1]);
}

/**
 * Bulk-write an array of historical candles (REST history fetch).
 * Existing candles at same timestamp are NOT overwritten (streamed data wins).
 */
function writeCandles(source, sym, tf, candles) {
  if (!source || !sym || !tf || !Array.isArray(candles) || !candles.length) return;

  const arr    = _getArr(source, sym, tf);
  const exists = new Map(arr.map(c => [c.t, c]));

  let added = 0;
  for (const c of candles) {
    if (!exists.has(c.t)) { arr.push({ ...c }); added++; }
  }

  if (added > 0) {
    arr.sort((a, b) => a.t - b.t);
    if (arr.length > MAX_CANDLES) arr.splice(0, arr.length - MAX_CANDLES);
    _dirty.add(_key(source, sym));
    _log('info', 'writeCandles', { source, sym, tf, added, total: arr.length });
  }
}

/**
 * Read candles — returns a copy of the array (or empty []).
 */
function readCandles(source, sym, tf) {
  const arr = _getArr(source, sym, tf);
  return arr.slice();
}

/**
 * High-water mark: latest timestamp already stored.
 * Use in history fetchers to avoid re-fetching candles we already have.
 */
function highWaterMark(source, sym, tf) {
  const arr = _getArr(source, sym, tf);
  return arr.length ? arr[arr.length - 1].t : 0;
}

/**
 * Subscribe to updates for a source:sym pair.
 * cb(source, sym, tf, latestCandle)
 * Returns unsubscribe function.
 */
function subscribe(source, sym, cb) {
  const k = _key(source, sym);
  if (!_subs[k]) _subs[k] = new Set();
  _subs[k].add(cb);
  return () => _subs[k] && _subs[k].delete(cb);
}

/**
 * Remove a symbol from memory and mark its disk entry for deletion.
 * Does NOT delete the file — caller handles that.
 */
function purge(source, sym) {
  const k = _key(source, sym);
  delete _store[k];
  _dirty.delete(k);
}

/**
 * Replace or insert a bar at the exact timestamp. Unlike writeBar (which skips
 * overwrites of mid-array bars), this ALWAYS overwrites on timestamp match —
 * authoritative source (REST broker history) wins over any locally aggregated
 * live tick version.
 */
function replaceBar(source, sym, tf, candle) {
  if (!source || !sym || !tf || !candle || candle.t == null) return;
  const arr = _getArr(source, sym, tf);
  const idx = arr.findIndex(c => c.t === candle.t);
  if (idx >= 0) {
    arr[idx] = { ...candle };
  } else {
    arr.push({ ...candle });
    arr.sort((a, b) => a.t - b.t);
    if (arr.length > MAX_CANDLES) arr.splice(0, arr.length - MAX_CANDLES);
  }
  _dirty.add(_key(source, sym));
  _notify(source, sym, tf, arr[idx >= 0 ? idx : arr.findIndex(c => c.t === candle.t)]);
}

/**
 * Remove candles in-place where predicate(candle) returns true.
 * Returns number of candles removed. Marks entry dirty if any were removed.
 */
function removeWhere(source, sym, tf, predicate) {
  const k = _key(source, sym);
  if (!_store[k] || !_store[k][tf]) return 0;
  const before = _store[k][tf].length;
  _store[k][tf] = _store[k][tf].filter(c => !predicate(c));
  const removed = before - _store[k][tf].length;
  if (removed > 0) _dirty.add(k);
  return removed;
}

/**
 * List all keys currently in the store.
 */
function listKeys() { return Object.keys(_store); }

/**
 * Stats for debug endpoint.
 */
function getStats() {
  const out = {};
  for (const k of Object.keys(_store)) {
    out[k] = {};
    for (const tf of Object.keys(_store[k])) {
      out[k][tf] = _store[k][tf].length;
    }
  }
  return out;
}

// ─── Disk persistence ─────────────────────────────────────────────────────────

function _cacheDir(source) {
  const d = path.join(CACHE_DIR, source);
  fs.mkdirSync(d, { recursive: true });
  return d;
}

function _cacheFile(source, sym) {
  return path.join(_cacheDir(source), `${sym}.json`);
}

function saveToDisk(source, sym) {
  const k = _key(source, sym);
  if (!_store[k]) return;
  try {
    const clean = {};
    for (const tf of Object.keys(_store[k])) {
      clean[tf] = _dedup(_store[k][tf]);
      _store[k][tf] = clean[tf]; // heal in-memory too
    }
    fs.writeFileSync(_cacheFile(source, sym), JSON.stringify(clean));
    _dirty.delete(k);
  } catch (e) {
    _log('error', 'saveToDisk failed', { source, sym, err: e.message });
  }
}

function loadFromDisk(source, sym) {
  const f = _cacheFile(source, sym);
  if (!fs.existsSync(f)) return;
  try {
    const data = JSON.parse(fs.readFileSync(f, 'utf8'));
    const k    = _key(source, sym);
    _store[k]  = {};
    for (const tf of Object.keys(data)) {
      _store[k][tf] = _dedup(data[tf]);
    }
    _log('info', 'loadFromDisk', { source, sym, tfs: Object.keys(_store[k]).join(',') });
  } catch (e) {
    _log('error', 'loadFromDisk failed', { source, sym, err: e.message });
  }
}

function flushAllDirty() {
  for (const k of Array.from(_dirty)) {
    const [source, ...rest] = k.split(':');
    const sym = rest.join(':');
    saveToDisk(source, sym);
  }
}

// Auto-flush loop
const _flushTimer = setInterval(flushAllDirty, FLUSH_MS);
_flushTimer.unref && _flushTimer.unref();

// ─── Exports ──────────────────────────────────────────────────────────────────
module.exports = {
  writeTick,
  writeBar,
  writeCandles,
  readCandles,
  highWaterMark,
  subscribe,
  purge,
  replaceBar,
  removeWhere,
  listKeys,
  getStats,
  saveToDisk,
  loadFromDisk,
  flushAllDirty,
};
