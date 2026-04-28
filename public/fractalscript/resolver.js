/* ═══════════════════════════════════════════════════════════════
   FractalScript — Namespace Resolver
   
   Resolves member access expressions (obj.member) and time-field
   identifiers against the FractalScript namespace constants
   (color.*, shape.*, location.*, size.*, math.*, etc.) and
   runtime state (barstate.*, timeframe.*, strategy.*, etc.).
   ═══════════════════════════════════════════════════════════════ */

(function (global) {
    'use strict';

    var FS = global.FractalScript || (global.FractalScript = {});

    /* Time-field resolution (shared between evaluator's resolveVar and execCall for date functions) */
    function resolveTimeField(name, curCandle) {
        var _dt = new Date(curCandle.t || 0);
        switch (name) {
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
            default: return FS.NA;
        }
    }

    /* Member access resolution */
    function resolveMember(obj, member, ctx) {
        /* Namespace resolution */
        if (obj === 'color') return FS.COLORS[member] !== undefined ? FS.COLORS[member] : FS.NA;
        if (obj === 'shape') return FS.SHAPES[member] || FS.NA;
        if (obj === 'location') return FS.LOCATIONS[member] || FS.NA;
        if (obj === 'size') return FS.SIZES[member] || FS.NA;
        if (obj === 'math') return FS.MATH[member] !== undefined ? FS.MATH[member] : FS.NA;
        if (obj === 'ta') return 'ta.' + member;
        if (obj === 'input') return 'input.' + member;
        if (obj === 'line') return FS.LINE_STYLES[member] || 'line.' + member;
        if (obj === 'label') return FS.LABEL_STYLES[member] || 'label.' + member;
        if (obj === 'box') return FS.BOX_STYLES[member] || 'box.' + member;
        if (obj === 'str') return 'str.' + member;
        if (obj === 'extend') return FS.EXTEND_MODES[member] || 'extend.' + member;
        if (obj === 'hline') return 'hline.' + member;

        /* syminfo.* */
        if (obj === 'syminfo') {
            var _sym = (ctx.inputOverrides && ctx.inputOverrides.symbol) ? String(ctx.inputOverrides.symbol) : null;
            switch (member) {
                case 'tickerid': return _sym ? _sym : 'UNKNOWN:UNKNOWN';
                case 'ticker': return _sym ? _sym.split(':').pop() : 'UNKNOWN';
                case 'prefix': return '';
                case 'mintick': return 0.01;
                case 'pointvalue': return 1;
                case 'currency': return 'USD';
                case 'basecurrency': return 'USD';
                case 'description': return '';
                case 'type': return 'crypto';
                case 'session': return 'regular';
                case 'timezone': return 'UTC';
                default: return FS.NA;
            }
        }

        /* barmerge.* */
        if (obj === 'barmerge') {
            switch (member) {
                case 'gaps_on': return 'gaps_on';
                case 'gaps_off': return 'gaps_off';
                case 'lookahead_on': return 'lookahead_on';
                case 'lookahead_off': return 'lookahead_off';
                default: return FS.NA;
            }
        }

        /* plot.* */
        if (obj === 'plot') return 'plot.' + member;

        /* order.* */
        if (obj === 'order') {
            switch (member) {
                case 'ascending': return 'ascending';
                case 'descending': return 'descending';
                default: return 'order.' + member;
            }
        }

        /* strategy.* */
        if (obj === 'strategy') {
            switch (member) {
                case 'long': return 'long';
                case 'short': return 'short';
                case 'position_size': {
                    var _sz = 0;
                    for (var _k in ctx.positions) {
                        if (ctx.positions[_k].direction === 'long') _sz += ctx.positions[_k].qty;
                        else _sz -= ctx.positions[_k].qty;
                    }
                    return _sz;
                }
                case 'opentrades': return Object.keys(ctx.positions).length;
                case 'closedtrades': return ctx.closedTrades.length;
                case 'equity': return ctx.equityCurve.length > 0 ? ctx.equityCurve[ctx.equityCurve.length - 1] : ctx.stratCapital;
                case 'netprofit': {
                    var _np = 0;
                    for (var _nt = 0; _nt < ctx.closedTrades.length; _nt++) _np += ctx.closedTrades[_nt].profit;
                    return _np;
                }
                case 'initial_capital': return ctx.stratCapital;
                default: return FS.NA;
            }
        }

        if (obj === 'position') return FS.POSITIONS[member] || member;
        if (obj === 'text') return FS.TEXT_ALIGN[member] || member;
        if (obj === 'table') return 'table.' + member;
        if (obj === 'map') return 'map.' + member;

        /* UDT field access */
        if (obj && typeof obj === 'object' && !obj.__fractal_na__ && obj.__type__) {
            if (obj.hasOwnProperty(member)) return obj[member];
            var tdef = ctx.typeRegistry[obj.__type__];
            if (tdef) {
                for (var fi = 0; fi < tdef.fields.length; fi++) {
                    if (tdef.fields[fi].name === member) {
                        if (tdef.fields[fi].def) return ctx.execNode ? ctx.execNode(tdef.fields[fi].def) : FS.NA;
                        return FS.NA;
                    }
                }
            }
            return FS.NA;
        }

        /* barstate.* */
        if (obj === 'barstate') {
            switch (member) {
                case 'isfirst': return ctx.barIndex === 0;
                case 'islast': return ctx.barIndex === ctx.N - 1;
                case 'isconfirmed': return ctx.barIndex < ctx.N - 1;
                case 'isnew': return true;
                case 'isrealtime': return false;
                case 'ishistory': return true;
                case 'islastconfirmedhistory': return ctx.barIndex === ctx.N - 2;
                default: return FS.NA;
            }
        }

        /* timeframe.* */
        if (obj === 'timeframe') {
            switch (member) {
                case 'period': return (ctx.inputOverrides && ctx.inputOverrides.timeframe) ? String(ctx.inputOverrides.timeframe) : ctx._tfPeriod;
                case 'multiplier': return ctx._tfMultiplier;
                case 'isintraday': return ctx._tfIsIntraday;
                case 'isdaily': return ctx._tfIsDaily;
                case 'isweekly': return ctx._tfIsWeekly;
                case 'ismonthly': return ctx._tfIsMonthly;
                case 'isseconds': return ctx._tfIsSeconds;
                case 'isminutes': return ctx._tfIsMinutes;
                case 'ishours': return ctx._tfIsHours;
                case 'isdwm': return ctx._tfIsDaily || ctx._tfIsWeekly || ctx._tfIsMonthly;
                default: return FS.NA;
            }
        }

        return FS.NA;
    }

    /* ── Export ── */
    FS.resolveTimeField = resolveTimeField;
    FS.resolveMember = resolveMember;

})(typeof window !== 'undefined' ? window : this);