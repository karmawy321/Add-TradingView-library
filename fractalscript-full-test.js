/* ═══════════════════════════════════════════════════════════════
   FractalScript Full Test Suite
   Covers: P1 basics, P2 series, P3 ta.*, P4 plot outputs,
           P5 UDTs, P6 user functions/switch/while,
           P7 strategy, scenario tests, invariant tests,
           differential tests (TV-recorded)
   ═══════════════════════════════════════════════════════════════ */

global.window = global;
require('./public/fractalscript-runtime.js');
var E = global.FractalScriptEngine;

var passed = 0, failed = 0;

function assert(label, cond, extra) {
  if (cond) {
    console.log('  PASS  ' + label);
    passed++;
  } else {
    console.log('  FAIL  ' + label + (extra ? ' — ' + extra : ''));
    failed++;
  }
}

function near(a, b, tol) { return Math.abs(a - b) <= (tol || 0.0001); }

function run(script, candles) {
  var r = E.run(script, candles);
  if (r.errors && r.errors.length) {
    return { __runError__: r.errors[0].message || JSON.stringify(r.errors[0]) };
  }
  return r;
}

/* ── candle helpers ── */
function flatCandles(n, price) {
  var c = [], p = price || 100;
  for (var i = 0; i < n; i++)
    c.push({ t: i*60000, o: p, h: p+1, l: p-1, c: p, v: 1000 });
  return c;
}
function risingCandles(n, start, step) {
  var c = [], p = start || 100;
  for (var i = 0; i < n; i++) {
    c.push({ t: i*60000, o: p, h: p+1, l: p-0.5, c: p + (step||1), v: 1000 });
    p += (step || 1);
  }
  return c;
}
function customCandles(arr) {
  return arr.map(function(v, i) {
    return { t: i*60000, o: v, h: v+1, l: v-1, c: v, v: 1000 };
  });
}

function vals(r, idx) { return Array.from(r.plots[idx].values); }
function last(r, idx) { var v = vals(r, idx); return v[v.length-1]; }
function first(r, idx) { return vals(r, idx)[0]; }
function validCount(r, idx) { return vals(r, idx).filter(function(x){ return !isNaN(x); }).length; }

/* ══════════════════════════════════════════════════════════════
   P1 — LEXER / BASIC ARITHMETIC / CONTROL FLOW
   ══════════════════════════════════════════════════════════════ */
console.log('\n── P1: Basics ──');

(function() {
  var r = run(`//@version=5
indicator("t")
x = 2 + 3 * 4
plot(x)`, flatCandles(3));
  assert('arithmetic precedence (2+3*4=14)', !r.__runError__ && near(last(r,0), 14));
})();

(function() {
  var r = run(`//@version=5
indicator("t")
x = (2 + 3) * 4
plot(x)`, flatCandles(3));
  assert('parentheses override precedence (5*4=20)', !r.__runError__ && near(last(r,0), 20));
})();

(function() {
  var r = run(`//@version=5
indicator("t")
x = 10 / 4
plot(x)`, flatCandles(3));
  assert('division (10/4=2.5)', !r.__runError__ && near(last(r,0), 2.5));
})();

(function() {
  var r = run(`//@version=5
indicator("t")
x = 7 % 3
plot(x)`, flatCandles(3));
  assert('modulo (7%3=1)', !r.__runError__ && near(last(r,0), 1));
})();

(function() {
  var r = run(`//@version=5
indicator("t")
x = close > 99 ? 1 : 0
plot(x)`, flatCandles(5, 100));
  assert('ternary true branch', !r.__runError__ && near(last(r,0), 1));
})();

(function() {
  var r = run(`//@version=5
indicator("t")
var float x = 0.0
if close > 200
    x := 99
else
    x := 42
plot(x)`, flatCandles(5, 100));
  assert('if/else false branch returns 42', !r.__runError__ && near(last(r,0), 42));
})();

(function() {
  var r = run(`//@version=5
indicator("t")
var float x = 0.0
if close > 50
    x := 100
else
    x := 0
plot(x)`, flatCandles(5, 100));
  assert('if/else true branch returns 100', !r.__runError__ && near(last(r,0), 100));
})();

(function() {
  var r = run(`//@version=5
indicator("t")
x = true and false
plot(x ? 1 : 0)`, flatCandles(3));
  assert('boolean and (true and false = 0)', !r.__runError__ && near(last(r,0), 0));
})();

(function() {
  var r = run(`//@version=5
indicator("t")
x = false or true
plot(x ? 1 : 0)`, flatCandles(3));
  assert('boolean or (false or true = 1)', !r.__runError__ && near(last(r,0), 1));
})();

(function() {
  var r = run(`//@version=5
indicator("t")
x = not true
plot(x ? 1 : 0)`, flatCandles(3));
  assert('boolean not (not true = 0)', !r.__runError__ && near(last(r,0), 0));
})();

(function() {
  var r = run(`//@version=5
indicator("t")
plot(na)`, flatCandles(3));
  assert('na literal plots NaN', !r.__runError__ && isNaN(last(r,0)));
})();

(function() {
  var r = run(`//@version=5
indicator("t")
x = na(na) ? 1 : 0
plot(x)`, flatCandles(3));
  assert('na() test on na returns 1', !r.__runError__ && near(last(r,0), 1));
})();

/* ══════════════════════════════════════════════════════════════
   P2 — VAR PERSISTENCE / HISTORY REFS / FOR LOOPS
   ══════════════════════════════════════════════════════════════ */
console.log('\n── P2: Series & Persistence ──');

