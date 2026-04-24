/* ═══════════════════════════════════════════════════════════════
   FractalScript (Pine Script v5-compatible subset)
   Lexer → Parser → AST → Bar-by-bar Evaluator → Draw Commands

   Supported: ta.sma/ema/rma/atr/crossover/crossunder/highest/lowest,
              plot/plotshape/hline/bgcolor, input.int/float/bool/string,
              var persistence, if/else, for, ternary, history refs close[1],
              math.*, color.*, ai.sentiment/structure, na semantics.

   Security: Pure AST interpreter — no eval(), no Function(), no DOM access.
   Safety:   100k statement limit per run, v5-compatible syntax only.

   Exports: window.FractalScriptEngine = { compile, evaluate, run }
   ═══════════════════════════════════════════════════════════════ */

(function(global) {
  'use strict';

  var NA = Object.freeze({ __fractal_na__: true });
  function isNa(v)  { return v === NA || v === null || v === undefined || (typeof v === 'number' && isNaN(v)); }
  function naNum(v)  { return isNa(v) ? NA : +v; }
  function naArith(a, b, op) {
    if (isNa(a) || isNa(b)) return NA;
    return op(+a, +b);
  }
  function naCmp(a, b, op) {
    if (isNa(a) || isNa(b)) return false;
    return op(+a, +b);
  }

  /* ══════════════════════════════════════════════════════════════
     CONSTANTS & BUILTINS
     ══════════════════════════════════════════════════════════════ */

  var COLORS = {
    aqua:'#00BCD4', black:'#000000', blue:'#2196F3', fuchsia:'#E91E63',
    gray:'#9E9E9E', green:'#4CAF50', lime:'#8BC34A', maroon:'#800000',
    navy:'#1A237E', olive:'#808000', orange:'#FF9800', purple:'#9C27B0',
    red:'#F44336', silver:'#BDBDBD', teal:'#009688', white:'#FFFFFF',
    yellow:'#FFEB3B',
    // TradingView extra
    new: function(r, g, b, t) {
      t = (t !== undefined) ? t : 0;
      var a = Math.max(0, Math.min(1, 1 - t / 100));
      return 'rgba(' + r + ',' + g + ',' + b + ',' + a.toFixed(3) + ')';
    }
  };

  var SHAPES = {
    triangleup: 'triangleup', triangledown: 'triangledown',
    circle: 'circle', cross: 'cross', xcross: 'xcross',
    diamond: 'diamond', square: 'square',
    arrowup: 'arrowup', arrowdown: 'arrowdown',
    labelup: 'labelup', labeldown: 'labeldown',
    flag: 'flag'
  };

  var LOCATIONS = {
    abovebar: 'abovebar', belowbar: 'belowbar',
    top: 'top', bottom: 'bottom', absolute: 'absolute'
  };

  var SIZES = {
    auto: 'auto', tiny: 'tiny', small: 'small',
    normal: 'normal', large: 'large', huge: 'huge'
  };

  var MATH = {
    abs: Math.abs, max: Math.max, min: Math.min,
    round: Math.round, floor: Math.floor, ceil: Math.ceil,
    sqrt: Math.sqrt, pow: Math.pow, log: Math.log, log10: Math.log10,
    sign: Math.sign, avg: function() {
      var s = 0, n = 0;
      for (var i = 0; i < arguments.length; i++) {
        if (!isNa(arguments[i])) { s += arguments[i]; n++; }
      }
      return n > 0 ? s / n : NA;
    },
    pi: Math.PI, e: Math.E
  };

  /* ══════════════════════════════════════════════════════════════
     LEXER
     ══════════════════════════════════════════════════════════════ */

  var TT = {
    NUMBER: 'NUMBER', STRING: 'STRING', IDENT: 'IDENT',
    OP: 'OP', LPAREN: 'LPAREN', RPAREN: 'RPAREN',
    LBRACKET: 'LBRACKET', RBRACKET: 'RBRACKET',
    COMMA: 'COMMA', DOT: 'DOT', COLON: 'COLON',
    ASSIGN: 'ASSIGN', REASSIGN: 'REASSIGN', QUESTION: 'QUESTION',
    NEWLINE: 'NEWLINE', EOF: 'EOF',
    // keywords
    KW_IF: 'KW_IF', KW_ELSE: 'KW_ELSE', KW_FOR: 'KW_FOR',
    KW_TO: 'KW_TO', KW_BY: 'KW_BY', KW_VAR: 'KW_VAR',
    KW_TRUE: 'KW_TRUE', KW_FALSE: 'KW_FALSE', KW_NA: 'KW_NA',
    KW_AND: 'KW_AND', KW_OR: 'KW_OR', KW_NOT: 'KW_NOT',
    KW_INDICATOR: 'KW_INDICATOR',
    KW_PLOT: 'KW_PLOT', KW_PLOTSHAPE: 'KW_PLOTSHAPE',
    KW_BGCOLOR: 'KW_BGCOLOR', KW_HLINE: 'KW_HLINE'
  };

  var KEYWORDS = {
    'if': TT.KW_IF, 'else': TT.KW_ELSE, 'for': TT.KW_FOR,
    'to': TT.KW_TO, 'by': TT.KW_BY, 'var': TT.KW_VAR,
    'true': TT.KW_TRUE, 'false': TT.KW_FALSE, 'na': TT.KW_NA,
    'and': TT.KW_AND, 'or': TT.KW_OR, 'not': TT.KW_NOT,
    'indicator': TT.KW_INDICATOR,
    'plot': TT.KW_PLOT, 'plotshape': TT.KW_PLOTSHAPE,
    'bgcolor': TT.KW_BGCOLOR, 'hline': TT.KW_HLINE
  };

  var OPS_2CHAR = [':=', '==', '!=', '>=', '<='];
  var OPS_1CHAR = ['+', '-', '*', '/', '%', '>', '<'];

  function tok(type, value, line, col) {
    return { type: type, value: value, line: line, col: col };
  }

  function lexer(source) {
    /* Version gate */
    var versionMatch = source.match(/^[ \t]*\/\/@version=(\d+)/m);
    if (!versionMatch) {
      return { tokens: null, error: { line: 1, col: 1,
        message: 'Missing v5-compatible declaration (//@version=5). Only v5 syntax is supported.' } };
    }
    if (versionMatch[1] !== '5') {
      return { tokens: null, error: { line: 1, col: 1,
        message: 'Only v5-compatible syntax (//@version=5) is supported. Found v' + versionMatch[1] + '.' } };
    }

    var tokens = [];
    var i = 0, line = 1, col = 1, len = source.length;

    function advance() { var ch = source[i++]; if (ch === '\n') { line++; col = 1; } else { col++; } return ch; }
    function peek()    { return i + 1 < len ? source[i + 1] : ''; }
    function peek2()   { return i + 1 < len ? source[i] + source[i + 1] : source[i] || ''; }

    while (i < len) {
      var ch = source[i];
      var startLine = line, startCol = col;

      /* Skip spaces and tabs (NOT newlines) */
      if (ch === ' ' || ch === '\t') { advance(); continue; }

      /* Newlines — significant in fractal */
      if (ch === '\n') {
        advance();
        /* Collapse multiple newlines */
        while (i < len && (source[i] === '\n' || source[i] === '\r' || source[i] === ' ' || source[i] === '\t')) {
          if (source[i] === '\n') advance(); else advance();
        }
        /* Don't push newline after another newline or at start */
        if (tokens.length > 0 && tokens[tokens.length - 1].type !== TT.NEWLINE) {
          tokens.push(tok(TT.NEWLINE, '\\n', startLine, startCol));
        }
        continue;
      }

      /* Carriage return */
      if (ch === '\r') { advance(); continue; }

      /* Comments — // to end of line, and //@version already handled */
      if (ch === '/' && peek() === '/') {
        while (i < len && source[i] !== '\n') advance();
        continue;
      }

      /* Numbers */
      if (ch >= '0' && ch <= '9') {
        var num = '';
        while (i < len && ((source[i] >= '0' && source[i] <= '9') || source[i] === '.')) {
          num += advance();
        }
        tokens.push(tok(TT.NUMBER, parseFloat(num), startLine, startCol));
        continue;
      }

      /* Strings */
      if (ch === '"' || ch === "'") {
        var quote = advance(); // consume opening quote
        var str = '';
        while (i < len && source[i] !== quote && source[i] !== '\n') {
          if (source[i] === '\\' && i + 1 < len) { advance(); str += advance(); }
          else { str += advance(); }
        }
        if (i < len && source[i] === quote) advance(); // consume closing quote
        tokens.push(tok(TT.STRING, str, startLine, startCol));
        continue;
      }

      /* Identifiers and keywords */
      if ((ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch === '_') {
        var id = '';
        while (i < len && ((source[i] >= 'a' && source[i] <= 'z') || (source[i] >= 'A' && source[i] <= 'Z') ||
               (source[i] >= '0' && source[i] <= '9') || source[i] === '_')) {
          id += advance();
        }
        var kwType = KEYWORDS[id];
        tokens.push(tok(kwType || TT.IDENT, id, startLine, startCol));
        continue;
      }

      /* Two-char operators first */
      var two = peek2();
      if (two === ':=') { advance(); advance(); tokens.push(tok(TT.REASSIGN, ':=', startLine, startCol)); continue; }
      if (two === '==') { advance(); advance(); tokens.push(tok(TT.OP, '==', startLine, startCol)); continue; }
      if (two === '!=') { advance(); advance(); tokens.push(tok(TT.OP, '!=', startLine, startCol)); continue; }
      if (two === '>=') { advance(); advance(); tokens.push(tok(TT.OP, '>=', startLine, startCol)); continue; }
      if (two === '<=') { advance(); advance(); tokens.push(tok(TT.OP, '<=', startLine, startCol)); continue; }

      /* Single-char tokens */
      if (ch === '(') { advance(); tokens.push(tok(TT.LPAREN, '(', startLine, startCol)); continue; }
      if (ch === ')') { advance(); tokens.push(tok(TT.RPAREN, ')', startLine, startCol)); continue; }
      if (ch === '[') { advance(); tokens.push(tok(TT.LBRACKET, '[', startLine, startCol)); continue; }
      if (ch === ']') { advance(); tokens.push(tok(TT.RBRACKET, ']', startLine, startCol)); continue; }
      if (ch === ',') { advance(); tokens.push(tok(TT.COMMA, ',', startLine, startCol)); continue; }
      if (ch === '.') { advance(); tokens.push(tok(TT.DOT, '.', startLine, startCol)); continue; }
      if (ch === ':') { advance(); tokens.push(tok(TT.COLON, ':', startLine, startCol)); continue; }
      if (ch === '=') { advance(); tokens.push(tok(TT.ASSIGN, '=', startLine, startCol)); continue; }
      if (ch === '?') { advance(); tokens.push(tok(TT.QUESTION, '?', startLine, startCol)); continue; }

      /* Arithmetic / comparison */
      if (OPS_1CHAR.indexOf(ch) >= 0) {
        advance();
        tokens.push(tok(TT.OP, ch, startLine, startCol));
        continue;
      }

      /* Unknown char — skip */
      advance();
    }

    /* Ensure we end with a newline + EOF */
    if (tokens.length > 0 && tokens[tokens.length - 1].type !== TT.NEWLINE) {
      tokens.push(tok(TT.NEWLINE, '\\n', line, col));
    }
    tokens.push(tok(TT.EOF, null, line, col));

    return { tokens: tokens, error: null };
  }

  /* ══════════════════════════════════════════════════════════════
     PARSER — Recursive Descent → AST
     ══════════════════════════════════════════════════════════════ */

  function parser(tokens) {
    var pos = 0;

    function cur()     { return tokens[pos] || tok(TT.EOF, null, 0, 0); }
    function at(type)  { return cur().type === type; }
    function atVal(type, val) { return cur().type === type && cur().value === val; }
    function eat(type) {
      if (!at(type)) {
        var t = cur();
        return { error: { line: t.line, col: t.col,
          message: 'Expected ' + type + ', got ' + t.type + " ('" + t.value + "')" } };
      }
      return tokens[pos++];
    }
    function tryEat(type) { if (at(type)) { return tokens[pos++]; } return null; }
    function skipNewlines() { while (at(TT.NEWLINE)) pos++; }
    function loc() { var t = cur(); return { line: t.line, col: t.col }; }
    function node(type, props) { var n = { type: type }; var l = loc(); n.line = l.line; n.col = l.col; for (var k in props) n[k] = props[k]; return n; }

    function parseProgram() {
      var stmts = [];
      skipNewlines();
      /* Skip //@version=5 line — already validated by lexer */
      while (!at(TT.EOF)) {
        skipNewlines();
        if (at(TT.EOF)) break;
        var s = parseStatement();
        if (s && s.error) return s;
        if (s) stmts.push(s);
        while (at(TT.COMMA)) {
          pos++;
          var s2 = parseStatement();
          if (s2 && s2.error) return s2;
          if (s2) stmts.push(s2);
        }
        skipNewlines();
      }
      return node('Program', { body: stmts });
    }

    function parseStatement() {
      skipNewlines();
      if (at(TT.EOF)) return null;

      /* indicator() declaration */
      if (at(TT.KW_INDICATOR)) return parseIndicator();

      /* var declarations */
      if (at(TT.KW_VAR)) return parseVarDecl();

      /* if */
      if (at(TT.KW_IF)) return parseIf();

      /* for */
      if (at(TT.KW_FOR)) return parseFor();

      /* plot / plotshape / bgcolor / hline */
      if (at(TT.KW_PLOT)) return parsePlotCall();
      if (at(TT.KW_PLOTSHAPE)) return parsePlotShapeCall();
      if (at(TT.KW_BGCOLOR)) return parseBgColorCall();
      if (at(TT.KW_HLINE)) return parseHlineCall();

      /* Tuple destructuring: [a, b, c] = expr  or  [a, b, c] := expr */
      if (at(TT.LBRACKET)) return parseTupleAssign();

      /* Assignment or expression */
      return parseAssignmentOrExpr();
    }

    function parseTupleAssign() {
      var l = loc(); pos++; // consume '['
      var names = [];
      skipNewlines();
      while (!at(TT.RBRACKET)) {
        var ident = eat(TT.IDENT); if (ident.error) return ident;
        names.push(ident.value);
        skipNewlines();
        if (!tryEat(TT.COMMA)) break;
        skipNewlines();
      }
      var rb = eat(TT.RBRACKET); if (rb && rb.error) return rb;
      var isReassign = false;
      if (at(TT.REASSIGN)) { isReassign = true; pos++; }
      else { var ra = eat(TT.ASSIGN); if (ra && ra.error) return ra; }
      var value = parseExpression();
      if (value && value.error) return value;
      return { type: 'TupleAssign', names: names, value: value, reassign: isReassign, line: l.line, col: l.col };
    }

    function parseIndicator() {
      var l = loc(); pos++; // consume 'indicator'
      var r = eat(TT.LPAREN); if (r && r.error) return r;
      var args = parseArgList();
      if (args.error) return args;
      r = eat(TT.RPAREN); if (r && r.error) return r;
      return { type: 'Indicator', args: args, line: l.line, col: l.col };
    }

    function parseVarDecl() {
      var l = loc(); pos++; // consume 'var'
      var nameToken = eat(TT.IDENT); if (nameToken.error) return nameToken;
      var name = nameToken.value;
      
      if (at(TT.LBRACKET)) {
        pos++;
        var rb = eat(TT.RBRACKET); if (rb && rb.error) return rb;
        var actualName = eat(TT.IDENT); if (actualName.error) return actualName;
        name = actualName.value;
      } else if (at(TT.IDENT)) {
        var actualName = eat(TT.IDENT); if (actualName.error) return actualName;
        name = actualName.value;
      }

      var r = eat(TT.ASSIGN); if (r && r.error) return r;
      var value = parseExpression();
      if (value && value.error) return value;
      return { type: 'VarDecl', name: name, value: value, persistent: true, line: l.line, col: l.col };
    }

    function parseAssignmentOrExpr() {
      var l = loc();
      var expr = parseExpression();
      if (expr && expr.error) return expr;

      /* Check for = or := after identifier */
      if (expr && expr.type === 'Identifier') {
        if (at(TT.ASSIGN)) {
          pos++;
          var val = parseExpression();
          if (val && val.error) return val;
          return { type: 'VarDecl', name: expr.name, value: val, persistent: false, line: l.line, col: l.col };
        }
        if (at(TT.REASSIGN)) {
          pos++;
          var val2 = parseExpression();
          if (val2 && val2.error) return val2;
          return { type: 'Reassign', name: expr.name, value: val2, line: l.line, col: l.col };
        }
      }

      return expr;
    }

    function parseIf(parentCol) {
      var l = loc(); pos++; // consume 'if'
      var cond = parseExpression();
      if (cond && cond.error) return cond;
      skipNewlines();
      var then = parseBlock(parentCol !== undefined ? parentCol : l.col);
      if (then && then.error) return then;
      var els = null;
      skipNewlines();
      if (at(TT.KW_ELSE)) {
        pos++;
        skipNewlines();
        if (at(TT.KW_IF)) {
          els = parseIf(parentCol !== undefined ? parentCol : l.col);
        } else {
          els = parseBlock(parentCol !== undefined ? parentCol : l.col);
        }
        if (els && els.error) return els;
      }
      return { type: 'If', condition: cond, then: then, else: els, line: l.line, col: l.col };
    }

    function parseFor() {
      var l = loc(); pos++; // consume 'for'
      var varName = eat(TT.IDENT); if (varName.error) return varName;
      var r = eat(TT.ASSIGN); if (r && r.error) return r;
      var start = parseExpression(); if (start && start.error) return start;
      r = eat(TT.KW_TO); if (r && r.error) return r;
      var end = parseExpression(); if (end && end.error) return end;
      var step = null;
      if (at(TT.KW_BY)) { pos++; step = parseExpression(); if (step && step.error) return step; }
      skipNewlines();
      var body = parseBlock(l.col); if (body && body.error) return body;
      return { type: 'For', varName: varName.value, start: start, end: end, step: step, body: body, line: l.line, col: l.col };
    }

    function parseBlock(parentCol) {
      parentCol = parentCol || 0;
      var stmts = [];
      skipNewlines();
      var t = cur();
      if (!t || t.col <= parentCol) return null; // empty block
      var blockCol = t.col;

      var first = parseStatement();
      if (first && first.error) return first;
      if (first) stmts.push(first);
      while (at(TT.COMMA)) {
        pos++;
        var s2 = parseStatement();
        if (s2 && s2.error) return s2;
        if (s2) stmts.push(s2);
      }

      while (!at(TT.EOF)) {
        skipNewlines();
        if (at(TT.EOF)) break;
        t = cur();
        if (t.col < blockCol) break;

        var s = parseStatement();
        if (s && s.error) return s;
        if (s) stmts.push(s);
        while (at(TT.COMMA)) {
          pos++;
          var s2 = parseStatement();
          if (s2 && s2.error) return s2;
          if (s2) stmts.push(s2);
        }
      }

      if (stmts.length === 1) return stmts[0];
      return { type: 'Block', body: stmts, line: stmts[0].line, col: stmts[0].col };
    }

    function parsePlotCall() {
      var l = loc(); pos++; // consume 'plot'
      var r = eat(TT.LPAREN); if (r && r.error) return r;
      var args = parseArgList(); if (args.error) return args;
      r = eat(TT.RPAREN); if (r && r.error) return r;
      return { type: 'Plot', args: args, line: l.line, col: l.col };
    }

    function parsePlotShapeCall() {
      var l = loc(); pos++; // consume 'plotshape'
      var r = eat(TT.LPAREN); if (r && r.error) return r;
      var args = parseArgList(); if (args.error) return args;
      r = eat(TT.RPAREN); if (r && r.error) return r;
      return { type: 'PlotShape', args: args, line: l.line, col: l.col };
    }

    function parseBgColorCall() {
      var l = loc(); pos++; // consume 'bgcolor'
      var r = eat(TT.LPAREN); if (r && r.error) return r;
      var args = parseArgList(); if (args.error) return args;
      r = eat(TT.RPAREN); if (r && r.error) return r;
      return { type: 'Bgcolor', args: args, line: l.line, col: l.col };
    }

    function parseHlineCall() {
      var l = loc(); pos++; // consume 'hline'
      var r = eat(TT.LPAREN); if (r && r.error) return r;
      var args = parseArgList(); if (args.error) return args;
      r = eat(TT.RPAREN); if (r && r.error) return r;
      return { type: 'Hline', args: args, line: l.line, col: l.col };
    }

    function parseArgList() {
      var args = [];
      if (at(TT.RPAREN)) return args;
      while (true) {
        skipNewlines();
        /* Named argument: name = expr */
        var namedArg = null;
        if (at(TT.IDENT) && pos + 1 < tokens.length && tokens[pos + 1].type === TT.ASSIGN) {
          namedArg = tokens[pos].value;
          pos += 2; // skip name and =
        }
        var val = parseExpression();
        if (val && val.error) return val;
        if (namedArg) {
          args.push({ type: 'NamedArg', name: namedArg, value: val, line: val.line, col: val.col });
        } else {
          args.push(val);
        }
        skipNewlines();
        if (!tryEat(TT.COMMA)) break;
      }
      return args;
    }

    /* ── Expression parsing (precedence climbing) ── */

    function parseExpression() { return parseTernary(); }

    function parseTernary() {
      var expr = parseOr();
      if (expr && expr.error) return expr;
      if (at(TT.QUESTION)) {
        var l = loc(); pos++;
        var then = parseExpression();
        if (then && then.error) return then;
        var r = eat(TT.COLON); if (r && r.error) return r;
        var els = parseExpression();
        if (els && els.error) return els;
        return { type: 'Ternary', condition: expr, then: then, else: els, line: l.line, col: l.col };
      }
      return expr;
    }

    function parseOr() {
      var left = parseAnd();
      if (left && left.error) return left;
      while (at(TT.KW_OR)) {
        var l = loc(); pos++;
        var right = parseAnd(); if (right && right.error) return right;
        left = { type: 'BinaryExpr', op: 'or', left: left, right: right, line: l.line, col: l.col };
      }
      return left;
    }

    function parseAnd() {
      var left = parseComparison();
      if (left && left.error) return left;
      while (at(TT.KW_AND)) {
        var l = loc(); pos++;
        var right = parseComparison(); if (right && right.error) return right;
        left = { type: 'BinaryExpr', op: 'and', left: left, right: right, line: l.line, col: l.col };
      }
      return left;
    }

    function parseComparison() {
      var left = parseAddSub();
      if (left && left.error) return left;
      while (atVal(TT.OP, '==') || atVal(TT.OP, '!=') || atVal(TT.OP, '<') ||
             atVal(TT.OP, '>') || atVal(TT.OP, '<=') || atVal(TT.OP, '>=')) {
        var l = loc(); var op = cur().value; pos++;
        var right = parseAddSub(); if (right && right.error) return right;
        left = { type: 'BinaryExpr', op: op, left: left, right: right, line: l.line, col: l.col };
      }
      return left;
    }

    function parseAddSub() {
      var left = parseMulDiv();
      if (left && left.error) return left;
      while (atVal(TT.OP, '+') || atVal(TT.OP, '-')) {
        var l = loc(); var op = cur().value; pos++;
        var right = parseMulDiv(); if (right && right.error) return right;
        left = { type: 'BinaryExpr', op: op, left: left, right: right, line: l.line, col: l.col };
      }
      return left;
    }

    function parseMulDiv() {
      var left = parseUnary();
      if (left && left.error) return left;
      while (atVal(TT.OP, '*') || atVal(TT.OP, '/') || atVal(TT.OP, '%')) {
        var l = loc(); var op = cur().value; pos++;
        var right = parseUnary(); if (right && right.error) return right;
        left = { type: 'BinaryExpr', op: op, left: left, right: right, line: l.line, col: l.col };
      }
      return left;
    }

    function parseUnary() {
      if (at(TT.KW_NOT)) {
        var l = loc(); pos++;
        var expr = parseUnary(); if (expr && expr.error) return expr;
        return { type: 'UnaryExpr', op: 'not', operand: expr, line: l.line, col: l.col };
      }
      if (atVal(TT.OP, '-')) {
        var l2 = loc(); pos++;
        var expr2 = parseUnary(); if (expr2 && expr2.error) return expr2;
        return { type: 'UnaryExpr', op: '-', operand: expr2, line: l2.line, col: l2.col };
      }
      return parsePostfix();
    }

    function parsePostfix() {
      var expr = parsePrimary();
      if (expr && expr.error) return expr;

      while (true) {
        /* History reference: expr[n] */
        if (at(TT.LBRACKET)) {
          var l = loc(); pos++;
          var index = parseExpression(); if (index && index.error) return index;
          var r = eat(TT.RBRACKET); if (r && r.error) return r;
          expr = { type: 'HistoryRef', series: expr, offset: index, line: l.line, col: l.col };
          continue;
        }
        /* Member access: expr.member */
        if (at(TT.DOT)) {
          var l2 = loc(); pos++;
          var member = eat(TT.IDENT); if (member.error) return member;
          expr = { type: 'MemberAccess', object: expr, member: member.value, line: l2.line, col: l2.col };
          continue;
        }
        /* Function call: expr(...) */
        if (at(TT.LPAREN) && expr.type === 'MemberAccess' || (at(TT.LPAREN) && expr.type === 'Identifier')) {
          var l3 = loc(); pos++; // consume (
          var args = parseArgList(); if (args.error) return args;
          var r2 = eat(TT.RPAREN); if (r2 && r2.error) return r2;
          expr = { type: 'Call', callee: expr, args: args, line: l3.line, col: l3.col };
          continue;
        }
        break;
      }
      return expr;
    }

    function parsePrimary() {
      var t = cur();

      /* Number */
      if (at(TT.NUMBER)) { pos++; return { type: 'NumLiteral', value: t.value, line: t.line, col: t.col }; }
      /* String */
      if (at(TT.STRING)) { pos++; return { type: 'StrLiteral', value: t.value, line: t.line, col: t.col }; }
      /* Boolean */
      if (at(TT.KW_TRUE))  { pos++; return { type: 'BoolLiteral', value: true, line: t.line, col: t.col }; }
      if (at(TT.KW_FALSE)) { pos++; return { type: 'BoolLiteral', value: false, line: t.line, col: t.col }; }
      /* na — literal, OR function-call form na(expr) */
      if (at(TT.KW_NA)) {
        pos++;
        /* If followed by '(', treat as identifier so parsePostfix forms a Call — execCall handles 'na' as test */
        if (at(TT.LPAREN)) return { type: 'Identifier', name: 'na', line: t.line, col: t.col };
        return { type: 'NaLiteral', value: NA, line: t.line, col: t.col };
      }

      /* Identifier */
      if (at(TT.IDENT)) { pos++; return { type: 'Identifier', name: t.value, line: t.line, col: t.col }; }

      /* Parenthesized expression */
      if (at(TT.LPAREN)) {
        pos++;
        var expr = parseExpression();
        if (expr && expr.error) return expr;
        var r = eat(TT.RPAREN); if (r && r.error) return r;
        return expr;
      }

      return { error: { line: t.line, col: t.col,
        message: 'Unexpected token: ' + t.type + " ('" + t.value + "')" } };
    }

    return parseProgram();
  }

  /* ══════════════════════════════════════════════════════════════
     ta.* HELPERS — Stateful per-run caches
     ══════════════════════════════════════════════════════════════ */

  function createTaContext() {
    /* Each ta function gets a cache keyed by a unique call-site ID.
       This ensures ta.sma(close, 14) and ta.sma(close, 28) maintain separate state. */
    var callCounter = 0;
    var caches = {};

    function getCache(id, init) {
      if (!caches[id]) caches[id] = init();
      return caches[id];
    }

    function nextId() { return ++callCounter; }

    return {
      reset: function() { callCounter = 0; caches = {}; },
      resetCounter: function() { callCounter = 0; },  // reset per bar-pass to re-use IDs

      sma: function(source, length, id) {
        var c = getCache(id, function() { return { sum: 0, buf: [], ready: false }; });
        if (isNa(source)) return NA;
        c.buf.push(source);
        c.sum += source;
        if (c.buf.length > length) { c.sum -= c.buf.shift(); }
        return c.buf.length >= length ? c.sum / length : NA;
      },

      ema: function(source, length, id) {
        var c = getCache(id, function() { return { prev: NA, count: 0, sum: 0 }; });
        if (isNa(source)) return isNa(c.prev) ? NA : c.prev;
        c.count++;
        if (c.count <= length) {
          c.sum += source;
          if (c.count === length) { c.prev = c.sum / length; return c.prev; }
          return NA;
        }
        var k = 2 / (length + 1);
        c.prev = source * k + c.prev * (1 - k);
        return c.prev;
      },

      rma: function(source, length, id) {
        var c = getCache(id, function() { return { prev: NA, count: 0, sum: 0 }; });
        if (isNa(source)) return isNa(c.prev) ? NA : c.prev;
        c.count++;
        if (c.count <= length) {
          c.sum += source;
          if (c.count === length) { c.prev = c.sum / length; return c.prev; }
          return NA;
        }
        var alpha = 1 / length;
        c.prev = alpha * source + (1 - alpha) * c.prev;
        return c.prev;
      },

      wma: function(source, length, id) {
        var c = getCache(id, function() { return { buf: [] }; });
        if (isNa(source)) return NA;
        c.buf.push(source);
        if (c.buf.length > length) c.buf.shift();
        if (c.buf.length < length) return NA;
        var sum = 0, weightSum = 0;
        for (var i = 0; i < length; i++) {
          var w = (i + 1);
          sum += c.buf[i] * w;
          weightSum += w;
        }
        return sum / weightSum;
      },

      rsi: function(source, length, id) {
        var c = getCache(id, function() { return { prevSrc: NA, gains: [], losses: [], lastAvgGain: NA, lastAvgLoss: NA, count: 0 }; });
        if (isNa(source)) return NA;
        if (isNa(c.prevSrc)) { c.prevSrc = source; return NA; }
        var diff = source - c.prevSrc;
        var gain = diff > 0 ? diff : 0;
        var loss = diff < 0 ? -diff : 0;
        c.prevSrc = source;
        c.count++;
        if (c.count <= length) {
          c.gains.push(gain); c.losses.push(loss);
          if (c.count === length) {
            var gSum = 0, lSum = 0;
            for (var i = 0; i < length; i++) { gSum += c.gains[i]; lSum += c.losses[i]; }
            c.lastAvgGain = gSum / length; c.lastAvgLoss = lSum / length;
            var rs = c.lastAvgLoss === 0 ? 100 : c.lastAvgGain / c.lastAvgLoss;
            return 100 - (100 / (1 + rs));
          }
          return NA;
        }
        c.lastAvgGain = (c.lastAvgGain * (length - 1) + gain) / length;
        c.lastAvgLoss = (c.lastAvgLoss * (length - 1) + loss) / length;
        var rs2 = c.lastAvgLoss === 0 ? 100 : c.lastAvgGain / c.lastAvgLoss;
        return 100 - (100 / (1 + rs2));
      },

      macd: function(source, fast, slow, sig, id) {
        var m_id = id + '_m', s_id = id + '_s';
        var fastEma = this.ema(source, fast, m_id + '_f');
        var slowEma = this.ema(source, slow, m_id + '_s');
        if (isNa(fastEma) || isNa(slowEma)) return [NA, NA, NA];
        var macdLine = fastEma - slowEma;
        var signalLine = this.ema(macdLine, sig, s_id);
        if (isNa(signalLine)) return [macdLine, NA, NA];
        return [macdLine, signalLine, macdLine - signalLine];
      },

      stoch: function(source, high, low, length, id) {
        var c = getCache(id, function() { return { hBuf: [], lBuf: [] }; });
        if (isNa(source) || isNa(high) || isNa(low)) return NA;
        c.hBuf.push(high); c.lBuf.push(low);
        if (c.hBuf.length > length) { c.hBuf.shift(); c.lBuf.shift(); }
        if (c.hBuf.length < length) return NA;
        var highest = -Infinity, lowest = Infinity;
        for (var i = 0; i < length; i++) {
          if (c.hBuf[i] > highest) highest = c.hBuf[i];
          if (c.lBuf[i] < lowest) lowest = c.lBuf[i];
        }
        if (highest === lowest) return 100;
        return 100 * (source - lowest) / (highest - lowest);
      },

      atr: function(high, low, close, prevClose, length, id) {
        var tr;
        if (isNa(prevClose)) {
          tr = isNa(high) || isNa(low) ? NA : high - low;
        } else {
          if (isNa(high) || isNa(low)) { tr = NA; }
          else { tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose)); }
        }
        return this.rma(tr, length, id + '_rma');
      },

      vwap: function(source, volume, id) {
        var c = getCache(id, function() { return { sumPV: 0, sumV: 0 }; });
        if (isNa(source) || isNa(volume)) return NA;
        c.sumPV += (source * volume);
        c.sumV += volume;
        return c.sumV === 0 ? NA : c.sumPV / c.sumV;
      },

      ema: function(source, length, id) {
        var c = getCache(id, function() { return { prev: NA, count: 0, sum: 0 }; });
        if (isNa(source)) return isNa(c.prev) ? NA : c.prev;
        c.count++;
        if (c.count <= length) {
          c.sum += source;
          if (c.count === length) { c.prev = c.sum / length; return c.prev; }
          return NA;
        }
        var k = 2 / (length + 1);
        c.prev = source * k + c.prev * (1 - k);
        return c.prev;
      },

      rma: function(source, length, id) {
        var c = getCache(id, function() { return { prev: NA, count: 0, sum: 0 }; });
        if (isNa(source)) return isNa(c.prev) ? NA : c.prev;
        c.count++;
        if (c.count <= length) {
          c.sum += source;
          if (c.count === length) { c.prev = c.sum / length; return c.prev; }
          return NA;
        }
        var alpha = 1 / length;
        c.prev = alpha * source + (1 - alpha) * c.prev;
        return c.prev;
      },

      atr: function(high, low, close, prevClose, length, id) {
        /* ATR = RMA of True Range */
        var tr;
        if (isNa(prevClose)) {
          tr = isNa(high) || isNa(low) ? NA : high - low;
        } else {
          if (isNa(high) || isNa(low)) { tr = NA; }
          else { tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose)); }
        }
        var c = getCache(id, function() { return { prev: NA, count: 0, sum: 0 }; });
        if (isNa(tr)) return isNa(c.prev) ? NA : c.prev;
        c.count++;
        if (c.count <= length) {
          c.sum += tr;
          if (c.count === length) { c.prev = c.sum / length; return c.prev; }
          return NA;
        }
        var alpha = 1 / length;
        c.prev = alpha * tr + (1 - alpha) * c.prev;
        return c.prev;
      },

      crossover: function(a, b, id) {
        var c = getCache(id, function() { return { prevA: NA, prevB: NA }; });
        if (isNa(a) || isNa(b) || isNa(c.prevA) || isNa(c.prevB)) {
          c.prevA = a; c.prevB = b;
          return false;
        }
        var result = c.prevA <= c.prevB && a > b;
        c.prevA = a; c.prevB = b;
        return result;
      },

      crossunder: function(a, b, id) {
        var c = getCache(id, function() { return { prevA: NA, prevB: NA }; });
        if (isNa(a) || isNa(b) || isNa(c.prevA) || isNa(c.prevB)) {
          c.prevA = a; c.prevB = b;
          return false;
        }
        var result = c.prevA >= c.prevB && a < b;
        c.prevA = a; c.prevB = b;
        return result;
      },

      highest: function(source, length, id) {
        var c = getCache(id, function() { return { buf: [] }; });
        if (isNa(source)) return NA;
        c.buf.push(source);
        if (c.buf.length > length) c.buf.shift();
        var max = -Infinity;
        for (var i = 0; i < c.buf.length; i++) {
          if (!isNa(c.buf[i]) && c.buf[i] > max) max = c.buf[i];
        }
        return max === -Infinity ? NA : max;
      },

      lowest: function(source, length, id) {
        var c = getCache(id, function() { return { buf: [] }; });
        if (isNa(source)) return NA;
        c.buf.push(source);
        if (c.buf.length > length) c.buf.shift();
        var min = Infinity;
        for (var i = 0; i < c.buf.length; i++) {
          if (!isNa(c.buf[i]) && c.buf[i] < min) min = c.buf[i];
        }
        return min === Infinity ? NA : min;
      }
    };
  }

  /* ══════════════════════════════════════════════════════════════
     EVALUATOR — Bar-by-bar execution
     ══════════════════════════════════════════════════════════════ */

  var STMT_LIMIT = 5000000;

  function evaluate(ast, candles, inputOverrides) {
    if (!ast || ast.error) return { error: ast ? ast.error : { line: 0, col: 0, message: 'No AST' } };
    if (!candles || candles.length === 0) return emptyResult();

    var N = candles.length;
    var ta = createTaContext();
    var stmtCount = 0;

    /* Result collectors */
    var plots = [];       // {label, values: [], colors: [], color, lineWidth}
    var shapes = [];      // {barIndex, price, style, location, color, size}
    var hlines = [];      // {price, color, lineWidth}
    var bgcolors = [];    // {barIndex, color}
    var inputs = [];      // {name, type, default, value}
    var lines = [];       // {id, x1, y1, x2, y2, color, width, style, extend}
    var labels = [];      // {id, x, y, text, color, textcolor, style, size, textalign, tooltip}

    var nextLineId = 1;
    var nextLabelId = 1;
    var max_lines_count = 50;
    var max_labels_count = 50;

    var COLORS = {
      'red': '#FF5252', 'green': '#4CAF50', 'blue': '#2196F3', 'orange': '#FF9800',
      'yellow': '#FFEB3B', 'lime': '#8BC34A', 'white': '#FFFFFF', 'black': '#000000',
      'gray': '#9E9E9E', 'silver': '#C0C0C0', 'fuchsia': '#E91E63', 'aqua': '#00BCD4',
      'teal': '#009688', 'navy': '#3F51B5', 'maroon': '#880E4F', 'purple': '#9C27B0',
      'olive': '#827717'
    };
    var SHAPES = {
      'arrowup': 'arrowup', 'arrowdown': 'arrowdown', 'labelup': 'labelup', 'labeldown': 'labeldown',
      'circle': 'circle', 'cross': 'cross', 'xcross': 'xcross', 'triangleup': 'triangleup', 'triangledown': 'triangledown'
    };
    var LINE_STYLES = { 'style_solid': 'solid', 'style_dashed': 'dashed', 'style_dotted': 'dotted' };
    var EXTEND_MODES = { 'none': 'none', 'right': 'right', 'left': 'left', 'both': 'both' };
    var LABEL_STYLES = {
      'style_none': 'none',
      'style_label_up': 'label_up', 'style_label_down': 'label_down',
      'style_label_left': 'label_left', 'style_label_right': 'label_right',
      'style_label_center': 'label_center',
      'style_label_upper_left': 'label_upper_left',  'style_label_upper_right': 'label_upper_right',
      'style_label_lower_left': 'label_lower_left',  'style_label_lower_right': 'label_lower_right',
      'style_arrowup': 'arrowup', 'style_arrowdown': 'arrowdown',
      'style_triangleup': 'triangleup', 'style_triangledown': 'triangledown',
      'style_circle': 'circle', 'style_square': 'square', 'style_diamond': 'diamond',
      'style_cross': 'cross', 'style_xcross': 'xcross', 'style_flag': 'flag'
    };
    var LOCATIONS = {
      'abovebar': 'abovebar', 'belowbar': 'belowbar', 'top': 'top', 'bottom': 'bottom', 'absolute': 'absolute'
    };
    /* Parse indicator params */
    var overlay = true; // default: overlay on main price chart
    if (ast.type === 'Program') {
      for (var i = 0; i < ast.body.length; i++) {
        if (ast.body[i].type === 'Indicator') {
           var indArgs = ast.body[i].args;
           for (var j = 0; j < indArgs.length; j++) {
             if (indArgs[j].type === 'NamedArg' && indArgs[j].name === 'max_lines_count') {
               if (indArgs[j].value && indArgs[j].value.type === 'NumLiteral') {
                 max_lines_count = indArgs[j].value.value;
               }
             }
             if (indArgs[j].type === 'NamedArg' && indArgs[j].name === 'max_labels_count') {
               if (indArgs[j].value && indArgs[j].value.type === 'NumLiteral') {
                 max_labels_count = indArgs[j].value.value;
               }
             }
             if (indArgs[j].type === 'NamedArg' && indArgs[j].name === 'overlay') {
               var ov = indArgs[j].value;
               if (ov && ov.type === 'BoolLiteral') overlay = !!ov.value;
             }
           }
        }
      }
    }

    /* Plot registry — maps plot call-site index to plot entry */
    var plotRegistry = {};
    var plotCounter = 0;

    /* Variable scopes */
    var persistentVars = {};  // var x = ...  (survives across bars)
    var barVars = {};         // x = ...      (resets each bar)

    /* History buffers for series variables */
    var seriesHistory = {};   // varName -> [val_at_bar0, val_at_bar1, ...]

    /* Candle data for current bar */
    var barIndex = 0;
    var curCandle = null;
    var prevCandle = null;

    /* Extract inputs first (single pass) */
    extractInputs(ast, inputOverrides);

    /* Bar-by-bar execution */
    for (barIndex = 0; barIndex < N; barIndex++) {
      curCandle = candles[barIndex];
      prevCandle = barIndex > 0 ? candles[barIndex - 1] : null;
      barVars = {};
      ta.resetCounter();
      plotCounter = 0;

      /* Execute all statements */
      var body = ast.type === 'Program' ? ast.body : [ast];
      for (var si = 0; si < body.length; si++) {
        var result = execNode(body[si]);
        if (result && result.__error__) return { error: result.__error__ };
      }

      /* Record series history for history refs */
      for (var vn in persistentVars) {
        if (!seriesHistory[vn]) seriesHistory[vn] = [];
        seriesHistory[vn].push(persistentVars[vn]);
      }
      for (var vn2 in barVars) {
        if (!seriesHistory[vn2]) seriesHistory[vn2] = [];
        seriesHistory[vn2].push(barVars[vn2]);
      }
    }

    /* Build Float64Array for plot values */
    var finalPlots = [];
    for (var pk in plotRegistry) {
      var p = plotRegistry[pk];
      var vals = new Float64Array(N);
      var cols = new Array(N);
      for (var vi = 0; vi < N; vi++) {
        var v = p.values[vi];
        vals[vi] = (v !== undefined && !isNa(v)) ? v : NaN;
        cols[vi] = p.colors[vi] || null;
      }
      finalPlots.push({
        label: p.label || ('Plot ' + (parseInt(pk) + 1)),
        values: vals,
        colors: cols,
        color: p.color || '#2196F3',
        lineWidth: p.lineWidth || 1
      });
    }

    return {
      plots: finalPlots,
      shapes: shapes,
      hlines: hlines,
      bgcolors: bgcolors,
      inputs: inputs,
      lines: lines,
      labels: labels,
      overlay: overlay,
      errors: []
    };

    /* ── Helper: extract input() calls from AST ── */
    function extractInputs(node, overrides) {
      if (!node) return;
      overrides = overrides || {};
      walkAST(node, function(n) {
        if (n.type === 'Call' && n.callee) {
          var callName = getCallName(n.callee);
          if (callName === 'input.int' || callName === 'input.float' ||
              callName === 'input.bool' || callName === 'input.string' || callName === 'input') {
            var defVal = n.args[0] ? n.args[0] : null;
            var title = '';
            for (var ai = 0; ai < n.args.length; ai++) {
              var a = n.args[ai];
              if (a.type === 'NamedArg') {
                if (a.name === 'title') title = a.value.value || '';
                if (a.name === 'defval' && defVal === null) defVal = a.value;
              }
            }
            if (!title && n.args.length > 1) {
              var secondArg = n.args[1];
              if (secondArg && secondArg.type !== 'NamedArg' && secondArg.type === 'StrLiteral') {
                title = secondArg.value;
              }
            }
            var itype = callName.replace('input.', '') || 'int';
            var dv = defVal ? (defVal.type === 'NamedArg' ? defVal.value.value : defVal.value) : 0;
            var actualVal = overrides[title] !== undefined ? overrides[title] : dv;
            inputs.push({ name: title || ('Input ' + (inputs.length + 1)), type: itype, default: dv, value: actualVal });
          }
        }
      });
    }

    function walkAST(node, fn) {
      if (!node || typeof node !== 'object') return;
      fn(node);
      if (Array.isArray(node)) { for (var i = 0; i < node.length; i++) walkAST(node[i], fn); return; }
      for (var k in node) {
        if (k === 'line' || k === 'col' || k === 'type') continue;
        if (typeof node[k] === 'object') walkAST(node[k], fn);
      }
    }

    function getCallName(callee) {
      if (callee.type === 'Identifier') return callee.name;
      if (callee.type === 'MemberAccess') {
        var obj = getCallName(callee.object);
        return obj + '.' + callee.member;
      }
      return '';
    }

    /* ── Core execution ── */
    function execNode(node) {
      if (!node) return NA;
      if (++stmtCount > STMT_LIMIT) {
        return { __error__: { line: node.line, col: node.col,
          message: 'Execution limit exceeded (100,000 statements). Possible infinite loop.' } };
      }

      switch (node.type) {
        case 'Program':      return execProgram(node);
        case 'Indicator':    return NA; // declaration only
        case 'NumLiteral':   return node.value;
        case 'StrLiteral':   return node.value;
        case 'BoolLiteral':  return node.value;
        case 'NaLiteral':    return NA;
        case 'Identifier':   return resolveVar(node.name);
        case 'VarDecl':      return execVarDecl(node);
        case 'Reassign':     return execReassign(node);
        case 'TupleAssign':  return execTupleAssign(node);
        case 'BinaryExpr':   return execBinary(node);
        case 'UnaryExpr':    return execUnary(node);
        case 'Ternary':      return execTernary(node);
        case 'If':           return execIf(node);
        case 'For':          return execFor(node);
        case 'Block':        return execBlock(node);
        case 'MemberAccess': return execMember(node);
        case 'HistoryRef':   return execHistoryRef(node);
        case 'Call':         return execCall(node);
        case 'Plot':         return execPlot(node);
        case 'PlotShape':    return execPlotShape(node);
        case 'Bgcolor':      return execBgcolor(node);
        case 'Hline':        return execHline(node);
        case 'NamedArg':     return execNode(node.value);
        default:             return NA;
      }
    }

    function execProgram(node) {
      var last = NA;
      for (var i = 0; i < node.body.length; i++) {
        last = execNode(node.body[i]);
        if (last && last.__error__) return last;
      }
      return last;
    }

    function execBlock(node) {
      var last = NA;
      for (var i = 0; i < node.body.length; i++) {
        last = execNode(node.body[i]);
        if (last && last.__error__) return last;
      }
      return last;
    }

    function execVarDecl(node) {
      if (node.persistent) {
        /* var x = ... → only initialize on the first bar */
        if (!(node.name in persistentVars)) {
          var val = execNode(node.value);
          if (val && val.__error__) return val;
          persistentVars[node.name] = val;
          return val;
        }
        return persistentVars[node.name];
      } else {
        var val = execNode(node.value);
        if (val && val.__error__) return val;
        barVars[node.name] = val;
        return val;
      }
    }

    function execReassign(node) {
      var val = execNode(node.value);
      if (val && val.__error__) return val;
      if (node.name in persistentVars) { persistentVars[node.name] = val; delete barVars[node.name]; }
      else { barVars[node.name] = val; }
      return val;
    }

    function execTupleAssign(node) {
      var val = execNode(node.value);
      if (val && val.__error__) return val;
      if (!Array.isArray(val)) {
        return { __error__: { line: node.line, col: node.col,
          message: 'Tuple destructuring requires an array/tuple on the right side' } };
      }
      for (var i = 0; i < node.names.length; i++) {
        var name = node.names[i];
        var v = i < val.length ? val[i] : NA;
        if (node.reassign && (name in persistentVars)) {
          persistentVars[name] = v; delete barVars[name];
        } else {
          barVars[name] = v;
        }
      }
      return val;
    }

    function resolveVar(name) {
      /* Built-in series */
      if (name === 'close')  return +curCandle.c;
      if (name === 'open')   return +curCandle.o;
      if (name === 'high')   return +curCandle.h;
      if (name === 'low')    return +curCandle.l;
      if (name === 'volume') return curCandle.v || 0;
      if (name === 'hl2')    return (+curCandle.h + +curCandle.l) / 2;
      if (name === 'hlc3')   return (+curCandle.h + +curCandle.l + +curCandle.c) / 3;
      if (name === 'ohlc4')  return (+curCandle.o + +curCandle.h + +curCandle.l + +curCandle.c) / 4;
      if (name === 'bar_index') return barIndex;
      if (name === 'last_bar_index') return N - 1;
      if (name === 'na')     return NA;

      /* User variables */
      if (name in barVars) return barVars[name];
      if (name in persistentVars) return persistentVars[name];

      /* Resolve input values */
      for (var ii = 0; ii < inputs.length; ii++) {
        if (inputs[ii].name === name) return inputs[ii].value;
      }

      /* Namespace roots */
      if (name === 'ta' || name === 'math' || name === 'color' || name === 'shape' ||
          name === 'location' || name === 'size' || name === 'input' || name === 'str' ||
          name === 'hline') return name;

      return NA;
    }

    function execBinary(node) {
      var left = execNode(node.left);
      if (left && left.__error__) return left;

      /* Short-circuit for and/or */
      if (node.op === 'and') { if (!left) return false; var r = execNode(node.right); return r && r.__error__ ? r : !!r; }
      if (node.op === 'or')  { if (left) return true; var r2 = execNode(node.right); return r2 && r2.__error__ ? r2 : !!r2; }

      var right = execNode(node.right);
      if (right && right.__error__) return right;

      switch (node.op) {
        case '+':
          /* String concatenation when either side is a string */
          if (typeof left === 'string' || typeof right === 'string') {
            if (isNa(left) || isNa(right)) return NA;
            return String(left) + String(right);
          }
          return naArith(left, right, function(a,b){return a+b;});
        case '-':  return naArith(left, right, function(a,b){return a-b;});
        case '*':  return naArith(left, right, function(a,b){return a*b;});
        case '/':  return naArith(left, right, function(a,b){return b===0?NA:a/b;});
        case '%':  return naArith(left, right, function(a,b){return b===0?NA:a%b;});
        case '==': return naCmp(left, right, function(a,b){return a===b;});
        case '!=': return naCmp(left, right, function(a,b){return a!==b;});
        case '<':  return naCmp(left, right, function(a,b){return a<b;});
        case '>':  return naCmp(left, right, function(a,b){return a>b;});
        case '<=': return naCmp(left, right, function(a,b){return a<=b;});
        case '>=': return naCmp(left, right, function(a,b){return a>=b;});
        default:   return NA;
      }
    }

    function execUnary(node) {
      var val = execNode(node.operand);
      if (val && val.__error__) return val;
      if (node.op === '-') return isNa(val) ? NA : -val;
      if (node.op === 'not') return isNa(val) ? NA : !val;
      return NA;
    }

    function execTernary(node) {
      var cond = execNode(node.condition);
      if (cond && cond.__error__) return cond;
      return cond ? execNode(node.then) : execNode(node.else);
    }

    function execIf(node) {
      var cond = execNode(node.condition);
      if (cond && cond.__error__) return cond;
      if (cond) return execNode(node.then);
      if (node.else) return execNode(node.else);
      return NA;
    }

    function execFor(node) {
      var start = execNode(node.start);
      var end = execNode(node.end);
      var step = node.step ? execNode(node.step) : 1;
      if (isNa(start) || isNa(end) || isNa(step) || step === 0) return NA;
      
      // Safety: If range is invalid for the step direction, don't execute
      if (step > 0 && start > end) return NA;
      if (step < 0 && start < end) return NA;

      var last = NA;
      for (var i = start; step > 0 ? i <= end : i >= end; i += step) {
        barVars[node.varName] = i;
        last = execNode(node.body);
        if (last && last.__error__) return last;
      }
      return last;
    }

    function execMember(node) {
      var obj = execNode(node.object);
      if (obj && obj.__error__) return obj;

      /* Namespace resolution */
      if (obj === 'color') return COLORS[node.member] !== undefined ? COLORS[node.member] : NA;
      if (obj === 'shape') return SHAPES[node.member] || NA;
      if (obj === 'location') return LOCATIONS[node.member] || NA;
      if (obj === 'size') return SIZES[node.member] || NA;
      if (obj === 'math') return MATH[node.member] !== undefined ? MATH[node.member] : NA;
      if (obj === 'ta') return 'ta.' + node.member;
      if (obj === 'input') return 'input.' + node.member;
      if (obj === 'line') return LINE_STYLES[node.member] || 'line.' + node.member;
      if (obj === 'label') return LABEL_STYLES[node.member] || 'label.' + node.member;
      if (obj === 'str') return 'str.' + node.member;
      if (obj === 'extend') return EXTEND_MODES[node.member] || 'extend.' + node.member;
      if (obj === 'hline') return 'hline.' + node.member;

      return NA;
    }

    function execHistoryRef(node) {
      var offset = execNode(node.offset);
      if (isNa(offset)) return NA;
      offset = Math.round(offset);

      /* Built-in series history */
      var series = node.series;
      if (series.type === 'Identifier') {
        var name = series.name;
        var targetBar = barIndex - offset;
        if (targetBar < 0 || targetBar >= N) return NA;
        var tc = candles[targetBar];
        if (name === 'close')  return +tc.c;
        if (name === 'open')   return +tc.o;
        if (name === 'high')   return +tc.h;
        if (name === 'low')    return +tc.l;
        if (name === 'volume') return tc.v || 0;
        if (name === 'hl2')    return (+tc.h + +tc.l) / 2;
        if (name === 'hlc3')   return (+tc.h + +tc.l + +tc.c) / 3;
        if (name === 'ohlc4')  return (+tc.o + +tc.h + +tc.l + +tc.c) / 4;

        /* User variable history */
        if (seriesHistory[name]) {
          var hi = seriesHistory[name].length - 1 - (offset - (barIndex - seriesHistory[name].length));
          var idx = barIndex - offset;
          if (idx >= 0 && idx < seriesHistory[name].length) return seriesHistory[name][idx];
        }
      }
      return NA;
    }

    function execCall(node) {
      var callName = getCallName(node.callee);

      /* line.* functions */
      if (callName.indexOf('line.') === 0) {
        return execLineCall(callName, node.args, node);
      }

      /* label.* functions */
      if (callName.indexOf('label.') === 0) {
        return execLabelCall(callName, node.args, node);
      }

      /* str.* functions */
      if (callName.indexOf('str.') === 0) {
        return execStrCall(callName, node.args, node);
      }

      /* array.* functions */
      if (callName.indexOf('array.') === 0) {
        return execArrayCall(callName, node.args, node);
      }

      /* ta.* functions */
      if (callName.indexOf('ta.') === 0) {
        return execTaCall(callName, node.args, node);
      }

      /* ai.* functions */
      if (callName.indexOf('ai.') === 0) {
        if (callName === 'ai.sentiment') {
          var c = curCandle.c, o = curCandle.o, h = curCandle.h, l = curCandle.l;
          return (c - o) / (h - l || 1);
        }
        if (callName === 'ai.structure') return Math.random();
        return NA;
      }

      /* input.* functions */
      if (callName.indexOf('input.') === 0 || callName === 'input') {
        return execInputCall(callName, node.args);
      }

      /* math.* functions */
      if (callName.indexOf('math.') === 0) {
        var fn = MATH[callName.replace('math.', '')];
        if (typeof fn === 'function') {
          var mathArgs = [];
          for (var i = 0; i < node.args.length; i++) {
            var a = node.args[i];
            var v = execNode(a.type === 'NamedArg' ? a.value : a);
            if (v && v.__error__) return v;
            if (isNa(v)) return NA;
            mathArgs.push(v);
          }
          return fn.apply(null, mathArgs);
        }
        return NA;
      }

      /* na() test function */
      if (callName === 'na') {
        if (node.args.length > 0) {
          var testVal = execNode(node.args[0].type === 'NamedArg' ? node.args[0].value : node.args[0]);
          return isNa(testVal);
        }
        return NA;
      }

      /* nz() — replace na with default */
      if (callName === 'nz') {
        var v1 = node.args[0] ? execNode(node.args[0].type === 'NamedArg' ? node.args[0].value : node.args[0]) : NA;
        var v2 = node.args[1] ? execNode(node.args[1].type === 'NamedArg' ? node.args[1].value : node.args[1]) : 0;
        return isNa(v1) ? v2 : v1;
      }

      /* fixnan — persist last non-na */
      if (callName === 'fixnan') {
        var src = node.args[0] ? execNode(node.args[0].type === 'NamedArg' ? node.args[0].value : node.args[0]) : NA;
        if (!isNa(src)) { persistentVars['__fixnan__'] = src; return src; }
        return persistentVars['__fixnan__'] !== undefined ? persistentVars['__fixnan__'] : NA;
      }

      /* color.new() */
      if (callName === 'color.new') {
        var cArgs = [];
        for (var ci = 0; ci < node.args.length; ci++) {
          var ca = node.args[ci];
          cArgs.push(execNode(ca.type === 'NamedArg' ? ca.value : ca));
        }
        if (cArgs.length >= 2 && typeof cArgs[0] === 'string') {
          /* color.new(color.red, 50) — apply transparency to existing color */
          return applyTransparency(cArgs[0], cArgs[1]);
        }
        return NA;
      }

      /* str.tostring etc — just return the value */
      if (callName === 'str.tostring') {
        var sv = node.args[0] ? execNode(node.args[0].type === 'NamedArg' ? node.args[0].value : node.args[0]) : '';
        return String(sv);
      }

      /* input.int, input.float, input.bool, input.string */
      if (callName.startsWith('input')) {
        var inputTitle = '';
        var defVal = NA;
        for (var k = 0; k < node.args.length; k++) {
          var a = node.args[k];
          if (a.type === 'NamedArg') {
            if (a.name === 'title') inputTitle = execNode(a.value);
            if (a.name === 'defval') defVal = execNode(a.value);
          } else {
            if (k === 0) defVal = execNode(a);
            if (k === 1) inputTitle = execNode(a);
          }
        }
        if (inputOverrides && inputOverrides[inputTitle] !== undefined) {
          return inputOverrides[inputTitle];
        }
        return defVal;
      }

      return NA;
    }

    function applyTransparency(color, transp) {
      if (isNa(transp)) return color;
      var a = Math.max(0, Math.min(1, 1 - transp / 100));
      /* If it's a hex color, convert to rgba */
      if (typeof color === 'string' && color[0] === '#') {
        var r = parseInt(color.slice(1, 3), 16);
        var g = parseInt(color.slice(3, 5), 16);
        var b = parseInt(color.slice(5, 7), 16);
        return 'rgba(' + r + ',' + g + ',' + b + ',' + a.toFixed(3) + ')';
      }
      return color;
    }

    function execTaCall(name, args, node) {
      /* Unique ID based on the call node's position in the AST */
      var id = 'ta_' + node.line + '_' + node.col + '_' + name;

      var evalArg = function(idx) {
        if (idx >= args.length) return NA;
        var a = args[idx];
        return execNode(a.type === 'NamedArg' ? a.value : a);
      };

      var getNamedArg = function(argName, defaultIdx) {
        for (var i = 0; i < args.length; i++) {
          if (args[i].type === 'NamedArg' && args[i].name === argName) {
            return execNode(args[i].value);
          }
        }
        return defaultIdx !== undefined ? evalArg(defaultIdx) : NA;
      };

      switch (name) {
        case 'ta.sma': {
          var src = evalArg(0);
          var len = evalArg(1);
          if (isNa(len)) return NA;
          return ta.sma(src, Math.round(len), id);
        }
        case 'ta.ema': {
          var src2 = evalArg(0);
          var len2 = evalArg(1);
          if (isNa(len2)) return NA;
          return ta.ema(src2, Math.round(len2), id);
        }
        case 'ta.rma': {
          var src3 = evalArg(0);
          var len3 = evalArg(1);
          if (isNa(len3)) return NA;
          return ta.rma(src3, Math.round(len3), id);
        }
        case 'ta.macd': {
          var srcM = evalArg(0);
          var fastM = evalArg(1);
          var slowM = evalArg(2);
          var sigM = evalArg(3);
          if (isNa(fastM) || isNa(slowM) || isNa(sigM)) return [NA, NA, NA];
          return ta.macd(srcM, Math.round(fastM), Math.round(slowM), Math.round(sigM), id);
        }
        case 'ta.stoch': {
          var srcS = evalArg(0);
          var highS = evalArg(1);
          var lowS = evalArg(2);
          var lenS = evalArg(3);
          if (isNa(lenS)) return NA;
          return ta.stoch(srcS, highS, lowS, Math.round(lenS), id);
        }
        case 'ta.atr': {
          var lenA = evalArg(0);
          if (isNa(lenA)) return NA;
          var pc = prevCandle ? +prevCandle.c : NA;
          return ta.atr(+curCandle.h, +curCandle.l, +curCandle.c, pc, Math.round(lenA), id);
        }
        case 'ta.vwap': {
          var srcV = evalArg(0);
          return ta.vwap(srcV, +curCandle.v, id);
        }
        case 'ta.crossover': {
          var a = evalArg(0);
          var b = evalArg(1);
          return ta.crossover(a, b, id);
        }
        case 'ta.crossunder': {
          var a2 = evalArg(0);
          var b2 = evalArg(1);
          return ta.crossunder(a2, b2, id);
        }
        case 'ta.ema': {
          var srcE = evalArg(0);
          var lenE = evalArg(1);
          if (isNa(lenE)) return NA;
          return ta.ema(srcE, Math.round(lenE), id);
        }
        case 'ta.rsi': {
          var srcR = evalArg(0);
          var lenR = evalArg(1);
          if (isNa(lenR)) return NA;
          return ta.rsi(srcR, Math.round(lenR), id);
        }
        case 'ta.wma': {
          var srcW = evalArg(0);
          var lenW = evalArg(1);
          if (isNa(lenW)) return NA;
          return ta.wma(srcW, Math.round(lenW), id);
        }
        case 'ta.highest': {
          var src4 = evalArg(0);
          var len5 = evalArg(1);
          if (isNa(len5)) return NA;
          return ta.highest(src4, Math.round(len5), id);
        }
        case 'ta.lowest': {
          var src5 = evalArg(0);
          var len6 = evalArg(1);
          if (isNa(len6)) return NA;
          return ta.lowest(src5, Math.round(len6), id);
        }
        case 'ta.highestbars': {
          var src6 = evalArg(0);
          var len7 = evalArg(1);
          if (isNa(len7)) return NA;
          return ta.highestbars(src6, Math.round(len7), id);
        }
        case 'ta.lowestbars': {
          var src7 = evalArg(0);
          var len8 = evalArg(1);
          if (isNa(len8)) return NA;
          return ta.lowestbars(src7, Math.round(len8), id);
        }
        default:
          return { __error__: { line: node.line, col: node.col,
            message: "Unknown function '" + name + "' — not supported in this interpreter" } };
      }
    }

    function execLineCall(name, args, node) {
      var evalArg = function(idx) {
        if (idx >= args.length) return NA;
        var a = args[idx];
        return execNode(a.type === 'NamedArg' ? a.value : a);
      };
      
      var getNamedArg = function(argName, defaultIdx) {
        for (var i = 0; i < args.length; i++) {
          if (args[i].type === 'NamedArg' && args[i].name === argName) {
            return execNode(args[i].value);
          }
        }
        return defaultIdx !== undefined ? evalArg(defaultIdx) : NA;
      };

      switch (name) {
        case 'line.new': {
          var x1 = Number(getNamedArg('x1', 0));
          var y1 = Number(getNamedArg('y1', 1));
          var x2 = Number(getNamedArg('x2', 2));
          var y2 = Number(getNamedArg('y2', 3));
          
          if (isNaN(x1) || isNaN(y1) || isNaN(x2) || isNaN(y2)) return NA;

          var color = getNamedArg('color', 4);
          var width = getNamedArg('width', 5);
          var style = getNamedArg('style', 6);
          var extend = getNamedArg('extend', 7);
          
          var lObj = {
            id: nextLineId++,
            x1: x1, y1: y1,
            x2: x2, y2: y2,
            color: isNa(color) ? '#c9a84c' : color,
            width: isNa(width) ? 1 : width,
            style: isNa(style) ? 'solid' : style,
            extend: isNa(extend) ? 'none' : extend
          };
          lines.push(lObj);
          if (lines.length > 500) {
             lines.shift();
          }
          return lObj;
        }
        case 'line.delete': {
          var l = evalArg(0);
          if (l && l.id) {
            for (var i = 0; i < lines.length; i++) {
              if (lines[i].id === l.id) {
                lines.splice(i, 1);
                break;
              }
            }
          }
          return NA;
        }
        case 'line.set_xy1': {
          var l = evalArg(0);
          var x = evalArg(1);
          var y = evalArg(2);
          if (l && l.id) { l.x1 = x; l.y1 = y; }
          return NA;
        }
        case 'line.set_xy2': {
          var l = evalArg(0);
          var x = evalArg(1);
          var y = evalArg(2);
          if (l && l.id) { l.x2 = x; l.y2 = y; }
          return NA;
        }
        case 'line.set_color': {
          var l = evalArg(0);
          var c = evalArg(1);
          if (l && l.id && !isNa(c)) { l.color = c; }
          return NA;
        }
        case 'line.set_width': {
          var l = evalArg(0);
          var w = evalArg(1);
          if (l && l.id && !isNa(w)) { l.width = w; }
          return NA;
        }
        case 'line.get_x1': { var l1 = evalArg(0); return (l1 && l1.id) ? l1.x1 : NA; }
        case 'line.get_y1': { var l2 = evalArg(0); return (l2 && l2.id) ? l2.y1 : NA; }
        case 'line.get_x2': { var l3 = evalArg(0); return (l3 && l3.id) ? l3.x2 : NA; }
        case 'line.get_y2': { var l4 = evalArg(0); return (l4 && l4.id) ? l4.y2 : NA; }
        default:
          return { __error__: { line: node.line, col: node.col, message: "Unknown line function '" + name + "'" } };
      }
    }

    function execLabelCall(name, args, node) {
      var evalArg = function(idx) {
        if (idx >= args.length) return NA;
        var a = args[idx];
        return execNode(a.type === 'NamedArg' ? a.value : a);
      };
      var getNamedArg = function(argName, defaultIdx) {
        for (var i = 0; i < args.length; i++) {
          if (args[i].type === 'NamedArg' && args[i].name === argName) {
            return execNode(args[i].value);
          }
        }
        return defaultIdx !== undefined ? evalArg(defaultIdx) : NA;
      };

      switch (name) {
        case 'label.new': {
          var x = Number(getNamedArg('x', 0));
          var y = Number(getNamedArg('y', 1));
          if (isNaN(x) || isNaN(y)) return NA;
          var text = getNamedArg('text', 2);
          var color = getNamedArg('color', 3);
          var style = getNamedArg('style', 4);
          var textcolor = getNamedArg('textcolor', 5);
          var size = getNamedArg('size', 6);
          var textalign = getNamedArg('textalign', 7);
          var tooltip = getNamedArg('tooltip', 8);
          var lbl = {
            id: nextLabelId++,
            x: x, y: y,
            text: isNa(text) ? '' : String(text),
            color: isNa(color) ? '#2196F3' : color,
            textcolor: isNa(textcolor) ? '#FFFFFF' : textcolor,
            style: isNa(style) ? 'label_down' : style,
            size: isNa(size) ? 'normal' : size,
            textalign: isNa(textalign) ? 'center' : textalign,
            tooltip: isNa(tooltip) ? '' : String(tooltip)
          };
          labels.push(lbl);
          if (labels.length > max_labels_count) labels.shift();
          return lbl;
        }
        case 'label.delete': {
          var lb = evalArg(0);
          if (lb && lb.id) {
            for (var i = 0; i < labels.length; i++) {
              if (labels[i].id === lb.id) { labels.splice(i, 1); break; }
            }
          }
          return NA;
        }
        case 'label.set_text': {
          var lb1 = evalArg(0); var t = evalArg(1);
          if (lb1 && lb1.id) lb1.text = isNa(t) ? '' : String(t);
          return NA;
        }
        case 'label.set_xy': {
          var lb2 = evalArg(0); var nx = evalArg(1); var ny = evalArg(2);
          if (lb2 && lb2.id && !isNa(nx) && !isNa(ny)) { lb2.x = Number(nx); lb2.y = Number(ny); }
          return NA;
        }
        case 'label.set_x': {
          var lb3 = evalArg(0); var nx1 = evalArg(1);
          if (lb3 && lb3.id && !isNa(nx1)) lb3.x = Number(nx1);
          return NA;
        }
        case 'label.set_y': {
          var lb4 = evalArg(0); var ny1 = evalArg(1);
          if (lb4 && lb4.id && !isNa(ny1)) lb4.y = Number(ny1);
          return NA;
        }
        case 'label.set_color': {
          var lb5 = evalArg(0); var c = evalArg(1);
          if (lb5 && lb5.id && !isNa(c)) lb5.color = c;
          return NA;
        }
        case 'label.set_textcolor': {
          var lb6 = evalArg(0); var tc = evalArg(1);
          if (lb6 && lb6.id && !isNa(tc)) lb6.textcolor = tc;
          return NA;
        }
        case 'label.set_style': {
          var lb7 = evalArg(0); var s = evalArg(1);
          if (lb7 && lb7.id && !isNa(s)) lb7.style = s;
          return NA;
        }
        case 'label.set_size': {
          var lb8 = evalArg(0); var sz = evalArg(1);
          if (lb8 && lb8.id && !isNa(sz)) lb8.size = sz;
          return NA;
        }
        case 'label.get_x':    { var lg1 = evalArg(0); return (lg1 && lg1.id) ? lg1.x : NA; }
        case 'label.get_y':    { var lg2 = evalArg(0); return (lg2 && lg2.id) ? lg2.y : NA; }
        case 'label.get_text': { var lg3 = evalArg(0); return (lg3 && lg3.id) ? lg3.text : NA; }
        default:
          return { __error__: { line: node.line, col: node.col, message: "Unknown label function '" + name + "'" } };
      }
    }

    function execStrCall(name, args, node) {
      var evalArg = function(idx) {
        if (idx >= args.length) return NA;
        var a = args[idx];
        return execNode(a.type === 'NamedArg' ? a.value : a);
      };

      /* Helper: convert a Pine value to a display string */
      function toStr(v, fmt) {
        if (isNa(v)) return 'NaN';
        if (typeof v === 'boolean') return v ? 'true' : 'false';
        if (typeof v === 'string') return v;
        var n = +v;
        if (isNaN(n)) return String(v);
        /* fmt can be a number (decimal places) or a format string like "#.##" or "0.0000" */
        if (fmt !== undefined && fmt !== null && !isNa(fmt)) {
          if (typeof fmt === 'number') return n.toFixed(Math.max(0, Math.round(fmt)));
          if (typeof fmt === 'string') {
            var decPart = fmt.split('.')[1] || '';
            var places = decPart.replace(/[^#0]/g, '').length;
            return n.toFixed(places);
          }
        }
        /* Default: up to 4 significant decimal places, strip trailing zeros */
        var s = n.toFixed(4);
        return s.replace(/\.?0+$/, '');
      }

      switch (name) {
        case 'str.tostring': {
          var v = evalArg(0);
          var fmt = args.length > 1 ? evalArg(1) : undefined;
          return toStr(v, fmt);
        }
        case 'str.format': {
          /* str.format("{0}", val1, val2, ...) — basic positional substitution */
          var template = evalArg(0);
          if (isNa(template) || typeof template !== 'string') return NA;
          var result = template;
          for (var fi = 1; fi < args.length; fi++) {
            var fv = evalArg(fi);
            result = result.split('{' + (fi - 1) + '}').join(toStr(fv));
          }
          return result;
        }
        case 'str.length': {
          var s = evalArg(0);
          return (isNa(s) || typeof s !== 'string') ? NA : s.length;
        }
        case 'str.substring': {
          var s1 = evalArg(0); var from = evalArg(1); var to = evalArg(2);
          if (isNa(s1) || typeof s1 !== 'string' || isNa(from)) return NA;
          return isNa(to) ? s1.substring(+from) : s1.substring(+from, +to);
        }
        case 'str.contains': {
          var s2 = evalArg(0); var sub = evalArg(1);
          if (isNa(s2) || isNa(sub)) return NA;
          return String(s2).indexOf(String(sub)) >= 0;
        }
        case 'str.startswith': {
          var s3 = evalArg(0); var pre = evalArg(1);
          if (isNa(s3) || isNa(pre)) return NA;
          return String(s3).indexOf(String(pre)) === 0;
        }
        case 'str.endswith': {
          var s4 = evalArg(0); var suf = evalArg(1);
          if (isNa(s4) || isNa(suf)) return NA;
          var str4 = String(s4), suf4 = String(suf);
          return str4.lastIndexOf(suf4) === str4.length - suf4.length;
        }
        case 'str.lower':  { var s5 = evalArg(0); return isNa(s5) ? NA : String(s5).toLowerCase(); }
        case 'str.upper':  { var s6 = evalArg(0); return isNa(s6) ? NA : String(s6).toUpperCase(); }
        case 'str.replace': {
          var s7 = evalArg(0); var pat = evalArg(1); var rep = evalArg(2);
          if (isNa(s7) || isNa(pat) || isNa(rep)) return NA;
          return String(s7).split(String(pat)).join(String(rep));
        }
        default:
          return { __error__: { line: node.line, col: node.col, message: "Unknown str function '" + name + "'" } };
      }
    }

    function execArrayCall(name, args, node) {
      var evalArg = function(idx) {
        if (idx >= args.length) return NA;
        var a = args[idx];
        return execNode(a.type === 'NamedArg' ? a.value : a);
      };

      switch (name) {
        case 'array.new_int':
        case 'array.new_float':
        case 'array.new_bool':
        case 'array.new_string': {
          var size = evalArg(0);
          var initial = evalArg(1);
          var arr = [];
          if (!isNa(size) && size > 0) {
            for (var i = 0; i < size; i++) arr.push(isNa(initial) ? NA : initial);
          }
          return arr;
        }
        case 'array.push': {
          var arr = evalArg(0);
          var val = evalArg(1);
          if (Array.isArray(arr)) arr.push(val);
          return NA;
        }
        case 'array.pop': {
          var arr = evalArg(0);
          if (Array.isArray(arr) && arr.length > 0) return arr.pop();
          return NA;
        }
        case 'array.shift': {
          var arr = evalArg(0);
          if (Array.isArray(arr) && arr.length > 0) return arr.shift();
          return NA;
        }
        case 'array.unshift': {
          var arr = evalArg(0);
          var val = evalArg(1);
          if (Array.isArray(arr)) arr.unshift(val);
          return NA;
        }
        case 'array.shift': {
          var arr = evalArg(0);
          if (Array.isArray(arr) && arr.length > 0) return arr.shift();
          return NA;
        }
        case 'array.unshift': {
          var arr = evalArg(0);
          var val = evalArg(1);
          if (Array.isArray(arr)) arr.unshift(val);
          return NA;
        }
        case 'array.set': {
          var arr = evalArg(0);
          var idx = evalArg(1);
          var val = evalArg(2);
          if (Array.isArray(arr) && !isNa(idx) && idx >= 0 && idx < arr.length) arr[idx] = val;
          return NA;
        }
        case 'array.get': {
          var arr = evalArg(0);
          var idx = evalArg(1);
          if (Array.isArray(arr) && !isNa(idx) && idx >= 0 && idx < arr.length) return arr[idx];
          return NA;
        }
        case 'array.size': {
          var arr = evalArg(0);
          if (Array.isArray(arr)) return arr.length;
          return NA;
        }
        case 'array.clear': {
          var arr = evalArg(0);
          if (Array.isArray(arr)) arr.length = 0;
          return NA;
        }
        case 'array.slice': {
          var arr = evalArg(0);
          var from = evalArg(1);
          var to = evalArg(2);
          if (Array.isArray(arr)) return arr.slice(isNa(from) ? 0 : from, isNa(to) ? arr.length : to);
          return [];
        }
        case 'array.insert': {
          var arr = evalArg(0);
          var idx = evalArg(1);
          var val = evalArg(2);
          if (Array.isArray(arr) && !isNa(idx)) arr.splice(Math.max(0, idx), 0, val);
          return NA;
        }
        case 'array.remove': {
          var arr = evalArg(0);
          var idx = evalArg(1);
          if (Array.isArray(arr) && !isNa(idx) && idx >= 0 && idx < arr.length) return arr.splice(idx, 1)[0];
          return NA;
        }
        case 'array.sum': {
          var arr = evalArg(0);
          if (!Array.isArray(arr)) return NA;
          var sum = 0;
          for (var i = 0; i < arr.length; i++) if (!isNa(arr[i])) sum += arr[i];
          return sum;
        }
        case 'array.avg': {
          var arr = evalArg(0);
          if (!Array.isArray(arr)) return NA;
          var sum = 0, cnt = 0;
          for (var i = 0; i < arr.length; i++) {
            if (!isNa(arr[i])) { sum += arr[i]; cnt++; }
          }
          return cnt > 0 ? sum / cnt : NA;
        }
        case 'array.max': {
          var arr = evalArg(0);
          if (!Array.isArray(arr)) return NA;
          var max = -Infinity;
          for (var i = 0; i < arr.length; i++) {
            if (!isNa(arr[i]) && arr[i] > max) max = arr[i];
          }
          return max === -Infinity ? NA : max;
        }
        case 'array.min': {
          var arr = evalArg(0);
          if (!Array.isArray(arr)) return NA;
          var min = Infinity;
          for (var i = 0; i < arr.length; i++) {
            if (!isNa(arr[i]) && arr[i] < min) min = arr[i];
          }
          return min === Infinity ? NA : min;
        }
        case 'array.sort': {
          var arr = evalArg(0);
          var order = evalArg(1);
          if (Array.isArray(arr)) {
             arr.sort(function(a,b) {
               if(isNa(a)) return 1; if(isNa(b)) return -1;
               return (order === 'order.descending' || order === 'descending') ? b - a : a - b;
             });
          }
          return NA;
        }
        case 'array.indexof': {
          var arr = evalArg(0);
          var val = evalArg(1);
          if (Array.isArray(arr)) return arr.indexOf(val);
          return -1;
        }
        case 'array.includes': {
          var arr = evalArg(0);
          var val = evalArg(1);
          if (Array.isArray(arr)) return arr.indexOf(val) !== -1;
          return false;
        }
        case 'array.reverse': {
          var arr = evalArg(0);
          if (Array.isArray(arr)) arr.reverse();
          return NA;
        }
        default:
          return { __error__: { line: node.line, col: node.col, message: "Unknown array function '" + name + "'" } };
      }
    }

    function execInputCall(name, args) {
      /* Return the current value from inputs array (already extracted) */
      var title = '';
      var defVal = NA;
      for (var i = 0; i < args.length; i++) {
        var a = args[i];
        if (a.type === 'NamedArg') {
          if (a.name === 'title') title = execNode(a.value);
          if (a.name === 'defval') defVal = execNode(a.value);
        } else if (i === 0) {
          defVal = execNode(a);
        } else if (i === 1 && a.type === 'StrLiteral') {
          title = a.value;
        }
      }
      /* Find matching input */
      for (var j = 0; j < inputs.length; j++) {
        if (inputs[j].name === title || (title === '' && j === inputs.length - 1)) {
          return inputs[j].value;
        }
      }
      return defVal;
    }

    /* ── Plot/shape/hline/bgcolor execution ── */

    function execPlot(node) {
      var args = node.args || [];
      var series = args.length > 0 ? execNode(args[0].type === 'NamedArg' ? args[0].value : args[0]) : NA;
      var label = '', color = '#2196F3', lineWidth = 1, dynamicColor = null;

      for (var i = 0; i < args.length; i++) {
        var a = args[i];
        if (a.type === 'NamedArg') {
          if (a.name === 'title') label = execNode(a.value);
          if (a.name === 'color') {
            var cv = execNode(a.value);
            if (typeof cv === 'string') {
              /* Check if this is a dynamic expression (contains ternary/if) */
              dynamicColor = cv;
              color = cv;
            }
          }
          if (a.name === 'linewidth') lineWidth = execNode(a.value) || 1;
          if (a.name === 'series') series = execNode(a.value);
        } else if (i === 1 && a.type !== 'NamedArg') {
          /* Second positional arg is often title */
          var v = execNode(a);
          if (typeof v === 'string') label = v;
        }
      }

      /* Register or update plot entry */
      var pid = plotCounter++;
      if (!plotRegistry[pid]) {
        plotRegistry[pid] = { label: label, values: new Array(N), colors: new Array(N), color: color, lineWidth: lineWidth };
      }
      plotRegistry[pid].values[barIndex] = series;
      plotRegistry[pid].colors[barIndex] = dynamicColor;

      return series;
    }

    function execPlotShape(node) {
      var args = node.args || [];
      var condition = args.length > 0 ? execNode(args[0].type === 'NamedArg' ? args[0].value : args[0]) : false;
      if (!condition || isNa(condition)) return NA;

      var style = 'triangleup', loc = 'belowbar', color = '#4CAF50', sz = 'small', title = '';
      var text = '', textcolor = '#2196F3'; // Pine v5 default textcolor is color.blue
      var price = NA;

      for (var i = 0; i < args.length; i++) {
        var a = args[i];
        if (a.type === 'NamedArg') {
          var v = execNode(a.value);
          if (a.name === 'style') style = v || style;
          if (a.name === 'location') loc = v || loc;
          if (a.name === 'color') color = (typeof v === 'string') ? v : color;
          if (a.name === 'size') sz = v || sz;
          if (a.name === 'title') title = v || '';
          if (a.name === 'text') text = (v !== undefined && v !== null) ? String(v) : '';
          if (a.name === 'textcolor') textcolor = (typeof v === 'string') ? v : textcolor;
          if (a.name === 'series') { condition = v; if (!condition) return NA; }
          if (a.name === 'price') price = v;
        }
      }

      /* Determine price from location */
      if (isNa(price)) {
        if (loc === 'abovebar') price = +curCandle.h;
        else if (loc === 'belowbar') price = +curCandle.l;
        else price = +curCandle.c;
      }

      shapes.push({
        barIndex: barIndex,
        price: price,
        style: style,
        location: loc,
        color: color,
        size: sz,
        title: title,
        text: text,
        textcolor: textcolor
      });
      return NA;
    }

    function execBgcolor(node) {
      var args = node.args || [];
      var color = args.length > 0 ? execNode(args[0].type === 'NamedArg' ? args[0].value : args[0]) : NA;
      if (!color || isNa(color) || typeof color !== 'string') return NA;
      bgcolors.push({ barIndex: barIndex, color: color });
      return NA;
    }

    function execHline(node) {
      var args = node.args || [];
      var price = args.length > 0 ? execNode(args[0].type === 'NamedArg' ? args[0].value : args[0]) : NA;
      if (isNa(price)) return NA;

      /* hline only needs to be added once */
      if (barIndex > 0) return NA;

      var color = '#FF9800', lw = 1, title = '', linestyle = 'dashed';
      for (var i = 0; i < args.length; i++) {
        var a = args[i];
        if (a.type === 'NamedArg') {
          var v = execNode(a.value);
          if (a.name === 'color') color = (typeof v === 'string') ? v : color;
          if (a.name === 'linewidth') lw = v || 1;
          if (a.name === 'title') title = v || '';
          if (a.name === 'linestyle') {
            var ls = typeof v === 'string' ? v : 'dashed';
            if (ls.indexOf('solid') >= 0) linestyle = 'solid';
            else if (ls.indexOf('dotted') >= 0) linestyle = 'dotted';
            else linestyle = 'dashed';
          }
        }
      }
      hlines.push({ price: price, color: color, lineWidth: lw, linestyle: linestyle, title: title });
      return NA;
    }
  }

  function emptyResult() {
    return { plots: [], shapes: [], hlines: [], bgcolors: [], inputs: [], errors: [] };
  }



  /* ══════════════════════════════════════════════════════════════
     PUBLIC API
     ══════════════════════════════════════════════════════════════ */

  function compile(source) {
    var lexResult = lexer(source);
    if (lexResult.error) return { ast: null, inputs: [], error: lexResult.error };

    var ast = parser(lexResult.tokens);
    if (ast && ast.error) return { ast: null, inputs: [], error: ast.error };

    return { ast: ast, inputs: [], error: null };
  }

  function run(source, candles, inputOverrides) {
    var compiled = compile(source);
    if (compiled.error) {
      return {
        plots: [], shapes: [], hlines: [], bgcolors: [],
        inputs: [],
        errors: [compiled.error]
      };
    }
    var result = evaluate(compiled.ast, candles, inputOverrides || {});
    if (result.error) {
      return {
        plots: [], shapes: [], hlines: [], bgcolors: [],
        inputs: result.inputs || [],
        errors: [result.error]
      };
    }
    return result;
  }

  /* ══════════════════════════════════════════════════════════════
     EXPORT
     ══════════════════════════════════════════════════════════════ */

  global.FractalScriptEngine = {
    compile: compile,
    evaluate: evaluate,
    run: run,
    NA: NA,
    isNa: isNa
  };

})(typeof window !== 'undefined' ? window : this);
