'use strict';

const store = require('./candleStore');

// ─── Config ───────────────────────────────────────────────────────────────────
const THROTTLE_MS = 250; // minimum ms between pushes per client

// ─── Client registry ─────────────────────────────────────────────────────────
// Key: `${source}:${sym}`
// Value: Set of { res, lastPush, pendingTfs: Map<tf, candle> }
const _clients = {};

function _key(source, sym) { return `${source}:${sym}`; }

// ─── Register ─────────────────────────────────────────────────────────────────
/**
 * Called when a client connects to /subscribe/:source/:sym
 * Returns cleanup function (call on 'close').
 */
function addClient(source, sym, res) {
  const k = _key(source, sym);
  if (!_clients[k]) _clients[k] = new Set();

  const client = { res, lastPush: 0, pendingTfs: new Map() };
  _clients[k].add(client);

  // SSE headers
  res.writeHead(200, {
    'Content-Type':  'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection':    'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  // Send initial snapshot
  const tfs = ['1m', '5m', '15m', '30m', '1h', '4h', '1d', '1w'];
  const snap = {};
  for (const tf of tfs) {
    const arr = store.readCandles(source, sym, tf);
    if (arr.length) snap[tf] = arr;
  }
  _send(client, { type: 'snapshot', source, symbol: sym, candles: snap });

  // Subscribe to live updates
  const unsub = store.subscribe(source, sym, (src, s, tf, candle) => {
    _enqueue(client, src, s, tf, candle);
  });

  // Heartbeat to keep connection alive
  const heartbeat = setInterval(() => {
    try {
      res.write(':heartbeat\n\n');
    } catch (e) {
      clearInterval(heartbeat);
    }
  }, 15000);

  return () => {
    unsub();
    clearInterval(heartbeat);
    if (_clients[k]) {
      _clients[k].delete(client);
      if (_clients[k].size === 0) delete _clients[k];
    }
  };
}

// ─── Enqueue + throttled flush ────────────────────────────────────────────────
function _enqueue(client, source, sym, tf, candle) {
  client.pendingTfs.set(tf, candle);
  const now  = Date.now();
  const wait = THROTTLE_MS - (now - client.lastPush);
  if (wait <= 0) {
    _flush(client, source, sym);
  } else {
    if (!client._timer) {
      client._timer = setTimeout(() => {
        client._timer = null;
        _flush(client, source, sym);
      }, wait);
    }
  }
}

function _flush(client, source, sym) {
  if (!client.pendingTfs.size) return;
  const ticks = {};
  for (const [tf, candle] of client.pendingTfs) ticks[tf] = candle;
  client.pendingTfs.clear();
  client.lastPush = Date.now();
  _send(client, { type: 'tick', source, symbol: sym, tick: ticks });
}

function _send(client, data) {
  try {
    client.res.write(`data: ${JSON.stringify(data)}\n\n`);
  } catch (_) {
    // client disconnected; cleanup handled by 'close' event
  }
}

// ─── Push from outside (e.g. scanner results) ────────────────────────────────
/**
 * Push an arbitrary SSE event to all clients subscribed to source:sym.
 */
function pushEvent(source, sym, data) {
  const k = _key(source, sym);
  if (!_clients[k]) return;
  for (const client of _clients[k]) _send(client, data);
}

/**
 * How many clients are currently watching source:sym.
 */
function clientCount(source, sym) {
  const k = _key(source, sym);
  return _clients[k] ? _clients[k].size : 0;
}

/**
 * List all active subscriptions.
 */
function listSubscriptions() {
  return Object.entries(_clients).map(([k, set]) => ({ key: k, count: set.size }));
}

module.exports = { addClient, pushEvent, clientCount, listSubscriptions };