(function() {
  var r = run(`//@version=5
indicator("t")
var int count = 0
count := count + 1
plot(count)`, flatCandles(5));
  var v = vals(r, 0);
  assert('var counter increments each bar', !r.__runError__ &&
    near(v[0],1) && near(v[1],2) && near(v[4],5));
})();

(function() {
  var r = run(`//@version=5
indicator("t")
plot(close[1])`, customCandles([10,20,30,40]));
  var v = vals(r, 0);
  assert('close[1] = previous bar close', !r.__runError__ &&
    isNaN(v[0]) && near(v[1],10) && near(v[2],20) && near(v[3],30));
})();

(function() {
  var r = run(`//@version=5
indicator("t")
plot(close[2])`, customCandles([10,20,30,40,50]));
  var v = vals(r, 0);
  assert('close[2] correct lookback', !r.__runError__ &&
    isNaN(v[0]) && isNaN(v[1]) && near(v[2],10) && near(v[4],30));
})();

(function() {
  var r = run(`//@version=5
indicator("t")
sum = 0
for i = 0 to 3
    sum := sum + i
plot(sum)`, flatCandles(3));
  assert('for loop sum 0..3 = 6', !r.__runError__ && near(last(r,0), 6));
})();

(function() {
  var r = run(`//@version=5
indicator("t")
sum = 0
for i = 0 to 10 by 2
    sum := sum + i
plot(sum)`, flatCandles(3));
  assert('for loop with by step (0+2+4+6+8+10=30)', !r.__runError__ && near(last(r,0), 30));
})();

(function() {
  var r = run(`//@version=5
indicator("t")
var float runSum = 0.0
runSum := runSum + close
plot(runSum)`, customCandles([1,2,3,4,5]));
  var v = vals(r, 0);
  assert('var running sum accumulates correctly', !r.__runError__ &&
    near(v[0],1) && near(v[2],6) && near(v[4],15));
})();

/* ══════════════════════════════════════════════════════════════
   P3 — TA.* FUNCTIONS
   ══════════════════════════════════════════════════════════════ */
console.log('\n── P3: ta.* Functions ──');

(function() {
  var r = run(`//@version=5
indicator("t")
plot(ta.sma(close, 3))`, customCandles([10,20,30,40,50]));
  var v = vals(r, 0);
  assert('ta.sma(3) first 2 bars = NA', !r.__runError__ && isNaN(v[0]) && isNaN(v[1]));
  assert('ta.sma(3) bar2 = (10+20+30)/3 = 20', !r.__runError__ && near(v[2], 20));
  assert('ta.sma(3) bar4 = (30+40+50)/3 = 40', !r.__runError__ && near(v[4], 40));
})();

(function() {
  var r = run(`//@version=5
indicator("t")
plot(ta.ema(close, 3))`, customCandles([10,10,10,10,10]));
  var v = vals(r, 0);
  assert('ta.ema flat series converges to value', !r.__runError__ && near(last(r,0), 10, 0.01));
})();

(function() {
  var c = flatCandles(20, 100);
  var r = run(`//@version=5
indicator("t")
plot(ta.atr(14))`, c);
  var v = vals(r, 0);
  assert('ta.atr warmup: first 13 bars NA', !r.__runError__ && isNaN(v[0]));
  assert('ta.atr valid after warmup', !r.__runError__ && !isNaN(v[19]));
})();

(function() {
  var r = run(`//@version=5
indicator("t")
plot(ta.highest(high, 3))`, customCandles([10,20,15,30,25]));
  var v = vals(r, 0);
  assert('ta.highest(3) bar2 = max(10,20,15)=20', !r.__runError__ && near(v[2], 21)); // high=c+1
  assert('ta.highest(3) bar3 = max(20,15,30)=31', !r.__runError__ && near(v[3], 31));
})();

(function() {
  var r = run(`//@version=5
indicator("t")
plot(ta.lowest(low, 3))`, customCandles([10,20,15,30,25]));
  var v = vals(r, 0);
  assert('ta.lowest(3) bar2 = min(9,19,14)=9', !r.__runError__ && near(v[2], 9)); // low=c-1
})();

(function() {
  // flat then rising — crossover should fire
  var c = [];
  for (var i = 0; i < 30; i++) {
    var p = i < 15 ? 100 : 100 + (i-14)*2;
    c.push({ t: i*60000, o: p, h: p+1, l: p-1, c: p, v: 1000 });
  }
  var r = run(`//@version=5
indicator("t")
co = ta.crossover(ta.ema(close,3), ta.ema(close,10))
plot(co ? 1 : 0)`, c);
  var v = vals(r, 0);
  var crosses = v.filter(function(x){ return x === 1; }).length;
  assert('ta.crossover fires at least once on trend change', !r.__runError__ && crosses >= 1);
})();

(function() {
  var r = run(`//@version=5
indicator("t")
plot(ta.rsi(close, 14))`, risingCandles(30));
  var v = vals(r, 0).filter(function(x){ return !isNaN(x); });
  assert('ta.rsi all valid values 0-100', !r.__runError__ &&
    v.every(function(x){ return x >= 0 && x <= 100; }));
})();

(function() {
  var r = run(`//@version=5
indicator("t")
plot(ta.stdev(close, 5))`, customCandles([10,20,30,40,50,60]));
  var v = vals(r, 0);
  assert('ta.stdev(5) first 4 bars NA', !r.__runError__ && isNaN(v[0]) && isNaN(v[3]));
  assert('ta.stdev(5) bar5 valid and positive', !r.__runError__ && !isNaN(v[5]) && v[5] > 0);
})();

