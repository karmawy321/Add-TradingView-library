/* ═══════════════════════════════════════════════════════════════
   FractalScript — Lexer (Tokenizer)
   
   Converts Pine Script v5 source code into a linear stream of tokens.
   Validates //@version=5 declaration.
   
   Token types defined in FS.TT (Token Types).
   ═══════════════════════════════════════════════════════════════ */

(function (global) {
    'use strict';

    var FS = global.FractalScript || (global.FractalScript = {});

    /* ── Token Types ── */
    var TT = FS.TT = {
        NUMBER: 'NUMBER', STRING: 'STRING', IDENT: 'IDENT',
        OP: 'OP', LPAREN: 'LPAREN', RPAREN: 'RPAREN',
        LBRACKET: 'LBRACKET', RBRACKET: 'RBRACKET',
        COMMA: 'COMMA', DOT: 'DOT', COLON: 'COLON',
        ASSIGN: 'ASSIGN', REASSIGN: 'REASSIGN', COMPOUND_ASSIGN: 'COMPOUND_ASSIGN', QUESTION: 'QUESTION', ARROW: 'ARROW',
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
        KW_STRATEGY: 'KW_STRATEGY', KW_METHOD: 'KW_METHOD'
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
        'strategy': TT.KW_STRATEGY, 'method': TT.KW_METHOD,
        'varip': TT.KW_VAR
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
            return {
                tokens: null, error: {
                    line: 1, col: 1,
                    message: 'Missing v5-compatible declaration (//@version=5). Only v5 syntax is supported.'
                }
            };
        }
        if (versionMatch[1] !== '5') {
            return {
                tokens: null, error: {
                    line: 1, col: 1,
                    message: 'Only v5-compatible syntax (//@version=5) is supported. Found v' + versionMatch[1] + '.'
                }
            };
        }

        var tokens = [];
        var i = 0, line = 1, col = 1, len = source.length;

        function advance() { var ch = source[i++]; if (ch === '\n') { line++; col = 1; } else { col++; } return ch; }
        function peek() { return i + 1 < len ? source[i + 1] : ''; }
        function peek2() { return i + 1 < len ? source[i] + source[i + 1] : source[i] || ''; }

        while (i < len) {
            var ch = source[i];
            var startLine = line, startCol = col;

            /* Skip spaces and tabs (NOT newlines) */
            if (ch === ' ' || ch === '\t') { advance(); continue; }

            /* Newlines — significant in fractal */
            if (ch === '\n') {
                advance();
                /* Collapse multiple newlines and spaces */
                while (i < len && (source[i] === '\n' || source[i] === '\r' || source[i] === ' ' || source[i] === '\t')) {
                    advance();
                }
                
                /* Pine Script v5 line continuation:
                   If a line starts with indentation that is NOT a multiple of 4 spaces,
                   it is a continuation of the previous line. */
                var isContinuation = false;
                if (i < len) {
                    if (source[i] === '/' && i + 1 < len && source[i+1] === '/') {
                        isContinuation = false; // comments don't force continuation
                    } else {
                        isContinuation = (col - 1) % 4 !== 0;
                    }
                }

                /* Don't push newline if it's a continuation, or if we already just pushed one, or at start */
                if (!isContinuation && tokens.length > 0 && tokens[tokens.length - 1].type !== TT.NEWLINE) {
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
                return {
                    tokens: null, error: {
                        line: startLine, col: startCol,
                        message: "Invalid hex color literal '" + hex + "' (expected #RRGGBB or #RRGGBBAA)"
                    }
                };
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
            /* Compound assignment operators: +=, -=, *=, /= */
            if (two === '+=') { advance(); advance(); tokens.push(tok(TT.COMPOUND_ASSIGN, '+=', startLine, startCol)); continue; }
            if (two === '-=') { advance(); advance(); tokens.push(tok(TT.COMPOUND_ASSIGN, '-=', startLine, startCol)); continue; }
            if (two === '*=') { advance(); advance(); tokens.push(tok(TT.COMPOUND_ASSIGN, '*=', startLine, startCol)); continue; }
            if (two === '/=') { advance(); advance(); tokens.push(tok(TT.COMPOUND_ASSIGN, '/=', startLine, startCol)); continue; }

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

    /* ── Export ── */
    FS.lexer = lexer;
    FS.KEYWORDS = KEYWORDS;
    FS.tok = tok;

})(typeof window !== 'undefined' ? window : this);