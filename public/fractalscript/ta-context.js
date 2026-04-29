/* ═══════════════════════════════════════════════════════════════
   FractalScript — ta.* Technical Analysis Helpers
   
   Stateful per-run caches for ta.sma/ema/rma/rsi/macd/stoch/atr/
   crossover/crossunder/highest/lowest and many more indicators.
   Each function gets a cache keyed by a unique call-site ID.
   ═══════════════════════════════════════════════════════════════ */

(function (global) {
    'use strict';

    var FS = global.FractalScript || (global.FractalScript = {});

    function createTaContext() {
        var callCounter = 0;
        var caches = {};

        function getCache(id, init) {
            if (!caches[id]) caches[id] = init();
            return caches[id];
        }

        function nextId() { return ++callCounter; }

        var ta = {
            reset: function () { callCounter = 0; caches = {}; },
            resetCounter: function () { callCounter = 0; },

            sma: function (source, length, id) {
                var c = getCache(id, function () { return { sum: 0, buf: [], ready: false }; });
                if (FS.isNa(source)) return FS.NA;
                c.buf.push(source);
                c.sum += source;
                if (c.buf.length > length) { c.sum -= c.buf.shift(); }
                return c.buf.length >= length ? c.sum / length : FS.NA;
            },

            ema: function (source, length, id) {
                var c = getCache(id, function () { return { prev: FS.NA, count: 0, sum: 0 }; });
                if (FS.isNa(source)) return FS.isNa(c.prev) ? FS.NA : c.prev;
                c.count++;
                if (c.count <= length) {
                    c.sum += source;
                    if (c.count === length) { c.prev = c.sum / length; return c.prev; }
                    return FS.NA;
                }
                var k = 2 / (length + 1);
                c.prev = source * k + c.prev * (1 - k);
                return c.prev;
            },

            rma: function (source, length, id) {
                var c = getCache(id, function () { return { prev: FS.NA, count: 0, sum: 0 }; });
                if (FS.isNa(source)) return FS.isNa(c.prev) ? FS.NA : c.prev;
                c.count++;
                if (c.count <= length) {
                    c.sum += source;
                    if (c.count === length) { c.prev = c.sum / length; return c.prev; }
                    return FS.NA;
                }
                var alpha = 1 / length;
                c.prev = alpha * source + (1 - alpha) * c.prev;
                return c.prev;
            },

            wma: function (source, length, id) {
                var c = getCache(id, function () { return { buf: [] }; });
                if (FS.isNa(source)) return FS.NA;
                c.buf.push(source);
                if (c.buf.length > length) c.buf.shift();
                if (c.buf.length < length) return FS.NA;
                var sum = 0, weightSum = 0;
                for (var i = 0; i < length; i++) {
                    var w = (i + 1);
                    sum += c.buf[i] * w;
                    weightSum += w;
                }
                return sum / weightSum;
            },

            rsi: function (source, length, id) {
                var c = getCache(id, function () { return { prevSrc: FS.NA, gains: [], losses: [], lastAvgGain: FS.NA, lastAvgLoss: FS.NA, count: 0 }; });
                if (FS.isNa(source)) return FS.NA;
                if (FS.isNa(c.prevSrc)) { c.prevSrc = source; return FS.NA; }
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
                    return FS.NA;
                }
                c.lastAvgGain = (c.lastAvgGain * (length - 1) + gain) / length;
                c.lastAvgLoss = (c.lastAvgLoss * (length - 1) + loss) / length;
                var rs2 = c.lastAvgLoss === 0 ? 100 : c.lastAvgGain / c.lastAvgLoss;
                return 100 - (100 / (1 + rs2));
            },

            macd: function (source, fast, slow, sig, id) {
                var m_id = id + '_m', s_id = id + '_s';
                var fastEma = this.ema(source, fast, m_id + '_f');
                var slowEma = this.ema(source, slow, m_id + '_s');
                if (FS.isNa(fastEma) || FS.isNa(slowEma)) return [FS.NA, FS.NA, FS.NA];
                var macdLine = fastEma - slowEma;
                var signalLine = this.ema(macdLine, sig, s_id);
                if (FS.isNa(signalLine)) return [macdLine, FS.NA, FS.NA];
                return [macdLine, signalLine, macdLine - signalLine];
            },

            stoch: function (source, high, low, length, id) {
                var c = getCache(id, function () { return { hBuf: [], lBuf: [] }; });
                if (FS.isNa(source) || FS.isNa(high) || FS.isNa(low)) return FS.NA;
                c.hBuf.push(high); c.lBuf.push(low);
                if (c.hBuf.length > length) { c.hBuf.shift(); c.lBuf.shift(); }
                if (c.hBuf.length < length) return FS.NA;
                var highest = -Infinity, lowest = Infinity;
                for (var i = 0; i < length; i++) {
                    if (c.hBuf[i] > highest) highest = c.hBuf[i];
                    if (c.lBuf[i] < lowest) lowest = c.lBuf[i];
                }
                if (highest === lowest) return 100;
                return 100 * (source - lowest) / (highest - lowest);
            },

            atr: function (high, low, close, prevClose, length, id) {
                var tr;
                if (FS.isNa(prevClose)) {
                    tr = FS.isNa(high) || FS.isNa(low) ? FS.NA : high - low;
                } else {
                    if (FS.isNa(high) || FS.isNa(low)) { tr = FS.NA; }
                    else { tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose)); }
                }
                return this.rma(tr, length, id + '_rma');
            },

            vwap: function (source, volume, id) {
                var c = getCache(id, function () { return { sumPV: 0, sumV: 0 }; });
                if (FS.isNa(source) || FS.isNa(volume)) return FS.NA;
                c.sumPV += (source * volume);
                c.sumV += volume;
                return c.sumV === 0 ? FS.NA : c.sumPV / c.sumV;
            },

            crossover: function (a, b, id) {
                var c = getCache(id, function () { return { prevA: FS.NA, prevB: FS.NA }; });
                if (FS.isNa(a) || FS.isNa(b) || FS.isNa(c.prevA) || FS.isNa(c.prevB)) {
                    c.prevA = a; c.prevB = b;
                    return false;
                }
                var result = c.prevA <= c.prevB && a > b;
                c.prevA = a; c.prevB = b;
                return result;
            },

            crossunder: function (a, b, id) {
                var c = getCache(id, function () { return { prevA: FS.NA, prevB: FS.NA }; });
                if (FS.isNa(a) || FS.isNa(b) || FS.isNa(c.prevA) || FS.isNa(c.prevB)) {
                    c.prevA = a; c.prevB = b;
                    return false;
                }
                var result = c.prevA >= c.prevB && a < b;
                c.prevA = a; c.prevB = b;
                return result;
            },

            highest: function (source, length, id) {
                var c = getCache(id, function () { return { buf: [] }; });
                if (FS.isNa(source)) return FS.NA;
                c.buf.push(source);
                if (c.buf.length > length) c.buf.shift();
                var max = -Infinity;
                for (var i = 0; i < c.buf.length; i++) {
                    if (!FS.isNa(c.buf[i]) && c.buf[i] > max) max = c.buf[i];
                }
                return max === -Infinity ? FS.NA : max;
            },

            lowest: function (source, length, id) {
                var c = getCache(id, function () { return { buf: [] }; });
                if (FS.isNa(source)) return FS.NA;
                c.buf.push(source);
                if (c.buf.length > length) c.buf.shift();
                var min = Infinity;
                for (var i = 0; i < c.buf.length; i++) {
                    if (!FS.isNa(c.buf[i]) && c.buf[i] < min) min = c.buf[i];
                }
                return min === Infinity ? FS.NA : min;
            },

            highestbars: function (source, length, id) {
                var c = getCache(id, function () { return { buf: [] }; });
                if (FS.isNa(source)) return FS.NA;
                c.buf.push(source);
                if (c.buf.length > length) c.buf.shift();
                var max = -Infinity;
                var maxIdx = -1;
                for (var i = 0; i < c.buf.length; i++) {
                    if (!FS.isNa(c.buf[i]) && c.buf[i] > max) {
                        max = c.buf[i];
                        maxIdx = i;
                    }
                }
                return maxIdx === -1 ? FS.NA : (c.buf.length - 1 - maxIdx);
            },

            lowestbars: function (source, length, id) {
                var c = getCache(id, function () { return { buf: [] }; });
                if (FS.isNa(source)) return FS.NA;
                c.buf.push(source);
                if (c.buf.length > length) c.buf.shift();
                var min = Infinity;
                var minIdx = -1;
                for (var i = 0; i < c.buf.length; i++) {
                    if (!FS.isNa(c.buf[i]) && c.buf[i] < min) {
                        min = c.buf[i];
                        minIdx = i;
                    }
                }
                return minIdx === -1 ? FS.NA : (c.buf.length - 1 - minIdx);
            },

            vwma: function (source, length, volume, id) {
                var num = this.sma(source * volume, length, id + '_num');
                var den = this.sma(volume, length, id + '_den');
                if (FS.isNa(num) || FS.isNa(den) || den === 0) return FS.NA;
                return num / den;
            },

            cmo: function (source, length, id) {
                var c = getCache(id, function () { return { prevSrc: FS.NA, gains: [], losses: [], sumG: 0, sumL: 0 }; });
                if (FS.isNa(source)) return FS.NA;
                if (FS.isNa(c.prevSrc)) { c.prevSrc = source; return FS.NA; }
                var diff = source - c.prevSrc;
                var gain = diff > 0 ? diff : 0;
                var loss = diff < 0 ? -diff : 0;
                c.prevSrc = source;
                c.gains.push(gain);
                c.losses.push(loss);
                c.sumG += gain;
                c.sumL += loss;
                if (c.gains.length > length) {
                    c.sumG -= c.gains.shift();
                    c.sumL -= c.losses.shift();
                }
                if (c.gains.length < length) return FS.NA;
                var total = c.sumG + c.sumL;
                return total === 0 ? 0 : 100 * (c.sumG - c.sumL) / total;
            },

            dmi: function (diLength, adxSmoothing, high, low, prevClose, id) {
                var c = getCache(id, function () { return { prevH: FS.NA, prevL: FS.NA }; });
                var up = FS.isNa(high) || FS.isNa(c.prevH) ? FS.NA : high - c.prevH;
                var down = FS.isNa(low) || FS.isNa(c.prevL) ? FS.NA : -(low - c.prevL);
                var plusDM = FS.isNa(up) ? FS.NA : (up > down && up > 0 ? up : 0);
                var minusDM = FS.isNa(down) ? FS.NA : (down > up && down > 0 ? down : 0);
                
                c.prevH = high; c.prevL = low;
                
                var tr = this.tr(high, low, prevClose);
                var trRma = this.rma(tr, diLength, id + '_tr');
                var plusRma = this.rma(plusDM, diLength, id + '_plus');
                var minusRma = this.rma(minusDM, diLength, id + '_minus');
                
                if (FS.isNa(trRma) || trRma === 0) return [FS.NA, FS.NA, FS.NA];
                
                var plusDI = 100 * plusRma / trRma;
                var minusDI = 100 * minusRma / trRma;
                var sum = plusDI + minusDI;
                var dx = sum === 0 ? FS.NA : 100 * Math.abs(plusDI - minusDI) / sum;
                var adx = this.rma(dx, adxSmoothing, id + '_adx');
                
                return [plusDI, minusDI, adx];
            },

            supertrend: function (factor, atrPeriod, high, low, close, prevClose, id) {
                var c = getCache(id, function () { return { prevTrendUp: FS.NA, prevTrendDn: FS.NA, prevTrend: 1 }; });
                var hl2 = (high + low) / 2;
                var atr = this.atr(high, low, close, prevClose, atrPeriod, id + '_atr');
                if (FS.isNa(atr)) return [FS.NA, FS.NA];
                
                var up = hl2 - (factor * atr);
                var dn = hl2 + (factor * atr);
                
                var trendUp = FS.isNa(c.prevTrendUp) ? up : (prevClose > c.prevTrendUp ? Math.max(up, c.prevTrendUp) : up);
                var trendDn = FS.isNa(c.prevTrendDn) ? dn : (prevClose < c.prevTrendDn ? Math.min(dn, c.prevTrendDn) : dn);
                
                var trend = c.prevTrend;
                if (trend === -1 && close > c.prevTrendDn) trend = 1;
                else if (trend === 1 && close < c.prevTrendUp) trend = -1;
                
                c.prevTrendUp = trendUp;
                c.prevTrendDn = trendDn;
                c.prevTrend = trend;
                
                var st = trend === 1 ? trendUp : trendDn;
                return [st, trend];
            },

            cog: function (source, length, id) {
                var c = getCache(id, function () { return { buf: [] }; });
                if (FS.isNa(source)) return FS.NA;
                c.buf.push(source);
                if (c.buf.length > length) c.buf.shift();
                if (c.buf.length < length) return FS.NA;
                var num = 0, den = 0;
                for (var i = 0; i < length; i++) {
                    var val = c.buf[length - 1 - i];
                    num += val * (i + 1);
                    den += val;
                }
                if (den === 0) return FS.NA;
                return -(num / den);
            },

            sar: function (start, inc, max, high, low, id) {
                var c = getCache(id, function () { 
                    return { 
                        trend: FS.NA, sar: FS.NA, ep: FS.NA, af: start,
                        prevH: FS.NA, prevL: FS.NA, prevPrevH: FS.NA, prevPrevL: FS.NA 
                    }; 
                });
                if (FS.isNa(high) || FS.isNa(low)) return c.sar;
                
                if (FS.isNa(c.trend)) {
                    if (FS.isNa(c.prevH)) {
                        c.prevH = high; c.prevL = low;
                        return FS.NA;
                    }
                    if (FS.isNa(c.prevPrevH)) {
                        c.prevPrevH = c.prevH; c.prevPrevL = c.prevL;
                        c.prevH = high; c.prevL = low;
                        c.trend = high > c.prevPrevH ? 1 : -1;
                        c.sar = c.trend === 1 ? c.prevPrevL : c.prevPrevH;
                        c.ep = c.trend === 1 ? Math.max(high, c.prevH) : Math.min(low, c.prevL);
                        c.af = start;
                        return c.sar;
                    }
                }
                
                var prevSar = c.sar;
                var nextSar = prevSar + c.af * (c.ep - prevSar);
                
                if (c.trend === 1) {
                    nextSar = Math.min(nextSar, c.prevL, c.prevPrevL);
                    if (low < nextSar) {
                        c.trend = -1;
                        c.sar = c.ep;
                        c.ep = low;
                        c.af = start;
                    } else {
                        c.sar = nextSar;
                        if (high > c.ep) {
                            c.ep = high;
                            c.af = Math.min(c.af + inc, max);
                        }
                    }
                } else {
                    nextSar = Math.max(nextSar, c.prevH, c.prevPrevH);
                    if (high > nextSar) {
                        c.trend = 1;
                        c.sar = c.ep;
                        c.ep = high;
                        c.af = start;
                    } else {
                        c.sar = nextSar;
                        if (low < c.ep) {
                            c.ep = low;
                            c.af = Math.min(c.af + inc, max);
                        }
                    }
                }
                
                c.prevPrevH = c.prevH; c.prevPrevL = c.prevL;
                c.prevH = high; c.prevL = low;
                
                return c.sar;
            },

            /* ════════ P5: Moving averages ════════ */
            hma: function (source, length, id) {
                var c = getCache(id, function () { return { buf: [], rawBuf: [] }; });
                if (FS.isNa(source)) return FS.NA;
                c.buf.push(source);
                if (c.buf.length > length) c.buf.shift();
                if (c.buf.length < length) return FS.NA;
                var halfLen = Math.max(1, Math.floor(length / 2));
                var sqrtLen = Math.max(1, Math.floor(Math.sqrt(length)));
                var wHalf = 0, wSumH = 0;
                for (var i = 0; i < halfLen; i++) {
                    var idx = length - halfLen + i;
                    var w = i + 1;
                    wHalf += c.buf[idx] * w; wSumH += w;
                }
                wHalf = wSumH === 0 ? FS.NA : wHalf / wSumH;
                var wFull = 0, wSumF = 0;
                for (var j = 0; j < length; j++) {
                    var wf = j + 1;
                    wFull += c.buf[j] * wf; wSumF += wf;
                }
                wFull = wSumF === 0 ? FS.NA : wFull / wSumF;
                if (FS.isNa(wHalf) || FS.isNa(wFull)) return FS.NA;
                var raw = 2 * wHalf - wFull;
                c.rawBuf.push(raw);
                if (c.rawBuf.length > sqrtLen) c.rawBuf.shift();
                if (c.rawBuf.length < sqrtLen) return FS.NA;
                var sum = 0, wSum = 0;
                for (var k = 0; k < sqrtLen; k++) {
                    var ww = k + 1;
                    sum += c.rawBuf[k] * ww; wSum += ww;
                }
                return wSum === 0 ? FS.NA : sum / wSum;
            },

            dema: function (source, length, id) {
                var e1 = this.ema(source, length, id + '_e1');
                if (FS.isNa(e1)) return FS.NA;
                var e2 = this.ema(e1, length, id + '_e2');
                if (FS.isNa(e2)) return FS.NA;
                return 2 * e1 - e2;
            },

            tema: function (source, length, id) {
                var e1 = this.ema(source, length, id + '_e1');
                if (FS.isNa(e1)) return FS.NA;
                var e2 = this.ema(e1, length, id + '_e2');
                if (FS.isNa(e2)) return FS.NA;
                var e3 = this.ema(e2, length, id + '_e3');
                if (FS.isNa(e3)) return FS.NA;
                return 3 * e1 - 3 * e2 + e3;
            },

            alma: function (source, length, offset, sigma, id) {
                var c = getCache(id, function () { return { buf: [] }; });
                if (FS.isNa(source)) return FS.NA;
                c.buf.push(source);
                if (c.buf.length > length) c.buf.shift();
                if (c.buf.length < length) return FS.NA;
                var m = offset * (length - 1);
                var s = length / sigma;
                var sum = 0, norm = 0;
                for (var i = 0; i < length; i++) {
                    var w = Math.exp(-((i - m) * (i - m)) / (2 * s * s));
                    sum += c.buf[i] * w; norm += w;
                }
                return norm === 0 ? FS.NA : sum / norm;
            },

            swma: function (source, id) {
                var c = getCache(id, function () { return { buf: [] }; });
                if (FS.isNa(source)) return FS.NA;
                c.buf.push(source);
                if (c.buf.length > 4) c.buf.shift();
                if (c.buf.length < 4) return FS.NA;
                return c.buf[3] * (1 / 6) + c.buf[2] * (2 / 6) + c.buf[1] * (2 / 6) + c.buf[0] * (1 / 6);
            },

            linreg: function (source, length, offset, id) {
                var c = getCache(id, function () { return { buf: [] }; });
                if (FS.isNa(source)) return FS.NA;
                c.buf.push(source);
                if (c.buf.length > length) c.buf.shift();
                if (c.buf.length < length) return FS.NA;
                var sx = 0, sy = 0, sxy = 0, sx2 = 0;
                for (var i = 0; i < length; i++) {
                    sx += i; sy += c.buf[i];
                    sxy += i * c.buf[i]; sx2 += i * i;
                }
                var n = length;
                var denom = n * sx2 - sx * sx;
                if (denom === 0) return FS.NA;
                var slope = (n * sxy - sx * sy) / denom;
                var intercept = (sy - slope * sx) / n;
                return slope * (length - 1 - (offset || 0)) + intercept;
            },

            /* ════════ P5: Oscillators ════════ */
            cci: function (source, length, id) {
                var c = getCache(id, function () { return { buf: [] }; });
                if (FS.isNa(source)) return FS.NA;
                c.buf.push(source);
                if (c.buf.length > length) c.buf.shift();
                if (c.buf.length < length) return FS.NA;
                var mean = 0;
                for (var i = 0; i < length; i++) mean += c.buf[i];
                mean /= length;
                var mad = 0;
                for (var j = 0; j < length; j++) mad += Math.abs(c.buf[j] - mean);
                mad /= length;
                if (mad === 0) return 0;
                return (source - mean) / (0.015 * mad);
            },

            mfi: function (high, low, close, volume, length, id) {
                var c = getCache(id, function () { return { prevTp: FS.NA, posBuf: [], negBuf: [] }; });
                if (FS.isNa(high) || FS.isNa(low) || FS.isNa(close) || FS.isNa(volume)) return FS.NA;
                var tp = (high + low + close) / 3;
                if (FS.isNa(c.prevTp)) { c.prevTp = tp; return FS.NA; }
                var mf = tp * volume;
                var pos = tp > c.prevTp ? mf : 0;
                var neg = tp < c.prevTp ? mf : 0;
                c.prevTp = tp;
                c.posBuf.push(pos); c.negBuf.push(neg);
                if (c.posBuf.length > length) { c.posBuf.shift(); c.negBuf.shift(); }
                if (c.posBuf.length < length) return FS.NA;
                var ps = 0, ns = 0;
                for (var i = 0; i < length; i++) { ps += c.posBuf[i]; ns += c.negBuf[i]; }
                if (ns === 0) return 100;
                var mfr = ps / ns;
                return 100 - (100 / (1 + mfr));
            },

            wpr: function (high, low, close, length, id) {
                var c = getCache(id, function () { return { hBuf: [], lBuf: [] }; });
                if (FS.isNa(high) || FS.isNa(low) || FS.isNa(close)) return FS.NA;
                c.hBuf.push(high); c.lBuf.push(low);
                if (c.hBuf.length > length) { c.hBuf.shift(); c.lBuf.shift(); }
                if (c.hBuf.length < length) return FS.NA;
                var hh = -Infinity, ll = Infinity;
                for (var i = 0; i < length; i++) {
                    if (c.hBuf[i] > hh) hh = c.hBuf[i];
                    if (c.lBuf[i] < ll) ll = c.lBuf[i];
                }
                if (hh === ll) return -50;
                return -100 * (hh - close) / (hh - ll);
            },

            mom: function (source, length, id) {
                var c = getCache(id, function () { return { buf: [] }; });
                if (FS.isNa(source)) return FS.NA;
                c.buf.push(source);
                if (c.buf.length > length + 1) c.buf.shift();
                if (c.buf.length < length + 1) return FS.NA;
                return source - c.buf[0];
            },

            roc: function (source, length, id) {
                var c = getCache(id, function () { return { buf: [] }; });
                if (FS.isNa(source)) return FS.NA;
                c.buf.push(source);
                if (c.buf.length > length + 1) c.buf.shift();
                if (c.buf.length < length + 1) return FS.NA;
                var old = c.buf[0];
                if (old === 0) return FS.NA;
                return 100 * (source - old) / old;
            },

            tsi: function (source, shortLen, longLen, id) {
                var c = getCache(id, function () { return { prev: FS.NA }; });
                if (FS.isNa(source)) return FS.NA;
                var m = FS.isNa(c.prev) ? 0 : source - c.prev;
                c.prev = source;
                var m1 = this.ema(m, longLen, id + '_m1');
                if (FS.isNa(m1)) return FS.NA;
                var m2 = this.ema(m1, shortLen, id + '_m2');
                if (FS.isNa(m2)) return FS.NA;
                var am = Math.abs(m);
                var a1 = this.ema(am, longLen, id + '_a1');
                if (FS.isNa(a1)) return FS.NA;
                var a2 = this.ema(a1, shortLen, id + '_a2');
                if (FS.isNa(a2) || a2 === 0) return FS.NA;
                return 100 * m2 / a2;
            },

            trix: function (source, length, id) {
                var c = getCache(id, function () { return { prevE3: FS.NA }; });
                var e1 = this.ema(source, length, id + '_t1');
                if (FS.isNa(e1)) return FS.NA;
                var e2 = this.ema(e1, length, id + '_t2');
                if (FS.isNa(e2)) return FS.NA;
                var e3 = this.ema(e2, length, id + '_t3');
                if (FS.isNa(e3)) return FS.NA;
                if (FS.isNa(c.prevE3) || c.prevE3 === 0) { c.prevE3 = e3; return FS.NA; }
                var val = 100 * (e3 - c.prevE3) / c.prevE3;
                c.prevE3 = e3;
                return val;
            },

            cog: function (source, length, id) {
                var c = getCache(id, function () { return { buf: [] }; });
                if (FS.isNa(source)) return FS.NA;
                c.buf.push(source);
                if (c.buf.length > length) c.buf.shift();
                if (c.buf.length < length) return FS.NA;
                var num = 0, den = 0;
                for (var i = 0; i < length; i++) {
                    var val = c.buf[length - 1 - i];
                    num += val * (i + 1); den += val;
                }
                if (den === 0) return FS.NA;
                return -num / den;
            },

            /* ════════ P5: Volatility ════════ */
            stdev: function (source, length, biased, id) {
                var c = getCache(id, function () { return { buf: [] }; });
                if (FS.isNa(source)) return FS.NA;
                c.buf.push(source);
                if (c.buf.length > length) c.buf.shift();
                if (c.buf.length < length) return FS.NA;
                var mean = 0;
                for (var i = 0; i < length; i++) mean += c.buf[i];
                mean /= length;
                var sq = 0;
                for (var j = 0; j < length; j++) { var d = c.buf[j] - mean; sq += d * d; }
                var divisor = biased === false ? (length - 1) : length;
                if (divisor <= 0) return FS.NA;
                return Math.sqrt(sq / divisor);
            },

            variance: function (source, length, biased, id) {
                var c = getCache(id, function () { return { buf: [] }; });
                if (FS.isNa(source)) return FS.NA;
                c.buf.push(source);
                if (c.buf.length > length) c.buf.shift();
                if (c.buf.length < length) return FS.NA;
                var mean = 0;
                for (var i = 0; i < length; i++) mean += c.buf[i];
                mean /= length;
                var sq = 0;
                for (var j = 0; j < length; j++) { var d = c.buf[j] - mean; sq += d * d; }
                var divisor = biased === false ? (length - 1) : length;
                if (divisor <= 0) return FS.NA;
                return sq / divisor;
            },

            dev: function (source, length, id) {
                var c = getCache(id, function () { return { buf: [] }; });
                if (FS.isNa(source)) return FS.NA;
                c.buf.push(source);
                if (c.buf.length > length) c.buf.shift();
                if (c.buf.length < length) return FS.NA;
                var mean = 0;
                for (var i = 0; i < length; i++) mean += c.buf[i];
                mean /= length;
                var ad = 0;
                for (var j = 0; j < length; j++) ad += Math.abs(c.buf[j] - mean);
                return ad / length;
            },

            bb: function (source, length, mult, id) {
                var mid = this.sma(source, length, id + '_bmid');
                if (FS.isNa(mid)) return [FS.NA, FS.NA, FS.NA];
                var d = this.stdev(source, length, true, id + '_bdev');
                if (FS.isNa(d)) return [mid, FS.NA, FS.NA];
                return [mid, mid + mult * d, mid - mult * d];
            },

            bbw: function (source, length, mult, id) {
                var r = this.bb(source, length, mult, id + '_bbw');
                if (FS.isNa(r[0]) || FS.isNa(r[1]) || FS.isNa(r[2]) || r[0] === 0) return FS.NA;
                return (r[1] - r[2]) / r[0];
            },

            kc: function (source, high, low, close, prevClose, length, mult, useTR, id) {
                var mid = this.ema(source, length, id + '_kmid');
                if (FS.isNa(mid)) return [FS.NA, FS.NA, FS.NA];
                var rng;
                if (useTR === false) {
                    rng = FS.isNa(high) || FS.isNa(low) ? FS.NA : high - low;
                } else {
                    if (FS.isNa(prevClose)) rng = FS.isNa(high) || FS.isNa(low) ? FS.NA : high - low;
                    else rng = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
                }
                var avgRng = this.sma(rng, length, id + '_krng');
                if (FS.isNa(avgRng)) return [mid, FS.NA, FS.NA];
                return [mid, mid + mult * avgRng, mid - mult * avgRng];
            },

            kcw: function (source, high, low, close, prevClose, length, mult, useTR, id) {
                var r = this.kc(source, high, low, close, prevClose, length, mult, useTR, id + '_kcw');
                if (FS.isNa(r[0]) || FS.isNa(r[1]) || FS.isNa(r[2]) || r[0] === 0) return FS.NA;
                return (r[1] - r[2]) / r[0];
            },

            /* ════════ P5: Structure ════════ */
            pivothigh: function (source, leftbars, rightbars, id) {
                var c = getCache(id, function () { return { buf: [] }; });
                c.buf.push(source);
                var total = leftbars + rightbars + 1;
                if (c.buf.length > total) c.buf.shift();
                if (c.buf.length < total) return FS.NA;
                var cand = c.buf[leftbars];
                if (FS.isNa(cand)) return FS.NA;
                for (var i = 0; i < total; i++) {
                    if (i === leftbars) continue;
                    if (FS.isNa(c.buf[i]) || c.buf[i] >= cand) return FS.NA;
                }
                return cand;
            },

            pivotlow: function (source, leftbars, rightbars, id) {
                var c = getCache(id, function () { return { buf: [] }; });
                c.buf.push(source);
                var total = leftbars + rightbars + 1;
                if (c.buf.length > total) c.buf.shift();
                if (c.buf.length < total) return FS.NA;
                var cand = c.buf[leftbars];
                if (FS.isNa(cand)) return FS.NA;
                for (var i = 0; i < total; i++) {
                    if (i === leftbars) continue;
                    if (FS.isNa(c.buf[i]) || c.buf[i] <= cand) return FS.NA;
                }
                return cand;
            },

            supertrend: function (high, low, close, prevClose, factor, atrPeriod, id) {
                var c = getCache(id, function () { return { prevUp: FS.NA, prevDn: FS.NA, prevTrend: -1, prevClose: FS.NA }; });
                var atr = this.atr(high, low, close, prevClose, atrPeriod, id + '_stAtr');
                if (FS.isNa(atr)) { c.prevClose = close; return [FS.NA, FS.NA]; }
                var src = (high + low) / 2;
                var up = src - factor * atr;
                var dn = src + factor * atr;
                var upF = !FS.isNa(c.prevUp) && !FS.isNa(c.prevClose) && c.prevClose > c.prevUp ? Math.max(up, c.prevUp) : up;
                var dnF = !FS.isNa(c.prevDn) && !FS.isNa(c.prevClose) && c.prevClose < c.prevDn ? Math.min(dn, c.prevDn) : dn;
                var trend;
                if (FS.isNa(c.prevUp) || FS.isNa(c.prevDn)) {
                    trend = -1;
                } else if (c.prevTrend === 1 && close > c.prevDn) {
                    trend = -1;
                } else if (c.prevTrend === -1 && close < c.prevUp) {
                    trend = 1;
                } else {
                    trend = c.prevTrend;
                }
                var value = trend === -1 ? upF : dnF;
                c.prevUp = upF; c.prevDn = dnF; c.prevTrend = trend; c.prevClose = close;
                return [value, trend];
            },

            valuewhen: function (cond, source, occurrence, id) {
                var c = getCache(id, function () { return { hist: [] }; });
                if (cond) {
                    c.hist.unshift(source);
                    if (c.hist.length > 100) c.hist.length = 100;
                }
                var o = Math.max(0, Math.round(occurrence || 0));
                return c.hist[o] !== undefined ? c.hist[o] : FS.NA;
            },

            barssince: function (cond, id) {
                var c = getCache(id, function () { return { count: -1 }; });
                if (cond) { c.count = 0; return 0; }
                if (c.count < 0) return FS.NA;
                c.count++;
                return c.count;
            },

            /* ════════ P5: Change / aggregate ════════ */
            change: function (source, length, id) {
                var c = getCache(id, function () { return { buf: [] }; });
                c.buf.push(source);
                var L = Math.max(1, length || 1);
                if (c.buf.length > L + 1) c.buf.shift();
                if (c.buf.length < L + 1) return FS.NA;
                if (FS.isNa(source) || FS.isNa(c.buf[0])) return FS.NA;
                return source - c.buf[0];
            },

            cum: function (source, id) {
                var c = getCache(id, function () { return { sum: 0, hasAny: false }; });
                if (!FS.isNa(source)) { c.sum += source; c.hasAny = true; }
                return c.hasAny ? c.sum : FS.NA;
            },

            tr: function (high, low, prevClose, handleGaps) {
                if (FS.isNa(high) || FS.isNa(low)) return FS.NA;
                if (FS.isNa(prevClose)) return handleGaps === false ? FS.NA : high - low;
                return Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
            },

            rising: function (source, length, id) {
                var c = getCache(id, function () { return { buf: [] }; });
                c.buf.push(source);
                if (c.buf.length > length + 1) c.buf.shift();
                if (c.buf.length < length + 1) return false;
                for (var i = 1; i <= length; i++) {
                    if (FS.isNa(c.buf[i]) || FS.isNa(c.buf[i - 1]) || c.buf[i] <= c.buf[i - 1]) return false;
                }
                return true;
            },

            falling: function (source, length, id) {
                var c = getCache(id, function () { return { buf: [] }; });
                c.buf.push(source);
                if (c.buf.length > length + 1) c.buf.shift();
                if (c.buf.length < length + 1) return false;
                for (var i = 1; i <= length; i++) {
                    if (FS.isNa(c.buf[i]) || FS.isNa(c.buf[i - 1]) || c.buf[i] >= c.buf[i - 1]) return false;
                }
                return true;
            },

            /* ════════ P5: Statistical ════════ */
            correlation: function (src1, src2, length, id) {
                var c = getCache(id, function () { return { b1: [], b2: [] }; });
                if (FS.isNa(src1) || FS.isNa(src2)) return FS.NA;
                c.b1.push(src1); c.b2.push(src2);
                if (c.b1.length > length) { c.b1.shift(); c.b2.shift(); }
                if (c.b1.length < length) return FS.NA;
                var m1 = 0, m2 = 0;
                for (var i = 0; i < length; i++) { m1 += c.b1[i]; m2 += c.b2[i]; }
                m1 /= length; m2 /= length;
                var cov = 0, v1 = 0, v2 = 0;
                for (var j = 0; j < length; j++) {
                    var d1 = c.b1[j] - m1, d2 = c.b2[j] - m2;
                    cov += d1 * d2; v1 += d1 * d1; v2 += d2 * d2;
                }
                if (v1 === 0 || v2 === 0) return FS.NA;
                return cov / Math.sqrt(v1 * v2);
            },

            percentrank: function (source, length, id) {
                var c = getCache(id, function () { return { buf: [] }; });
                if (FS.isNa(source)) return FS.NA;
                c.buf.push(source);
                if (c.buf.length > length + 1) c.buf.shift();
                if (c.buf.length < length + 1) return FS.NA;
                var cnt = 0;
                for (var i = 0; i < length; i++) {
                    if (!FS.isNa(c.buf[i]) && c.buf[i] <= source) cnt++;
                }
                return 100 * cnt / length;
            },

            median: function (source, length, id) {
                var c = getCache(id, function () { return { buf: [] }; });
                if (FS.isNa(source)) return FS.NA;
                c.buf.push(source);
                if (c.buf.length > length) c.buf.shift();
                if (c.buf.length < length) return FS.NA;
                var sorted = c.buf.slice().sort(function (a, b) { return a - b; });
                var mid = Math.floor(length / 2);
                return length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
            },

            range: function (source, length, id) {
                var hi = this.highest(source, length, id + '_rhi');
                var lo = this.lowest(source, length, id + '_rlo');
                if (FS.isNa(hi) || FS.isNa(lo)) return FS.NA;
                return hi - lo;
            }
        };

        return ta;
    }

    /* ── Export ── */
    FS.createTaContext = createTaContext;

})(typeof window !== 'undefined' ? window : this);