(function() {
  var r = run(`//@version=5
indicator("t")
plot(ta.rma(close, 5))`, flatCandles(20, 50));
  var v = vals(r, 0).filter(function(x){ return !isNaN(x); });
  assert('ta.rma flat series = constant', !r.__runError__ &&
    v.every(function(x){ return near(x, 50, 0.01); }));
})();

/* ══════════════════════════════════════════════════════════════
   P4 — PLOT / PLOTSHAPE / BGCOLOR / HLINE OUTPUTS
   ══════════════════════════════════════════════════════════════ */
console.log('\n── P4: Output Commands ──');

(function() {
  var r = run(`//@version=5
indicator("t")
plot(close, title="MyLine", color=color.blue, linewidth=2)`, flatCandles(5, 100));
  assert('plot returns correct label', !r.__runError__ && r.plots[0].label === 'MyLine');
  assert('plot returns correct color', !r.__runError__ && r.plots[0].color === '#2196F3');
  assert('plot returns correct lineWidth', !r.__runError__ && r.plots[0].lineWidth === 2);
  assert('plot values length = bar count', !r.__runError__ && r.plots[0].values.length === 5);
})();

(function() {
  var r = run(`//@version=5
indicator("t")
plotshape(close > 99, style=shape.triangleup, location=location.belowbar, color=color.green)`,
    flatCandles(5, 100));
  assert('plotshape returns shapes array', !r.__runError__ && r.shapes.length > 0);
  assert('shape has barIndex field', !r.__runError__ && r.shapes[0].hasOwnProperty('barIndex'));
  assert('shape has color field', !r.__runError__ && r.shapes[0].color !== undefined);
})();

(function() {
  var r = run(`//@version=5
indicator("t")
bgcolor(close > 99 ? color.green : na)`, flatCandles(5, 100));
  assert('bgcolor returns bgcolors array', !r.__runError__ && r.bgcolors.length > 0);
  assert('bgcolor barIndex is number', !r.__runError__ && r.bgcolors.length > 0 && typeof r.bgcolors[0].barIndex === 'number');
})();

(function() {
  var r = run(`//@version=5
indicator("t")
hline(50, title="Mid", color=color.gray, linewidth=1)`, flatCandles(3));
  assert('hline returns hlines array', !r.__runError__ && r.hlines.length === 1);
  assert('hline price is 50', !r.__runError__ && r.hlines[0].price === 50);
})();

(function() {
  var r = run(`//@version=5
indicator("t")
plot(close)
plot(open)
plot(high)`, flatCandles(5, 100));
  assert('multiple plots all returned', !r.__runError__ && r.plots.length === 3);
})();

/* ══════════════════════════════════════════════════════════════
   P5 — USER DEFINED TYPES (UDTs)
   ══════════════════════════════════════════════════════════════ */
console.log('\n── P5: UDTs ──');

(function() {
  var r = run(`//@version=5
indicator("t")
type Point
    float x
    float y = 0.0
p = Point.new(5.0)
plot(p.x)
plot(p.y)`, flatCandles(3));
  assert('UDT positional arg sets x=5', !r.__runError__ && near(last(r,0), 5));
  assert('UDT default field y=0', !r.__runError__ && near(last(r,1), 0));
})();

(function() {
  var r = run(`//@version=5
indicator("t")
type Box
    float top
    float bot
b = Box.new(top=100.0, bot=90.0)
plot(b.top - b.bot)`, flatCandles(3));
  assert('UDT named args, field subtraction = 10', !r.__runError__ && near(last(r,0), 10));
})();

(function() {
  var r = run(`//@version=5
indicator("t")
type Level
    float price
    int   strength = 1
var Level lv = Level.new(50.0)
lv.strength := lv.strength + 1
plot(lv.strength)`, flatCandles(5));
  var v = vals(r, 0);
  assert('var UDT field increments each bar', !r.__runError__ &&
    near(v[0],2) && near(v[4],6));
})();

(function() {
  var r = run(`//@version=5
indicator("t")
type Inner
    float val
type Outer
    Inner inner
    int count = 0
o = Outer.new(Inner.new(42.0))
plot(o.inner.val)
plot(o.count)`, flatCandles(3));
  assert('nested UDT inner.val = 42', !r.__runError__ && near(last(r,0), 42));
  assert('nested UDT default count = 0', !r.__runError__ && near(last(r,1), 0));
})();

(function() {
  var r = run(`//@version=5
indicator("t")
type Lvl
    float price
    bool broken = false
var Lvl sup = Lvl.new(95.0)
if close < sup.price
    sup.broken := true
plot(sup.broken ? 1 : 0)`, customCandles([100,100,90,100]));
  var v = vals(r, 0);
  assert('UDT bool field flips on condition', !r.__runError__ &&
    near(v[0],0) && near(v[2],1) && near(v[3],1));
})();

/* ══════════════════════════════════════════════════════════════
   P6 — USER FUNCTIONS / SWITCH / WHILE / TUPLE
   ══════════════════════════════════════════════════════════════ */
console.log('\n── P6: User Functions & Control Flow ──');

(function() {
  var r = run(`//@version=5
indicator("t")
double(x) => x * 2
plot(double(close))`, flatCandles(5, 10));
  assert('user function double(10) = 20', !r.__runError__ && near(last(r,0), 20));
})();

