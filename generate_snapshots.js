/* Run this once to generate snapshot values — output goes into the test file */
global.window = global;
require('./public/fractalscript-runtime.js');
var E = global.FractalScriptEngine;

function fmt(v) { return isNaN(v) ? 'NaN' : +v.toFixed(6); }
function fmtArr(arr) {
  return '[' + Array.from(arr).map(fmt).join(', ') + ']';
}

/* ── SNAPSHOT 1: SMA + EMA on deterministic rising data ── */
var c1 = [];
for (var i = 0; i < 15; i++)
  c1.push({ t: i*60000, o: 100+i, h: 101+i, l: 99+i, c: 100+i, v: 1000 });

var r1 = E.run(`//@version=5
indicator("snap1")
plot(ta.sma(close, 5), title="sma5")
plot(ta.ema(close, 5), title="ema5")`, c1);
console.log('\n// SNAPSHOT 1: sma5 + ema5 on [100..114]');
console.log('// sma5:', fmtArr(r1.plots[0].values));
console.log('// ema5:', fmtArr(r1.plots[1].values));

/* ── SNAPSHOT 2: RSI on alternating up/down data ── */
var c2 = [];
var p2 = 100;
var moves2 = [2,-1,3,-1,2,-2,4,-1,2,-1,3,-2,2,-1,3,-1,2,-1,4,-2];
for (var i = 0; i < 20; i++) {
  p2 += moves2[i];
  c2.push({ t: i*60000, o: p2-moves2[i], h: p2+0.5, l: p2-moves2[i]-0.5, c: p2, v: 1000 });
}
var r2 = E.run(`//@version=5
indicator("snap2")
plot(ta.rsi(close, 7), title="rsi7")`, c2);
console.log('\n// SNAPSHOT 2: rsi(7) on alternating data');
console.log('// rsi7:', fmtArr(r2.plots[0].values));

/* ── SNAPSHOT 3: Bollinger Bands components ── */
var c3 = [];
for (var i = 0; i < 25; i++)
  c3.push({ t: i*60000, o: 100, h: 102, l: 98, c: 100 + Math.sin(i * 0.5) * 3, v: 1000 });

var r3 = E.run(`//@version=5
indicator("snap3")
basis = ta.sma(close, 10)
dev   = ta.stdev(close, 10)
plot(basis,       title="basis")
plot(basis + dev, title="upper")
plot(basis - dev, title="lower")`, c3);
console.log('\n// SNAPSHOT 3: BB basis/upper/lower (10)');
console.log('// basis:', fmtArr(r3.plots[0].values));
console.log('// upper:', fmtArr(r3.plots[1].values));
console.log('// lower:', fmtArr(r3.plots[2].values));

/* ── SNAPSHOT 4: Strategy — bar_index based entries, deterministic prices ── */
var c4 = [
  {t:0,      o:100, h:101, l:99,  c:100, v:1000},
  {t:60000,  o:100, h:101, l:99,  c:100, v:1000},
  {t:120000, o:100, h:101, l:99,  c:110, v:1000},
  {t:180000, o:110, h:111, l:109, c:110, v:1000},
  {t:240000, o:110, h:111, l:109, c:120, v:1000},
  {t:300000, o:120, h:121, l:119, c:120, v:1000},
  {t:360000, o:120, h:121, l:119, c:115, v:1000},
  {t:420000, o:115, h:116, l:114, c:115, v:1000}
];
var r4 = E.run(`//@version=5
strategy("snap4", initial_capital=10000, commission_value=0)
if bar_index == 0
    strategy.entry("L1", strategy.long)
if bar_index == 2
    strategy.close("L1")
if bar_index == 4
    strategy.entry("L2", strategy.long)
if bar_index == 6
    strategy.close("L2")
plot(close, title="close")`, c4);
console.log('\n// SNAPSHOT 4: EMA cross strategy on trend-reversal data');
console.log('// totalTrades:', r4.strategyResult.summary.totalTrades);
console.log('// netProfit:', +r4.strategyResult.summary.netProfit.toFixed(6));
console.log('// winRate:', +r4.strategyResult.summary.winRate.toFixed(6));
console.log('// equityCurve last:', +Array.from(r4.strategyResult.equityCurve).pop().toFixed(6));
r4.strategyResult.trades.forEach(function(t, i) {
  console.log('// trade['+i+']: dir='+t.direction+
    ' entry='+t.entryPrice.toFixed(4)+
    ' exit='+t.exitPrice.toFixed(4)+
    ' profit='+t.profit.toFixed(4));
});

/* ── SNAPSHOT 5: UDT with var persistence ── */
var c5 = [];
for (var i = 0; i < 10; i++)
  c5.push({ t: i*60000, o: 100+i, h: 102+i, l: 99+i, c: 100+i, v: 1000 });

var r5 = E.run(`//@version=5
indicator("snap5")
type Level
    float price
    int   hits = 0
var Level hi = Level.new(0.0)
if high > hi.price
    hi.price := high
    hi.hits  := hi.hits + 1
plot(hi.price, title="hiPrice")
plot(hi.hits,  title="hiHits")`, c5);
console.log('\n// SNAPSHOT 5: UDT var persistence — tracking highest high');
console.log('// hiPrice:', fmtArr(r5.plots[0].values));
console.log('// hiHits:', fmtArr(r5.plots[1].values));
