/* ═══════════════════════════════════════════════════════════════
   fractalscript RUNTIME — Unit Tests
   Run: node fractalscript-runtime.test.js
   ═══════════════════════════════════════════════════════════════ */

/* Load the runtime — IIFE uses `typeof window !== 'undefined' ? window : this`.
   In Node's require() context, `this` is module.exports, not global.
   Set global.window so the IIFE writes FractalScriptEngine to it. */
global.window = global;
require('./public/fractalscript-runtime.js');
var FractalScriptEngine = global.FractalScriptEngine;

var passed = 0, failed = 0, total = 0;

function assert(condition, msg) {
  total++;
  if (condition) { passed++; }
  else { failed++; console.error('  FAIL: ' + msg); }
}
function section(name) { console.log('\n── ' + name + ' ──'); }
function approx(a, b, tol) { return Math.abs(a - b) < (tol || 0.0001); }

/* ══ Fake candle data ══ */
function makeCandles(n, startPrice) {
  var candles = [];
  var p = startPrice || 100;
  for (var i = 0; i < n; i++) {
    var o = p;
    var c = o + (Math.sin(i * 0.3) * 2);
    var h = Math.max(o, c) + 0.5;
    var l = Math.min(o, c) - 0.5;
    candles.push({ t: Date.now() + i * 60000, o: o, h: h, l: l, c: c, v: 1000 + i });
    p = c;
  }
  return candles;
}

/* ══════════════════════════════════════════════════════════════
   LEXER TESTS
   ══════════════════════════════════════════════════════════════ */
section('Lexer');

(function() {
  /* Version gate — reject v4 */
  var r1 = FractalScriptEngine.compile('//@version=4\nindicator("test")');
  assert(r1.error !== null, 'Should reject //@version=4');
  assert(r1.error.message.indexOf('v4') >= 0, 'Error should mention v4');

  /* Version gate — reject missing */
  var r2 = FractalScriptEngine.compile('indicator("test")');
  assert(r2.error !== null, 'Should reject missing version');

  /* Version gate — accept v5 */
  var r3 = FractalScriptEngine.compile('//@version=5\nindicator("test")');
  assert(r3.error === null, 'Should accept //@version=5');
  assert(r3.ast !== null, 'Should produce AST for v5');

  /* Token line/col accuracy */
  var src = '//@version=5\nx = 42';
  var r4 = FractalScriptEngine.compile(src);
  assert(r4.ast !== null, 'Should parse simple assignment');
  /* The assignment should be on line 2 */
  if (r4.ast && r4.ast.body && r4.ast.body.length > 0) {
    var stmt = r4.ast.body[0];
    assert(stmt.line === 2, 'Assignment should be on line 2, got ' + stmt.line);
  }

  /* Comment stripping */
  var r5 = FractalScriptEngine.compile('//@version=5\n// this is a comment\nx = 10');
  assert(r5.error === null, 'Comments should be stripped');

  /* String literal */
  var r6 = FractalScriptEngine.compile('//@version=5\nindicator("My Test")');
  assert(r6.error === null, 'String literals should parse');

  /* na literal */
  var r7 = FractalScriptEngine.compile('//@version=5\nx = na');
  assert(r7.error === null, 'na literal should parse');
})();

/* ══════════════════════════════════════════════════════════════
   PARSER TESTS
   ══════════════════════════════════════════════════════════════ */
section('Parser');