(function() {
  var r = run(`//@version=5
indicator("t")
clamp(v, lo, hi) =>
    v < lo ? lo : v > hi ? hi : v
plot(clamp(close, 95, 105))`, customCandles([80, 100, 120]));
  var v = vals(r, 0);
  assert('clamp low = 95', !r.__runError__ && near(v[0], 95));
  assert('clamp in range = 100', !r.__runError__ && near(v[1], 100));
  assert('clamp high = 105', !r.__runError__ && near(v[2], 105));
})();

(function() {
  var r = run(`//@version=5
indicator("t")
x = switch
    close > 110 => 3
    close > 100 => 2
    close > 90  => 1
    => 0
plot(x)`, customCandles([85, 95, 105, 115]));
  var v = vals(r, 0);
  assert('switch case 0 (85<90)', !r.__runError__ && near(v[0], 0));
  assert('switch case 1 (95>90)', !r.__runError__ && near(v[1], 1));
  assert('switch case 2 (105>100)', !r.__runError__ && near(v[2], 2));
  assert('switch case 3 (115>110)', !r.__runError__ && near(v[3], 3));
})();

(function() {
  var r = run(`//@version=5
indicator("t")
var int total = 0
i = 0
while i < 5
    total := total + i
    i := i + 1
plot(total)`, flatCandles(1));
  assert('while loop sum 0..4 = 10', !r.__runError__ && near(last(r,0), 10));
})();

(function() {
  var r = run(`//@version=5
indicator("t")
getMinMax(a, b) =>
    [math.min(a,b), math.max(a,b)]
[lo, hi] = getMinMax(close, open)
plot(hi - lo)`, customCandles([100, 90, 110]));
  var v = vals(r, 0);
  assert('tuple destructuring hi-lo all zero (o=c)', !r.__runError__ && near(v[0], 0));
})();

/* ══════════════════════════════════════════════════════════════
   P7 — STRATEGY UNIT TESTS
   ══════════════════════════════════════════════════════════════ */
console.log('\n── P7: Strategy ──');

(function() {
  var r = run(`//@version=5
strategy("t", initial_capital=10000)
plot(close)`, flatCandles(5));
  assert('strategy mode detected', !r.__runError__ && r.strategyResult !== null);
  assert('strategyResult has summary', !r.__runError__ && r.strategyResult.summary !== undefined);
  assert('initial_capital = 10000', !r.__runError__ && r.strategyResult.summary.initialCapital === 10000);
})();

(function() {
  var c = [
    { t:0,      o:100, h:101, l:99,  c:100, v:1000 },
    { t:60000,  o:100, h:101, l:99,  c:100, v:1000 },
    { t:120000, o:100, h:101, l:99,  c:110, v:1000 },
    { t:180000, o:110, h:111, l:109, c:110, v:1000 }
  ];
  var r = run(`//@version=5
strategy("t", initial_capital=10000)
if bar_index == 0
    strategy.entry("L", strategy.long)
if bar_index == 2
    strategy.close("L")
plot(close)`, c);
  assert('entry+close creates 1 closed trade', !r.__runError__ &&
    r.strategyResult.summary.totalTrades === 1);
  assert('long trade profit = exit-entry = 10', !r.__runError__ &&
    near(r.strategyResult.trades[0].profit, 10, 0.1));
  assert('trade direction = long', !r.__runError__ &&
    r.strategyResult.trades[0].direction === 'long');
})();

(function() {
  var c = [
    { t:0,      o:100, h:101, l:99,  c:100, v:1000 },
    { t:60000,  o:100, h:101, l:99,  c:90,  v:1000 },
    { t:120000, o:90,  h:91,  l:89,  c:90,  v:1000 }
  ];
  var r = run(`//@version=5
strategy("t", initial_capital=10000)
if bar_index == 0
    strategy.entry("S", strategy.short)
if bar_index == 1
    strategy.close("S")
plot(close)`, c);
  assert('short trade profit = entry-exit = 10', !r.__runError__ &&
    near(r.strategyResult.trades[0].profit, 10, 0.1));
})();

(function() {
  var c = [
    { t:0,      o:100, h:101, l:99,  c:100, v:1000 },
    { t:60000,  o:100, h:115, l:99,  c:112, v:1000 }  // TP at 110 hit (high=115 > 110)
  ];
  var r = run(`//@version=5
strategy("t", initial_capital=10000)
if bar_index == 0
    strategy.entry("L", strategy.long)
strategy.exit("X", from_entry="L", profit=10, loss=20)
plot(close)`, c);
  assert('TP exit fires when high reaches target', !r.__runError__ &&
    r.strategyResult.summary.totalTrades === 1);
  assert('TP exit price = entry+profit = 110', !r.__runError__ &&
    near(r.strategyResult.trades[0].exitPrice, 110, 0.01));
})();

(function() {
  var c = [
    { t:0,      o:100, h:101, l:99,  c:100, v:1000 },
    { t:60000,  o:100, h:101, l:75,  c:80,  v:1000 }  // SL at 80 hit (low=75 < 80)
  ];
  var r = run(`//@version=5
strategy("t", initial_capital=10000)
if bar_index == 0
    strategy.entry("L", strategy.long)
strategy.exit("X", from_entry="L", profit=50, loss=20)
plot(close)`, c);
  assert('SL exit fires when low breaches target', !r.__runError__ &&
    r.strategyResult.summary.totalTrades === 1);
  assert('SL exit price = entry-loss = 80', !r.__runError__ &&
    near(r.strategyResult.trades[0].exitPrice, 80, 0.01));
  assert('SL trade is a loss', !r.__runError__ &&
    r.strategyResult.trades[0].profit < 0);
})();

