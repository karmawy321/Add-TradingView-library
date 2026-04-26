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
    ASSIGN: 'ASSIGN', REASSIGN: 'REASSIGN', QUESTION: 'QUESTION', ARROW: 'ARROW',
    NEWLINE: 'NEWLINE', EOF: 'EOF',
    // keywords
    KW_IF: 'KW_IF', KW_ELSE: 'KW_ELSE', KW_FOR: 'KW_FOR',
    KW_TO: 'KW_TO', KW_BY: 'KW_BY', KW_VAR: 'KW_VAR',
    KW_TRUE: 'KW_TRUE', KW_FALSE: 'KW_FALSE', KW_NA: 'KW_NA',
    KW_AND: 'KW_AND', KW_OR: 'KW_OR', KW_NOT: 'KW_NOT',
    KW_INDICATOR: 'KW_INDICATOR',
    KW_PLOT: 'KW_PLOT', KW_PLOTSHAPE: 'KW_PLOTSHAPE',
    KW_BGCOLOR: 'KW_BGCOLOR', KW_HLINE: 'KW_HLINE',
    KW_SWITCH: 'KW_SWITCH', KW_WHILE: 'KW_WHILE', KW_BREAK: 'KW_BREAK',
    KW_CONTINUE: 'KW_CONTINUE', KW_IN: 'KW_IN', KW_TYPE: 'KW_TYPE',
    KW_STRATEGY: 'KW_STRATEGY'
  };

  var KEYWORDS = {
    'if': TT.KW_IF, 'else': TT.KW_ELSE, 'for': TT.KW_FOR,
    'to': TT.KW_TO, 'by': TT.KW_BY, 'var': TT.KW_VAR,
    'true': TT.KW_TRUE, 'false': TT.KW_FALSE, 'na': TT.KW_NA,
    'and': TT.KW_AND, 'or': TT.KW_OR, 'not': TT.KW_NOT,
    'indicator': TT.KW_INDICATOR,
    'plot': TT.KW_PLOT, 'plotshape': TT.KW_PLOTSHAPE,
    'bgcolor': TT.KW_BGCOLOR, 'hline': TT.KW_HLINE,
    'switch': TT.KW_SWITCH, 'while': TT.KW_WHILE, 'break': TT.KW_BREAK,
    'continue': TT.KW_CONTINUE, 'in': TT.KW_IN, 'type': TT.KW_TYPE,
    'strategy': TT.KW_STRATEGY
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

      /* Hex color literal: #RRGGBB or #RRGGBBAA — tokenize as STRING so it
         flows through expressions as a color value. */
      if (ch === '#') {
        advance(); // consume #
        var hex = '#';
        while (i < len && ((source[i] >= '0' && source[i] <= '9') ||
               (source[i] >= 'a' && source[i] <= 'f') ||
               (source[i] >= 'A' && source[i] <= 'F'))) {
          hex += advance();
        }
        if (hex.length === 7 || hex.length === 9) {
          tokens.push(tok(TT.STRING, hex, startLine, startCol));
          continue;
        }
        return { tokens: null, error: { line: startLine, col: startCol,
          message: "Invalid hex color literal '" + hex + "' (expected #RRGGBB or #RRGGBBAA)" } };
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
      if (two === '=>') { advance(); advance(); tokens.push(tok(TT.ARROW, '=>', startLine, startCol)); continue; }
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

      /* indicator() / strategy() declaration — only when followed by '(', not '.' */
      if (at(TT.KW_INDICATOR)) return parseIndicator();
      if (at(TT.KW_STRATEGY) && tokens[pos + 1] && tokens[pos + 1].type === TT.LPAREN) return parseIndicator();

      /* var declarations */
      if (at(TT.KW_VAR)) return parseVarDecl();

      /* if */
      if (at(TT.KW_IF)) return parseIf();

      /* for */
      if (at(TT.KW_FOR)) return parseFor();

      /* while / break / switch */
      if (at(TT.KW_WHILE))  return parseWhile();
      if (at(TT.KW_BREAK))  { var lb = loc(); pos++; return { type: 'Break',    line: lb.line, col: lb.col }; }
      if (at(TT.KW_CONTINUE)) { var lc = loc(); pos++; return { type: 'Continue', line: lc.line, col: lc.col }; }
      if (at(TT.KW_SWITCH)) return parseSwitch();
      if (at(TT.KW_TYPE)) return parseTypeDecl();

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

    function parseWhile() {
      var l = loc(); pos++; // consume 'while'
      var cond = parseExpression();
      if (cond && cond.error) return cond;
      skipNewlines();
      var body = parseBlock(l.col);
      if (body && body.error) return body;
      return { type: 'While', condition: cond, body: body, line: l.line, col: l.col };
    }

    function parseSwitch() {
      var l = loc(); pos++; // consume 'switch'
      /* Two forms:
         (1)  switch x       <- expression-form, then `value => result` cases
              1 => "one"
              2 => "two"
              => "default"
         (2)  switch          <- predicate-form, then `cond => result` cases
              x > 5 => "big"
              x < 0 => "neg"
              => "other" */
      var subject = null;
      if (!at(TT.NEWLINE)) {
        subject = parseExpression();
        if (subject && subject.error) return subject;
      }
      skipNewlines();
      /* Determine indent from first case */
      if (at(TT.EOF)) return { error: { line: l.line, col: l.col, message: 'switch needs at least one case' } };
      var firstCol = cur().col;
      var cases = [];
      var defaultBody = null;
      while (!at(TT.EOF)) {
        skipNewlines();
        if (at(TT.EOF)) break;
        if (cur().col < firstCol) break;
        /* Default case: starts with `=>` directly */
        if (at(TT.ARROW)) {
          pos++;
          var dbody;
          if (at(TT.NEWLINE)) { skipNewlines(); dbody = parseBlock(firstCol + 1); }
          else dbody = parseExpression();
          if (dbody && dbody.error) return dbody;
          defaultBody = dbody;
          continue;
        }
        /* Regular case: <expr> => <body> */
        var cval = parseExpression();
        if (cval && cval.error) return cval;
        if (!at(TT.ARROW)) {
          return { error: { line: cur().line, col: cur().col,
            message: "Expected '=>' in switch case" } };
        }
        pos++; // consume =>
        var cbody;
        if (at(TT.NEWLINE)) { skipNewlines(); cbody = parseBlock(firstCol + 1); }
        else cbody = parseExpression();
        if (cbody && cbody.error) return cbody;
        cases.push({ value: cval, body: cbody });
      }
      return { type: 'Switch', subject: subject, cases: cases, defaultBody: defaultBody, line: l.line, col: l.col };
    }

    function parseTypeDecl() {
      var l = loc(); pos++; // consume 'type'
      var nameToken = eat(TT.IDENT); if (nameToken.error) return nameToken;
      var typeName = nameToken.value;
      skipNewlines();
      var fields = [];
      while (!at(TT.EOF)) {
        skipNewlines();
        if (at(TT.EOF)) break;
        if (at(TT.KW_TYPE)) break;
        var t = cur();
        if (t.col <= l.col) break;
        // field: <type> <name> [= default]
        var fieldTypeToken = eat(TT.IDENT); if (fieldTypeToken.error) return fieldTypeToken;
        var fieldNameToken = eat(TT.IDENT); if (fieldNameToken.error) return fieldNameToken;
        var fieldDefault = null;
        if (at(TT.ASSIGN)) {
          pos++; // consume =
          fieldDefault = parseExpression();
          if (fieldDefault && fieldDefault.error) return fieldDefault;
        }
        fields.push({ type: fieldTypeToken.value, name: fieldNameToken.value, def: fieldDefault });
        skipNewlines();
      }
      if (fields.length === 0) {
        return { error: { line: l.line, col: l.col, message: 'Type "' + typeName + '" must have at least one field' } };
      }
      return { type: 'TypeDecl', name: typeName, fields: fields, line: l.line, col: l.col };
    }

    function parseTupleAssign() {
      var l = loc(); pos++; // consume '['
      var elems = [];
      skipNewlines();
      while (!at(TT.RBRACKET)) {
        var elem = parseExpression();
        if (elem && elem.error) return elem;
        elems.push(elem);
        skipNewlines();
        if (!tryEat(TT.COMMA)) break;
        skipNewlines();
      }
      var rb = eat(TT.RBRACKET); if (rb && rb.error) return rb;

      /* Destructuring assignment: [a, b, c] = expr  OR  [a, b, c] := expr */
      if (at(TT.ASSIGN) || at(TT.REASSIGN)) {
        var isReassign = at(TT.REASSIGN);
        pos++;
        var names = [];
        for (var ni = 0; ni < elems.length; ni++) {
          if (elems[ni].type !== 'Identifier') {
            return { error: { line: l.line, col: l.col,
              message: 'Tuple destructuring target must be a list of identifiers' } };
          }
          names.push(elems[ni].name);
        }
        var value = parseExpression();
        if (value && value.error) return value;
        return { type: 'TupleAssign', names: names, value: value, reassign: isReassign, line: l.line, col: l.col };
      }

      /* No assignment — it's a tuple literal expression (e.g., return value of a user fn) */
      return { type: 'TupleLiteral', elems: elems, line: l.line, col: l.col };
    }

    function parseIndicator() {
      var l = loc();
      var isStrat = at(TT.KW_STRATEGY);
      pos++; // consume 'indicator' or 'strategy'
      var r = eat(TT.LPAREN); if (r && r.error) return r;
      var args = parseArgList();
      if (args.error) return args;
      r = eat(TT.RPAREN); if (r && r.error) return r;
      return { type: isStrat ? 'Strategy' : 'Indicator', args: args, line: l.line, col: l.col };
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

      /* User-defined function: foo(a, b) => body */
      if (expr && expr.type === 'Call' && at(TT.ARROW)) {
        if (expr.callee.type !== 'Identifier') {
          return { error: { line: l.line, col: l.col, message: 'Function name must be a simple identifier' } };
        }
        var params = [];
        for (var pi = 0; pi < expr.args.length; pi++) {
          var ap = expr.args[pi];
          if (ap.type !== 'Identifier') {
            return { error: { line: ap.line || l.line, col: ap.col || l.col, message: 'Function parameters must be plain identifiers' } };
          }
          params.push(ap.name);
        }
        pos++; // consume '=>'
        var body;
        if (at(TT.NEWLINE)) {
          skipNewlines();
          body = parseBlock(l.col);
          if (body && body.error) return body;
          if (!body) return { error: { line: l.line, col: l.col, message: 'Empty function body' } };
        } else {
          body = parseExpression();
          if (body && body.error) return body;
        }
        return { type: 'FunctionDecl', name: expr.callee.name, params: params, body: body, line: l.line, col: l.col };
      }

      /* Member assignment: obj.field := value */
      if (expr && expr.type === 'MemberAccess' && at(TT.REASSIGN)) {
        pos++;
        var val3 = parseExpression();
        if (val3 && val3.error) return val3;
        return { type: 'MemberAssign', object: expr.object, member: expr.member, value: val3, line: l.line, col: l.col };
      }
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
      /* `for x in arr` form (Pine v5 array iteration) */
      if (at(TT.KW_IN)) {
        pos++;
        var iter = parseExpression(); if (iter && iter.error) return iter;
        skipNewlines();
        var body2 = parseBlock(l.col); if (body2 && body2.error) return body2;
        return { type: 'ForIn', varName: varName.value, iter: iter, body: body2, line: l.line, col: l.col };
      }
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
        /* Named argument: name = expr (keywords like bgcolor/hline/plot can also be param names) */
        var namedArg = null;
        var curTok = cur();
        if (pos + 1 < tokens.length && tokens[pos + 1].type === TT.ASSIGN &&
            (curTok.type === TT.IDENT || curTok.type === TT.KW_BGCOLOR || curTok.type === TT.KW_HLINE ||
             curTok.type === TT.KW_PLOT || curTok.type === TT.KW_PLOTSHAPE)) {
          namedArg = curTok.value;
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

      /* Statement-style expressions (switch / if) consumed multi-line content;
         don't apply postfix operators — otherwise the `[` of a following tuple
         literal would be misread as a history-ref index on the switch result. */
      if (expr && (expr.type === 'Switch' || expr.type === 'If')) return expr;

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

      /* Statement keywords used as namespace identifiers in expressions:
         e.g. `linestyle=hline.style_dashed` — `hline` is KW_HLINE but here it's a namespace. */
      if (at(TT.KW_HLINE) || at(TT.KW_PLOT) || at(TT.KW_PLOTSHAPE) || at(TT.KW_BGCOLOR) || at(TT.KW_STRATEGY)) {
        pos++;
        return { type: 'Identifier', name: t.value, line: t.line, col: t.col };
      }

      /* switch as expression: `x = switch cond \n case => val ...` */
      if (at(TT.KW_SWITCH)) {
        return parseSwitch();
      }
      /* if as expression: `x = if cond \n  val1 \n else \n  val2` */
      if (at(TT.KW_IF)) {
        return parseIf();
      }

      /* Parenthesized expression */
      if (at(TT.LPAREN)) {
        pos++;
        var expr = parseExpression();
        if (expr && expr.error) return expr;
        var r = eat(TT.RPAREN); if (r && r.error) return r;
        return expr;
      }

      /* Tuple/array literal as expression: [a, b, c]
         Used in named-arg values (e.g. `options = ["Live", "All History"]`)
         and as function return values. Statement-level `[a,b,c] = expr` is
         handled separately via parseTupleAssign. */
      if (at(TT.LBRACKET)) {
        var llt = loc(); pos++; // consume [
        var lelems = [];
        skipNewlines();
        while (!at(TT.RBRACKET)) {
          var lel = parseExpression();
          if (lel && lel.error) return lel;
          lelems.push(lel);
          skipNewlines();
          if (!tryEat(TT.COMMA)) break;
          skipNewlines();
        }
        var lrb = eat(TT.RBRACKET); if (lrb && lrb.error) return lrb;
        return { type: 'TupleLiteral', elems: lelems, line: llt.line, col: llt.col };
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
      },

      /* ════════ P5: Moving averages ════════ */
      hma: function(source, length, id) {
        var c = getCache(id, function() { return { buf: [], rawBuf: [] }; });
        if (isNa(source)) return NA;
        c.buf.push(source);
        if (c.buf.length > length) c.buf.shift();
        if (c.buf.length < length) return NA;
        var halfLen = Math.max(1, Math.floor(length / 2));
        var sqrtLen = Math.max(1, Math.floor(Math.sqrt(length)));
        /* WMA over last halfLen of buf */
        var wHalf = 0, wSumH = 0;
        for (var i = 0; i < halfLen; i++) {
          var idx = length - halfLen + i;
          var w = i + 1;
          wHalf += c.buf[idx] * w; wSumH += w;
        }
        wHalf = wSumH === 0 ? NA : wHalf / wSumH;
        /* WMA over full length */
        var wFull = 0, wSumF = 0;
        for (var j = 0; j < length; j++) {
          var wf = j + 1;
          wFull += c.buf[j] * wf; wSumF += wf;
        }
        wFull = wSumF === 0 ? NA : wFull / wSumF;
        if (isNa(wHalf) || isNa(wFull)) return NA;
        var raw = 2 * wHalf - wFull;
        c.rawBuf.push(raw);
        if (c.rawBuf.length > sqrtLen) c.rawBuf.shift();
        if (c.rawBuf.length < sqrtLen) return NA;
        var sum = 0, wSum = 0;
        for (var k = 0; k < sqrtLen; k++) {
          var ww = k + 1;
          sum += c.rawBuf[k] * ww; wSum += ww;
        }
        return wSum === 0 ? NA : sum / wSum;
      },

      dema: function(source, length, id) {
        var e1 = this.ema(source, length, id + '_e1');
        if (isNa(e1)) return NA;
        var e2 = this.ema(e1, length, id + '_e2');
        if (isNa(e2)) return NA;
        return 2 * e1 - e2;
      },

      tema: function(source, length, id) {
        var e1 = this.ema(source, length, id + '_e1');
        if (isNa(e1)) return NA;
        var e2 = this.ema(e1, length, id + '_e2');
        if (isNa(e2)) return NA;
        var e3 = this.ema(e2, length, id + '_e3');
        if (isNa(e3)) return NA;
        return 3 * e1 - 3 * e2 + e3;
      },

      alma: function(source, length, offset, sigma, id) {
        var c = getCache(id, function() { return { buf: [] }; });
        if (isNa(source)) return NA;
        c.buf.push(source);
        if (c.buf.length > length) c.buf.shift();
        if (c.buf.length < length) return NA;
        var m = offset * (length - 1);
        var s = length / sigma;
        var sum = 0, norm = 0;
        for (var i = 0; i < length; i++) {
          var w = Math.exp(-((i - m) * (i - m)) / (2 * s * s));
          sum += c.buf[i] * w; norm += w;
        }
        return norm === 0 ? NA : sum / norm;
      },

      swma: function(source, id) {
        var c = getCache(id, function() { return { buf: [] }; });
        if (isNa(source)) return NA;
        c.buf.push(source);
        if (c.buf.length > 4) c.buf.shift();
        if (c.buf.length < 4) return NA;
        /* Pine: close*1/6 + close[1]*2/6 + close[2]*2/6 + close[3]*1/6 — buf[3]=newest */
        return c.buf[3] * (1/6) + c.buf[2] * (2/6) + c.buf[1] * (2/6) + c.buf[0] * (1/6);
      },

      linreg: function(source, length, offset, id) {
        var c = getCache(id, function() { return { buf: [] }; });
        if (isNa(source)) return NA;
        c.buf.push(source);
        if (c.buf.length > length) c.buf.shift();
        if (c.buf.length < length) return NA;
        var sx = 0, sy = 0, sxy = 0, sx2 = 0;
        for (var i = 0; i < length; i++) {
          sx += i; sy += c.buf[i];
          sxy += i * c.buf[i]; sx2 += i * i;
        }
        var n = length;
        var denom = n * sx2 - sx * sx;
        if (denom === 0) return NA;
        var slope = (n * sxy - sx * sy) / denom;
        var intercept = (sy - slope * sx) / n;
        return slope * (length - 1 - (offset || 0)) + intercept;
      },

      /* ════════ P5: Oscillators ════════ */
      cci: function(source, length, id) {
        var c = getCache(id, function() { return { buf: [] }; });
        if (isNa(source)) return NA;
        c.buf.push(source);
        if (c.buf.length > length) c.buf.shift();
        if (c.buf.length < length) return NA;
        var mean = 0;
        for (var i = 0; i < length; i++) mean += c.buf[i];
        mean /= length;
        var mad = 0;
        for (var j = 0; j < length; j++) mad += Math.abs(c.buf[j] - mean);
        mad /= length;
        if (mad === 0) return 0;
        return (source - mean) / (0.015 * mad);
      },

      mfi: function(high, low, close, volume, length, id) {
        var c = getCache(id, function() { return { prevTp: NA, posBuf: [], negBuf: [] }; });
        if (isNa(high) || isNa(low) || isNa(close) || isNa(volume)) return NA;
        var tp = (high + low + close) / 3;
        if (isNa(c.prevTp)) { c.prevTp = tp; return NA; }
        var mf = tp * volume;
        var pos = tp > c.prevTp ? mf : 0;
        var neg = tp < c.prevTp ? mf : 0;
        c.prevTp = tp;
        c.posBuf.push(pos); c.negBuf.push(neg);
        if (c.posBuf.length > length) { c.posBuf.shift(); c.negBuf.shift(); }
        if (c.posBuf.length < length) return NA;
        var ps = 0, ns = 0;
        for (var i = 0; i < length; i++) { ps += c.posBuf[i]; ns += c.negBuf[i]; }
        if (ns === 0) return 100;
        var mfr = ps / ns;
        return 100 - (100 / (1 + mfr));
      },

      wpr: function(high, low, close, length, id) {
        var c = getCache(id, function() { return { hBuf: [], lBuf: [] }; });
        if (isNa(high) || isNa(low) || isNa(close)) return NA;
        c.hBuf.push(high); c.lBuf.push(low);
        if (c.hBuf.length > length) { c.hBuf.shift(); c.lBuf.shift(); }
        if (c.hBuf.length < length) return NA;
        var hh = -Infinity, ll = Infinity;
        for (var i = 0; i < length; i++) {
          if (c.hBuf[i] > hh) hh = c.hBuf[i];
          if (c.lBuf[i] < ll) ll = c.lBuf[i];
        }
        if (hh === ll) return -50;
        return -100 * (hh - close) / (hh - ll);
      },

      mom: function(source, length, id) {
        var c = getCache(id, function() { return { buf: [] }; });
        if (isNa(source)) return NA;
        c.buf.push(source);
        if (c.buf.length > length + 1) c.buf.shift();
        if (c.buf.length < length + 1) return NA;
        return source - c.buf[0];
      },

      roc: function(source, length, id) {
        var c = getCache(id, function() { return { buf: [] }; });
        if (isNa(source)) return NA;
        c.buf.push(source);
        if (c.buf.length > length + 1) c.buf.shift();
        if (c.buf.length < length + 1) return NA;
        var old = c.buf[0];
        if (old === 0) return NA;
        return 100 * (source - old) / old;
      },

      tsi: function(source, shortLen, longLen, id) {
        var c = getCache(id, function() { return { prev: NA }; });
        if (isNa(source)) return NA;
        var m = isNa(c.prev) ? 0 : source - c.prev;
        c.prev = source;
        var m1 = this.ema(m, longLen, id + '_m1');
        if (isNa(m1)) return NA;
        var m2 = this.ema(m1, shortLen, id + '_m2');
        if (isNa(m2)) return NA;
        var am = Math.abs(m);
        var a1 = this.ema(am, longLen, id + '_a1');
        if (isNa(a1)) return NA;
        var a2 = this.ema(a1, shortLen, id + '_a2');
        if (isNa(a2) || a2 === 0) return NA;
        return 100 * m2 / a2;
      },

      trix: function(source, length, id) {
        var c = getCache(id, function() { return { prevE3: NA }; });
        var e1 = this.ema(source, length, id + '_t1');
        if (isNa(e1)) return NA;
        var e2 = this.ema(e1, length, id + '_t2');
        if (isNa(e2)) return NA;
        var e3 = this.ema(e2, length, id + '_t3');
        if (isNa(e3)) return NA;
        if (isNa(c.prevE3) || c.prevE3 === 0) { c.prevE3 = e3; return NA; }
        var val = 100 * (e3 - c.prevE3) / c.prevE3;
        c.prevE3 = e3;
        return val;
      },

      cog: function(source, length, id) {
        var c = getCache(id, function() { return { buf: [] }; });
        if (isNa(source)) return NA;
        c.buf.push(source);
        if (c.buf.length > length) c.buf.shift();
        if (c.buf.length < length) return NA;
        var num = 0, den = 0;
        /* Pine: newest is source[0], weight = 1; oldest is source[length-1], weight = length */
        for (var i = 0; i < length; i++) {
          var val = c.buf[length - 1 - i];
          num += val * (i + 1); den += val;
        }
        if (den === 0) return NA;
        return -num / den;
      },

      /* ════════ P5: Volatility ════════ */
      stdev: function(source, length, biased, id) {
        var c = getCache(id, function() { return { buf: [] }; });
        if (isNa(source)) return NA;
        c.buf.push(source);
        if (c.buf.length > length) c.buf.shift();
        if (c.buf.length < length) return NA;
        var mean = 0;
        for (var i = 0; i < length; i++) mean += c.buf[i];
        mean /= length;
        var sq = 0;
        for (var j = 0; j < length; j++) { var d = c.buf[j] - mean; sq += d * d; }
        var divisor = biased === false ? (length - 1) : length;
        if (divisor <= 0) return NA;
        return Math.sqrt(sq / divisor);
      },

      variance: function(source, length, biased, id) {
        var c = getCache(id, function() { return { buf: [] }; });
        if (isNa(source)) return NA;
        c.buf.push(source);
        if (c.buf.length > length) c.buf.shift();
        if (c.buf.length < length) return NA;
        var mean = 0;
        for (var i = 0; i < length; i++) mean += c.buf[i];
        mean /= length;
        var sq = 0;
        for (var j = 0; j < length; j++) { var d = c.buf[j] - mean; sq += d * d; }
        var divisor = biased === false ? (length - 1) : length;
        if (divisor <= 0) return NA;
        return sq / divisor;
      },

      dev: function(source, length, id) {
        var c = getCache(id, function() { return { buf: [] }; });
        if (isNa(source)) return NA;
        c.buf.push(source);
        if (c.buf.length > length) c.buf.shift();
        if (c.buf.length < length) return NA;
        var mean = 0;
        for (var i = 0; i < length; i++) mean += c.buf[i];
        mean /= length;
        var ad = 0;
        for (var j = 0; j < length; j++) ad += Math.abs(c.buf[j] - mean);
        return ad / length;
      },

      bb: function(source, length, mult, id) {
        var mid = this.sma(source, length, id + '_bmid');
        if (isNa(mid)) return [NA, NA, NA];
        var d = this.stdev(source, length, true, id + '_bdev');
        if (isNa(d)) return [mid, NA, NA];
        return [mid, mid + mult * d, mid - mult * d];
      },

      bbw: function(source, length, mult, id) {
        var r = this.bb(source, length, mult, id + '_bbw');
        if (isNa(r[0]) || isNa(r[1]) || isNa(r[2]) || r[0] === 0) return NA;
        return (r[1] - r[2]) / r[0];
      },

      kc: function(source, high, low, close, prevClose, length, mult, useTR, id) {
        var mid = this.ema(source, length, id + '_kmid');
        if (isNa(mid)) return [NA, NA, NA];
        var rng;
        if (useTR === false) {
          rng = isNa(high) || isNa(low) ? NA : high - low;
        } else {
          if (isNa(prevClose)) rng = isNa(high) || isNa(low) ? NA : high - low;
          else rng = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
        }
        var avgRng = this.sma(rng, length, id + '_krng');
        if (isNa(avgRng)) return [mid, NA, NA];
        return [mid, mid + mult * avgRng, mid - mult * avgRng];
      },

      kcw: function(source, high, low, close, prevClose, length, mult, useTR, id) {
        var r = this.kc(source, high, low, close, prevClose, length, mult, useTR, id + '_kcw');
        if (isNa(r[0]) || isNa(r[1]) || isNa(r[2]) || r[0] === 0) return NA;
        return (r[1] - r[2]) / r[0];
      },

      /* ════════ P5: Structure ════════ */
      pivothigh: function(source, leftbars, rightbars, id) {
        var c = getCache(id, function() { return { buf: [] }; });
        c.buf.push(source);
        var total = leftbars + rightbars + 1;
        if (c.buf.length > total) c.buf.shift();
        if (c.buf.length < total) return NA;
        var cand = c.buf[leftbars];
        if (isNa(cand)) return NA;
        for (var i = 0; i < total; i++) {
          if (i === leftbars) continue;
          if (isNa(c.buf[i]) || c.buf[i] >= cand) return NA;
        }
        return cand;
      },

      pivotlow: function(source, leftbars, rightbars, id) {
        var c = getCache(id, function() { return { buf: [] }; });
        c.buf.push(source);
        var total = leftbars + rightbars + 1;
        if (c.buf.length > total) c.buf.shift();
        if (c.buf.length < total) return NA;
        var cand = c.buf[leftbars];
        if (isNa(cand)) return NA;
        for (var i = 0; i < total; i++) {
          if (i === leftbars) continue;
          if (isNa(c.buf[i]) || c.buf[i] <= cand) return NA;
        }
        return cand;
      },

      supertrend: function(high, low, close, prevClose, factor, atrPeriod, id) {
        /* Pine convention: direction = -1 for uptrend, +1 for downtrend */
        var c = getCache(id, function() { return { prevUp: NA, prevDn: NA, prevTrend: -1, prevClose: NA }; });
        var atr = this.atr(high, low, close, prevClose, atrPeriod, id + '_stAtr');
        if (isNa(atr)) { c.prevClose = close; return [NA, NA]; }
        var src = (high + low) / 2;
        var up = src - factor * atr;  /* lower band (shown during uptrend) */
        var dn = src + factor * atr;  /* upper band (shown during downtrend) */
        var upF = !isNa(c.prevUp) && !isNa(c.prevClose) && c.prevClose > c.prevUp ? Math.max(up, c.prevUp) : up;
        var dnF = !isNa(c.prevDn) && !isNa(c.prevClose) && c.prevClose < c.prevDn ? Math.min(dn, c.prevDn) : dn;
        var trend;
        if (isNa(c.prevUp) || isNa(c.prevDn)) {
          trend = -1;
        } else if (c.prevTrend === 1 && close > c.prevDn) {
          trend = -1;  /* was downtrend; close broke above upper band → flip to uptrend */
        } else if (c.prevTrend === -1 && close < c.prevUp) {
          trend = 1;   /* was uptrend; close broke below lower band → flip to downtrend */
        } else {
          trend = c.prevTrend;
        }
        var value = trend === -1 ? upF : dnF;
        c.prevUp = upF; c.prevDn = dnF; c.prevTrend = trend; c.prevClose = close;
        return [value, trend];
      },

      valuewhen: function(cond, source, occurrence, id) {
        var c = getCache(id, function() { return { hist: [] }; });
        if (cond) {
          c.hist.unshift(source);
          if (c.hist.length > 100) c.hist.length = 100;
        }
        var o = Math.max(0, Math.round(occurrence || 0));
        return c.hist[o] !== undefined ? c.hist[o] : NA;
      },

      barssince: function(cond, id) {
        var c = getCache(id, function() { return { count: -1 }; });
        if (cond) { c.count = 0; return 0; }
        if (c.count < 0) return NA;
        c.count++;
        return c.count;
      },

      /* ════════ P5: Change / aggregate ════════ */
      change: function(source, length, id) {
        var c = getCache(id, function() { return { buf: [] }; });
        c.buf.push(source);
        var L = Math.max(1, length || 1);
        if (c.buf.length > L + 1) c.buf.shift();
        if (c.buf.length < L + 1) return NA;
        if (isNa(source) || isNa(c.buf[0])) return NA;
        return source - c.buf[0];
      },

      cum: function(source, id) {
        var c = getCache(id, function() { return { sum: 0, hasAny: false }; });
        if (!isNa(source)) { c.sum += source; c.hasAny = true; }
        return c.hasAny ? c.sum : NA;
      },

      tr: function(high, low, prevClose, handleGaps) {
        if (isNa(high) || isNa(low)) return NA;
        if (isNa(prevClose)) return handleGaps === false ? NA : high - low;
        return Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
      },

      rising: function(source, length, id) {
        var c = getCache(id, function() { return { buf: [] }; });
        c.buf.push(source);
        if (c.buf.length > length + 1) c.buf.shift();
        if (c.buf.length < length + 1) return false;
        for (var i = 1; i <= length; i++) {
          if (isNa(c.buf[i]) || isNa(c.buf[i-1]) || c.buf[i] <= c.buf[i-1]) return false;
        }
        return true;
      },

      falling: function(source, length, id) {
        var c = getCache(id, function() { return { buf: [] }; });
        c.buf.push(source);
        if (c.buf.length > length + 1) c.buf.shift();
        if (c.buf.length < length + 1) return false;
        for (var i = 1; i <= length; i++) {
          if (isNa(c.buf[i]) || isNa(c.buf[i-1]) || c.buf[i] >= c.buf[i-1]) return false;
        }
        return true;
      },

      /* ════════ P5: Statistical ════════ */
      correlation: function(src1, src2, length, id) {
        var c = getCache(id, function() { return { b1: [], b2: [] }; });
        if (isNa(src1) || isNa(src2)) return NA;
        c.b1.push(src1); c.b2.push(src2);
        if (c.b1.length > length) { c.b1.shift(); c.b2.shift(); }
        if (c.b1.length < length) return NA;
        var m1 = 0, m2 = 0;
        for (var i = 0; i < length; i++) { m1 += c.b1[i]; m2 += c.b2[i]; }
        m1 /= length; m2 /= length;
        var cov = 0, v1 = 0, v2 = 0;
        for (var j = 0; j < length; j++) {
          var d1 = c.b1[j] - m1, d2 = c.b2[j] - m2;
          cov += d1 * d2; v1 += d1 * d1; v2 += d2 * d2;
        }
        if (v1 === 0 || v2 === 0) return NA;
        return cov / Math.sqrt(v1 * v2);
      },

      percentrank: function(source, length, id) {
        var c = getCache(id, function() { return { buf: [] }; });
        if (isNa(source)) return NA;
        c.buf.push(source);
        if (c.buf.length > length + 1) c.buf.shift();
        if (c.buf.length < length + 1) return NA;
        var cnt = 0;
        for (var i = 0; i < length; i++) {
          if (!isNa(c.buf[i]) && c.buf[i] <= source) cnt++;
        }
        return 100 * cnt / length;
      },

      median: function(source, length, id) {
        var c = getCache(id, function() { return { buf: [] }; });
        if (isNa(source)) return NA;
        c.buf.push(source);
        if (c.buf.length > length) c.buf.shift();
        if (c.buf.length < length) return NA;
        var sorted = c.buf.slice().sort(function(a,b){return a-b;});
        var mid = Math.floor(length / 2);
        return length % 2 === 0 ? (sorted[mid-1] + sorted[mid]) / 2 : sorted[mid];
      },

      range: function(source, length, id) {
        var hi = this.highest(source, length, id + '_rhi');
        var lo = this.lowest(source, length, id + '_rlo');
        if (isNa(hi) || isNa(lo)) return NA;
        return hi - lo;
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
    var tables = [];      // {id, position, cols, rows, bgcolor, frame_color, frame_width, border_color, border_width, cells:{col,row -> {text, bgcolor, text_color, text_halign, text_valign, text_size, width, height, tooltip}}}
    var boxes = [];       // P2: {id, left, top, right, bottom, border_color, border_width, border_style, bgcolor, extend, text, text_color, text_size, text_halign, text_valign}

    var nextLineId = 1;
    var nextLabelId = 1;
    var nextTableId = 1;
    var nextBoxId = 1;
    var max_lines_count = 50;
    var max_labels_count = 50;
    var max_boxes_count = 50;

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
    var BOX_STYLES = { 'style_solid': 'solid', 'style_dashed': 'dashed', 'style_dotted': 'dotted' };
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
    var POSITIONS = {
      'top_left': 'top_left', 'top_center': 'top_center', 'top_right': 'top_right',
      'middle_left': 'middle_left', 'middle_center': 'middle_center', 'middle_right': 'middle_right',
      'bottom_left': 'bottom_left', 'bottom_center': 'bottom_center', 'bottom_right': 'bottom_right'
    };
    var TEXT_ALIGN = {
      'align_left': 'left', 'align_center': 'center', 'align_right': 'right',
      'align_top': 'top', 'align_bottom': 'bottom'
    };
    /* Strategy state */
    var isStrategy = false;
    var stratCapital = 10000;
    var stratCommission = 0;
    var stratDefaultQty = 1;
    var positions = {};
    var closedTrades = [];
    var equityCurve = [];

    /* Parse indicator / strategy params */
    var overlay = true; // default: overlay on main price chart
    if (ast.type === 'Program') {
      for (var i = 0; i < ast.body.length; i++) {
        if (ast.body[i].type === 'Strategy') {
          isStrategy = true;
          var stratArgs = ast.body[i].args;
          for (var sj = 0; sj < stratArgs.length; sj++) {
            var sa = stratArgs[sj];
            if (sa.type === 'NamedArg') {
              if (sa.name === 'initial_capital' && sa.value && sa.value.type === 'NumLiteral') stratCapital = sa.value.value;
              if (sa.name === 'commission_value' && sa.value && sa.value.type === 'NumLiteral') stratCommission = sa.value.value;
              if (sa.name === 'default_qty_value' && sa.value && sa.value.type === 'NumLiteral') stratDefaultQty = sa.value.value;
            }
          }
        }
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
             if (indArgs[j].type === 'NamedArg' && indArgs[j].name === 'max_boxes_count') {
               if (indArgs[j].value && indArgs[j].value.type === 'NumLiteral') {
                 max_boxes_count = indArgs[j].value.value;
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
    var userFunctions = {};
    var typeRegistry = {};   // P7: name -> { params, body }
    var fnCallDepth = 0;      // P7: prevent runaway recursion

    /* History buffers for series variables */
    var seriesHistory = {};   // varName -> [val_at_bar0, val_at_bar1, ...]

    /* Candle data for current bar */
    var barIndex = 0;
    var curCandle = null;
    var prevCandle = null;

    /* P6: Detect timeframe from candle spacing (ms between closes) */
    var _tfMs = 0;
    if (candles.length >= 2 && candles[1].t && candles[0].t) {
      _tfMs = candles[1].t - candles[0].t;
      /* Resample against a few pairs to reduce gap-based errors */
      for (var _ti = 2; _ti < Math.min(5, candles.length); _ti++) {
        var _d = candles[_ti].t - candles[_ti-1].t;
        if (_d > 0 && _d < _tfMs) _tfMs = _d;
      }
    }
    /* Pine timeframe.period string: "1"/"5"/"60"/"240"/"D"/"W"/"M" */
    var _tfPeriod = '1', _tfMultiplier = 1;
    var _tfIsIntraday = false, _tfIsDaily = false, _tfIsWeekly = false, _tfIsMonthly = false;
    var _tfIsSeconds = false, _tfIsMinutes = false, _tfIsHours = false;
    if (_tfMs > 0) {
      if (_tfMs < 60000) {
        _tfPeriod = String(Math.round(_tfMs / 1000)) + 'S';
        _tfMultiplier = Math.round(_tfMs / 1000);
        _tfIsSeconds = true; _tfIsIntraday = true;
      } else if (_tfMs < 3600000) {
        var _mins = Math.round(_tfMs / 60000);
        _tfPeriod = String(_mins);
        _tfMultiplier = _mins;
        _tfIsMinutes = true; _tfIsIntraday = true;
      } else if (_tfMs < 86400000) {
        var _hrs = Math.round(_tfMs / 3600000);
        _tfPeriod = String(_hrs * 60);  /* Pine: hours are expressed in minutes */
        _tfMultiplier = _hrs;
        _tfIsHours = true; _tfIsIntraday = true;
      } else if (_tfMs < 7 * 86400000) {
        _tfPeriod = 'D';
        _tfMultiplier = Math.max(1, Math.round(_tfMs / 86400000));
        _tfIsDaily = true;
      } else if (_tfMs < 28 * 86400000) {
        _tfPeriod = 'W';
        _tfMultiplier = Math.max(1, Math.round(_tfMs / (7 * 86400000)));
        _tfIsWeekly = true;
      } else {
        _tfPeriod = 'M';
        _tfMultiplier = Math.max(1, Math.round(_tfMs / (30 * 86400000)));
        _tfIsMonthly = true;
      }
    }

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
      /* Strategy equity snapshot */
      if (isStrategy) {
        var eq = stratCapital;
        for (var _ct = 0; _ct < closedTrades.length; _ct++) eq += closedTrades[_ct].profit;
        for (var _pk in positions) {
          var _p = positions[_pk];
          if (_p.direction === 'long') eq += (+curCandle.c - _p.entryClose) * _p.qty;
          else eq += (_p.entryClose - +curCandle.c) * _p.qty;
        }
        equityCurve.push(eq);
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
      tables: tables,
      boxes: boxes,
      overlay: overlay,
      errors: [],
      strategyResult: isStrategy ? (function() {
        var netProfit = 0, grossProfit = 0, grossLoss = 0, winCount = 0;
        for (var _t = 0; _t < closedTrades.length; _t++) {
          var _tr = closedTrades[_t];
          netProfit += _tr.profit;
          if (_tr.profit > 0) { grossProfit += _tr.profit; winCount++; }
          else grossLoss += _tr.profit;
        }
        var peak = stratCapital, mdd = 0;
        for (var _ei = 0; _ei < equityCurve.length; _ei++) {
          if (equityCurve[_ei] > peak) peak = equityCurve[_ei];
          var _dd = peak > 0 ? (peak - equityCurve[_ei]) / peak : 0;
          if (_dd > mdd) mdd = _dd;
        }
        var total = closedTrades.length;
        return {
          trades: closedTrades,
          equityCurve: new Float64Array(equityCurve),
          summary: {
            netProfit: netProfit,
            grossProfit: grossProfit,
            grossLoss: grossLoss,
            maxDrawdown: mdd,
            winRate: total > 0 ? winCount / total : 0,
            totalTrades: total,
            profitFactor: grossLoss !== 0 ? Math.abs(grossProfit / grossLoss) : (grossProfit > 0 ? Infinity : 0),
            initialCapital: stratCapital,
            finalEquity: stratCapital + netProfit
          }
        };
      })() : null
    };

    /* ── Strategy order execution ── */
    function execStrategyCall(callName, args) {
      function getArg(idx) {
        var a = args[idx];
        if (!a) return NA;
        return execNode(a.type === 'NamedArg' ? a.value : a);
      }
      function getNamedArg(name, def) {
        for (var i = 0; i < args.length; i++) {
          if (args[i].type === 'NamedArg' && args[i].name === name) return execNode(args[i].value);
        }
        return def;
      }
      var ec = +curCandle.c;
      switch (callName) {
        case 'strategy.entry': {
          var id  = getArg(0);
          var dir = getNamedArg('direction', getArg(1)) || 'long';
          var qty = getNamedArg('qty', stratDefaultQty);
          if (!id) return NA;
          /* Auto-reversal: close any existing position in opposite direction */
          for (var _ek in positions) {
            if (positions[_ek].direction !== dir) {
              var _ep = positions[_ek];
              var _epnl = (_ep.direction === 'long' ? ec - _ep.entryPrice : _ep.entryPrice - ec) * _ep.qty;
              var _ecom = stratCommission * ec * _ep.qty / 100;
              _epnl -= (_ep.commission + _ecom);
              closedTrades.push({ id: _ek, direction: _ep.direction, entryBar: _ep.entryBar, entryPrice: _ep.entryPrice, exitBar: barIndex, exitPrice: ec, profit: _epnl, qty: _ep.qty });
              delete positions[_ek];
            }
          }
          if (positions[id]) return NA; // already in same-dir position with this id
          var com = stratCommission * ec * qty / 100;
          positions[id] = { direction: dir, qty: qty, entryPrice: ec, entryClose: ec, entryBar: barIndex, commission: com };
          return NA;
        }
        case 'strategy.close': {
          var cid = getArg(0) || getNamedArg('id', null);
          if (!cid || !positions[cid]) return NA;
          var pos = positions[cid];
          var xc  = ec;
          var pnl = (pos.direction === 'long' ? xc - pos.entryPrice : pos.entryPrice - xc) * pos.qty;
          var xcom = stratCommission * xc * pos.qty / 100;
          pnl -= (pos.commission + xcom);
          closedTrades.push({ id: cid, direction: pos.direction, entryBar: pos.entryBar, entryPrice: pos.entryPrice, exitBar: barIndex, exitPrice: xc, profit: pnl, qty: pos.qty });
          delete positions[cid];
          return NA;
        }
        case 'strategy.exit': {
          var eid    = getArg(0) || getNamedArg('id', null);
          var fromId = getNamedArg('from_entry', eid);
          var tp     = getNamedArg('profit', NA);
          var sl     = getNamedArg('loss',   NA);
          if (!fromId || !positions[fromId]) return NA;
          var epos = positions[fromId];
          var hi = +curCandle.h, lo = +curCandle.l, op = +curCandle.o, cl = +curCandle.c;
          var tpPrice = NA, slPrice = NA;
          if (!isNa(tp)) tpPrice = epos.direction === 'long' ? epos.entryPrice + +tp : epos.entryPrice - +tp;
          if (!isNa(sl)) slPrice = epos.direction === 'long' ? epos.entryPrice - +sl : epos.entryPrice + +sl;
          /* Intrabar hit detection using high/low */
          var tpHit = !isNa(tpPrice) && (epos.direction === 'long' ? hi >= tpPrice : lo <= tpPrice);
          var slHit = !isNa(slPrice) && (epos.direction === 'long' ? lo <= slPrice : hi >= slPrice);
          var triggered = false, exitPrice = cl;
          if (tpHit && slHit) {
            /* OHLC path heuristic: green candle assumed Open→Low→High→Close, red assumed Open→High→Low→Close */
            var greenPath = cl >= op;
            if (epos.direction === 'long') {
              /* long: green path hits SL (low) first, red path hits TP (high) first */
              if (greenPath) { exitPrice = slPrice; } else { exitPrice = tpPrice; }
            } else {
              /* short: green path hits TP (low) first, red path hits SL (high) first */
              if (greenPath) { exitPrice = tpPrice; } else { exitPrice = slPrice; }
            }
            triggered = true;
          } else if (tpHit) {
            exitPrice = tpPrice; triggered = true;
          } else if (slHit) {
            exitPrice = slPrice; triggered = true;
          }
          if (!triggered) return NA;
          var epnl = (epos.direction === 'long' ? exitPrice - epos.entryPrice : epos.entryPrice - exitPrice) * epos.qty;
          var ecom = stratCommission * exitPrice * epos.qty / 100;
          epnl -= (epos.commission + ecom);
          closedTrades.push({ id: fromId, direction: epos.direction, entryBar: epos.entryBar, entryPrice: epos.entryPrice, exitBar: barIndex, exitPrice: exitPrice, profit: epnl, qty: epos.qty });
          delete positions[fromId];
          return NA;
        }
        case 'strategy.cancel': {
          var cancelId = getArg(0) || getNamedArg('id', null);
          if (cancelId && positions[cancelId]) delete positions[cancelId];
          return NA;
        }
        default: return NA;
      }
    }

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
            var actualVal = (overrides[title] !== undefined && overrides[title] !== '') ? overrides[title] : dv;
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
        case 'Indicator':
        case 'Strategy':     return NA; // declaration only
        case 'NumLiteral':   return node.value;
        case 'StrLiteral':   return node.value;
        case 'BoolLiteral':  return node.value;
        case 'NaLiteral':    return NA;
        case 'Identifier':   return resolveVar(node.name);
        case 'VarDecl':      return execVarDecl(node);
        case 'Reassign':     return execReassign(node);
        case 'TupleAssign':  return execTupleAssign(node);
        case 'TupleLiteral': {
          var _arr = [];
          for (var _li = 0; _li < node.elems.length; _li++) {
            var _v = execNode(node.elems[_li]);
            if (_v && _v.__error__) return _v;
            _arr.push(_v);
          }
          return _arr;
        }
        case 'BinaryExpr':   return execBinary(node);
        case 'UnaryExpr':    return execUnary(node);
        case 'Ternary':      return execTernary(node);
        case 'If':           return execIf(node);
        case 'For':          return execFor(node);
        case 'ForIn':        return execForIn(node);
        case 'While':        return execWhile(node);
        case 'Switch':       return execSwitch(node);
        case 'Break':        return { __break__: true };
        case 'Continue':     return { __continue__: true };
        case 'Block':        return execBlock(node);
        case 'MemberAccess': return execMember(node);
        case 'HistoryRef':   return execHistoryRef(node);
        case 'Call':         return execCall(node);
        case 'Plot':         return execPlot(node);
        case 'PlotShape':    return execPlotShape(node);
        case 'Bgcolor':      return execBgcolor(node);
        case 'Hline':        return execHline(node);
        case 'NamedArg':     return execNode(node.value);
        case 'FunctionDecl':
          /* P7: register user-defined function (declaration is a no-op at runtime) */
          userFunctions[node.name] = { params: node.params, body: node.body };
          return NA;
        case 'TypeDecl':
          typeRegistry[node.name] = { fields: node.fields };
          return NA;
        case 'MemberAssign':
          return execMemberAssign(node);
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
        /* Bubble break/continue up to the nearest loop */
        if (last && (last.__break__ || last.__continue__)) return last;
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

      /* P6: time built-ins */
      if (name === 'time')           return curCandle.t || 0;
      if (name === 'time_close')     return (curCandle.t || 0) + _tfMs;
      if (name === 'time_tradingday') {
        var _d = new Date(curCandle.t || 0);
        _d.setUTCHours(0, 0, 0, 0);
        return _d.getTime();
      }

      /* P6: date/time decomposition as bare identifiers (Pine also supports year(), month(), ...) */
      if (name === 'year' || name === 'month' || name === 'dayofmonth' ||
          name === 'dayofweek' || name === 'hour' || name === 'minute' ||
          name === 'second' || name === 'weekofyear') {
        var _dt = new Date(curCandle.t || 0);
        if (name === 'year')       return _dt.getUTCFullYear();
        if (name === 'month')      return _dt.getUTCMonth() + 1;
        if (name === 'dayofmonth') return _dt.getUTCDate();
        if (name === 'dayofweek')  return _dt.getUTCDay() + 1;
        if (name === 'hour')       return _dt.getUTCHours();
        if (name === 'minute')     return _dt.getUTCMinutes();
        if (name === 'second')     return _dt.getUTCSeconds();
        if (name === 'weekofyear') {
          var _jan1 = Date.UTC(_dt.getUTCFullYear(), 0, 1);
          var _days = Math.floor((_dt.getTime() - _jan1) / 86400000);
          return Math.ceil((_days + new Date(_jan1).getUTCDay() + 1) / 7);
        }
      }

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
          name === 'hline' || name === 'barstate' || name === 'timeframe' ||
          name === 'line' || name === 'extend' || name === 'label' ||
          name === 'position' || name === 'table' || name === 'text' ||
          name === 'box' || name === 'syminfo' || name === 'barmerge' ||
          name === 'plot' || name === 'order' || name === 'strategy') return name;

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

      /* Pine `for i = N to 0` (descending) auto-flips step to -1 if not given */
      if (step > 0 && start > end) {
        if (!node.step) step = -1;
        else return NA;
      } else if (step < 0 && start < end) {
        return NA;
      }

      var last = NA;
      for (var i = start; step > 0 ? i <= end : i >= end; i += step) {
        barVars[node.varName] = i;
        last = execNode(node.body);
        if (last && last.__error__) return last;
        if (last && last.__break__) { last = NA; break; }
        if (last && last.__continue__) { last = NA; continue; }
      }
      return last;
    }

    function execForIn(node) {
      var iter = execNode(node.iter);
      if (iter && iter.__error__) return iter;
      if (!iter || typeof iter.length !== 'number') return NA;
      var last = NA;
      for (var i = 0; i < iter.length; i++) {
        barVars[node.varName] = iter[i];
        last = execNode(node.body);
        if (last && last.__error__) return last;
        if (last && last.__break__) { last = NA; break; }
        if (last && last.__continue__) { last = NA; continue; }
      }
      return last;
    }

    function execWhile(node) {
      var last = NA;
      var safety = 0;
      while (true) {
        if (++safety > 100000) {
          return { __error__: { line: node.line, col: node.col,
            message: 'while-loop iteration limit exceeded (100,000) — likely infinite loop' } };
        }
        var cond = execNode(node.condition);
        if (cond && cond.__error__) return cond;
        if (!cond) break;
        last = execNode(node.body);
        if (last && last.__error__) return last;
        if (last && last.__break__) { last = NA; break; }
        if (last && last.__continue__) { last = NA; continue; }
      }
      return last;
    }

    function execSwitch(node) {
      if (node.subject) {
        /* expression-form: match each case value against subject */
        var subj = execNode(node.subject);
        if (subj && subj.__error__) return subj;
        for (var i = 0; i < node.cases.length; i++) {
          var cv = execNode(node.cases[i].value);
          if (cv && cv.__error__) return cv;
          if (cv === subj) return execNode(node.cases[i].body);
        }
      } else {
        /* predicate-form: each case is a boolean expression */
        for (var j = 0; j < node.cases.length; j++) {
          var cb = execNode(node.cases[j].value);
          if (cb && cb.__error__) return cb;
          if (cb) return execNode(node.cases[j].body);
        }
      }
      if (node.defaultBody) return execNode(node.defaultBody);
      return NA;
    }

    function execMemberAssign(node) {
      var obj = execNode(node.object);
      if (obj && obj.__error__) return obj;
      if (!obj || typeof obj !== 'object' || obj.__fractal_na__) return NA;
      var val = execNode(node.value);
      if (val && val.__error__) return val;
      obj[node.member] = val;
      return val;
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
      if (obj === 'box') return BOX_STYLES[node.member] || 'box.' + node.member;
      if (obj === 'str') return 'str.' + node.member;
      if (obj === 'extend') return EXTEND_MODES[node.member] || 'extend.' + node.member;
      if (obj === 'hline') return 'hline.' + node.member;

      /* syminfo.* — stub values (real values would require chart context) */
      if (obj === 'syminfo') {
        switch (node.member) {
          case 'tickerid': return 'UNKNOWN:UNKNOWN';
          case 'ticker':   return 'UNKNOWN';
          case 'prefix':   return '';
          case 'mintick':  return 0.01;
          case 'pointvalue': return 1;
          case 'currency': return 'USD';
          case 'basecurrency': return 'USD';
          case 'description': return '';
          case 'type':     return 'crypto';
          case 'session':  return 'regular';
          case 'timezone': return 'UTC';
          default: return NA;
        }
      }

      /* barmerge.* — sentinel values for request.security() flags */
      if (obj === 'barmerge') {
        switch (node.member) {
          case 'gaps_on':       return 'gaps_on';
          case 'gaps_off':      return 'gaps_off';
          case 'lookahead_on':  return 'lookahead_on';
          case 'lookahead_off': return 'lookahead_off';
          default: return NA;
        }
      }

      /* plot.* style enum — used as `style=plot.style_circles` etc */
      if (obj === 'plot') {
        return 'plot.' + node.member;
      }

      /* order.* — strategy direction enum */
      if (obj === 'order') {
        switch (node.member) {
          case 'ascending':  return 'ascending';
          case 'descending': return 'descending';
          default: return 'order.' + node.member;
        }
      }

      /* strategy.* property reads */
      if (obj === 'strategy') {
        switch (node.member) {
          case 'long':  return 'long';
          case 'short': return 'short';
          case 'position_size': {
            var _sz = 0;
            for (var _k in positions) { if (positions[_k].direction === 'long') _sz += positions[_k].qty; else _sz -= positions[_k].qty; }
            return _sz;
          }
          case 'opentrades':   return Object.keys(positions).length;
          case 'closedtrades': return closedTrades.length;
          case 'equity':       return equityCurve.length > 0 ? equityCurve[equityCurve.length - 1] : stratCapital;
          case 'netprofit': {
            var _np = 0;
            for (var _nt = 0; _nt < closedTrades.length; _nt++) _np += closedTrades[_nt].profit;
            return _np;
          }
          case 'initial_capital': return stratCapital;
          default: return NA;
        }
      }
      if (obj === 'position') return POSITIONS[node.member] || node.member;
      if (obj === 'text') return TEXT_ALIGN[node.member] || node.member;
      if (obj === 'table') return 'table.' + node.member;

      /* UDT field access */
      if (obj && typeof obj === 'object' && !obj.__fractal_na__ && obj.__type__) {
        if (obj.hasOwnProperty(node.member)) return obj[node.member];
        var tdef = typeRegistry[obj.__type__];
        if (tdef) {
          for (var fi = 0; fi < tdef.fields.length; fi++) {
            if (tdef.fields[fi].name === node.member) {
              if (tdef.fields[fi].def) return execNode(tdef.fields[fi].def);
              return NA;
            }
          }
        }
        return NA;
      }

      /* P6: barstate.* property lookups */
      if (obj === 'barstate') {
        switch (node.member) {
          case 'isfirst': return barIndex === 0;
          case 'islast': return barIndex === N - 1;
          case 'isconfirmed': return barIndex < N - 1;
          case 'isnew': return true;
          case 'isrealtime': return false;
          case 'ishistory': return true;
          case 'islastconfirmedhistory': return barIndex === N - 2;
          default: return NA;
        }
      }

      /* P6: timeframe.* property lookups */
      if (obj === 'timeframe') {
        switch (node.member) {
          case 'period': return _tfPeriod;
          case 'multiplier': return _tfMultiplier;
          case 'isintraday': return _tfIsIntraday;
          case 'isdaily': return _tfIsDaily;
          case 'isweekly': return _tfIsWeekly;
          case 'ismonthly': return _tfIsMonthly;
          case 'isseconds': return _tfIsSeconds;
          case 'isminutes': return _tfIsMinutes;
          case 'ishours': return _tfIsHours;
          case 'isdwm': return _tfIsDaily || _tfIsWeekly || _tfIsMonthly;
          default: return NA;
        }
      }

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
      /* UDT constructor: TypeName.new(...) — only when type is registered */
      if (node.callee.type === 'MemberAccess' && node.callee.member === 'new') {
        var typeName = node.callee.object.name;
        var tdef = typeRegistry[typeName];
        if (tdef) {
          var rec = { __type__: typeName };
          for (var fi = 0; fi < tdef.fields.length; fi++) {
            var fld = tdef.fields[fi];
            rec[fld.name] = fld.def ? execNode(fld.def) : NA;
          }
          for (var ai = 0; ai < node.args.length; ai++) {
            var a = node.args[ai];
            if (a.type === 'NamedArg') {
              rec[a.name] = execNode(a.value);
            } else if (ai < tdef.fields.length) {
              rec[tdef.fields[ai].name] = execNode(a);
            }
          }
          return rec;
        }
        /* Not a registered UDT — fall through to color.new / other handlers */
      }

      var callName = getCallName(node.callee);

      /* P7: user-defined functions — checked before built-ins so users can shadow */
      if (userFunctions[callName]) {
        return execUserFunction(callName, node.args, node);
      }

      /* line.* functions */
      if (callName.indexOf('line.') === 0) {
        return execLineCall(callName, node.args, node);
      }

      /* label.* functions */
      if (callName.indexOf('label.') === 0) {
        return execLabelCall(callName, node.args, node);
      }

      /* table.* functions */
      if (callName.indexOf('table.') === 0) {
        return execTableCall(callName, node.args, node);
      }

      /* P2: box.* functions */
      if (callName.indexOf('box.') === 0) {
        return execBoxCall(callName, node.args, node);
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

      /* Type casts: int(x), float(x), bool(x), string(x) — Pine v5 explicit conversions */
      if (callName === 'int' || callName === 'float' || callName === 'bool' || callName === 'string') {
        var castVal = node.args[0] ? execNode(node.args[0].type === 'NamedArg' ? node.args[0].value : node.args[0]) : NA;
        if (isNa(castVal)) return NA;
        if (callName === 'int')    return Math.trunc(Number(castVal));
        if (callName === 'float')  return Number(castVal);
        if (callName === 'bool')   return !!castVal;
        if (callName === 'string') return String(castVal);
      }

      /* alertcondition() — no-op stub. Pine fires alerts via UI configuration; we just absorb args. */
      if (callName === 'alertcondition') return NA;

      /* alert() — same no-op stub */
      if (callName === 'alert') return NA;

      /* plotcandle() — no-op stub for now (renderer doesn't support custom candle painting). */
      if (callName === 'plotcandle') return NA;

      /* request.security() — stub: return the source expression evaluated on the current
         timeframe. Real MTF resolution is P8 (not yet done). This lets scripts that call
         request.security() RUN rather than crash, but the values reflect the current TF
         instead of the requested HTF. */
      if (callName === 'request.security' || callName === 'request.security_lower_tf') {
        if (node.args.length < 3) return NA;
        var srcArg = node.args[2];
        return execNode(srcArg.type === 'NamedArg' ? srcArg.value : srcArg);
      }
      /* request.dividends/earnings/financial — no-op, return NA */
      if (callName.indexOf('request.') === 0) return NA;

      if (callName.indexOf('strategy.') === 0) return execStrategyCall(callName, node.args);

      /* fixnan — persist last non-na */
      if (callName === 'fixnan') {
        var src = node.args[0] ? execNode(node.args[0].type === 'NamedArg' ? node.args[0].value : node.args[0]) : NA;
        if (!isNa(src)) { persistentVars['__fixnan__'] = src; return src; }
        return persistentVars['__fixnan__'] !== undefined ? persistentVars['__fixnan__'] : NA;
      }

      /* P6: Date/time decomposition functions — default arg = current bar's time */
      if (callName === 'year' || callName === 'month' || callName === 'dayofmonth' ||
          callName === 'dayofweek' || callName === 'hour' || callName === 'minute' ||
          callName === 'second' || callName === 'weekofyear') {
        var dtArg = node.args[0]
          ? execNode(node.args[0].type === 'NamedArg' ? node.args[0].value : node.args[0])
          : (curCandle.t || 0);
        if (isNa(dtArg)) return NA;
        var _dt = new Date(dtArg);
        switch (callName) {
          case 'year':       return _dt.getUTCFullYear();
          case 'month':      return _dt.getUTCMonth() + 1;          /* Pine: 1–12 */
          case 'dayofmonth': return _dt.getUTCDate();
          case 'dayofweek':  return _dt.getUTCDay() + 1;            /* Pine: 1=Sun..7=Sat */
          case 'hour':       return _dt.getUTCHours();
          case 'minute':     return _dt.getUTCMinutes();
          case 'second':     return _dt.getUTCSeconds();
          case 'weekofyear': {
            var _jan1 = Date.UTC(_dt.getUTCFullYear(), 0, 1);
            var _days = Math.floor((_dt.getTime() - _jan1) / 86400000);
            return Math.ceil((_days + new Date(_jan1).getUTCDay() + 1) / 7);
          }
        }
      }

      /* P6: timestamp(year, month, day, hour?, minute?, second?) → ms since epoch */
      if (callName === 'timestamp') {
        var tsArgs = [];
        for (var ti = 0; ti < node.args.length; ti++) {
          var ta2 = node.args[ti];
          tsArgs.push(execNode(ta2.type === 'NamedArg' ? ta2.value : ta2));
        }
        /* Handle optional timezone string as first arg */
        var tsIdx = 0;
        if (tsArgs.length > 0 && typeof tsArgs[0] === 'string') tsIdx = 1;
        var _y = tsArgs[tsIdx], _mo = tsArgs[tsIdx + 1], _d = tsArgs[tsIdx + 2];
        var _h = tsArgs[tsIdx + 3], _mi = tsArgs[tsIdx + 4], _s = tsArgs[tsIdx + 5];
        if (isNa(_y) || isNa(_mo) || isNa(_d)) return NA;
        return Date.UTC(_y, _mo - 1, _d, isNa(_h) ? 0 : _h, isNa(_mi) ? 0 : _mi, isNa(_s) ? 0 : _s);
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

    /* P7: user-defined function call.
       Pine semantics:
       - new local scope for params + locally-declared vars
       - returns the LAST expression's value from the body
       - `var` inside a fn persists per-call-site (not implemented yet — for now it persists per-fn)
       - no recursion (Pine disallows; we cap depth as a safety)
       - closure: identifiers not in local scope fall through to the outer scope (built-ins, globals) */
    function execUserFunction(name, callArgs, node) {
      if (fnCallDepth > 50) {
        return { __error__: { line: node.line, col: node.col,
          message: "Recursion limit exceeded calling '" + name + "' (Pine disallows recursion)" } };
      }
      var fn = userFunctions[name];

      /* Evaluate args in caller scope BEFORE swapping scope */
      var evaluatedArgs = [];
      for (var ai = 0; ai < callArgs.length; ai++) {
        var a = callArgs[ai];
        var v = execNode(a.type === 'NamedArg' ? a.value : a);
        if (v && v.__error__) return v;
        evaluatedArgs.push(v);
      }

      /* Save outer barVars; swap in fresh scope with params bound */
      var savedBarVars = barVars;
      var localScope = {};
      for (var pi = 0; pi < fn.params.length; pi++) {
        localScope[fn.params[pi]] = pi < evaluatedArgs.length ? evaluatedArgs[pi] : NA;
      }
      barVars = localScope;
      fnCallDepth++;

      var result;
      try {
        if (fn.body && fn.body.type === 'Block') {
          /* Multi-line body — return value of last statement */
          result = NA;
          for (var bi = 0; bi < fn.body.body.length; bi++) {
            result = execNode(fn.body.body[bi]);
            if (result && result.__error__) break;
          }
        } else {
          /* Single-line body — body is an expression node */
          result = execNode(fn.body);
        }
      } finally {
        barVars = savedBarVars;
        fnCallDepth--;
      }
      return result;
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
        /* Fallback to positional only if that slot is NOT a different named arg */
        if (defaultIdx !== undefined && defaultIdx < args.length && args[defaultIdx].type !== 'NamedArg') {
          return execNode(args[defaultIdx]);
        }
        return NA;
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
        case 'ta.cross': {
          var aC = evalArg(0);
          var bC = evalArg(1);
          return ta.crossover(aC, bC, id + '_o') || ta.crossunder(aC, bC, id + '_u');
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

        /* ════════ P5: Moving averages ════════ */
        case 'ta.hma': {
          var s = evalArg(0), l = evalArg(1);
          if (isNa(l)) return NA;
          return ta.hma(s, Math.round(l), id);
        }
        case 'ta.dema': {
          var s = evalArg(0), l = evalArg(1);
          if (isNa(l)) return NA;
          return ta.dema(s, Math.round(l), id);
        }
        case 'ta.tema': {
          var s = evalArg(0), l = evalArg(1);
          if (isNa(l)) return NA;
          return ta.tema(s, Math.round(l), id);
        }
        case 'ta.alma': {
          var s = evalArg(0), l = evalArg(1), o = evalArg(2), sg = evalArg(3);
          if (isNa(l) || isNa(o) || isNa(sg)) return NA;
          return ta.alma(s, Math.round(l), o, sg, id);
        }
        case 'ta.swma': {
          return ta.swma(evalArg(0), id);
        }
        case 'ta.linreg': {
          var s = evalArg(0), l = evalArg(1), o = evalArg(2);
          if (isNa(l)) return NA;
          return ta.linreg(s, Math.round(l), isNa(o) ? 0 : Math.round(o), id);
        }

        /* ════════ P5: Oscillators ════════ */
        case 'ta.cci': {
          var s = evalArg(0), l = evalArg(1);
          if (isNa(l)) return NA;
          return ta.cci(s, Math.round(l), id);
        }
        case 'ta.mfi': {
          var s = evalArg(0), l = evalArg(1);
          if (isNa(l)) return NA;
          /* Pine: ta.mfi(source, length) — source usually hlc3; uses curCandle.v for volume */
          return ta.mfi(+curCandle.h, +curCandle.l, +curCandle.c, +curCandle.v || 0, Math.round(l), id);
        }
        case 'ta.wpr': {
          var l = evalArg(0);
          if (isNa(l)) return NA;
          return ta.wpr(+curCandle.h, +curCandle.l, +curCandle.c, Math.round(l), id);
        }
        case 'ta.mom': {
          var s = evalArg(0), l = evalArg(1);
          if (isNa(l)) return NA;
          return ta.mom(s, Math.round(l), id);
        }
        case 'ta.roc': {
          var s = evalArg(0), l = evalArg(1);
          if (isNa(l)) return NA;
          return ta.roc(s, Math.round(l), id);
        }
        case 'ta.tsi': {
          var s = evalArg(0), sh = evalArg(1), lg = evalArg(2);
          if (isNa(sh) || isNa(lg)) return NA;
          return ta.tsi(s, Math.round(sh), Math.round(lg), id);
        }
        case 'ta.trix': {
          var s = evalArg(0), l = evalArg(1);
          if (isNa(l)) return NA;
          return ta.trix(s, Math.round(l), id);
        }
        case 'ta.cog': {
          var s = evalArg(0), l = evalArg(1);
          if (isNa(l)) return NA;
          return ta.cog(s, Math.round(l), id);
        }

        /* ════════ P5: Volatility ════════ */
        case 'ta.stdev': {
          var s = evalArg(0), l = evalArg(1), b = evalArg(2);
          if (isNa(l)) return NA;
          return ta.stdev(s, Math.round(l), isNa(b) ? true : !!b, id);
        }
        case 'ta.variance': {
          var s = evalArg(0), l = evalArg(1), b = evalArg(2);
          if (isNa(l)) return NA;
          return ta.variance(s, Math.round(l), isNa(b) ? true : !!b, id);
        }
        case 'ta.dev': {
          var s = evalArg(0), l = evalArg(1);
          if (isNa(l)) return NA;
          return ta.dev(s, Math.round(l), id);
        }
        case 'ta.bb': {
          var s = evalArg(0), l = evalArg(1), m = evalArg(2);
          if (isNa(l) || isNa(m)) return [NA, NA, NA];
          return ta.bb(s, Math.round(l), m, id);
        }
        case 'ta.bbw': {
          var s = evalArg(0), l = evalArg(1), m = evalArg(2);
          if (isNa(l) || isNa(m)) return NA;
          return ta.bbw(s, Math.round(l), m, id);
        }
        case 'ta.kc': {
          var s = evalArg(0), l = evalArg(1), m = evalArg(2), ut = evalArg(3);
          if (isNa(l) || isNa(m)) return [NA, NA, NA];
          var pc = prevCandle ? +prevCandle.c : NA;
          return ta.kc(s, +curCandle.h, +curCandle.l, +curCandle.c, pc, Math.round(l), m, isNa(ut) ? true : !!ut, id);
        }
        case 'ta.kcw': {
          var s = evalArg(0), l = evalArg(1), m = evalArg(2), ut = evalArg(3);
          if (isNa(l) || isNa(m)) return NA;
          var pc = prevCandle ? +prevCandle.c : NA;
          return ta.kcw(s, +curCandle.h, +curCandle.l, +curCandle.c, pc, Math.round(l), m, isNa(ut) ? true : !!ut, id);
        }

        /* ════════ P5: Structure ════════ */
        case 'ta.pivothigh': {
          /* Pine signatures: ta.pivothigh(left, right)  OR  ta.pivothigh(source, left, right) */
          var s, lb, rb;
          if (args.length === 2) {
            s = +curCandle.h; lb = evalArg(0); rb = evalArg(1);
          } else {
            s = evalArg(0); lb = evalArg(1); rb = evalArg(2);
          }
          if (isNa(lb) || isNa(rb)) return NA;
          return ta.pivothigh(s, Math.round(lb), Math.round(rb), id);
        }
        case 'ta.pivotlow': {
          var s, lb, rb;
          if (args.length === 2) {
            s = +curCandle.l; lb = evalArg(0); rb = evalArg(1);
          } else {
            s = evalArg(0); lb = evalArg(1); rb = evalArg(2);
          }
          if (isNa(lb) || isNa(rb)) return NA;
          return ta.pivotlow(s, Math.round(lb), Math.round(rb), id);
        }
        case 'ta.supertrend': {
          var f = evalArg(0), p = evalArg(1);
          if (isNa(f) || isNa(p)) return [NA, NA];
          var pc = prevCandle ? +prevCandle.c : NA;
          return ta.supertrend(+curCandle.h, +curCandle.l, +curCandle.c, pc, f, Math.round(p), id);
        }
        case 'ta.valuewhen': {
          var cnd = evalArg(0), s = evalArg(1), occ = evalArg(2);
          return ta.valuewhen(!!cnd, s, isNa(occ) ? 0 : Math.round(occ), id);
        }
        case 'ta.barssince': {
          var cnd = evalArg(0);
          return ta.barssince(!!cnd, id);
        }

        /* ════════ P5: Change / aggregate ════════ */
        case 'ta.change': {
          var s = evalArg(0), l = evalArg(1);
          return ta.change(s, isNa(l) ? 1 : Math.round(l), id);
        }
        case 'ta.cum': {
          return ta.cum(evalArg(0), id);
        }
        case 'ta.tr': {
          var hg = evalArg(0);
          var pc = prevCandle ? +prevCandle.c : NA;
          return ta.tr(+curCandle.h, +curCandle.l, pc, isNa(hg) ? true : !!hg);
        }
        case 'ta.rising': {
          var s = evalArg(0), l = evalArg(1);
          if (isNa(l)) return false;
          return ta.rising(s, Math.round(l), id);
        }
        case 'ta.falling': {
          var s = evalArg(0), l = evalArg(1);
          if (isNa(l)) return false;
          return ta.falling(s, Math.round(l), id);
        }

        /* ════════ P5: Statistical ════════ */
        case 'ta.correlation': {
          var a = evalArg(0), b = evalArg(1), l = evalArg(2);
          if (isNa(l)) return NA;
          return ta.correlation(a, b, Math.round(l), id);
        }
        case 'ta.percentrank': {
          var s = evalArg(0), l = evalArg(1);
          if (isNa(l)) return NA;
          return ta.percentrank(s, Math.round(l), id);
        }
        case 'ta.median': {
          var s = evalArg(0), l = evalArg(1);
          if (isNa(l)) return NA;
          return ta.median(s, Math.round(l), id);
        }
        case 'ta.range': {
          var s = evalArg(0), l = evalArg(1);
          if (isNa(l)) return NA;
          return ta.range(s, Math.round(l), id);
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
        /* Fallback to positional only if that slot is NOT a different named arg */
        if (defaultIdx !== undefined && defaultIdx < args.length && args[defaultIdx].type !== 'NamedArg') {
          return execNode(args[defaultIdx]);
        }
        return NA;
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
        /* Fallback to positional only if that slot is NOT a different named arg */
        if (defaultIdx !== undefined && defaultIdx < args.length && args[defaultIdx].type !== 'NamedArg') {
          return execNode(args[defaultIdx]);
        }
        return NA;
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

    function execTableCall(name, args, node) {
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
        /* Fallback to positional only if that slot is NOT a different named arg */
        if (defaultIdx !== undefined && defaultIdx < args.length && args[defaultIdx].type !== 'NamedArg') {
          return execNode(args[defaultIdx]);
        }
        return NA;
      };

      switch (name) {
        case 'table.new': {
          var position = getNamedArg('position', 0);
          var columns = Number(getNamedArg('columns', 1));
          var rowsN = Number(getNamedArg('rows', 2));
          if (isNaN(columns) || isNaN(rowsN)) return NA;
          var tbgcolor = getNamedArg('bgcolor', 3);
          var tframeColor = getNamedArg('frame_color', 4);
          var tframeWidth = getNamedArg('frame_width', 5);
          var tborderColor = getNamedArg('border_color', 6);
          var tborderWidth = getNamedArg('border_width', 7);
          var tObj = {
            id: nextTableId++,
            position: isNa(position) ? 'top_right' : position,
            cols: columns, rows: rowsN,
            bgcolor: isNa(tbgcolor) ? null : tbgcolor,
            frame_color: isNa(tframeColor) ? null : tframeColor,
            frame_width: isNa(tframeWidth) ? 0 : tframeWidth,
            border_color: isNa(tborderColor) ? null : tborderColor,
            border_width: isNa(tborderWidth) ? 0 : tborderWidth,
            cells: {}
          };
          tables.push(tObj);
          if (tables.length > 50) tables.shift();
          return tObj;
        }
        case 'table.delete': {
          var td = evalArg(0);
          if (td && td.id) {
            for (var i = 0; i < tables.length; i++) {
              if (tables[i].id === td.id) { tables.splice(i, 1); break; }
            }
          }
          return NA;
        }
        case 'table.cell': {
          var tc = evalArg(0);
          var col = Number(evalArg(1));
          var row = Number(evalArg(2));
          if (!tc || !tc.id || isNaN(col) || isNaN(row)) return NA;
          var cellText = getNamedArg('text', 3);
          var cellWidth = getNamedArg('width', 4);
          var cellHeight = getNamedArg('height', 5);
          var cellTextColor = getNamedArg('text_color', 6);
          var cellHalign = getNamedArg('text_halign', 7);
          var cellValign = getNamedArg('text_valign', 8);
          var cellBg = getNamedArg('bgcolor', 9);
          var cellTooltip = getNamedArg('tooltip', 10);
          var cellSize = getNamedArg('text_size', 11);
          var key = col + ',' + row;
          tc.cells[key] = {
            col: col, row: row,
            text: isNa(cellText) ? '' : String(cellText),
            width: isNa(cellWidth) ? 0 : cellWidth,
            height: isNa(cellHeight) ? 0 : cellHeight,
            text_color: isNa(cellTextColor) ? '#000000' : cellTextColor,
            text_halign: isNa(cellHalign) ? 'center' : cellHalign,
            text_valign: isNa(cellValign) ? 'center' : cellValign,
            bgcolor: isNa(cellBg) ? null : cellBg,
            tooltip: isNa(cellTooltip) ? '' : String(cellTooltip),
            text_size: isNa(cellSize) ? 'normal' : cellSize
          };
          return NA;
        }
        case 'table.clear': {
          var tcl = evalArg(0);
          if (!tcl || !tcl.id) return NA;
          var sc = Number(evalArg(1));
          var sr = Number(evalArg(2));
          var ec = isNaN(Number(evalArg(3))) ? sc : Number(evalArg(3));
          var er = isNaN(Number(evalArg(4))) ? sr : Number(evalArg(4));
          if (isNaN(sc) || isNaN(sr)) { tcl.cells = {}; return NA; }
          for (var cc = sc; cc <= ec; cc++) {
            for (var rr = sr; rr <= er; rr++) {
              delete tcl.cells[cc + ',' + rr];
            }
          }
          return NA;
        }
        case 'table.set_bgcolor': {
          var tsb = evalArg(0); var sbc = evalArg(1);
          if (tsb && tsb.id) tsb.bgcolor = isNa(sbc) ? null : sbc;
          return NA;
        }
        case 'table.set_frame_color': {
          var tsf = evalArg(0); var sfc = evalArg(1);
          if (tsf && tsf.id) tsf.frame_color = isNa(sfc) ? null : sfc;
          return NA;
        }
        case 'table.set_border_color': {
          var tsbr = evalArg(0); var sbrc = evalArg(1);
          if (tsbr && tsbr.id) tsbr.border_color = isNa(sbrc) ? null : sbrc;
          return NA;
        }
        case 'table.set_position': {
          var tsp = evalArg(0); var spp = evalArg(1);
          if (tsp && tsp.id && !isNa(spp)) tsp.position = spp;
          return NA;
        }
        case 'table.cell_set_text': {
          var tct = evalArg(0); var ctc = Number(evalArg(1)); var ctr = Number(evalArg(2)); var ctx = evalArg(3);
          if (tct && tct.id && !isNaN(ctc) && !isNaN(ctr)) {
            var k = ctc + ',' + ctr;
            if (!tct.cells[k]) tct.cells[k] = { col: ctc, row: ctr, text: '', text_color: '#000000', text_halign: 'center', text_valign: 'center', bgcolor: null, text_size: 'normal', width: 0, height: 0, tooltip: '' };
            tct.cells[k].text = isNa(ctx) ? '' : String(ctx);
          }
          return NA;
        }
        case 'table.cell_set_bgcolor': {
          var tcb = evalArg(0); var cbc = Number(evalArg(1)); var cbr = Number(evalArg(2)); var cbx = evalArg(3);
          if (tcb && tcb.id && !isNaN(cbc) && !isNaN(cbr)) {
            var k2 = cbc + ',' + cbr;
            if (!tcb.cells[k2]) tcb.cells[k2] = { col: cbc, row: cbr, text: '', text_color: '#000000', text_halign: 'center', text_valign: 'center', bgcolor: null, text_size: 'normal', width: 0, height: 0, tooltip: '' };
            tcb.cells[k2].bgcolor = isNa(cbx) ? null : cbx;
          }
          return NA;
        }
        case 'table.cell_set_text_color': {
          var tctc = evalArg(0); var tcc = Number(evalArg(1)); var tcr = Number(evalArg(2)); var tcx = evalArg(3);
          if (tctc && tctc.id && !isNaN(tcc) && !isNaN(tcr)) {
            var k3 = tcc + ',' + tcr;
            if (!tctc.cells[k3]) tctc.cells[k3] = { col: tcc, row: tcr, text: '', text_color: '#000000', text_halign: 'center', text_valign: 'center', bgcolor: null, text_size: 'normal', width: 0, height: 0, tooltip: '' };
            tctc.cells[k3].text_color = isNa(tcx) ? '#000000' : tcx;
          }
          return NA;
        }
        case 'table.cell_set_text_halign': {
          var tcha = evalArg(0); var hac = Number(evalArg(1)); var har = Number(evalArg(2)); var hax = evalArg(3);
          if (tcha && tcha.id && !isNaN(hac) && !isNaN(har)) {
            var k4 = hac + ',' + har;
            if (!tcha.cells[k4]) tcha.cells[k4] = { col: hac, row: har, text: '', text_color: '#000000', text_halign: 'center', text_valign: 'center', bgcolor: null, text_size: 'normal', width: 0, height: 0, tooltip: '' };
            tcha.cells[k4].text_halign = isNa(hax) ? 'center' : hax;
          }
          return NA;
        }
        case 'table.cell_set_text_valign': {
          var tcva = evalArg(0); var vac = Number(evalArg(1)); var var_ = Number(evalArg(2)); var vax = evalArg(3);
          if (tcva && tcva.id && !isNaN(vac) && !isNaN(var_)) {
            var k5 = vac + ',' + var_;
            if (!tcva.cells[k5]) tcva.cells[k5] = { col: vac, row: var_, text: '', text_color: '#000000', text_halign: 'center', text_valign: 'center', bgcolor: null, text_size: 'normal', width: 0, height: 0, tooltip: '' };
            tcva.cells[k5].text_valign = isNa(vax) ? 'center' : vax;
          }
          return NA;
        }
        case 'table.cell_set_text_size': {
          var tcts = evalArg(0); var tsc = Number(evalArg(1)); var tsr = Number(evalArg(2)); var tsx = evalArg(3);
          if (tcts && tcts.id && !isNaN(tsc) && !isNaN(tsr)) {
            var k6 = tsc + ',' + tsr;
            if (!tcts.cells[k6]) tcts.cells[k6] = { col: tsc, row: tsr, text: '', text_color: '#000000', text_halign: 'center', text_valign: 'center', bgcolor: null, text_size: 'normal', width: 0, height: 0, tooltip: '' };
            tcts.cells[k6].text_size = isNa(tsx) ? 'normal' : tsx;
          }
          return NA;
        }
        case 'table.cell_set_tooltip': {
          var tctt = evalArg(0); var ttc = Number(evalArg(1)); var ttr = Number(evalArg(2)); var ttx = evalArg(3);
          if (tctt && tctt.id && !isNaN(ttc) && !isNaN(ttr)) {
            var k7 = ttc + ',' + ttr;
            if (!tctt.cells[k7]) tctt.cells[k7] = { col: ttc, row: ttr, text: '', text_color: '#000000', text_halign: 'center', text_valign: 'center', bgcolor: null, text_size: 'normal', width: 0, height: 0, tooltip: '' };
            tctt.cells[k7].tooltip = isNa(ttx) ? '' : String(ttx);
          }
          return NA;
        }
        default:
          return { __error__: { line: node.line, col: node.col, message: "Unknown table function '" + name + "'" } };
      }
    }

    /* P2: box.* — rectangles drawn on the chart at world coords (left/top/right/bottom) */
    function execBoxCall(name, args, node) {
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
        if (defaultIdx !== undefined && defaultIdx < args.length && args[defaultIdx].type !== 'NamedArg') {
          return execNode(args[defaultIdx]);
        }
        return NA;
      };

      switch (name) {
        case 'box.new': {
          var left = Number(getNamedArg('left', 0));
          var top = Number(getNamedArg('top', 1));
          var right = Number(getNamedArg('right', 2));
          var bottom = Number(getNamedArg('bottom', 3));
          if (isNaN(left) || isNaN(top) || isNaN(right) || isNaN(bottom)) return NA;
          var border_color = getNamedArg('border_color', 4);
          var border_width = getNamedArg('border_width', 5);
          var border_style = getNamedArg('border_style', 6);
          var extend = getNamedArg('extend', 7);
          var bgcolor = getNamedArg('bgcolor', 8);
          var text = getNamedArg('text', 9);
          var text_size = getNamedArg('text_size', 10);
          var text_color = getNamedArg('text_color', 11);
          var text_halign = getNamedArg('text_halign', 12);
          var text_valign = getNamedArg('text_valign', 13);
          var b = {
            id: nextBoxId++,
            left: left, top: top, right: right, bottom: bottom,
            border_color: isNa(border_color) ? '#787B86' : border_color,
            border_width: isNa(border_width) ? 1 : border_width,
            border_style: isNa(border_style) ? 'solid' : border_style,
            extend: isNa(extend) ? 'none' : extend,
            bgcolor: isNa(bgcolor) ? 'rgba(120,123,134,0.2)' : bgcolor,
            text: isNa(text) ? '' : String(text),
            text_size: isNa(text_size) ? 'normal' : text_size,
            text_color: isNa(text_color) ? '#FFFFFF' : text_color,
            text_halign: isNa(text_halign) ? 'center' : text_halign,
            text_valign: isNa(text_valign) ? 'center' : text_valign
          };
          boxes.push(b);
          if (boxes.length > max_boxes_count) boxes.shift();
          return b;
        }
        case 'box.delete': {
          var bx = evalArg(0);
          if (bx && bx.id) {
            for (var i = 0; i < boxes.length; i++) {
              if (boxes[i].id === bx.id) { boxes.splice(i, 1); break; }
            }
          }
          return NA;
        }
        case 'box.set_left':   { var b1 = evalArg(0); var v = evalArg(1); if (b1 && b1.id && !isNa(v)) b1.left = Number(v); return NA; }
        case 'box.set_top':    { var b1 = evalArg(0); var v = evalArg(1); if (b1 && b1.id && !isNa(v)) b1.top = Number(v); return NA; }
        case 'box.set_right':  { var b1 = evalArg(0); var v = evalArg(1); if (b1 && b1.id && !isNa(v)) b1.right = Number(v); return NA; }
        case 'box.set_bottom': { var b1 = evalArg(0); var v = evalArg(1); if (b1 && b1.id && !isNa(v)) b1.bottom = Number(v); return NA; }
        case 'box.set_lefttop':     { var b1 = evalArg(0); var x = evalArg(1); var y = evalArg(2); if (b1 && b1.id) { if (!isNa(x)) b1.left = Number(x); if (!isNa(y)) b1.top = Number(y); } return NA; }
        case 'box.set_righttop':    { var b1 = evalArg(0); var x = evalArg(1); var y = evalArg(2); if (b1 && b1.id) { if (!isNa(x)) b1.right = Number(x); if (!isNa(y)) b1.top = Number(y); } return NA; }
        case 'box.set_leftbottom':  { var b1 = evalArg(0); var x = evalArg(1); var y = evalArg(2); if (b1 && b1.id) { if (!isNa(x)) b1.left = Number(x); if (!isNa(y)) b1.bottom = Number(y); } return NA; }
        case 'box.set_rightbottom': { var b1 = evalArg(0); var x = evalArg(1); var y = evalArg(2); if (b1 && b1.id) { if (!isNa(x)) b1.right = Number(x); if (!isNa(y)) b1.bottom = Number(y); } return NA; }
        case 'box.set_border_color': { var b1 = evalArg(0); var c = evalArg(1); if (b1 && b1.id && !isNa(c)) b1.border_color = c; return NA; }
        case 'box.set_border_width': { var b1 = evalArg(0); var w = evalArg(1); if (b1 && b1.id && !isNa(w)) b1.border_width = w; return NA; }
        case 'box.set_border_style': { var b1 = evalArg(0); var s = evalArg(1); if (b1 && b1.id && !isNa(s)) b1.border_style = s; return NA; }
        case 'box.set_bgcolor':      { var b1 = evalArg(0); var c = evalArg(1); if (b1 && b1.id && !isNa(c)) b1.bgcolor = c; return NA; }
        case 'box.set_extend':       { var b1 = evalArg(0); var e = evalArg(1); if (b1 && b1.id && !isNa(e)) b1.extend = e; return NA; }
        case 'box.set_text':         { var b1 = evalArg(0); var t = evalArg(1); if (b1 && b1.id) b1.text = isNa(t) ? '' : String(t); return NA; }
        case 'box.set_text_color':   { var b1 = evalArg(0); var c = evalArg(1); if (b1 && b1.id && !isNa(c)) b1.text_color = c; return NA; }
        case 'box.set_text_size':    { var b1 = evalArg(0); var s = evalArg(1); if (b1 && b1.id && !isNa(s)) b1.text_size = s; return NA; }
        case 'box.set_text_halign':  { var b1 = evalArg(0); var h = evalArg(1); if (b1 && b1.id && !isNa(h)) b1.text_halign = h; return NA; }
        case 'box.set_text_valign':  { var b1 = evalArg(0); var v = evalArg(1); if (b1 && b1.id && !isNa(v)) b1.text_valign = v; return NA; }
        case 'box.get_left':   { var b1 = evalArg(0); return (b1 && b1.id) ? b1.left   : NA; }
        case 'box.get_top':    { var b1 = evalArg(0); return (b1 && b1.id) ? b1.top    : NA; }
        case 'box.get_right':  { var b1 = evalArg(0); return (b1 && b1.id) ? b1.right  : NA; }
        case 'box.get_bottom': { var b1 = evalArg(0); return (b1 && b1.id) ? b1.bottom : NA; }
        default:
          return { __error__: { line: node.line, col: node.col, message: "Unknown box function '" + name + "'" } };
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
        case 'array.new_string':
        case 'array.new_label':
        case 'array.new_line':
        case 'array.new_box':
        case 'array.new_table':
        case 'array.new_color': {
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
          return inputs[j].value !== undefined ? inputs[j].value : defVal;
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
    return { plots: [], shapes: [], hlines: [], bgcolors: [], inputs: [], lines: [], labels: [], tables: [], boxes: [], errors: [] };
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
