/* ═══════════════════════════════════════════════════════════════
   FractalScript — Evaluator (Bar-by-bar AST execution engine)
   
   Walks an AST node tree candle-by-candle, maintaining state for
   variables, series history, and draw commands. Produces final
   plots, shapes, hlines, bgcolors, lines, labels, tables, and boxes.
   ═══════════════════════════════════════════════════════════════ */

(function (global) {
    'use strict';

    var FS = global.FractalScript || (global.FractalScript = {});

    var STMT_LIMIT = 5000000;

    function evaluate(ast, candles, inputOverrides) {
        if (!ast || ast.error) return { error: ast ? ast.error : { line: 0, col: 0, message: 'No AST' } };
        if (!candles || candles.length === 0) return emptyResult();

        var N = candles.length;
        var ta = FS.createTaContext();
        var stmtCount = 0;

        /* Result collectors */
        var plots = [];
        var shapes = [];
        var hlines = [];
        var bgcolors = [];
        var inputs = [];
        var lines = [];
        var labels = [];
        var tables = [];
        var boxes = [];
        var fills = [];

        var nextLineId = 1;
        var nextLabelId = 1;
        var nextTableId = 1;
        var nextBoxId = 1;
        var max_lines_count = 50;
        var max_labels_count = 50;
        var max_boxes_count = 50;

        /* Strategy state */
        var isStrategy = false;
        var stratCapital = 10000;
        var stratCommission = 0;
        var stratDefaultQty = 1;
        var positions = {};
        var closedTrades = [];
        var equityCurve = [];

        /* Parse indicator / strategy params */
        var overlay = false;
        if (ast.type === 'Program') {
            for (var i = 0; i < ast.body.length; i++) {
                var node = ast.body[i];
                var isStratNode = (node.type === 'Strategy');
                var isIndNode = (node.type === 'Indicator');
                var stratArgs = [];
                var indArgs = [];

                if (!isStratNode && !isIndNode) {
                    var expr = node.type === 'ExpressionStatement' ? node.expression : node;
                    if (expr && expr.type === 'CallExpression' && expr.callee && expr.callee.type === 'Identifier') {
                        if (expr.callee.name === 'strategy') {
                            isStratNode = true;
                            stratArgs = expr.args || [];
                        } else if (expr.callee.name === 'indicator') {
                            isIndNode = true;
                            indArgs = expr.args || [];
                        }
                    }
                } else {
                    stratArgs = node.args || [];
                    indArgs = node.args || [];
                }

                if (isStratNode) {
                    isStrategy = true;
                    for (var sj = 0; sj < stratArgs.length; sj++) {
                        var sa = stratArgs[sj];
                        if (sa.type === 'NamedArg') {
                            if (sa.name === 'initial_capital' && sa.value && sa.value.type === 'NumLiteral') stratCapital = sa.value.value;
                            if (sa.name === 'commission_value' && sa.value && sa.value.type === 'NumLiteral') stratCommission = sa.value.value;
                            if (sa.name === 'default_qty_value' && sa.value && sa.value.type === 'NumLiteral') stratDefaultQty = sa.value.value;
                        }
                    }
                }
                if (isIndNode) {
                    for (var j = 0; j < indArgs.length; j++) {
                        var ia = indArgs[j];
                        if (ia.type === 'NamedArg') {
                            if (ia.name === 'max_lines_count' && ia.value && ia.value.type === 'NumLiteral') max_lines_count = ia.value.value;
                            if (ia.name === 'max_labels_count' && ia.value && ia.value.type === 'NumLiteral') max_labels_count = ia.value.value;
                            if (ia.name === 'max_boxes_count' && ia.value && ia.value.type === 'NumLiteral') max_boxes_count = ia.value.value;
                            if (ia.name === 'overlay' && ia.value && ia.value.type === 'BoolLiteral') overlay = !!ia.value.value;
                        }
                    }
                }
            }
        }

        /* Plot registry */
        var plotRegistry = {};
        var plotCounter = 0;

        /* Variable scopes */
        var persistentVars = {};
        var barVars = {};
        var userFunctions = {};
        var typeRegistry = {};
        var fnCallDepth = 0;
        var seriesHistory = {};

        /* Candle data for current bar */
        var barIndex = 0;
        var curCandle = null;
        var prevCandle = null;

        /* P6: Detect timeframe from candle spacing */
        var _tfMs = 0;
        if (candles.length >= 2 && candles[1].t && candles[0].t) {
            _tfMs = candles[1].t - candles[0].t;
            for (var _ti = 2; _ti < Math.min(5, candles.length); _ti++) {
                var _d = candles[_ti].t - candles[_ti - 1].t;
                if (_d > 0 && _d < _tfMs) _tfMs = _d;
            }
        }
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
                _tfPeriod = String(_hrs * 60);
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

        /* Extract inputs first */
        extractInputs(ast, inputOverrides);

        /* Bar-by-bar execution */
        for (barIndex = 0; barIndex < N; barIndex++) {
            curCandle = candles[barIndex];
            prevCandle = barIndex > 0 ? candles[barIndex - 1] : null;
            barVars = {};
            ta.resetCounter();
            plotCounter = 0;

            var body = ast.type === 'Program' ? ast.body : [ast];
            for (var si = 0; si < body.length; si++) {
                var result = execNode(body[si]);
                if (result && result.__error__) return { error: result.__error__ };
            }

            /* Record series history */
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

        /* Build final plots */
        var finalPlots = [];
        for (var pk in plotRegistry) {
            var p = plotRegistry[pk];
            var vals = new Float64Array(N);
            var cols = new Array(N);
            for (var vi = 0; vi < N; vi++) {
                var v = p.values[vi];
                vals[vi] = (v !== undefined && !FS.isNa(v)) ? v : NaN;
                cols[vi] = p.colors[vi] || null;
            }
            finalPlots.push({
                label: p.label || ('Plot ' + (parseInt(pk) + 1)),
                values: vals,
                colors: cols,
                color: p.color || '#2196F3',
                lineWidth: p.lineWidth || 1,
                style: p.style || 'plot.style_line'
            });
        }

        return {
            plots: finalPlots,
            shapes: shapes,
            hlines: hlines,
            bgcolors: bgcolors,
            fills: fills,
            inputs: inputs,
            lines: lines,
            labels: labels,
            tables: tables,
            boxes: boxes,
            overlay: overlay,
            errors: [],
            strategyResult: isStrategy ? buildStrategyResult() : null
        };

        /* ── Strategy result builder ── */
        function buildStrategyResult() {
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
                var _dd2 = peak > 0 ? (peak - equityCurve[_ei]) / peak : 0;
                if (_dd2 > mdd) mdd = _dd2;
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
        }

        /* ── extractInputs ── */
        function extractInputs(node, overrides) {
            if (!node) return;
            overrides = overrides || {};
            walkAST(node, function (n) {
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

        /* ── Core execNode ── */
        function execNode(node) {
            if (!node) return FS.NA;
            if (++stmtCount > STMT_LIMIT) {
                return {
                    __error__: {
                        line: node.line, col: node.col,
                        message: 'Execution limit exceeded (5,000,000 statements). Possible infinite loop.'
                    }
                };
            }

            switch (node.type) {
                case 'Program': return execProgram(node);
                case 'Indicator':
                case 'Strategy': return FS.NA;
                case 'NumLiteral': return node.value;
                case 'StrLiteral': return node.value;
                case 'BoolLiteral': return node.value;
                case 'NaLiteral': return FS.NA;
                case 'Identifier': return resolveVar(node.name);
                case 'VarDecl': return execVarDecl(node);
                case 'Reassign': return execReassign(node);
                case 'TupleAssign': return execTupleAssign(node);
                case 'TupleLiteral': {
                    var _arr = [];
                    for (var _li = 0; _li < node.elems.length; _li++) {
                        var _v = execNode(node.elems[_li]);
                        if (_v && _v.__error__) return _v;
                        _arr.push(_v);
                    }
                    return _arr;
                }
                case 'BinaryExpr': return execBinary(node);
                case 'UnaryExpr': return execUnary(node);
                case 'Ternary': return execTernary(node);
                case 'If': return execIf(node);
                case 'For': return execFor(node);
                case 'ForIn': return execForIn(node);
                case 'While': return execWhile(node);
                case 'Switch': return execSwitch(node);
                case 'Break': return { __break__: true };
                case 'Continue': return { __continue__: true };
                case 'Block': return execBlock(node);
                case 'MemberAccess': return execMember(node);
                case 'HistoryRef': return execHistoryRef(node);
                case 'Call': return execCall(node);
                case 'Plot': return execPlot(node);
                case 'PlotShape': return execPlotShape(node);
                case 'Bgcolor': return execBgcolor(node);
                case 'Hline': return execHline(node);
                case 'NamedArg': return execNode(node.value);
                case 'FunctionDecl':
                    userFunctions[node.name] = { params: node.params, body: node.body };
                    return FS.NA;
                case 'TypeDecl':
                    typeRegistry[node.name] = { fields: node.fields };
                    return FS.NA;
                case 'MemberAssign': return execMemberAssign(node);
                case '__resolved__': return node.__resolvedValue__;
                default: return FS.NA;
            }
        }

        function execProgram(node) {
            var last = FS.NA;
            for (var i = 0; i < node.body.length; i++) {
                last = execNode(node.body[i]);
                if (last && last.__error__) return last;
            }
            return last;
        }

        function execBlock(node) {
            var last = FS.NA;
            for (var i = 0; i < node.body.length; i++) {
                last = execNode(node.body[i]);
                if (last && last.__error__) return last;
                if (last && (last.__break__ || last.__continue__)) return last;
            }
            return last;
        }

        function execVarDecl(node) {
            if (node.persistent) {
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
                return {
                    __error__: {
                        line: node.line, col: node.col,
                        message: 'Tuple destructuring requires an array/tuple on the right side'
                    }
                };
            }
            for (var i = 0; i < node.names.length; i++) {
                var name = node.names[i];
                var v = i < val.length ? val[i] : FS.NA;
                if (node.reassign && (name in persistentVars)) {
                    persistentVars[name] = v; delete barVars[name];
                } else {
                    barVars[name] = v;
                }
            }
            return val;
        }

        function resolveVar(name) {
            if (name === 'close') return +curCandle.c;
            if (name === 'open') return +curCandle.o;
            if (name === 'high') return +curCandle.h;
            if (name === 'low') return +curCandle.l;
            if (name === 'volume') return curCandle.v || 0;
            if (name === 'hl2') return (+curCandle.h + +curCandle.l) / 2;
            if (name === 'hlc3') return (+curCandle.h + +curCandle.l + +curCandle.c) / 3;
            if (name === 'ohlc4') return (+curCandle.o + +curCandle.h + +curCandle.l + +curCandle.c) / 4;
            if (name === 'bar_index') return barIndex;
            if (name === 'last_bar_index') return N - 1;
            if (name === 'na') return FS.NA;

            /* P6: time built-ins */
            if (name === 'time') return curCandle.t || 0;
            if (name === 'time_close') return (curCandle.t || 0) + _tfMs;
            if (name === 'time_tradingday') {
                var _d = new Date(curCandle.t || 0);
                _d.setUTCHours(0, 0, 0, 0);
                return _d.getTime();
            }
            if (name === 'year' || name === 'month' || name === 'dayofmonth' ||
                name === 'dayofweek' || name === 'hour' || name === 'minute' ||
                name === 'second' || name === 'weekofyear') {
                return FS.resolveTimeField(name, curCandle);
            }

            if (name in barVars) return barVars[name];
            if (name in persistentVars) return persistentVars[name];

            for (var ii = 0; ii < inputs.length; ii++) {
                if (inputs[ii].name === name) return inputs[ii].value;
            }

            if (name === 'ta' || name === 'math' || name === 'color' || name === 'shape' ||
                name === 'location' || name === 'size' || name === 'input' || name === 'str' ||
                name === 'hline' || name === 'barstate' || name === 'timeframe' ||
                name === 'line' || name === 'extend' || name === 'label' ||
                name === 'position' || name === 'table' || name === 'text' ||
                name === 'box' || name === 'syminfo' || name === 'barmerge' ||
                name === 'plot' || name === 'order' || name === 'strategy') return name;

            return FS.NA;
        }

        function execBinary(node) {
            var left = execNode(node.left);
            if (left && left.__error__) return left;

            if (node.op === 'and') { if (!left) return false; var r = execNode(node.right); return r && r.__error__ ? r : !!r; }
            if (node.op === 'or') { if (left) return true; var r2 = execNode(node.right); return r2 && r2.__error__ ? r2 : !!r2; }

            var right = execNode(node.right);
            if (right && right.__error__) return right;

            switch (node.op) {
                case '+':
                    if (typeof left === 'string' || typeof right === 'string') {
                        if (FS.isNa(left) || FS.isNa(right)) return FS.NA;
                        return String(left) + String(right);
                    }
                    return FS.naArith(left, right, function (a, b) { return a + b; });
                case '-': return FS.naArith(left, right, function (a, b) { return a - b; });
                case '*': return FS.naArith(left, right, function (a, b) { return a * b; });
                case '/': return FS.naArith(left, right, function (a, b) { return b === 0 ? FS.NA : a / b; });
                case '%': return FS.naArith(left, right, function (a, b) { return b === 0 ? FS.NA : a % b; });
                case '==': return FS.naCmp(left, right, function (a, b) { return a === b; });
                case '!=': return FS.naCmp(left, right, function (a, b) { return a !== b; });
                case '<': return FS.naCmp(left, right, function (a, b) { return a < b; });
                case '>': return FS.naCmp(left, right, function (a, b) { return a > b; });
                case '<=': return FS.naCmp(left, right, function (a, b) { return a <= b; });
                case '>=': return FS.naCmp(left, right, function (a, b) { return a >= b; });
                default: return FS.NA;
            }
        }

        function execUnary(node) {
            var val = execNode(node.operand);
            if (val && val.__error__) return val;
            if (node.op === '-') return FS.isNa(val) ? FS.NA : -val;
            if (node.op === 'not') return FS.isNa(val) ? FS.NA : !val;
            return FS.NA;
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
            return FS.NA;
        }

        function execFor(node) {
            var start = execNode(node.start);
            var end = execNode(node.end);
            var step = node.step ? execNode(node.step) : 1;
            if (FS.isNa(start) || FS.isNa(end) || FS.isNa(step) || step === 0) return FS.NA;

            if (step > 0 && start > end) {
                if (!node.step) step = -1;
                else return FS.NA;
            } else if (step < 0 && start < end) {
                return FS.NA;
            }

            var last = FS.NA;
            for (var i = start; step > 0 ? i <= end : i >= end; i += step) {
                barVars[node.varName] = i;
                last = execNode(node.body);
                if (last && last.__error__) return last;
                if (last && last.__break__) { last = FS.NA; break; }
                if (last && last.__continue__) { last = FS.NA; continue; }
            }
            return last;
        }

        function execForIn(node) {
            var iter = execNode(node.iter);
            if (iter && iter.__error__) return iter;
            if (!iter || typeof iter.length !== 'number') return FS.NA;
            var last = FS.NA;
            for (var i = 0; i < iter.length; i++) {
                barVars[node.varName] = iter[i];
                last = execNode(node.body);
                if (last && last.__error__) return last;
                if (last && last.__break__) { last = FS.NA; break; }
                if (last && last.__continue__) { last = FS.NA; continue; }
            }
            return last;
        }

        function execWhile(node) {
            var last = FS.NA;
            var safety = 0;
            while (true) {
                if (++safety > 100000) {
                    return {
                        __error__: {
                            line: node.line, col: node.col,
                            message: 'while-loop iteration limit exceeded (100,000)'
                        }
                    };
                }
                var cond = execNode(node.condition);
                if (cond && cond.__error__) return cond;
                if (!cond) break;
                last = execNode(node.body);
                if (last && last.__error__) return last;
                if (last && last.__break__) { last = FS.NA; break; }
                if (last && last.__continue__) { last = FS.NA; continue; }
            }
            return last;
        }

        function execSwitch(node) {
            if (node.subject) {
                var subj = execNode(node.subject);
                if (subj && subj.__error__) return subj;
                for (var i = 0; i < node.cases.length; i++) {
                    var cv = execNode(node.cases[i].value);
                    if (cv && cv.__error__) return cv;
                    if (cv === subj) return execNode(node.cases[i].body);
                }
            } else {
                for (var j = 0; j < node.cases.length; j++) {
                    var cb = execNode(node.cases[j].value);
                    if (cb && cb.__error__) return cb;
                    if (cb) return execNode(node.cases[j].body);
                }
            }
            if (node.defaultBody) return execNode(node.defaultBody);
            return FS.NA;
        }

        function execMemberAssign(node) {
            var obj = execNode(node.object);
            if (obj && obj.__error__) return obj;
            if (!obj || typeof obj !== 'object' || obj.__fractal_na__) return FS.NA;
            var val = execNode(node.value);
            if (val && val.__error__) return val;
            obj[node.member] = val;
            return val;
        }

        function execMember(node) {
            var obj = execNode(node.object);
            if (obj && obj.__error__) return obj;

            /* Use shared namespace resolver */
            var resolved = FS.resolveMember(obj, node.member, {
                barIndex: barIndex, N: N, curCandle: curCandle, prevCandle: prevCandle,
                inputOverrides: inputOverrides, positions: positions,
                closedTrades: closedTrades, equityCurve: equityCurve,
                stratCapital: stratCapital, typeRegistry: typeRegistry,
                _tfPeriod: _tfPeriod, _tfMultiplier: _tfMultiplier,
                _tfIsIntraday: _tfIsIntraday, _tfIsDaily: _tfIsDaily,
                _tfIsWeekly: _tfIsWeekly, _tfIsMonthly: _tfIsMonthly,
                _tfIsSeconds: _tfIsSeconds, _tfIsMinutes: _tfIsMinutes,
                _tfIsHours: _tfIsHours
            });

            return resolved !== undefined ? resolved : FS.NA;
        }

        function execHistoryRef(node) {
            var offset = execNode(node.offset);
            if (FS.isNa(offset)) return FS.NA;
            offset = Math.round(offset);

            var series = node.series;
            if (series.type === 'Identifier') {
                var name = series.name;
                var targetBar = barIndex - offset;
                if (targetBar < 0 || targetBar >= N) return FS.NA;
                var tc = candles[targetBar];
                if (name === 'close') return +tc.c;
                if (name === 'open') return +tc.o;
                if (name === 'high') return +tc.h;
                if (name === 'low') return +tc.l;
                if (name === 'volume') return tc.v || 0;
                if (name === 'hl2') return (+tc.h + +tc.l) / 2;
                if (name === 'hlc3') return (+tc.h + +tc.l + +tc.c) / 3;
                if (name === 'ohlc4') return (+tc.o + +tc.h + +tc.l + +tc.c) / 4;

                if (seriesHistory[name]) {
                    var idx = barIndex - offset;
                    if (idx >= 0 && idx < seriesHistory[name].length) return seriesHistory[name][idx];
                }
            }
            return FS.NA;
        }

        /* ── Function calls ── */
        function execCall(node) {
            /* UDT constructor */
            if (node.callee.type === 'MemberAccess' && node.callee.member === 'new') {
                var typeName = node.callee.object.name;
                var tdef = typeRegistry[typeName];
                if (tdef) {
                    var rec = { __type__: typeName };
                    for (var fi = 0; fi < tdef.fields.length; fi++) {
                        var fld = tdef.fields[fi];
                        rec[fld.name] = fld.def ? execNode(fld.def) : FS.NA;
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
            }

            /* Method-style calls: myArr.push(val) → array.push(myArr, val)
               Resolve the object to detect its type, then rewrite to namespace call */
            if (node.callee.type === 'MemberAccess') {
                var methodObj = execNode(node.callee.object);
                if (methodObj && methodObj.__error__) return methodObj;
                var methodName = node.callee.member;
                var namespace = null;

                if (Array.isArray(methodObj)) {
                    namespace = 'array';
                } else if (methodObj && typeof methodObj === 'object' && methodObj.__map__) {
                    namespace = 'map';
                } else if (typeof methodObj === 'string' && !FS.isNa(methodObj) &&
                           ['ta', 'strategy', 'math', 'color', 'input', 'str', 'array', 'map', 'box', 'table', 'label', 'line', 'shape', 'location', 'size', 'hline', 'barstate', 'timeframe', 'extend', 'position', 'text', 'syminfo', 'barmerge', 'plot', 'order'].indexOf(methodObj) === -1) {
                    namespace = 'str';
                } else if (methodObj && typeof methodObj === 'object' && methodObj.id !== undefined) {
                    if (methodObj.hasOwnProperty('text') && methodObj.hasOwnProperty('x') && methodObj.hasOwnProperty('y')) namespace = 'label';
                    else if (methodObj.hasOwnProperty('cells') && methodObj.hasOwnProperty('rows')) namespace = 'table';
                    else if (methodObj.hasOwnProperty('x1') && methodObj.hasOwnProperty('y1')) namespace = 'line';
                    else if (methodObj.hasOwnProperty('left') && methodObj.hasOwnProperty('top')) namespace = 'box';
                }

                if (namespace) {
                    /* Check user-defined methods first (e.g. method addDouble) */
                    if (userFunctions[methodName]) {
                        var objLitU = { type: '__resolved__', __resolvedValue__: methodObj, line: node.line, col: node.col };
                        var userArgs = [objLitU].concat(node.args);
                        return execUserFunction(methodName, userArgs, node);
                    }
                    /* Built-in namespace method: array.push, str.contains, etc. */
                    var objLiteral = { type: '__resolved__', __resolvedValue__: methodObj, line: node.line, col: node.col };
                    var rewrittenArgs = [objLiteral].concat(node.args);
                    var rewrittenName = namespace + '.' + methodName;
                    return FS.execCallDispatch(rewrittenName, rewrittenArgs, node, evalCtx());
                }

                /* User-defined method call on any type (UDTs, primitives, etc.) */
                if (userFunctions[methodName]) {
                    var objLit2 = { type: '__resolved__', __resolvedValue__: methodObj, line: node.line, col: node.col };
                    var methodArgs = [objLit2].concat(node.args);
                    return execUserFunction(methodName, methodArgs, node);
                }
            }

            var callName = getCallName(node.callee);

            /* User-defined function */
            if (userFunctions[callName]) {
                return execUserFunction(callName, node.args, node);
            }

            /* Delegate to shared dispatchers */
            return FS.execCallDispatch(callName, node.args, node, evalCtx());
        }


        function execUserFunction(name, callArgs, node) {
            if (fnCallDepth > 50) {
                return {
                    __error__: {
                        line: node.line, col: node.col,
                        message: "Recursion limit exceeded calling '" + name + "'"
                    }
                };
            }
            var fn = userFunctions[name];

            var evaluatedArgs = [];
            for (var ai = 0; ai < callArgs.length; ai++) {
                var a = callArgs[ai];
                var v = execNode(a.type === 'NamedArg' ? a.value : a);
                if (v && v.__error__) return v;
                evaluatedArgs.push(v);
            }

            var savedBarVars = barVars;
            var localScope = {};
            for (var pi = 0; pi < fn.params.length; pi++) {
                localScope[fn.params[pi]] = pi < evaluatedArgs.length ? evaluatedArgs[pi] : FS.NA;
            }
            barVars = localScope;
            fnCallDepth++;

            var result;
            try {
                if (fn.body && fn.body.type === 'Block') {
                    result = FS.NA;
                    for (var bi = 0; bi < fn.body.body.length; bi++) {
                        result = execNode(fn.body.body[bi]);
                        if (result && result.__error__) break;
                    }
                } else {
                    result = execNode(fn.body);
                }
            } finally {
                barVars = savedBarVars;
                fnCallDepth--;
            }
            return result;
        }

        /* ── Plot / shape / bgcolor / hline ── */
        function execPlot(node) {
            var args = node.args || [];
            var series = args.length > 0 ? execNode(args[0].type === 'NamedArg' ? args[0].value : args[0]) : FS.NA;
            var label = '', color = '#2196F3', lineWidth = 1, dynamicColor = null, style = 'plot.style_line';

            for (var i = 0; i < args.length; i++) {
                var a = args[i];
                if (a.type === 'NamedArg') {
                    if (a.name === 'title') label = execNode(a.value);
                    if (a.name === 'color') {
                        var cv = execNode(a.value);
                        if (typeof cv === 'string') { dynamicColor = cv; color = cv; }
                    }
                    if (a.name === 'linewidth') lineWidth = execNode(a.value) || 1;
                    if (a.name === 'series') series = execNode(a.value);
                    if (a.name === 'style') style = execNode(a.value);
                } else if (i === 1 && a.type !== 'NamedArg') {
                    var v = execNode(a);
                    if (typeof v === 'string') label = v;
                }
            }

            var pid = plotCounter++;
            if (!plotRegistry[pid]) {
                plotRegistry[pid] = { label: label, values: new Array(N), colors: new Array(N), color: color, lineWidth: lineWidth, style: style };
            }
            plotRegistry[pid].values[barIndex] = series;
            plotRegistry[pid].colors[barIndex] = dynamicColor;

            return series;
        }

        function execPlotShape(node) {
            var args = node.args || [];
            var condition = args.length > 0 ? execNode(args[0].type === 'NamedArg' ? args[0].value : args[0]) : false;
            if (!condition || FS.isNa(condition)) return FS.NA;

            var style = 'triangleup', loc = 'belowbar', color = '#4CAF50', sz = 'small', title = '';
            var text = '', textcolor = '#2196F3';
            var price = FS.NA;

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
                    if (a.name === 'series') { condition = v; if (!condition) return FS.NA; }
                    if (a.name === 'price') price = v;
                }
            }

            if (FS.isNa(price)) {
                if (loc === 'abovebar') price = +curCandle.h;
                else if (loc === 'belowbar') price = +curCandle.l;
                else price = +curCandle.c;
            }

            shapes.push({
                barIndex: barIndex, price: price, style: style,
                location: loc, color: color, size: sz,
                title: title, text: text, textcolor: textcolor
            });
            return FS.NA;
        }

        function execBgcolor(node) {
            var args = node.args || [];
            var color = args.length > 0 ? execNode(args[0].type === 'NamedArg' ? args[0].value : args[0]) : FS.NA;
            if (!color || FS.isNa(color) || typeof color !== 'string') return FS.NA;
            bgcolors.push({ barIndex: barIndex, color: color });
            return FS.NA;
        }

        function execHline(node) {
            var args = node.args || [];
            var price = args.length > 0 ? execNode(args[0].type === 'NamedArg' ? args[0].value : args[0]) : FS.NA;
            if (FS.isNa(price)) return FS.NA;
            if (barIndex > 0) return FS.NA;

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
            return FS.NA;
        }

        /* ── Evaluation context for call dispatchers ── */
        function evalCtx() {
            return {
                execNode: execNode,
                getCallName: getCallName,
                ta: ta,
                barIndex: barIndex,
                curCandle: curCandle,
                prevCandle: prevCandle,
                N: N,
                inputs: inputs,
                inputOverrides: inputOverrides,
                persistentVars: persistentVars,
                nextLineId: function () { return nextLineId++; },
                nextLabelId: function () { return nextLabelId++; },
                nextTableId: function () { return nextTableId++; },
                nextBoxId: function () { return nextBoxId++; },
                max_lines_count: max_lines_count,
                max_labels_count: max_labels_count,
                max_boxes_count: max_boxes_count,
                lines: lines, labels: labels, tables: tables, boxes: boxes,
                fills: fills,
                isStrategy: isStrategy,
                stratCapital: stratCapital,
                stratCommission: stratCommission,
                stratDefaultQty: stratDefaultQty,
                positions: positions,
                closedTrades: closedTrades,
                userFunctions: userFunctions,
                fnCallDepth: fnCallDepth,
                typeRegistry: typeRegistry,
                _tfPeriod: _tfPeriod, _tfMultiplier: _tfMultiplier,
                _tfIsIntraday: _tfIsIntraday, _tfIsDaily: _tfIsDaily,
                _tfIsWeekly: _tfIsWeekly, _tfIsMonthly: _tfIsMonthly,
                _tfIsSeconds: _tfIsSeconds, _tfIsMinutes: _tfIsMinutes,
                _tfIsHours: _tfIsHours
            };
        }
    }

    function emptyResult() {
        return { plots: [], shapes: [], hlines: [], bgcolors: [], fills: [], inputs: [], lines: [], labels: [], tables: [], boxes: [], errors: [] };
    }

    /* ── Export ── */
    FS.evaluate = evaluate;

})(typeof window !== 'undefined' ? window : this);