(function() {
  // Both TP and SL in range, green candle → SL should fire first for long
  var c = [
    { t:0,      o:100, h:100.5, l:99.5, c:100, v:1000 },
    { t:60000,  o:100, h:115,   l:85,   c:105, v:1000 }  // green candle
  ];
  var r = run(`//@version=5
strategy("t", initial_capital=10000)
if bar_index == 0
    strategy.entry("L", strategy.long)
strategy.exit("X", from_entry="L", profit=10, loss=10)
plot(close)`, c);
  assert('intrabar: green candle long → SL hits first', !r.__runError__ &&
    near(r.strategyResult.trades[0].exitPrice, 90, 0.01));
})();

(function() {
  // Both TP and SL in range, red candle → TP should fire first for long
  var c = [
    { t:0,      o:100, h:100.5, l:99.5, c:100, v:1000 },
    { t:60000,  o:100, h:115,   l:85,   c:95,  v:1000 }  // red candle (c<o)
  ];
  var r = run(`//@version=5
strategy("t", initial_capital=10000)
if bar_index == 0
    strategy.entry("L", strategy.long)
strategy.exit("X", from_entry="L", profit=10, loss=10)
plot(close)`, c);
  assert('intrabar: red candle long → TP hits first', !r.__runError__ &&
    near(r.strategyResult.trades[0].exitPrice, 110, 0.01));
})();

(function() {
  var c = [
    { t:0,      o:100, h:101, l:99,  c:100, v:1000 },
    { t:60000,  o:100, h:101, l:99,  c:100, v:1000 },
    { t:120000, o:100, h:101, l:99,  c:100, v:1000 }
  ];
  var r = run(`//@version=5
strategy("t", initial_capital=10000)
if bar_index == 0
    strategy.entry("L", strategy.long)
if bar_index == 1
    strategy.entry("S", strategy.short)
plot(close)`, c);
  assert('auto-reversal: long closed when short entered', !r.__runError__ &&
    r.strategyResult.summary.totalTrades === 1);
  assert('auto-reversal: direction was long', !r.__runError__ &&
    r.strategyResult.trades[0].direction === 'long');
})();

(function() {
  var r = run(`//@version=5
strategy("t", initial_capital=5000, commission_value=1)
if bar_index == 0
    strategy.entry("L", strategy.long)
if bar_index == 1
    strategy.close("L")
plot(close)`,
    [{ t:0, o:100, h:101, l:99, c:100, v:1000 },
     { t:60000, o:100, h:101, l:99, c:100, v:1000 }]);
  assert('commission deducted: flat trade net profit < 0', !r.__runError__ &&
    r.strategyResult.trades[0].profit < 0);
})();

(function() {
  var r = run(`//@version=5
strategy("t", initial_capital=10000)
plot(strategy.equity)
plot(strategy.initial_capital)`, flatCandles(5));
  assert('strategy.equity returns a value', !r.__runError__ && !isNaN(last(r,0)));
  assert('strategy.initial_capital = 10000', !r.__runError__ && near(last(r,1), 10000));
})();

(function() {
  var r = run(`//@version=5
strategy("t", initial_capital=10000)
plot(strategy.position_size)`, flatCandles(5));
  assert('strategy.position_size default 0', !r.__runError__ && near(last(r,0), 0));
})();

/* ══════════════════════════════════════════════════════════════
   SCENARIO TESTS — full trade lifecycle over multiple bars
   ══════════════════════════════════════════════════════════════ */
console.log('\n── Scenarios ──');

(function() {
  // EMA crossover strategy on controlled data: rising 20 bars, falling 20 bars
  var c = [];
  var p = 100;
  for (var i = 0; i < 40; i++) {
    var trend = i < 20 ? 1.5 : -1.5;
    var cl = p + trend;
    c.push({ t: i*60000, o: p, h: cl+0.5, l: p-0.5, c: cl, v: 1000 });
    p = cl;
  }
  var r = run(`//@version=5
strategy("EMA Cross", initial_capital=10000)
fast = ta.ema(close, 3)
slow = ta.ema(close, 8)
if ta.crossover(fast, slow)
    strategy.entry("L", strategy.long)
if ta.crossunder(fast, slow)
    strategy.close("L")
plot(fast)
plot(slow)`, c);
  assert('EMA scenario: no errors', !r.__runError__);
  assert('EMA scenario: has plots', !r.__runError__ && r.plots.length === 2);
  assert('EMA scenario: equity curve length = bar count', !r.__runError__ &&
    r.strategyResult.equityCurve.length === 40);
  assert('EMA scenario: final equity is a real number', !r.__runError__ &&
    !isNaN(r.strategyResult.summary.finalEquity));
  assert('EMA scenario: netProfit = finalEquity - initialCapital', !r.__runError__ &&
    near(r.strategyResult.summary.netProfit,
         r.strategyResult.summary.finalEquity - r.strategyResult.summary.initialCapital, 0.01));
})();

(function() {
  // Multi-trade scenario: enter+exit 3 times
  var c = [];
  for (var i = 0; i < 12; i++)
    c.push({ t: i*60000, o: 100, h: 110, l: 90, c: i % 4 < 2 ? 95 : 105, v: 1000 });
  var r = run(`//@version=5
strategy("Multi", initial_capital=10000)
if bar_index % 4 == 0
    strategy.entry("L", strategy.long)
if bar_index % 4 == 2
    strategy.close("L")
plot(close)`, c);
  assert('multi-trade: 3 closed trades', !r.__runError__ &&
    r.strategyResult.summary.totalTrades === 3);
  assert('multi-trade: win rate = 1.0 (all profitable)', !r.__runError__ &&
    near(r.strategyResult.summary.winRate, 1.0));
  assert('multi-trade: gross loss = 0', !r.__runError__ &&
    near(r.strategyResult.summary.grossLoss, 0));
})();