(function() {
  /* Variable declaration */
  var r1 = FractalScriptEngine.compile('//@version=5\nx = 42');
  assert(r1.ast.body[0].type === 'VarDecl', 'Should parse as VarDecl');
  assert(r1.ast.body[0].name === 'x', 'Variable name should be x');

  /* Persistent var */
  var r2 = FractalScriptEngine.compile('//@version=5\nvar count = 0');
  assert(r2.ast.body[0].persistent === true, 'var should be persistent');

  /* If/else */
  var r3 = FractalScriptEngine.compile('//@version=5\nif close > open\n    x = 1');
  assert(r3.error === null, 'If statement should parse');
  assert(r3.ast.body[0].type === 'If', 'Should be an If node');

  /* For loop */
  var r4 = FractalScriptEngine.compile('//@version=5\nfor i = 0 to 10\n    x = i');
  assert(r4.error === null, 'For loop should parse');
  assert(r4.ast.body[0].type === 'For', 'Should be a For node');

  /* History ref close[1] */
  var r5 = FractalScriptEngine.compile('//@version=5\nx = close[1]');
  assert(r5.error === null, 'History ref should parse');

  /* Ternary */
  var r6 = FractalScriptEngine.compile('//@version=5\nx = close > open ? 1 : 0');
  assert(r6.error === null, 'Ternary should parse');

  /* Plot with named args */
  var r7 = FractalScriptEngine.compile('//@version=5\nplot(close, title="Price", color=color.blue)');
  assert(r7.error === null, 'Plot with named args should parse');

  /* ta.sma call */
  var r8 = FractalScriptEngine.compile('//@version=5\nx = ta.sma(close, 14)');
  assert(r8.error === null, 'ta.sma should parse');

  /* Nested member access */
  var r9 = FractalScriptEngine.compile('//@version=5\nx = color.red');
  assert(r9.error === null, 'Member access should parse');

  /* Binary expression precedence */
  var r10 = FractalScriptEngine.compile('//@version=5\nx = 1 + 2 * 3');
  assert(r10.error === null, 'Arithmetic should parse');
})();

/* ══════════════════════════════════════════════════════════════
   EVALUATOR TESTS
   ══════════════════════════════════════════════════════════════ */
section('Evaluator');

