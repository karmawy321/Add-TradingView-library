/* ═══════════════════════════════════════════════════════════════
   FractalScript — Parser (Recursive Descent → AST)
   
   Converts a token stream into an Abstract Syntax Tree (AST).
   Supports: indicator/strategy declarations, var/assignment, if/else,
   for/for-in/while/switch, plot/plotshape/bgcolor/hline, tuple
   destructuring, type declarations, user-defined functions, ternary
   expressions, binary/unary operators, history references, member
   access, and function calls.
   ═══════════════════════════════════════════════════════════════ */

(function (global) {
    'use strict';

    var FS = global.FractalScript || (global.FractalScript = {});
    var TT = FS.TT;

    function parser(tokens) {
        var pos = 0;

        function cur() { return tokens[pos] || tok(TT.EOF, null, 0, 0); }
        function at(type) { return cur().type === type; }
        function atVal(type, val) { return cur().type === type && cur().value === val; }
        function eat(type) {
            if (!at(type)) {
                var t = cur();
                return {
                    error: {
                        line: t.line, col: t.col,
                        message: 'Expected ' + type + ', got ' + t.type + " ('" + t.value + "')"
                    }
                };
            }
            return tokens[pos++];
        }
        function tryEat(type) { if (at(type)) { return tokens[pos++]; } return null; }
        function skipNewlines() { while (at(TT.NEWLINE)) pos++; }
        function loc() { var t = cur(); return { line: t.line, col: t.col }; }
        function node(type, props) { var n = { type: type }; var l = loc(); n.line = l.line; n.col = l.col; for (var k in props) n[k] = props[k]; return n; }

        function tok(type, value, line, col) { return { type: type, value: value, line: line, col: col }; }

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
            if (at(TT.KW_WHILE)) return parseWhile();
            if (at(TT.KW_BREAK)) { var lb = loc(); pos++; return { type: 'Break', line: lb.line, col: lb.col }; }
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
            var subject = null;
            if (!at(TT.NEWLINE)) {
                subject = parseExpression();
                if (subject && subject.error) return subject;
            }
            skipNewlines();
            if (at(TT.EOF)) return { error: { line: l.line, col: l.col, message: 'switch needs at least one case' } };
            var firstCol = cur().col;
            var cases = [];
            var defaultBody = null;
            while (!at(TT.EOF)) {
                skipNewlines();
                if (at(TT.EOF)) break;
                if (cur().col < firstCol) break;
                if (at(TT.ARROW)) {
                    pos++;
                    var dbody;
                    if (at(TT.NEWLINE)) { skipNewlines(); dbody = parseBlock(firstCol + 1); }
                    else dbody = parseExpression();
                    if (dbody && dbody.error) return dbody;
                    defaultBody = dbody;
                    continue;
                }
                var cval = parseExpression();
                if (cval && cval.error) return cval;
                if (!at(TT.ARROW)) {
                    return {
                        error: {
                            line: cur().line, col: cur().col,
                            message: "Expected '=>' in switch case"
                        }
                    };
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
                var fieldTypeToken = eat(TT.IDENT); if (fieldTypeToken.error) return fieldTypeToken;
                var fieldNameToken = eat(TT.IDENT); if (fieldNameToken.error) return fieldNameToken;
                var fieldDefault = null;
                if (at(TT.ASSIGN)) {
                    pos++;
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

            if (at(TT.ASSIGN) || at(TT.REASSIGN)) {
                var isReassign = at(TT.REASSIGN);
                pos++;
                var names = [];
                for (var ni = 0; ni < elems.length; ni++) {
                    if (elems[ni].type !== 'Identifier') {
                        return {
                            error: {
                                line: l.line, col: l.col,
                                message: 'Tuple destructuring target must be a list of identifiers'
                            }
                        };
                    }
                    names.push(elems[ni].name);
                }
                var value = parseExpression();
                if (value && value.error) return value;
                return { type: 'TupleAssign', names: names, value: value, reassign: isReassign, line: l.line, col: l.col };
            }

            return { type: 'TupleLiteral', elems: elems, line: l.line, col: l.col };
        }

        function parseIndicator() {
            var l = loc();
            var isStrat = at(TT.KW_STRATEGY);
            pos++;
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
            if (!t || t.col <= parentCol) return null;
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
                    var s22 = parseStatement();
                    if (s22 && s22.error) return s22;
                    if (s22) stmts.push(s22);
                }
            }

            if (stmts.length === 1) return stmts[0];
            return { type: 'Block', body: stmts, line: stmts[0].line, col: stmts[0].col };
        }

        function parsePlotCall() {
            var l = loc(); pos++;
            var r = eat(TT.LPAREN); if (r && r.error) return r;
            var args = parseArgList(); if (args.error) return args;
            r = eat(TT.RPAREN); if (r && r.error) return r;
            return { type: 'Plot', args: args, line: l.line, col: l.col };
        }

        function parsePlotShapeCall() {
            var l = loc(); pos++;
            var r = eat(TT.LPAREN); if (r && r.error) return r;
            var args = parseArgList(); if (args.error) return args;
            r = eat(TT.RPAREN); if (r && r.error) return r;
            return { type: 'PlotShape', args: args, line: l.line, col: l.col };
        }

        function parseBgColorCall() {
            var l = loc(); pos++;
            var r = eat(TT.LPAREN); if (r && r.error) return r;
            var args = parseArgList(); if (args.error) return args;
            r = eat(TT.RPAREN); if (r && r.error) return r;
            return { type: 'Bgcolor', args: args, line: l.line, col: l.col };
        }

        function parseHlineCall() {
            var l = loc(); pos++;
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

            if (expr && (expr.type === 'Switch' || expr.type === 'If')) return expr;

            while (true) {
                if (at(TT.LBRACKET)) {
                    var l = loc(); pos++;
                    var index = parseExpression(); if (index && index.error) return index;
                    var r = eat(TT.RBRACKET); if (r && r.error) return r;
                    expr = { type: 'HistoryRef', series: expr, offset: index, line: l.line, col: l.col };
                    continue;
                }
                if (at(TT.DOT)) {
                    var l2 = loc(); pos++;
                    var member = eat(TT.IDENT); if (member.error) return member;
                    expr = { type: 'MemberAccess', object: expr, member: member.value, line: l2.line, col: l2.col };
                    continue;
                }
                if (at(TT.OP) && cur().value === '<' &&
                    expr.type === 'MemberAccess' && expr.member === 'new' &&
                    expr.object && expr.object.type === 'Identifier' && expr.object.name === 'array') {
                    pos++;
                    var tArg = eat(TT.IDENT); if (tArg.error) return tArg;
                    if (!(at(TT.OP) && cur().value === '>')) {
                        return { error: { line: cur().line, col: cur().col, message: "Expected '>' after type parameter" } };
                    }
                    pos++;
                    expr.typeArg = tArg.value;
                    continue;
                }
                if (at(TT.LPAREN) && expr.type === 'MemberAccess' || (at(TT.LPAREN) && expr.type === 'Identifier')) {
                    var l3 = loc(); pos++;
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

            if (at(TT.NUMBER)) { pos++; return { type: 'NumLiteral', value: t.value, line: t.line, col: t.col }; }
            if (at(TT.STRING)) { pos++; return { type: 'StrLiteral', value: t.value, line: t.line, col: t.col }; }
            if (at(TT.KW_TRUE)) { pos++; return { type: 'BoolLiteral', value: true, line: t.line, col: t.col }; }
            if (at(TT.KW_FALSE)) { pos++; return { type: 'BoolLiteral', value: false, line: t.line, col: t.col }; }
            if (at(TT.KW_NA)) {
                pos++;
                if (at(TT.LPAREN)) return { type: 'Identifier', name: 'na', line: t.line, col: t.col };
                return { type: 'NaLiteral', value: FS.NA, line: t.line, col: t.col };
            }

            if (at(TT.IDENT)) { pos++; return { type: 'Identifier', name: t.value, line: t.line, col: t.col }; }

            if (at(TT.KW_HLINE) || at(TT.KW_PLOT) || at(TT.KW_PLOTSHAPE) || at(TT.KW_BGCOLOR) || at(TT.KW_STRATEGY)) {
                pos++;
                return { type: 'Identifier', name: t.value, line: t.line, col: t.col };
            }

            if (at(TT.KW_SWITCH)) return parseSwitch();
            if (at(TT.KW_IF)) return parseIf();

            if (at(TT.LPAREN)) {
                pos++;
                var expr = parseExpression();
                if (expr && expr.error) return expr;
                var r = eat(TT.RPAREN); if (r && r.error) return r;
                return expr;
            }

            if (at(TT.LBRACKET)) {
                var llt = loc(); pos++;
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

            return {
                error: {
                    line: t.line, col: t.col,
                    message: 'Unexpected token: ' + t.type + " ('" + t.value + "')"
                }
            };
        }

        return parseProgram();
    }

    /* ── Export ── */
    FS.parser = parser;

})(typeof window !== 'undefined' ? window : this);