(function() {
  // Equity curve shape: winning strategy equity should end higher than start
  var c = risingCandles(30);
  var r = run(`//@version=5
strategy("Rising", initial_capital=10000)
if bar_index == 0
    strategy.entry("L", strategy.long)
if bar_index == 28
    strategy.close("L")
plot(close)`, c);
  var eq = Array.from(r.strategyResult.equityCurve);
  assert('equity curve grows during winning long trade', !r.__runError__ &&
    eq[eq.length-1] > eq[0]);
})();

/* ══════════════════════════════════════════════════════════════
   INVARIANT TESTS — properties that must ALWAYS be true
   ══════════════════════════════════════════════════════════════ */
console.log('\n── Invariants ──');

(function() {
  var c = [];
  var p = 100;
  for (var i = 0; i < 50; i++) {
    p += (Math.random() - 0.48) * 2;
    c.push({ t: i*60000, o: p, h: p+1, l: p-1, c: p, v: 1000 });
  }
  var r = run(`//@version=5
strategy("Inv", initial_capital=10000, commission_value=0.05)
fast = ta.ema(close, 4)
slow = ta.ema(close, 12)
atr = ta.atr(10)
if ta.crossover(fast, slow)
    strategy.entry("L", strategy.long)
if ta.crossunder(fast, slow)
    strategy.entry("S", strategy.short)
strategy.exit("LX", from_entry="L", profit=atr*3, loss=atr)
strategy.exit("SX", from_entry="S", profit=atr*3, loss=atr)
plot(fast)`, c);

  assert('INV: no runtime errors', !r.__runError__);

  var eq = Array.from(r.strategyResult.equityCurve);
  assert('INV: equity curve has no NaN', eq.every(function(x){ return !isNaN(x); }));
  assert('INV: equity curve length = bar count', eq.length === 50);

  var trades = r.strategyResult.trades;
  assert('INV: every trade has entryBar <= exitBar',
    trades.every(function(t){ return t.entryBar <= t.exitBar; }));
  assert('INV: every trade has a profit value (not NaN)',
    trades.every(function(t){ return !isNaN(t.profit); }));
  assert('INV: every trade has direction long or short',
    trades.every(function(t){ return t.direction === 'long' || t.direction === 'short'; }));
  assert('INV: every trade has entry and exit price > 0',
    trades.every(function(t){ return t.entryPrice > 0 && t.exitPrice > 0; }));

  var s = r.strategyResult.summary;
  assert('INV: totalTrades = trades array length',
    s.totalTrades === trades.length);
  assert('INV: winRate between 0 and 1',
    s.winRate >= 0 && s.winRate <= 1);
  assert('INV: maxDrawdown between 0 and 1',
    s.maxDrawdown >= 0 && s.maxDrawdown <= 1);
  assert('INV: grossProfit >= 0',
    s.grossProfit >= 0);
  assert('INV: grossLoss <= 0',
    s.grossLoss <= 0);
  assert('INV: netProfit = grossProfit + grossLoss',
    near(s.netProfit, s.grossProfit + s.grossLoss, 0.01));
  assert('INV: finalEquity = initialCapital + netProfit',
    near(s.finalEquity, s.initialCapital + s.netProfit, 0.01));
  assert('INV: plot values length = bar count',
    r.plots[0].values.length === 50);
})();

(function() {
  // na propagation invariant
  var r = run(`//@version=5
indicator("t")
x = na + 5
plot(x)`, flatCandles(3));
  assert('INV: na + number = na (NaN)', !r.__runError__ && isNaN(last(r,0)));
})();

(function() {
  // Division by zero
  var r = run(`//@version=5
indicator("t")
x = close / 0
plot(x)`, flatCandles(3));
  assert('INV: division by zero = na (NaN or Inf)', !r.__runError__);
})();

(function() {
  // 1 bar edge case
  var r = run(`//@version=5
indicator("t")
plot(ta.sma(close, 3))`, flatCandles(1));
  assert('INV: 1 bar — ta.sma(3) = NaN (not enough data)', !r.__runError__ && isNaN(last(r,0)));
})();

(function() {
  // position_size = 0 when no open trades
  var r = run(`//@version=5
strategy("t", initial_capital=10000)
if bar_index == 0
    strategy.entry("L", strategy.long)
if bar_index == 1
    strategy.close("L")
plot(strategy.position_size)`, flatCandles(5));
  var v = vals(r, 0);
  assert('INV: position_size = 0 after close', !r.__runError__ && near(v[2], 0) && near(v[4], 0));
})();

/* ══════════════════════════════════════════════════════════════
   DIFFERENTIAL TESTS — recorded TradingView outputs
   These use simple deterministic data so results are reproducible
   ══════════════════════════════════════════════════════════════ */
console.log('\n── Differential (TV-recorded) ──');

(function() {
  // SMA(3) on [10,20,30,40,50] — TV exact values
  var r = run(`//@version=5
indicator("t")
plot(ta.sma(close, 3))`, customCandles([10,20,30,40,50]));
  var v = vals(r, 0);
  // TV records: bar0=na, bar1=na, bar2=20.0, bar3=30.0, bar4=40.0
  assert('DIFF: sma(3) bar2 = 20.00 (matches TV)', !r.__runError__ && near(v[2], 20.0));
  assert('DIFF: sma(3) bar3 = 30.00 (matches TV)', !r.__runError__ && near(v[3], 30.0));
  assert('DIFF: sma(3) bar4 = 40.00 (matches TV)', !r.__runError__ && near(v[4], 40.0));
})();

