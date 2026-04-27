/* ═══════════════════════════════════════════════════════════════
   FractalScript — Call Dispatchers
   
   Central dispatch for all built-in function calls during AST
   evaluation. Includes ta.* indicators, line.*, label.*, table.*,
   box.*, str.*, array.*, strategy.*, and general utility functions
   (na, nz, type casts, request.security, etc.).
   ═══════════════════════════════════════════════════════════════ */

(function (global) {
    'use strict';

    var FS = global.FractalScript || (global.FractalScript = {});

    /* Shared: index and named-arg helpers */
    function evalArg(args, idx, execFn) {
        if (idx >= args.length) return FS.NA;
        var a = args[idx];
        return execFn(a.type === 'NamedArg' ? a.value : a);
    }

    function getNamedArg(args, name, defIdx, execFn) {
        for (var i = 0; i < args.length; i++) {
            if (args[i].type === 'NamedArg' && args[i].name === name) {
                return execFn(args[i].value);
            }
        }
        if (defIdx !== undefined && defIdx < args.length && args[defIdx].type !== 'NamedArg') {
            return execFn(args[defIdx]);
        }
        return FS.NA;
    }

    /* Color transparency helper */
    function applyTransparency(color, transp) {
        if (FS.isNa(transp)) return color;
        var a = Math.max(0, Math.min(1, 1 - transp / 100));
        if (typeof color === 'string' && color[0] === '#') {
            var r = parseInt(color.slice(1, 3), 16);
            var g = parseInt(color.slice(3, 5), 16);
            var b = parseInt(color.slice(5, 7), 16);
            return 'rgba(' + r + ',' + g + ',' + b + ',' + a.toFixed(3) + ')';
        }
        return color;
    }

    /* str helper: convert value to display string */
    function toStr(v, fmt) {
        if (FS.isNa(v)) return 'NaN';
        if (typeof v === 'boolean') return v ? 'true' : 'false';
        if (typeof v === 'string') return v;
        var n = +v;
        if (isNaN(n)) return String(v);
        if (fmt !== undefined && fmt !== null && !FS.isNa(fmt)) {
            if (typeof fmt === 'number') return n.toFixed(Math.max(0, Math.round(fmt)));
            if (typeof fmt === 'string') {
                var decPart = fmt.split('.')[1] || '';
                var places = decPart.replace(/[^#0]/g, '').length;
                return n.toFixed(places);
            }
        }
        var s = n.toFixed(4);
        return s.replace(/\.?0+$/, '');
    }

    /* ══════════════════════════════════════════════════════════════
       MAIN DISPATCH
       ══════════════════════════════════════════════════════════════ */

    function execCallDispatch(callName, args, node, ctx) {
        var execFn = ctx.execNode;

        /* User-defined function (already checked in evaluator, but safety net) */
        if (ctx.userFunctions && ctx.userFunctions[callName]) {
            return {
                __error__: {
                    line: node.line, col: node.col,
                    message: "Internal error: user function '" + callName + "' not delegated properly"
                }
            };
        }

        /* line.* */
        if (callName.indexOf('line.') === 0) return execLineCall(callName, args, node, ctx);
        /* label.* */
        if (callName.indexOf('label.') === 0) return execLabelCall(callName, args, node, ctx);
        /* table.* */
        if (callName.indexOf('table.') === 0) return execTableCall(callName, args, node, ctx);
        /* box.* */
        if (callName.indexOf('box.') === 0) return execBoxCall(callName, args, node, ctx);
        /* str.* */
        if (callName.indexOf('str.') === 0) return execStrCall(callName, args, node, ctx);
        /* array.* */
        if (callName.indexOf('array.') === 0) return execArrayCall(callName, args, node, ctx);
        /* ta.* */
        if (callName.indexOf('ta.') === 0) return execTaCall(callName, args, node, ctx);
        /* strategy.* */
        if (callName.indexOf('strategy.') === 0) return execStrategyCall(callName, args, node, ctx);

        /* ai.* */
        if (callName.indexOf('ai.') === 0) {
            if (callName === 'ai.sentiment') {
                var c = ctx.curCandle.c, o = ctx.curCandle.o, h = ctx.curCandle.h, l = ctx.curCandle.l;
                return (c - o) / (h - l || 1);
            }
            if (callName === 'ai.structure') return Math.random();
            return FS.NA;
        }

        /* input.* */
        if (callName.indexOf('input.') === 0 || callName === 'input') {
            return execInputCall(callName, args, node, ctx);
        }

        /* math.* */
        if (callName.indexOf('math.') === 0) {
            var fnName = callName.replace('math.', '');
            var fn = FS.MATH[fnName];
            if (typeof fn === 'function') {
                var mathArgs = [];
                for (var i = 0; i < args.length; i++) {
                    var a = args[i];
                    var v = execFn(a.type === 'NamedArg' ? a.value : a);
                    if (v && v.__error__) return v;
                    if (FS.isNa(v)) return FS.NA;
                    mathArgs.push(v);
                }
                return fn.apply(null, mathArgs);
            }
            return FS.NA;
        }

        /* na() */
        if (callName === 'na') {
            if (args.length > 0) {
                var testVal = execFn(args[0].type === 'NamedArg' ? args[0].value : args[0]);
                return FS.isNa(testVal);
            }
            return FS.NA;
        }

        /* nz() */
        if (callName === 'nz') {
            var v1 = args[0] ? execFn(args[0].type === 'NamedArg' ? args[0].value : args[0]) : FS.NA;
            var v2 = args[1] ? execFn(args[1].type === 'NamedArg' ? args[1].value : args[1]) : 0;
            return FS.isNa(v1) ? v2 : v1;
        }

        /* Type casts */
        if (callName === 'int' || callName === 'float' || callName === 'bool' || callName === 'string') {
            var castVal = args[0] ? execFn(args[0].type === 'NamedArg' ? args[0].value : args[0]) : FS.NA;
            if (FS.isNa(castVal)) return FS.NA;
            if (callName === 'int') return Math.trunc(Number(castVal));
            if (callName === 'float') return Number(castVal);
            if (callName === 'bool') return !!castVal;
            if (callName === 'string') return String(castVal);
        }

        /* alert / alertcondition — no-op */
        if (callName === 'alertcondition' || callName === 'alert') return FS.NA;

        /* plotcandle — no-op */
        if (callName === 'plotcandle') return FS.NA;

        /* request.security / request.security_lower_tf — stub */
        if (callName === 'request.security' || callName === 'request.security_lower_tf') {
            if (args.length < 3) return FS.NA;
            var srcArg = args[2];
            return execFn(srcArg.type === 'NamedArg' ? srcArg.value : srcArg);
        }
        /* request.dividends/earnings/financial — no-op */
        if (callName.indexOf('request.') === 0) return FS.NA;

        /* fixnan */
        if (callName === 'fixnan') {
            var src = args[0] ? execFn(args[0].type === 'NamedArg' ? args[0].value : args[0]) : FS.NA;
            if (!FS.isNa(src)) { ctx.persistentVars['__fixnan__'] = src; return src; }
            return ctx.persistentVars['__fixnan__'] !== undefined ? ctx.persistentVars['__fixnan__'] : FS.NA;
        }

        /* Date/time decomposition functions */
        if (callName === 'year' || callName === 'month' || callName === 'dayofmonth' ||
            callName === 'dayofweek' || callName === 'hour' || callName === 'minute' ||
            callName === 'second' || callName === 'weekofyear') {
            var dtArg = args[0] ? execFn(args[0].type === 'NamedArg' ? args[0].value : args[0]) : (ctx.curCandle.t || 0);
            if (FS.isNa(dtArg)) return FS.NA;
            var _dt = new Date(dtArg);
            switch (callName) {
                case 'year': return _dt.getUTCFullYear();
                case 'month': return _dt.getUTCMonth() + 1;
                case 'dayofmonth': return _dt.getUTCDate();
                case 'dayofweek': return _dt.getUTCDay() + 1;
                case 'hour': return _dt.getUTCHours();
                case 'minute': return _dt.getUTCMinutes();
                case 'second': return _dt.getUTCSeconds();
                case 'weekofyear': {
                    var _jan1 = Date.UTC(_dt.getUTCFullYear(), 0, 1);
                    var _days = Math.floor((_dt.getTime() - _jan1) / 86400000);
                    return Math.ceil((_days + new Date(_jan1).getUTCDay() + 1) / 7);
                }
            }
        }

        /* timestamp(year, month, day, hour?, minute?, second?) */
        if (callName === 'timestamp') {
            var tsArgs = [];
            for (var ti = 0; ti < args.length; ti++) {
                var ta2 = args[ti];
                tsArgs.push(execFn(ta2.type === 'NamedArg' ? ta2.value : ta2));
            }
            var tsIdx = 0;
            if (tsArgs.length > 0 && typeof tsArgs[0] === 'string') tsIdx = 1;
            var _y = tsArgs[tsIdx], _mo = tsArgs[tsIdx + 1], _d = tsArgs[tsIdx + 2];
            var _h = tsArgs[tsIdx + 3], _mi = tsArgs[tsIdx + 4], _s = tsArgs[tsIdx + 5];
            if (FS.isNa(_y) || FS.isNa(_mo) || FS.isNa(_d)) return FS.NA;
            return Date.UTC(_y, _mo - 1, _d, FS.isNa(_h) ? 0 : _h, FS.isNa(_mi) ? 0 : _mi, FS.isNa(_s) ? 0 : _s);
        }

        /* color.new() */
        if (callName === 'color.new') {
            var cArgs = [];
            for (var ci = 0; ci < args.length; ci++) {
                var ca = args[ci];
                cArgs.push(execFn(ca.type === 'NamedArg' ? ca.value : ca));
            }
            if (cArgs.length >= 2 && typeof cArgs[0] === 'string') {
                return applyTransparency(cArgs[0], cArgs[1]);
            }
            return FS.NA;
        }

        return FS.NA;
    }

    /* ══════════════════════════════════════════════════════════════
       ta.* DISPATCH
       ══════════════════════════════════════════════════════════════ */

    function execTaCall(name, args, node, ctx) {
        var execFn = ctx.execNode;
        var ta = ctx.ta;
        var id = 'ta_' + node.line + '_' + node.col + '_' + name;

        function e(idx) { return evalArg(args, idx, execFn); }
        function n(aname, didx) { return getNamedArg(args, aname, didx, execFn); }

        switch (name) {
            case 'ta.sma': { var s = e(0), l = e(1); return FS.isNa(l) ? FS.NA : ta.sma(s, Math.round(l), id); }
            case 'ta.ema': { var s = e(0), l = e(1); return FS.isNa(l) ? FS.NA : ta.ema(s, Math.round(l), id); }
            case 'ta.rma': { var s = e(0), l = e(1); return FS.isNa(l) ? FS.NA : ta.rma(s, Math.round(l), id); }
            case 'ta.rsi': { var s = e(0), l = e(1); return FS.isNa(l) ? FS.NA : ta.rsi(s, Math.round(l), id); }
            case 'ta.wma': { var s = e(0), l = e(1); return FS.isNa(l) ? FS.NA : ta.wma(s, Math.round(l), id); }
            case 'ta.highest': { var s = e(0), l = e(1); return FS.isNa(l) ? FS.NA : ta.highest(s, Math.round(l), id); }
            case 'ta.lowest': { var s = e(0), l = e(1); return FS.isNa(l) ? FS.NA : ta.lowest(s, Math.round(l), id); }
            case 'ta.crossover': { var a = e(0), b = e(1); return ta.crossover(a, b, id); }
            case 'ta.crossunder': { var a = e(0), b = e(1); return ta.crossunder(a, b, id); }
            case 'ta.cross': { var a = e(0), b = e(1); return ta.crossover(a, b, id + '_o') || ta.crossunder(a, b, id + '_u'); }
            case 'ta.atr': {
                var lenA = e(0);
                if (FS.isNa(lenA)) return FS.NA;
                var pc = ctx.prevCandle ? +ctx.prevCandle.c : FS.NA;
                return ta.atr(+ctx.curCandle.h, +ctx.curCandle.l, +ctx.curCandle.c, pc, Math.round(lenA), id);
            }
            case 'ta.vwap': { var s = e(0); return ta.vwap(s, +ctx.curCandle.v, id); }
            case 'ta.macd': {
                var sM = e(0), fM = e(1), slM = e(2), sgM = e(3);
                if (FS.isNa(fM) || FS.isNa(slM) || FS.isNa(sgM)) return [FS.NA, FS.NA, FS.NA];
                return ta.macd(sM, Math.round(fM), Math.round(slM), Math.round(sgM), id);
            }
            case 'ta.stoch': {
                var sS = e(0), hS = e(1), lS = e(2), lenS = e(3);
                if (FS.isNa(lenS)) return FS.NA;
                return ta.stoch(sS, hS, lS, Math.round(lenS), id);
            }
            /* P5: Moving averages */
            case 'ta.hma': { var s = e(0), l = e(1); return FS.isNa(l) ? FS.NA : ta.hma(s, Math.round(l), id); }
            case 'ta.dema': { var s = e(0), l = e(1); return FS.isNa(l) ? FS.NA : ta.dema(s, Math.round(l), id); }
            case 'ta.tema': { var s = e(0), l = e(1); return FS.isNa(l) ? FS.NA : ta.tema(s, Math.round(l), id); }
            case 'ta.alma': { var s = e(0), l = e(1), o = e(2), sg = e(3); if (FS.isNa(l) || FS.isNa(o) || FS.isNa(sg)) return FS.NA; return ta.alma(s, Math.round(l), o, sg, id); }
            case 'ta.swma': { return ta.swma(e(0), id); }
            case 'ta.linreg': { var s = e(0), l = e(1), o = e(2); if (FS.isNa(l)) return FS.NA; return ta.linreg(s, Math.round(l), FS.isNa(o) ? 0 : Math.round(o), id); }
            /* P5: Oscillators */
            case 'ta.cci': { var s = e(0), l = e(1); return FS.isNa(l) ? FS.NA : ta.cci(s, Math.round(l), id); }
            case 'ta.mfi': { var l = e(0); if (FS.isNa(l)) return FS.NA; return ta.mfi(+ctx.curCandle.h, +ctx.curCandle.l, +ctx.curCandle.c, +ctx.curCandle.v || 0, Math.round(l), id); }
            case 'ta.wpr': { var l = e(0); if (FS.isNa(l)) return FS.NA; return ta.wpr(+ctx.curCandle.h, +ctx.curCandle.l, +ctx.curCandle.c, Math.round(l), id); }
            case 'ta.mom': { var s = e(0), l = e(1); return FS.isNa(l) ? FS.NA : ta.mom(s, Math.round(l), id); }
            case 'ta.roc': { var s = e(0), l = e(1); return FS.isNa(l) ? FS.NA : ta.roc(s, Math.round(l), id); }
            case 'ta.tsi': { var s = e(0), sh = e(1), lg = e(2); if (FS.isNa(sh) || FS.isNa(lg)) return FS.NA; return ta.tsi(s, Math.round(sh), Math.round(lg), id); }
            case 'ta.trix': { var s = e(0), l = e(1); return FS.isNa(l) ? FS.NA : ta.trix(s, Math.round(l), id); }
            case 'ta.cog': { var s = e(0), l = e(1); return FS.isNa(l) ? FS.NA : ta.cog(s, Math.round(l), id); }
            /* P5: Volatility */
            case 'ta.stdev': { var s = e(0), l = e(1), b = e(2); if (FS.isNa(l)) return FS.NA; return ta.stdev(s, Math.round(l), FS.isNa(b) ? true : !!b, id); }
            case 'ta.variance': { var s = e(0), l = e(1), b = e(2); if (FS.isNa(l)) return FS.NA; return ta.variance(s, Math.round(l), FS.isNa(b) ? true : !!b, id); }
            case 'ta.dev': { var s = e(0), l = e(1); return FS.isNa(l) ? FS.NA : ta.dev(s, Math.round(l), id); }
            case 'ta.bb': { var s = e(0), l = e(1), m = e(2); if (FS.isNa(l) || FS.isNa(m)) return [FS.NA, FS.NA, FS.NA]; return ta.bb(s, Math.round(l), m, id); }
            case 'ta.bbw': { var s = e(0), l = e(1), m = e(2); if (FS.isNa(l) || FS.isNa(m)) return FS.NA; return ta.bbw(s, Math.round(l), m, id); }
            case 'ta.kc': {
                var s = e(0), l = e(1), m = e(2), ut = e(3);
                if (FS.isNa(l) || FS.isNa(m)) return [FS.NA, FS.NA, FS.NA];
                var pc = ctx.prevCandle ? +ctx.prevCandle.c : FS.NA;
                return ta.kc(s, +ctx.curCandle.h, +ctx.curCandle.l, +ctx.curCandle.c, pc, Math.round(l), m, FS.isNa(ut) ? true : !!ut, id);
            }
            case 'ta.kcw': {
                var s = e(0), l = e(1), m = e(2), ut = e(3);
                if (FS.isNa(l) || FS.isNa(m)) return FS.NA;
                var pc = ctx.prevCandle ? +ctx.prevCandle.c : FS.NA;
                return ta.kcw(s, +ctx.curCandle.h, +ctx.curCandle.l, +ctx.curCandle.c, pc, Math.round(l), m, FS.isNa(ut) ? true : !!ut, id);
            }
            /* P5: Structure */
            case 'ta.pivothigh': {
                var s, lb, rb;
                if (args.length === 2) { s = +ctx.curCandle.h; lb = e(0); rb = e(1); }
                else { s = e(0); lb = e(1); rb = e(2); }
                if (FS.isNa(lb) || FS.isNa(rb)) return FS.NA;
                return ta.pivothigh(s, Math.round(lb), Math.round(rb), id);
            }
            case 'ta.pivotlow': {
                var s, lb, rb;
                if (args.length === 2) { s = +ctx.curCandle.l; lb = e(0); rb = e(1); }
                else { s = e(0); lb = e(1); rb = e(2); }
                if (FS.isNa(lb) || FS.isNa(rb)) return FS.NA;
                return ta.pivotlow(s, Math.round(lb), Math.round(rb), id);
            }
            case 'ta.supertrend': {
                var f = e(0), p = e(1);
                if (FS.isNa(f) || FS.isNa(p)) return [FS.NA, FS.NA];
                var pc = ctx.prevCandle ? +ctx.prevCandle.c : FS.NA;
                return ta.supertrend(+ctx.curCandle.h, +ctx.curCandle.l, +ctx.curCandle.c, pc, f, Math.round(p), id);
            }
            case 'ta.valuewhen': { var cnd = e(0), s = e(1), occ = e(2); return ta.valuewhen(!!cnd, s, FS.isNa(occ) ? 0 : Math.round(occ), id); }
            case 'ta.barssince': { var cnd = e(0); return ta.barssince(!!cnd, id); }
            /* P5: Change / aggregate */
            case 'ta.change': { var s = e(0), l = e(1); return ta.change(s, FS.isNa(l) ? 1 : Math.round(l), id); }
            case 'ta.cum': { return ta.cum(e(0), id); }
            case 'ta.tr': { var hg = e(0); var pc = ctx.prevCandle ? +ctx.prevCandle.c : FS.NA; return ta.tr(+ctx.curCandle.h, +ctx.curCandle.l, pc, FS.isNa(hg) ? true : !!hg); }
            case 'ta.rising': { var s = e(0), l = e(1); return FS.isNa(l) ? false : ta.rising(s, Math.round(l), id); }
            case 'ta.falling': { var s = e(0), l = e(1); return FS.isNa(l) ? false : ta.falling(s, Math.round(l), id); }
            /* P5: Statistical */
            case 'ta.correlation': { var a = e(0), b = e(1), l = e(2); return FS.isNa(l) ? FS.NA : ta.correlation(a, b, Math.round(l), id); }
            case 'ta.percentrank': { var s = e(0), l = e(1); return FS.isNa(l) ? FS.NA : ta.percentrank(s, Math.round(l), id); }
            case 'ta.median': { var s = e(0), l = e(1); return FS.isNa(l) ? FS.NA : ta.median(s, Math.round(l), id); }
            case 'ta.range': { var s = e(0), l = e(1); return FS.isNa(l) ? FS.NA : ta.range(s, Math.round(l), id); }
            default:
                return {
                    __error__: {
                        line: node.line, col: node.col,
                        message: "Unknown function '" + name + "' — not supported in this interpreter"
                    }
                };
        }
    }

    /* ══════════════════════════════════════════════════════════════
       line.* DISPATCH
       ══════════════════════════════════════════════════════════════ */

    function execLineCall(name, args, node, ctx) {
        var execFn = ctx.execNode;
        function e(idx) { return evalArg(args, idx, execFn); }
        function n(aname, didx) { return getNamedArg(args, aname, didx, execFn); }

        switch (name) {
            case 'line.new': {
                var x1 = Number(n('x1', 0)), y1 = Number(n('y1', 1));
                var x2 = Number(n('x2', 2)), y2 = Number(n('y2', 3));
                if (isNaN(x1) || isNaN(y1) || isNaN(x2) || isNaN(y2)) return FS.NA;
                var color = n('color', 4), width = n('width', 5);
                var style = n('style', 6), extend = n('extend', 7);
                var lObj = {
                    id: ctx.nextLineId(), x1: x1, y1: y1, x2: x2, y2: y2,
                    color: FS.isNa(color) ? '#c9a84c' : color,
                    width: FS.isNa(width) ? 1 : width,
                    style: FS.isNa(style) ? 'solid' : style,
                    extend: FS.isNa(extend) ? 'none' : extend
                };
                ctx.lines.push(lObj);
                if (ctx.lines.length > 500) ctx.lines.shift();
                return lObj;
            }
            case 'line.delete': {
                var l = e(0);
                if (l && l.id) {
                    for (var i = 0; i < ctx.lines.length; i++) {
                        if (ctx.lines[i].id === l.id) { ctx.lines.splice(i, 1); break; }
                    }
                }
                return FS.NA;
            }
            case 'line.set_xy1': { var l = e(0), x = e(1), y = e(2); if (l && l.id) { l.x1 = x; l.y1 = y; } return FS.NA; }
            case 'line.set_xy2': { var l = e(0), x = e(1), y = e(2); if (l && l.id) { l.x2 = x; l.y2 = y; } return FS.NA; }
            case 'line.set_color': { var l = e(0), c = e(1); if (l && l.id && !FS.isNa(c)) l.color = c; return FS.NA; }
            case 'line.set_width': { var l = e(0), w = e(1); if (l && l.id && !FS.isNa(w)) l.width = w; return FS.NA; }
            case 'line.get_x1': { var l = e(0); return (l && l.id) ? l.x1 : FS.NA; }
            case 'line.get_y1': { var l = e(0); return (l && l.id) ? l.y1 : FS.NA; }
            case 'line.get_x2': { var l = e(0); return (l && l.id) ? l.x2 : FS.NA; }
            case 'line.get_y2': { var l = e(0); return (l && l.id) ? l.y2 : FS.NA; }
            default:
                return { __error__: { line: node.line, col: node.col, message: "Unknown line function '" + name + "'" } };
        }
    }

    /* ══════════════════════════════════════════════════════════════
       label.* DISPATCH
       ══════════════════════════════════════════════════════════════ */

    function execLabelCall(name, args, node, ctx) {
        var execFn = ctx.execNode;
        function e(idx) { return evalArg(args, idx, execFn); }
        function n(aname, didx) { return getNamedArg(args, aname, didx, execFn); }

        switch (name) {
            case 'label.new': {
                var x = Number(n('x', 0)), y = Number(n('y', 1));
                if (isNaN(x) || isNaN(y)) return FS.NA;
                var text = n('text', 2), color = n('color', 3), style = n('style', 4);
                var textcolor = n('textcolor', 5), size = n('size', 6);
                var textalign = n('textalign', 7), tooltip = n('tooltip', 8);
                var lbl = {
                    id: ctx.nextLabelId(), x: x, y: y,
                    text: FS.isNa(text) ? '' : String(text),
                    color: FS.isNa(color) ? '#2196F3' : color,
                    textcolor: FS.isNa(textcolor) ? '#FFFFFF' : textcolor,
                    style: FS.isNa(style) ? 'label_down' : style,
                    size: FS.isNa(size) ? 'normal' : size,
                    textalign: FS.isNa(textalign) ? 'center' : textalign,
                    tooltip: FS.isNa(tooltip) ? '' : String(tooltip)
                };
                ctx.labels.push(lbl);
                if (ctx.labels.length > ctx.max_labels_count) ctx.labels.shift();
                return lbl;
            }
            case 'label.delete': {
                var lb = e(0);
                if (lb && lb.id) {
                    for (var i = 0; i < ctx.labels.length; i++) {
                        if (ctx.labels[i].id === lb.id) { ctx.labels.splice(i, 1); break; }
                    }
                }
                return FS.NA;
            }
            case 'label.set_text': { var lb = e(0), t = e(1); if (lb && lb.id) lb.text = FS.isNa(t) ? '' : String(t); return FS.NA; }
            case 'label.set_xy': { var lb = e(0), nx = e(1), ny = e(2); if (lb && lb.id && !FS.isNa(nx) && !FS.isNa(ny)) { lb.x = Number(nx); lb.y = Number(ny); } return FS.NA; }
            case 'label.set_x': { var lb = e(0), nx = e(1); if (lb && lb.id && !FS.isNa(nx)) lb.x = Number(nx); return FS.NA; }
            case 'label.set_y': { var lb = e(0), ny = e(1); if (lb && lb.id && !FS.isNa(ny)) lb.y = Number(ny); return FS.NA; }
            case 'label.set_color': { var lb = e(0), c = e(1); if (lb && lb.id && !FS.isNa(c)) lb.color = c; return FS.NA; }
            case 'label.set_textcolor': { var lb = e(0), tc = e(1); if (lb && lb.id && !FS.isNa(tc)) lb.textcolor = tc; return FS.NA; }
            case 'label.set_style': { var lb = e(0), s = e(1); if (lb && lb.id && !FS.isNa(s)) lb.style = s; return FS.NA; }
            case 'label.set_size': { var lb = e(0), sz = e(1); if (lb && lb.id && !FS.isNa(sz)) lb.size = sz; return FS.NA; }
            case 'label.get_x': { var lb = e(0); return (lb && lb.id) ? lb.x : FS.NA; }
            case 'label.get_y': { var lb = e(0); return (lb && lb.id) ? lb.y : FS.NA; }
            case 'label.get_text': { var lb = e(0); return (lb && lb.id) ? lb.text : FS.NA; }
            default:
                return { __error__: { line: node.line, col: node.col, message: "Unknown label function '" + name + "'" } };
        }
    }

    /* ══════════════════════════════════════════════════════════════
       table.* DISPATCH
       ══════════════════════════════════════════════════════════════ */

    function execTableCall(name, args, node, ctx) {
        var execFn = ctx.execNode;
        function e(idx) { return evalArg(args, idx, execFn); }
        function n(aname, didx) { return getNamedArg(args, aname, didx, execFn); }

        switch (name) {
            case 'table.new': {
                var position = n('position', 0), columns = Number(n('columns', 1)), rowsN = Number(n('rows', 2));
                if (isNaN(columns) || isNaN(rowsN)) return FS.NA;
                var tbgcolor = n('bgcolor', 3), tframeColor = n('frame_color', 4);
                var tframeWidth = n('frame_width', 5), tborderColor = n('border_color', 6), tborderWidth = n('border_width', 7);
                var tObj = {
                    id: ctx.nextTableId(),
                    position: FS.isNa(position) ? 'top_right' : position,
                    cols: columns, rows: rowsN,
                    bgcolor: FS.isNa(tbgcolor) ? null : tbgcolor,
                    frame_color: FS.isNa(tframeColor) ? null : tframeColor,
                    frame_width: FS.isNa(tframeWidth) ? 0 : tframeWidth,
                    border_color: FS.isNa(tborderColor) ? null : tborderColor,
                    border_width: FS.isNa(tborderWidth) ? 0 : tborderWidth,
                    cells: {}
                };
                ctx.tables.push(tObj);
                if (ctx.tables.length > 50) ctx.tables.shift();
                return tObj;
            }
            case 'table.delete': {
                var td = e(0);
                if (td && td.id) {
                    for (var i = 0; i < ctx.tables.length; i++) {
                        if (ctx.tables[i].id === td.id) { ctx.tables.splice(i, 1); break; }
                    }
                }
                return FS.NA;
            }
            case 'table.cell': {
                var tc = e(0), col = Number(e(1)), row = Number(e(2));
                if (!tc || !tc.id || isNaN(col) || isNaN(row)) return FS.NA;
                var cellText = n('text', 3), cellWidth = n('width', 4), cellHeight = n('height', 5);
                var cellTextColor = n('text_color', 6), cellHalign = n('text_halign', 7), cellValign = n('text_valign', 8);
                var cellBg = n('bgcolor', 9), cellTooltip = n('tooltip', 10), cellSize = n('text_size', 11);
                var key = col + ',' + row;
                tc.cells[key] = {
                    col: col, row: row,
                    text: FS.isNa(cellText) ? '' : String(cellText),
                    width: FS.isNa(cellWidth) ? 0 : cellWidth,
                    height: FS.isNa(cellHeight) ? 0 : cellHeight,
                    text_color: FS.isNa(cellTextColor) ? '#000000' : cellTextColor,
                    text_halign: FS.isNa(cellHalign) ? 'center' : cellHalign,
                    text_valign: FS.isNa(cellValign) ? 'center' : cellValign,
                    bgcolor: FS.isNa(cellBg) ? null : cellBg,
                    tooltip: FS.isNa(cellTooltip) ? '' : String(cellTooltip),
                    text_size: FS.isNa(cellSize) ? 'normal' : cellSize
                };
                return FS.NA;
            }
            case 'table.clear': {
                var tcl = e(0);
                if (!tcl || !tcl.id) return FS.NA;
                var sc = Number(e(1)), sr = Number(e(2));
                var ec = isNaN(Number(e(3))) ? sc : Number(e(3));
                var er = isNaN(Number(e(4))) ? sr : Number(e(4));
                if (isNaN(sc) || isNaN(sr)) { tcl.cells = {}; return FS.NA; }
                for (var cc = sc; cc <= ec; cc++)
                    for (var rr = sr; rr <= er; rr++)
                        delete tcl.cells[cc + ',' + rr];
                return FS.NA;
            }
            case 'table.set_bgcolor': { var t = e(0), c = e(1); if (t && t.id) t.bgcolor = FS.isNa(c) ? null : c; return FS.NA; }
            case 'table.set_frame_color': { var t = e(0), c = e(1); if (t && t.id) t.frame_color = FS.isNa(c) ? null : c; return FS.NA; }
            case 'table.set_border_color': { var t = e(0), c = e(1); if (t && t.id) t.border_color = FS.isNa(c) ? null : c; return FS.NA; }
            case 'table.set_position': { var t = e(0), p = e(1); if (t && t.id && !FS.isNa(p)) t.position = p; return FS.NA; }
            case 'table.cell_set_text': {
                var tct = e(0), ctc = Number(e(1)), ctr = Number(e(2)), ctx_ = e(3);
                if (tct && tct.id && !isNaN(ctc) && !isNaN(ctr)) {
                    var k = ctc + ',' + ctr;
                    if (!tct.cells[k]) tct.cells[k] = { col: ctc, row: ctr, text: '', text_color: '#000000', text_halign: 'center', text_valign: 'center', bgcolor: null, text_size: 'normal', width: 0, height: 0, tooltip: '' };
                    tct.cells[k].text = FS.isNa(ctx_) ? '' : String(ctx_);
                }
                return FS.NA;
            }
            case 'table.cell_set_bgcolor': {
                var tcb = e(0), cbc = Number(e(1)), cbr = Number(e(2)), cbx = e(3);
                if (tcb && tcb.id && !isNaN(cbc) && !isNaN(cbr)) {
                    var k2 = cbc + ',' + cbr;
                    if (!tcb.cells[k2]) tcb.cells[k2] = { col: cbc, row: cbr, text: '', text_color: '#000000', text_halign: 'center', text_valign: 'center', bgcolor: null, text_size: 'normal', width: 0, height: 0, tooltip: '' };
                    tcb.cells[k2].bgcolor = FS.isNa(cbx) ? null : cbx;
                }
                return FS.NA;
            }
            case 'table.cell_set_text_color': {
                var tctc = e(0), tcc = Number(e(1)), tcr = Number(e(2)), tcx = e(3);
                if (tctc && tctc.id && !isNaN(tcc) && !isNaN(tcr)) {
                    var k3 = tcc + ',' + tcr;
                    if (!tctc.cells[k3]) tctc.cells[k3] = { col: tcc, row: tcr, text: '', text_color: '#000000', text_halign: 'center', text_valign: 'center', bgcolor: null, text_size: 'normal', width: 0, height: 0, tooltip: '' };
                    tctc.cells[k3].text_color = FS.isNa(tcx) ? '#000000' : tcx;
                }
                return FS.NA;
            }
            case 'table.cell_set_text_halign': {
                var tcha = e(0), hac = Number(e(1)), har = Number(e(2)), hax = e(3);
                if (tcha && tcha.id && !isNaN(hac) && !isNaN(har)) {
                    var k4 = hac + ',' + har;
                    if (!tcha.cells[k4]) tcha.cells[k4] = { col: hac, row: har, text: '', text_color: '#000000', text_halign: 'center', text_valign: 'center', bgcolor: null, text_size: 'normal', width: 0, height: 0, tooltip: '' };
                    tcha.cells[k4].text_halign = FS.isNa(hax) ? 'center' : hax;
                }
                return FS.NA;
            }
            case 'table.cell_set_text_valign': {
                var tcva = e(0), vac = Number(e(1)), var_ = Number(e(2)), vax = e(3);
                if (tcva && tcva.id && !isNaN(vac) && !isNaN(var_)) {
                    var k5 = vac + ',' + var_;
                    if (!tcva.cells[k5]) tcva.cells[k5] = { col: vac, row: var_, text: '', text_color: '#000000', text_halign: 'center', text_valign: 'center', bgcolor: null, text_size: 'normal', width: 0, height: 0, tooltip: '' };
                    tcva.cells[k5].text_valign = FS.isNa(vax) ? 'center' : vax;
                }
                return FS.NA;
            }
            case 'table.cell_set_text_size': {
                var tcts = e(0), tsc = Number(e(1)), tsr = Number(e(2)), tsx = e(3);
                if (tcts && tcts.id && !isNaN(tsc) && !isNaN(tsr)) {
                    var k6 = tsc + ',' + tsr;
                    if (!tcts.cells[k6]) tcts.cells[k6] = { col: tsc, row: tsr, text: '', text_color: '#000000', text_halign: 'center', text_valign: 'center', bgcolor: null, text_size: 'normal', width: 0, height: 0, tooltip: '' };
                    tcts.cells[k6].text_size = FS.isNa(tsx) ? 'normal' : tsx;
                }
                return FS.NA;
            }
            case 'table.cell_set_tooltip': {
                var tctt = e(0), ttc = Number(e(1)), ttr = Number(e(2)), ttx = e(3);
                if (tctt && tctt.id && !isNaN(ttc) && !isNaN(ttr)) {
                    var k7 = ttc + ',' + ttr;
                    if (!tctt.cells[k7]) tctt.cells[k7] = { col: ttc, row: ttr, text: '', text_color: '#000000', text_halign: 'center', text_valign: 'center', bgcolor: null, text_size: 'normal', width: 0, height: 0, tooltip: '' };
                    tctt.cells[k7].tooltip = FS.isNa(ttx) ? '' : String(ttx);
                }
                return FS.NA;
            }
            default:
                return { __error__: { line: node.line, col: node.col, message: "Unknown table function '" + name + "'" } };
        }
    }

    /* ══════════════════════════════════════════════════════════════
       box.* DISPATCH
       ══════════════════════════════════════════════════════════════ */

    function execBoxCall(name, args, node, ctx) {
        var execFn = ctx.execNode;
        function e(idx) { return evalArg(args, idx, execFn); }
        function n(aname, didx) { return getNamedArg(args, aname, didx, execFn); }

        switch (name) {
            case 'box.new': {
                var left = Number(n('left', 0)), top = Number(n('top', 1));
                var right = Number(n('right', 2)), bottom = Number(n('bottom', 3));
                if (isNaN(left) || isNaN(top) || isNaN(right) || isNaN(bottom)) return FS.NA;
                var border_color = n('border_color', 4), border_width = n('border_width', 5);
                var border_style = n('border_style', 6), extend = n('extend', 7);
                var bgcolor = n('bgcolor', 8), text = n('text', 9);
                var text_size = n('text_size', 10), text_color = n('text_color', 11);
                var text_halign = n('text_halign', 12), text_valign = n('text_valign', 13);
                var b = {
                    id: ctx.nextBoxId(),
                    left: left, top: top, right: right, bottom: bottom,
                    border_color: FS.isNa(border_color) ? '#787B86' : border_color,
                    border_width: FS.isNa(border_width) ? 1 : border_width,
                    border_style: FS.isNa(border_style) ? 'solid' : border_style,
                    extend: FS.isNa(extend) ? 'none' : extend,
                    bgcolor: FS.isNa(bgcolor) ? 'rgba(120,123,134,0.2)' : bgcolor,
                    text: FS.isNa(text) ? '' : String(text),
                    text_size: FS.isNa(text_size) ? 'normal' : text_size,
                    text_color: FS.isNa(text_color) ? '#FFFFFF' : text_color,
                    text_halign: FS.isNa(text_halign) ? 'center' : text_halign,
                    text_valign: FS.isNa(text_valign) ? 'center' : text_valign
                };
                ctx.boxes.push(b);
                if (ctx.boxes.length > ctx.max_boxes_count) ctx.boxes.shift();
                return b;
            }
            case 'box.delete': {
                var bx = e(0);
                if (bx && bx.id) {
                    for (var i = 0; i < ctx.boxes.length; i++) {
                        if (ctx.boxes[i].id === bx.id) { ctx.boxes.splice(i, 1); break; }
                    }
                }
                return FS.NA;
            }
            case 'box.set_left': { var b = e(0), v = e(1); if (b && b.id && !FS.isNa(v)) b.left = Number(v); return FS.NA; }
            case 'box.set_top': { var b = e(0), v = e(1); if (b && b.id && !FS.isNa(v)) b.top = Number(v); return FS.NA; }
            case 'box.set_right': { var b = e(0), v = e(1); if (b && b.id && !FS.isNa(v)) b.right = Number(v); return FS.NA; }
            case 'box.set_bottom': { var b = e(0), v = e(1); if (b && b.id && !FS.isNa(v)) b.bottom = Number(v); return FS.NA; }
            case 'box.set_lefttop': { var b = e(0), x = e(1), y = e(2); if (b && b.id) { if (!FS.isNa(x)) b.left = Number(x); if (!FS.isNa(y)) b.top = Number(y); } return FS.NA; }
            case 'box.set_righttop': { var b = e(0), x = e(1), y = e(2); if (b && b.id) { if (!FS.isNa(x)) b.right = Number(x); if (!FS.isNa(y)) b.top = Number(y); } return FS.NA; }
            case 'box.set_leftbottom': { var b = e(0), x = e(1), y = e(2); if (b && b.id) { if (!FS.isNa(x)) b.left = Number(x); if (!FS.isNa(y)) b.bottom = Number(y); } return FS.NA; }
            case 'box.set_rightbottom': { var b = e(0), x = e(1), y = e(2); if (b && b.id) { if (!FS.isNa(x)) b.right = Number(x); if (!FS.isNa(y)) b.bottom = Number(y); } return FS.NA; }
            case 'box.set_border_color': { var b = e(0), c = e(1); if (b && b.id && !FS.isNa(c)) b.border_color = c; return FS.NA; }
            case 'box.set_border_width': { var b = e(0), w = e(1); if (b && b.id && !FS.isNa(w)) b.border_width = w; return FS.NA; }
            case 'box.set_border_style': { var b = e(0), s = e(1); if (b && b.id && !FS.isNa(s)) b.border_style = s; return FS.NA; }
            case 'box.set_bgcolor': { var b = e(0), c = e(1); if (b && b.id && !FS.isNa(c)) b.bgcolor = c; return FS.NA; }
            case 'box.set_extend': { var b = e(0), ex = e(1); if (b && b.id && !FS.isNa(ex)) b.extend = ex; return FS.NA; }
            case 'box.set_text': { var b = e(0), t = e(1); if (b && b.id) b.text = FS.isNa(t) ? '' : String(t); return FS.NA; }
            case 'box.set_text_color': { var b = e(0), c = e(1); if (b && b.id && !FS.isNa(c)) b.text_color = c; return FS.NA; }
            case 'box.set_text_size': { var b = e(0), s = e(1); if (b && b.id && !FS.isNa(s)) b.text_size = s; return FS.NA; }
            case 'box.set_text_halign': { var b = e(0), h = e(1); if (b && b.id && !FS.isNa(h)) b.text_halign = h; return FS.NA; }
            case 'box.set_text_valign': { var b = e(0), v = e(1); if (b && b.id && !FS.isNa(v)) b.text_valign = v; return FS.NA; }
            case 'box.get_left': { var b = e(0); return (b && b.id) ? b.left : FS.NA; }
            case 'box.get_top': { var b = e(0); return (b && b.id) ? b.top : FS.NA; }
            case 'box.get_right': { var b = e(0); return (b && b.id) ? b.right : FS.NA; }
            case 'box.get_bottom': { var b = e(0); return (b && b.id) ? b.bottom : FS.NA; }
            default:
                return { __error__: { line: node.line, col: node.col, message: "Unknown box function '" + name + "'" } };
        }
    }

    /* ══════════════════════════════════════════════════════════════
       str.* DISPATCH
       ══════════════════════════════════════════════════════════════ */

    function execStrCall(name, args, node, ctx) {
        var execFn = ctx.execNode;
        function e(idx) { return evalArg(args, idx, execFn); }

        switch (name) {
            case 'str.tostring': {
                var v = e(0), fmt = args.length > 1 ? e(1) : undefined;
                return toStr(v, fmt);
            }
            case 'str.format': {
                var template = e(0);
                if (FS.isNa(template) || typeof template !== 'string') return FS.NA;
                var result = template;
                for (var fi = 1; fi < args.length; fi++) {
                    var fv = e(fi);
                    result = result.split('{' + (fi - 1) + '}').join(toStr(fv));
                }
                return result;
            }
            case 'str.length': { var s = e(0); return (FS.isNa(s) || typeof s !== 'string') ? FS.NA : s.length; }
            case 'str.substring': { var s = e(0), from = e(1), to = e(2); if (FS.isNa(s) || typeof s !== 'string' || FS.isNa(from)) return FS.NA; return FS.isNa(to) ? s.substring(+from) : s.substring(+from, +to); }
            case 'str.contains': { var s = e(0), sub = e(1); if (FS.isNa(s) || FS.isNa(sub)) return FS.NA; return String(s).indexOf(String(sub)) >= 0; }
            case 'str.startswith': { var s = e(0), pre = e(1); if (FS.isNa(s) || FS.isNa(pre)) return FS.NA; return String(s).indexOf(String(pre)) === 0; }
            case 'str.endswith': { var s = e(0), suf = e(1); if (FS.isNa(s) || FS.isNa(suf)) return FS.NA; var str4 = String(s), suf4 = String(suf); return str4.lastIndexOf(suf4) === str4.length - suf4.length; }
            case 'str.lower': { var s = e(0); return FS.isNa(s) ? FS.NA : String(s).toLowerCase(); }
            case 'str.upper': { var s = e(0); return FS.isNa(s) ? FS.NA : String(s).toUpperCase(); }
            case 'str.replace': { var s = e(0), pat = e(1), rep = e(2); if (FS.isNa(s) || FS.isNa(pat) || FS.isNa(rep)) return FS.NA; return String(s).split(String(pat)).join(String(rep)); }
            default:
                return { __error__: { line: node.line, col: node.col, message: "Unknown str function '" + name + "'" } };
        }
    }

    /* ══════════════════════════════════════════════════════════════
       array.* DISPATCH
       ══════════════════════════════════════════════════════════════ */

    function execArrayCall(name, args, node, ctx) {
        var execFn = ctx.execNode;
        function e(idx) { return evalArg(args, idx, execFn); }

        switch (name) {
            case 'array.new':
            case 'array.new_int':
            case 'array.new_float':
            case 'array.new_bool':
            case 'array.new_string':
            case 'array.new_label':
            case 'array.new_line':
            case 'array.new_box':
            case 'array.new_table':
            case 'array.new_color': {
                var size = e(0), initial = e(1);
                var arr = [];
                if (!FS.isNa(size) && size > 0) {
                    for (var i = 0; i < size; i++) arr.push(FS.isNa(initial) ? FS.NA : initial);
                }
                return arr;
            }
            case 'array.push': { var a = e(0), v = e(1); if (Array.isArray(a)) a.push(v); return FS.NA; }
            case 'array.pop': { var a = e(0); if (Array.isArray(a) && a.length > 0) return a.pop(); return FS.NA; }
            case 'array.shift': { var a = e(0); if (Array.isArray(a) && a.length > 0) return a.shift(); return FS.NA; }
            case 'array.unshift': { var a = e(0), v = e(1); if (Array.isArray(a)) a.unshift(v); return FS.NA; }
            case 'array.set': { var a = e(0), idx = e(1), v = e(2); if (Array.isArray(a) && !FS.isNa(idx) && idx >= 0 && idx < a.length) a[idx] = v; return FS.NA; }
            case 'array.get': { var a = e(0), idx = e(1); if (Array.isArray(a) && !FS.isNa(idx) && idx >= 0 && idx < a.length) return a[idx]; return FS.NA; }
            case 'array.size': { var a = e(0); return Array.isArray(a) ? a.length : FS.NA; }
            case 'array.clear': { var a = e(0); if (Array.isArray(a)) a.length = 0; return FS.NA; }
            case 'array.slice': { var a = e(0), from = e(1), to = e(2); return Array.isArray(a) ? a.slice(FS.isNa(from) ? 0 : from, FS.isNa(to) ? a.length : to) : []; }
            case 'array.insert': { var a = e(0), idx = e(1), v = e(2); if (Array.isArray(a) && !FS.isNa(idx)) a.splice(Math.max(0, idx), 0, v); return FS.NA; }
            case 'array.remove': { var a = e(0), idx = e(1); if (Array.isArray(a) && !FS.isNa(idx) && idx >= 0 && idx < a.length) return a.splice(idx, 1)[0]; return FS.NA; }
            case 'array.sum': { var a = e(0); if (!Array.isArray(a)) return FS.NA; var sum = 0; for (var i = 0; i < a.length; i++) if (!FS.isNa(a[i])) sum += a[i]; return sum; }
            case 'array.avg': { var a = e(0); if (!Array.isArray(a)) return FS.NA; var sum = 0, cnt = 0; for (var i = 0; i < a.length; i++) { if (!FS.isNa(a[i])) { sum += a[i]; cnt++; } } return cnt > 0 ? sum / cnt : FS.NA; }
            case 'array.max': { var a = e(0); if (!Array.isArray(a)) return FS.NA; var max = -Infinity; for (var i = 0; i < a.length; i++) { if (!FS.isNa(a[i]) && a[i] > max) max = a[i]; } return max === -Infinity ? FS.NA : max; }
            case 'array.min': { var a = e(0); if (!Array.isArray(a)) return FS.NA; var min = Infinity; for (var i = 0; i < a.length; i++) { if (!FS.isNa(a[i]) && a[i] < min) min = a[i]; } return min === Infinity ? FS.NA : min; }
            case 'array.sort': {
                var a = e(0), order = e(1);
                if (Array.isArray(a)) {
                    a.sort(function (a2, b2) {
                        if (FS.isNa(a2)) return 1; if (FS.isNa(b2)) return -1;
                        return (order === 'order.descending' || order === 'descending') ? b2 - a2 : a2 - b2;
                    });
                }
                return FS.NA;
            }
            case 'array.indexof': { var a = e(0), v = e(1); return Array.isArray(a) ? a.indexOf(v) : -1; }
            case 'array.includes': { var a = e(0), v = e(1); return Array.isArray(a) ? a.indexOf(v) !== -1 : false; }
            case 'array.reverse': { var a = e(0); if (Array.isArray(a)) a.reverse(); return FS.NA; }
            default:
                return { __error__: { line: node.line, col: node.col, message: "Unknown array function '" + name + "'" } };
        }
    }

    /* ══════════════════════════════════════════════════════════════
       input.* DISPATCH
       ══════════════════════════════════════════════════════════════ */

    function execInputCall(name, args, node, ctx) {
        var execFn = ctx.execNode;
        var title = '';
        var defVal = FS.NA;
        for (var i = 0; i < args.length; i++) {
            var a = args[i];
            if (a.type === 'NamedArg') {
                if (a.name === 'title') title = execFn(a.value);
                if (a.name === 'defval') defVal = execFn(a.value);
            } else if (i === 0) {
                defVal = execFn(a);
            } else if (i === 1 && a.type === 'StrLiteral') {
                title = a.value;
            }
        }
        for (var j = 0; j < ctx.inputs.length; j++) {
            if (ctx.inputs[j].name === title || (title === '' && j === ctx.inputs.length - 1)) {
                return ctx.inputs[j].value !== undefined ? ctx.inputs[j].value : defVal;
            }
        }
        return defVal;
    }

    /* ══════════════════════════════════════════════════════════════
       strategy.* DISPATCH
       ══════════════════════════════════════════════════════════════ */

    function execStrategyCall(name, args, node, ctx) {
        var execFn = ctx.execNode;
        function e(idx) { return evalArg(args, idx, execFn); }
        function n(aname, didx) { return getNamedArg(args, aname, didx, execFn); }

        var ec = +ctx.curCandle.c;

        switch (name) {
            case 'strategy.entry': {
                var id = e(0);
                var dir = n('direction', 1) || 'long';
                var qty = n('qty', -1);
                if (FS.isNa(qty)) qty = ctx.stratDefaultQty;
                if (!id) return FS.NA;
                /* Auto-reversal */
                for (var _ek in ctx.positions) {
                    if (ctx.positions[_ek].direction !== dir) {
                        var _ep = ctx.positions[_ek];
                        var _epnl = (_ep.direction === 'long' ? ec - _ep.entryPrice : _ep.entryPrice - ec) * _ep.qty;
                        var _ecom = ctx.stratCommission * ec * _ep.qty / 100;
                        _epnl -= (_ep.commission + _ecom);
                        ctx.closedTrades.push({ id: _ek, direction: _ep.direction, entryBar: _ep.entryBar, entryPrice: _ep.entryPrice, exitBar: ctx.barIndex, exitPrice: ec, profit: _epnl, qty: _ep.qty });
                        delete ctx.positions[_ek];
                    }
                }
                if (ctx.positions[id]) return FS.NA;
                var com = ctx.stratCommission * ec * qty / 100;
                ctx.positions[id] = { direction: dir, qty: qty, entryPrice: ec, entryClose: ec, entryBar: ctx.barIndex, commission: com };
                return FS.NA;
            }
            case 'strategy.close': {
                var cid = e(0) || n('id', 0);
                if (!cid || !ctx.positions[cid]) return FS.NA;
                var pos = ctx.positions[cid];
                var xc = ec;
                var pnl = (pos.direction === 'long' ? xc - pos.entryPrice : pos.entryPrice - xc) * pos.qty;
                var xcom = ctx.stratCommission * xc * pos.qty / 100;
                pnl -= (pos.commission + xcom);
                ctx.closedTrades.push({ id: cid, direction: pos.direction, entryBar: pos.entryBar, entryPrice: pos.entryPrice, exitBar: ctx.barIndex, exitPrice: xc, profit: pnl, qty: pos.qty });
                delete ctx.positions[cid];
                return FS.NA;
            }
            case 'strategy.exit': {
                var eid = e(0) || n('id', 0);
                var fromId = n('from_entry', -1);
                if (FS.isNa(fromId)) fromId = eid;
                var tp = n('profit', -1);
                var sl = n('loss', -1);
                if (FS.isNa(tp)) tp = FS.NA; else tp = +tp;
                if (FS.isNa(sl)) sl = FS.NA; else sl = +sl;
                if (!fromId || !ctx.positions[fromId]) return FS.NA;
                var epos = ctx.positions[fromId];
                var hi = +ctx.curCandle.h, lo = +ctx.curCandle.l, op = +ctx.curCandle.o, cl = +ctx.curCandle.c;
                var tpPrice = FS.NA, slPrice = FS.NA;
                if (!FS.isNa(tp)) tpPrice = epos.direction === 'long' ? epos.entryPrice + tp : epos.entryPrice - tp;
                if (!FS.isNa(sl)) slPrice = epos.direction === 'long' ? epos.entryPrice - sl : epos.entryPrice + sl;
                var tpHit = !FS.isNa(tpPrice) && (epos.direction === 'long' ? hi >= tpPrice : lo <= tpPrice);
                var slHit = !FS.isNa(slPrice) && (epos.direction === 'long' ? lo <= slPrice : hi >= slPrice);
                var triggered = false, exitPrice = cl;
                if (tpHit && slHit) {
                    var greenPath = cl >= op;
                    if (epos.direction === 'long') {
                        if (greenPath) { exitPrice = slPrice; } else { exitPrice = tpPrice; }
                    } else {
                        if (greenPath) { exitPrice = tpPrice; } else { exitPrice = slPrice; }
                    }
                    triggered = true;
                } else if (tpHit) {
                    exitPrice = tpPrice; triggered = true;
                } else if (slHit) {
                    exitPrice = slPrice; triggered = true;
                }
                if (!triggered) return FS.NA;
                var epnl = (epos.direction === 'long' ? exitPrice - epos.entryPrice : epos.entryPrice - exitPrice) * epos.qty;
                var ecom = ctx.stratCommission * exitPrice * epos.qty / 100;
                epnl -= (epos.commission + ecom);
                ctx.closedTrades.push({ id: fromId, direction: epos.direction, entryBar: epos.entryBar, entryPrice: epos.entryPrice, exitBar: ctx.barIndex, exitPrice: exitPrice, profit: epnl, qty: epos.qty });
                delete ctx.positions[fromId];
                return FS.NA;
            }
            case 'strategy.cancel': {
                var cancelId = e(0) || n('id', 0);
                if (cancelId && ctx.positions[cancelId]) delete ctx.positions[cancelId];
                return FS.NA;
            }
            default: return FS.NA;
        }
    }

    /* ── Export ── */
    FS.execCallDispatch = execCallDispatch;

})(typeof window !== 'undefined' ? window : this);