(function() {
  var candles = makeCandles(50);

  /* Simple SMA */
  var r1 = FractalScriptEngine.run(
    '//@version=5\nindicator("test", overlay=true)\nfast = ta.sma(close, 5)\nplot(fast, title="SMA5")',
    candles
  );
  assert(r1.errors.length === 0, 'SMA script should run without errors');
  assert(r1.plots.length === 1, 'Should produce 1 plot');
  assert(r1.plots[0].label === 'SMA5', 'Plot label should be SMA5');
  /* First 4 values should be NaN (not enough bars for SMA5) */
  assert(isNaN(r1.plots[0].values[0]), 'SMA5 at bar 0 should be NaN');
  assert(isNaN(r1.plots[0].values[3]), 'SMA5 at bar 3 should be NaN');
  assert(!isNaN(r1.plots[0].values[4]), 'SMA5 at bar 4 should have a value');

  /* Verify SMA correctness */
  var expectedSma5 = 0;
  for (var i = 0; i < 5; i++) expectedSma5 += candles[i].c;
  expectedSma5 /= 5;
  assert(approx(r1.plots[0].values[4], expectedSma5, 0.01),
    'SMA5 at bar 4 should be ' + expectedSma5.toFixed(4) + ', got ' + r1.plots[0].values[4].toFixed(4));

  /* na propagation — arithmetic */
  var r2 = FractalScriptEngine.run(
    '//@version=5\nindicator("test")\nx = na + 5\nplot(x)',
    candles
  );
  assert(r2.errors.length === 0, 'na arithmetic should not error');
  assert(isNaN(r2.plots[0].values[0]), 'na + 5 should be NaN in output');

  /* na comparison */
  var r3 = FractalScriptEngine.run(
    '//@version=5\nindicator("test")\ncond = na > 5\nplotshape(cond, style=shape.circle)',
    candles
  );
  assert(r3.errors.length === 0, 'na comparison should not error');
  assert(r3.shapes.length === 0, 'na > 5 should produce no shapes (false)');

  /* var persistence across bars */
  var r4 = FractalScriptEngine.run(
    '//@version=5\nindicator("test")\nvar count = 0\ncount := count + 1\nplot(count, title="Count")',
    candles
  );
  assert(r4.errors.length === 0, 'var persistence should work');
  assert(r4.plots[0].values[0] === 1, 'Count at bar 0 should be 1');
  assert(r4.plots[0].values[49] === 50, 'Count at bar 49 should be 50, got ' + r4.plots[0].values[49]);

  /* Statement limit — use a huge loop that would exceed 5M */
  var r5 = FractalScriptEngine.run(
    '//@version=5\nindicator("test")\nfor i = 0 to 9999999\n    x = i',
    makeCandles(5)
  );
  assert(r5.errors.length > 0, 'Infinite-ish loop should trigger statement limit');
  assert(r5.errors[0].message.indexOf('Execution limit') >= 0, 'Error should mention execution limit');

  /* Crossover detection */
  var crossCandles = [];
  for (var ci = 0; ci < 30; ci++) {
    /* Create a crossing pattern at bar 15 */
    var fast = ci < 15 ? 90 + ci * 0.5 : 100 + (ci - 15) * 0.5;
    var slow = 95 + ci * 0.2;
    crossCandles.push({ t: Date.now() + ci * 60000, o: fast, h: fast + 1, l: fast - 1, c: fast, v: 100 });
  }
  var r6 = FractalScriptEngine.run(
    '//@version=5\nindicator("test")\nplotshape(ta.crossover(close, ta.sma(close, 5)), style=shape.triangleup, location=location.belowbar)',
    crossCandles
  );
  assert(r6.errors.length === 0, 'Crossover script should run');

  /* plotshape with condition */
  var r7 = FractalScriptEngine.run(
    '//@version=5\nindicator("test")\nplotshape(close > open, style=shape.triangleup, location=location.belowbar, color=color.green)',
    candles
  );
  assert(r7.errors.length === 0, 'Plotshape should run');
  assert(r7.shapes.length > 0, 'Should produce some shapes where close > open');

  /* hline */
  var r8 = FractalScriptEngine.run(
    '//@version=5\nindicator("test")\nhline(100, title="Mid", color=color.red)',
    candles
  );
  assert(r8.errors.length === 0, 'hline should run');
  assert(r8.hlines.length === 1, 'Should produce 1 hline');
  assert(r8.hlines[0].price === 100, 'hline price should be 100');

  /* EMA convergence */
  var r9 = FractalScriptEngine.run(
    '//@version=5\nindicator("test")\nplot(ta.ema(close, 10), title="EMA10")',
    makeCandles(100)
  );
  assert(r9.errors.length === 0, 'EMA should run');
  assert(!isNaN(r9.plots[0].values[99]), 'EMA at bar 99 should have a value');

  /* input.int */
  var r10 = FractalScriptEngine.run(
    '//@version=5\nindicator("test")\nlen = input.int(14, "Length")\nplot(ta.sma(close, len), title="SMA")',
    candles
  );
  assert(r10.errors.length === 0, 'input.int should run');
  assert(r10.inputs.length === 1, 'Should extract 1 input');
  assert(r10.inputs[0].name === 'Length', 'Input name should be Length');
  assert(r10.inputs[0].value === 14, 'Input default should be 14');

  /* input override */
  var r11 = FractalScriptEngine.run(
    '//@version=5\nindicator("test")\nlen = input.int(14, "Length")\nplot(ta.sma(close, len), title="SMA")',
    candles,
    { 'Length': 5 }
  );
  assert(r11.errors.length === 0, 'input override should run');
  /* The SMA should now be 5-period */
  assert(!isNaN(r11.plots[0].values[4]), 'SMA with overridden length=5 should have value at bar 4');
})();

/* ══════════════════════════════════════════════════════════════
   RESULTS
   ══════════════════════════════════════════════════════════════ */
console.log('\n═══════════════════════════════════');
console.log('Results: ' + passed + '/' + total + ' passed' + (failed > 0 ? ', ' + failed + ' FAILED' : ''));
console.log('═══════════════════════════════════');
process.exit(failed > 0 ? 1 : 0);