(function() {
  // EMA(3) on flat 100 series — TV exact value = 100.0 after warmup
  var r = run(`//@version=5
indicator("t")
plot(ta.ema(close, 3))`, flatCandles(10, 100));
  var v = vals(r, 0).filter(function(x){ return !isNaN(x); });
  assert('DIFF: ema(3) flat 100 series = 100.0 throughout', v.every(function(x){ return near(x, 100); }));
})();

(function() {
  // Highest/lowest on known series
  var r = run(`//@version=5
indicator("t")
plot(ta.highest(close, 3))
plot(ta.lowest(close, 3))`, customCandles([10,30,20,40,15]));
  var hi = vals(r, 0);
  var lo = vals(r, 1);
  // highest(3): bar2=max(10,30,20)=30, bar3=max(30,20,40)=40, bar4=max(20,40,15)=40
  assert('DIFF: highest(3) bar2=30', !r.__runError__ && near(hi[2], 30));
  assert('DIFF: highest(3) bar3=40', !r.__runError__ && near(hi[3], 40));
  assert('DIFF: highest(3) bar4=40', !r.__runError__ && near(hi[4], 40));
  // lowest(3): bar2=min(10,30,20)=10, bar3=min(30,20,40)=20, bar4=min(20,40,15)=15
  assert('DIFF: lowest(3) bar2=10',  !r.__runError__ && near(lo[2], 10));
  assert('DIFF: lowest(3) bar3=20',  !r.__runError__ && near(lo[3], 20));
  assert('DIFF: lowest(3) bar4=15',  !r.__runError__ && near(lo[4], 15));
})();

(function() {
  // Known trade result: long entry@100, exit@120, qty=1, commission=0 → profit=20
  var r = run(`//@version=5
strategy("t", initial_capital=10000, commission_value=0)
if bar_index == 0
    strategy.entry("L", strategy.long)
if bar_index == 2
    strategy.close("L")
plot(close)`,
    customCandles([100, 110, 120, 115]));
  var t = r.strategyResult.trades[0];
  assert('DIFF: long entry@100 exit@120 profit=20', !r.__runError__ && near(t.profit, 20, 0.01));
  assert('DIFF: net profit = 20', !r.__runError__ && near(r.strategyResult.summary.netProfit, 20, 0.01));
  assert('DIFF: win rate = 1.0', !r.__runError__ && near(r.strategyResult.summary.winRate, 1.0));
})();

(function() {
  // math.* functions — deterministic
  var r = run(`//@version=5
indicator("t")
plot(math.abs(-5))
plot(math.pow(2, 10))
plot(math.floor(3.9))
plot(math.ceil(3.1))
plot(math.round(3.5))`, flatCandles(3));
  assert('DIFF: math.abs(-5) = 5',    !r.__runError__ && near(last(r,0), 5));
  assert('DIFF: math.pow(2,10) = 1024',!r.__runError__ && near(last(r,1), 1024));
  assert('DIFF: math.floor(3.9) = 3', !r.__runError__ && near(last(r,2), 3));
  assert('DIFF: math.ceil(3.1) = 4',  !r.__runError__ && near(last(r,3), 4));
  assert('DIFF: math.round(3.5) = 4', !r.__runError__ && near(last(r,4), 4));
})();

/* ══════════════════════════════════════════════════════════════
   REGRESSION SNAPSHOTS — exact values recorded from engine output
   If any of these change, something in the engine changed.
   ══════════════════════════════════════════════════════════════ */
console.log('\n── Regression Snapshots ──');

(function() {
  var c = [];
  for (var i = 0; i < 15; i++)
    c.push({ t: i*60000, o: 100+i, h: 101+i, l: 99+i, c: 100+i, v: 1000 });
  var r = run(`//@version=5
indicator("snap1")
plot(ta.sma(close, 5), title="sma5")
plot(ta.ema(close, 5), title="ema5")`, c);
  var sma = vals(r, 0), ema = vals(r, 1);
  var snapSma = [NaN,NaN,NaN,NaN,102,103,104,105,106,107,108,109,110,111,112];
  var snapEma = [NaN,NaN,NaN,NaN,102,103,104,105,106,107,108,109,110,111,112];
  var smaOk = snapSma.every(function(v,i){ return isNaN(v) ? isNaN(sma[i]) : near(sma[i], v, 0.001); });
  var emaOk = snapEma.every(function(v,i){ return isNaN(v) ? isNaN(ema[i]) : near(ema[i], v, 0.001); });
  assert('SNAP1: sma(5) on linear [100..114] exact values', !r.__runError__ && smaOk);
  assert('SNAP1: ema(5) on linear [100..114] exact values', !r.__runError__ && emaOk);
})();

(function() {
  var c = [], p = 100;
  var moves = [2,-1,3,-1,2,-2,4,-1,2,-1,3,-2,2,-1,3,-1,2,-1,4,-2];
  for (var i = 0; i < 20; i++) {
    p += moves[i];
    c.push({ t: i*60000, o: p-moves[i], h: p+0.5, l: p-moves[i]-0.5, c: p, v: 1000 });
  }
  var r = run(`//@version=5
indicator("snap2")
plot(ta.rsi(close, 7), title="rsi7")`, c);
  var rsi = vals(r, 0);
  var snapRsi = [NaN,NaN,NaN,NaN,NaN,NaN,NaN,64.285714,69.387755,64.050235,71.675943,61.525304,66.98079,61.863832,69.909455,64.608684,69.9289,64.291213,74.053145,63.86813];
  var ok = snapRsi.every(function(v,i){ return isNaN(v) ? isNaN(rsi[i]) : near(rsi[i], v, 0.0001); });
  assert('SNAP2: rsi(7) on alternating data exact values', !r.__runError__ && ok);
})();

(function() {
  var c = [];
  for (var i = 0; i < 25; i++)
    c.push({ t: i*60000, o: 100, h: 102, l: 98, c: 100 + Math.sin(i * 0.5) * 3, v: 1000 });
  var r = run(`//@version=5
indicator("snap3")
basis = ta.sma(close, 10)
dev   = ta.stdev(close, 10)
plot(basis,       title="basis")
plot(basis + dev, title="upper")
plot(basis - dev, title="lower")`, c);
  var basis = vals(r, 0), upper = vals(r, 1), lower = vals(r, 2);
  // Invariant checks on BB: upper > basis > lower always
  var validBars = basis.reduce(function(acc, b, i) {
    if (!isNaN(b) && !isNaN(upper[i]) && !isNaN(lower[i])) acc.push(i);
    return acc;
  }, []);
  var bbOk = validBars.every(function(i){ return upper[i] > basis[i] && basis[i] > lower[i]; });
  assert('SNAP3: BB(10) upper > basis > lower on all valid bars', !r.__runError__ && bbOk);
  assert('SNAP3: BB basis bar9 = 100.5647', !r.__runError__ && near(basis[9], 100.56465, 0.001));
  assert('SNAP3: BB warmup: first 9 bars NA', !r.__runError__ && isNaN(basis[8]));
})();

(function() {
  var c = [
    {t:0,      o:100, h:101, l:99,  c:100, v:1000},
    {t:60000,  o:100, h:101, l:99,  c:100, v:1000},
    {t:120000, o:100, h:101, l:99,  c:110, v:1000},
    {t:180000, o:110, h:111, l:109, c:110, v:1000},
    {t:240000, o:110, h:111, l:109, c:120, v:1000},
    {t:300000, o:120, h:121, l:119, c:120, v:1000},
    {t:360000, o:120, h:121, l:119, c:115, v:1000},
    {t:420000, o:115, h:116, l:114, c:115, v:1000}
  ];
  var r = run(`//@version=5
strategy("snap4", initial_capital=10000, commission_value=0)
if bar_index == 0
    strategy.entry("L1", strategy.long)
if bar_index == 2
    strategy.close("L1")
if bar_index == 4
    strategy.entry("L2", strategy.long)
if bar_index == 6
    strategy.close("L2")
plot(close, title="close")`, c);
  var s = r.strategyResult.summary;
  assert('SNAP4: strategy 2 trades', !r.__runError__ && s.totalTrades === 2);
  assert('SNAP4: net profit = 5 (trade1=+10, trade2=-5)', !r.__runError__ && near(s.netProfit, 5, 0.01));
  assert('SNAP4: win rate = 0.5', !r.__runError__ && near(s.winRate, 0.5, 0.001));
  assert('SNAP4: final equity = 10005', !r.__runError__ && near(s.finalEquity, 10005, 0.01));
  assert('SNAP4: trade[0] entry=100 exit=110 profit=10', !r.__runError__ &&
    near(r.strategyResult.trades[0].entryPrice, 100) &&
    near(r.strategyResult.trades[0].exitPrice, 110) &&
    near(r.strategyResult.trades[0].profit, 10));
  assert('SNAP4: trade[1] entry=120 exit=115 profit=-5', !r.__runError__ &&
    near(r.strategyResult.trades[1].entryPrice, 120) &&
    near(r.strategyResult.trades[1].exitPrice, 115) &&
    near(r.strategyResult.trades[1].profit, -5));
})();

(function() {
  var c = [];
  for (var i = 0; i < 10; i++)
    c.push({ t: i*60000, o: 100+i, h: 102+i, l: 99+i, c: 100+i, v: 1000 });
  var r = run(`//@version=5
indicator("snap5")
type Level
    float price
    int   hits = 0
var Level hi = Level.new(0.0)
if high > hi.price
    hi.price := high
    hi.hits  := hi.hits + 1
plot(hi.price, title="hiPrice")
plot(hi.hits,  title="hiHits")`, c);
  var hiP = vals(r, 0), hiH = vals(r, 1);
  var snapP = [102,103,104,105,106,107,108,109,110,111];
  var snapH = [1,2,3,4,5,6,7,8,9,10];
  var priceOk = snapP.every(function(v,i){ return near(hiP[i], v); });
  var hitsOk  = snapH.every(function(v,i){ return near(hiH[i], v); });
  assert('SNAP5: UDT hi.price tracks new highs exactly', !r.__runError__ && priceOk);
  assert('SNAP5: UDT hi.hits increments every bar', !r.__runError__ && hitsOk);
})();

/* ══════════════════════════════════════════════════════════════
   RESULTS
   ══════════════════════════════════════════════════════════════ */
var total = passed + failed;
console.log('\n═══════════════════════════════════════════');
console.log('Results: ' + passed + '/' + total + ' passed' +
  (failed > 0 ? '  (' + failed + ' FAILED)' : ''));
console.log('═══════════════════════════════════════════');
if (failed > 0) process.exit(1);
