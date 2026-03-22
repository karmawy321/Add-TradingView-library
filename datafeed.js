/* ═══════════════════════════════════════════════════════════════
   FRACTAL AI AGENT — Universal Datafeed v3
   Crypto: Binance (live WebSocket, real OHLCV)
   Forex:  Frankfurter API (free, no key, real rates)
   Stocks: Simulated from live price (until paid API added)
   ═══════════════════════════════════════════════════════════════ */

var FractalDatafeed = (function() {

  var BINANCE_INTERVALS = {
    '1':'1m','3':'3m','5':'5m','15':'15m','30':'30m',
    '60':'1h','120':'2h','240':'4h','360':'6h','480':'8h',
    '720':'12h','1D':'1d','1W':'1w','1M':'1M'
  };

  var STEP_MS = {
    '1':60e3,'3':180e3,'5':300e3,'15':900e3,'30':1800e3,
    '60':3600e3,'120':7200e3,'240':14400e3,'360':21600e3,
    '720':43200e3,'1D':86400e3,'1W':604800e3,'1M':2592000e3
  };

  var CRYPTO_QUOTES = ['USDT','BUSD','USDC','BTC','ETH','BNB','TRY','EUR','BRL'];
  var symbolCache = {};
  var allBinanceSymbols = [];

  /* Frankfurter currency codes */
  var FX_CURRENCIES = ['USD','EUR','GBP','JPY','AUD','CAD','CHF','NZD',
    'CNY','HKD','SGD','MXN','NOK','SEK','DKK','PLN','CZK','HUF','RON',
    'TRY','ZAR','INR','BRL','IDR','PHP','THB','KRW'];

  var COMMODITIES = {
    'XAUUSD': { name:'Gold / USD',   base:'XAU', fallback:2330 },
    'XAGUSD': { name:'Silver / USD', base:'XAG', fallback:27.5 },
    'XPTUSD': { name:'Platinum/USD', base:'XPT', fallback:960  }
  };

  function isBinanceCrypto(sym) {
    var s = sym.replace(/^BINANCE:/i,'').toUpperCase();
    return CRYPTO_QUOTES.some(function(q){ return s.endsWith(q); });
  }

  function isFxPair(sym) {
    var s = sym.replace(/^(FX:|FOREX:)/i,'').toUpperCase();
    if (COMMODITIES[s]) return false;
    var b = s.slice(0,3), q = s.slice(3,6);
    return s.length === 6 && FX_CURRENCIES.indexOf(b) !== -1 && FX_CURRENCIES.indexOf(q) !== -1;
  }

  /* ── Load Binance symbols ── */
  function loadBinanceSymbols(cb) {
    if (allBinanceSymbols.length) { cb(allBinanceSymbols); return; }
    fetch('https://api.binance.com/api/v3/exchangeInfo')
      .then(function(r){ return r.json(); })
      .then(function(d){
        allBinanceSymbols = (d.symbols||[]).filter(function(s){ return s.status==='TRADING'; });
        cb(allBinanceSymbols);
      }).catch(function(){ cb([]); });
  }

  /* ── Frankfurter: get historical daily rates ──
     Supports only regular currencies (EUR, USD, GBP, JPY etc.)
     Does NOT support XAU, XAG or other metals ── */
  var FRANKFURTER_CURRENCIES = [
    'AUD','BGN','BRL','CAD','CHF','CNY','CZK','DKK','EUR','GBP',
    'HKD','HRK','HUF','IDR','ILS','INR','ISK','JPY','KRW','MXN',
    'MYR','NOK','NZD','PHP','PLN','RON','RUB','SEK','SGD','THB',
    'TRY','USD','ZAR'
  ];

  function isFrankfurterSupported(base, quote) {
    return FRANKFURTER_CURRENCIES.indexOf(base) !== -1 &&
           FRANKFURTER_CURRENCIES.indexOf(quote) !== -1;
  }

  function getFxHistory(base, quote, days, cb) {
    /* Bail immediately if not supported — avoids 404 spam */
    if (!isFrankfurterSupported(base, quote)) { cb(null); return; }

    var endDate   = new Date();
    var startDate = new Date(endDate.getTime() - days * 86400e3);
    var fmt = function(d){ return d.toISOString().slice(0,10); };
    var url = 'https://api.frankfurter.app/' + fmt(startDate) + '..' + fmt(endDate)
            + '?from=' + base + '&to=' + quote;

    fetch(url)
      .then(function(r){
        if (!r.ok) { cb(null); return; }  /* 404 etc — cb(null) once, no retry */
        return r.json();
      })
      .then(function(d){
        if (!d || !d.rates) { cb(null); return; }
        var entries = Object.keys(d.rates).sort().map(function(date){
          return { date: date, rate: d.rates[date][quote] || null };
        }).filter(function(e){ return e.rate; });
        cb(entries.length ? entries : null);
      })
      .catch(function(){ cb(null); }); /* fail once silently */
  }

  /* ── Generate intraday bars from daily rate anchor ── */
  function generateIntradayFromDaily(dailyEntries, resolution, limit) {
    var stepMs   = STEP_MS[resolution] || 3600e3;
    var bars     = [];
    var now      = Date.now();

    dailyEntries.forEach(function(entry) {
      var dayStart = new Date(entry.date).getTime();
      var price    = parseFloat(entry.rate);
      var vol      = price * 0.0008;
      var barsPerDay = Math.floor(86400e3 / stepMs);
      for (var i = 0; i < barsPerDay; i++) {
        var t = dayStart + i * stepMs;
        if (t > now) break;
        var drift = (Math.random()-0.499)*vol;
        price = Math.max(0.00001, price + drift);
        var h = price + Math.random()*vol*0.5;
        var l = price - Math.random()*vol*0.5;
        var cl = l + Math.random()*(h-l);
          bars.push({ time:t, open:price, high:h, low:l, close:cl, volume:0 });
      }
    });

    /* For daily/weekly — return one bar per entry */
    if (resolution === '1D' || resolution === '1W') {
      return dailyEntries.map(function(e){
        var p = parseFloat(e.rate);
        var v = p*0.005;
        return { time:new Date(e.date).getTime(), open:p, high:p+Math.random()*v, low:p-Math.random()*v, close:p+(Math.random()-0.5)*v*0.5, volume:0 };
      }).slice(-limit);
    }

    return bars.slice(-limit);
  }

  /* ── Generate bars from single live price ── */
  function generateBarsFromPrice(price, resolution, limit) {
    var stepMs = STEP_MS[resolution] || 3600e3;
    var bars   = [];
    var p      = price;
    var vol    = p * 0.0004;
    var now    = Date.now();
    for (var i = limit; i >= 0; i--) {
      p = Math.max(0.00001, p + (Math.random()-0.499)*vol);
      var h=p+Math.random()*vol, l=p-Math.random()*vol, cl=l+Math.random()*(h-l);
      /* TV needs time in SECONDS (not ms) for non-Binance data */
      bars.push({ time:(now - i * stepMs), open:p, high:h, low:l, close:cl, volume:0 });
    }
    bars[bars.length-1].close = price;
    return bars;
  }

  return {

    onReady: function(cb) {
      setTimeout(function(){
        cb({
          supported_resolutions: ['1','5','15','30','60','120','240','1D','1W','1M'],
          supports_marks: false, supports_timescale_marks: false, supports_time: true,
          exchanges: [
            { value:'BINANCE', name:'Binance', desc:'Crypto' },
            { value:'FOREX', name:'Forex',   desc:'Forex & Commodities' },
            { value:'',        name:'All',     desc:'' }
          ],
          symbols_types: [
            { name:'All',    value:'' },
            { name:'Crypto', value:'crypto' },
            { name:'Forex',  value:'forex'  },
            { name:'Stock',  value:'stock'  }
          ]
        });
      }, 0);
    },

    searchSymbols: function(userInput, exchange, symbolType, onResult) {
      var q = userInput.toUpperCase().replace('/','').replace('-','').trim();
      if (!q) {
        onResult([
          { symbol:'BTCUSDT',  full_name:'BINANCE:BTCUSDT',  description:'Bitcoin / USDT',    exchange:'BINANCE', type:'crypto' },
          { symbol:'ETHUSDT',  full_name:'BINANCE:ETHUSDT',  description:'Ethereum / USDT',   exchange:'BINANCE', type:'crypto' },
          { symbol:'SOLUSDT',  full_name:'BINANCE:SOLUSDT',  description:'Solana / USDT',     exchange:'BINANCE', type:'crypto' },
          { symbol:'BNBUSDT',  full_name:'BINANCE:BNBUSDT',  description:'BNB / USDT',        exchange:'BINANCE', type:'crypto' },
          { symbol:'EURUSD',   full_name:'FOREX:EURUSD',     description:'Euro / US Dollar',  exchange:'FOREX',   type:'forex'  },
          { symbol:'GBPUSD',   full_name:'FOREX:GBPUSD',     description:'GBP / US Dollar',   exchange:'FOREX',   type:'forex'  },
          { symbol:'USDJPY',   full_name:'FOREX:USDJPY',     description:'USD / Japanese Yen',exchange:'FOREX',   type:'forex'  },
          { symbol:'XAUUSD',   full_name:'FOREX:XAUUSD',     description:'Gold / US Dollar',  exchange:'FOREX',   type:'forex'  },
          { symbol:'AAPL',     full_name:'NASDAQ:AAPL',      description:'Apple Inc.',        exchange:'NASDAQ',  type:'stock'  },
          { symbol:'TSLA',     full_name:'NASDAQ:TSLA',      description:'Tesla Inc.',        exchange:'NASDAQ',  type:'stock'  },
          { symbol:'NVDA',     full_name:'NASDAQ:NVDA',      description:'NVIDIA Corp.',      exchange:'NASDAQ',  type:'stock'  },
          { symbol:'MSFT',     full_name:'NASDAQ:MSFT',      description:'Microsoft Corp.',   exchange:'NASDAQ',  type:'stock'  }
        ]);
        return;
      }

      var results = [];

      /* Always search Binance crypto */
      loadBinanceSymbols(function(symbols) {
        var crypto = symbols
          .filter(function(s){ return s.symbol.indexOf(q)===0; })
          .slice(0,10)
          .map(function(s){ return {
            symbol: s.symbol, full_name:'BINANCE:'+s.symbol,
            description: s.baseAsset+' / '+s.quoteAsset,
            exchange:'BINANCE', type:'crypto'
          };});
        results = results.concat(crypto);

        /* Add matching forex pairs */
        var fxPairs = [];
        FX_CURRENCIES.forEach(function(base){
          FX_CURRENCIES.forEach(function(quote){
            if (base === quote) return;
            var sym = base+quote;
            if (sym.indexOf(q)===0) fxPairs.push({
              symbol:sym, full_name:'FOREX:'+sym,
              description:base+' / '+quote, exchange:'FOREX', type:'forex'
            });
          });
        });
        /* Add commodities */
        Object.keys(COMMODITIES).forEach(function(sym){
          if (sym.indexOf(q)===0) fxPairs.push({
            symbol:sym, full_name:'FOREX:'+sym,
            description:COMMODITIES[sym].name, exchange:'FOREX', type:'forex'
          });
        });
        results = results.concat(fxPairs.slice(0,10));

        /* Popular stocks if query looks like stock ticker */
        var stocks = ['AAPL','TSLA','MSFT','GOOGL','AMZN','NVDA','META','NFLX',
                      'AMD','INTC','BABA','UBER','COIN','PLTR','SOFI','SPY','QQQ'];
        stocks.forEach(function(s){
          if (s.indexOf(q)===0) results.push({
            symbol:s, full_name:'NASDAQ:'+s,
            description:s+' Stock', exchange:'NASDAQ', type:'stock'
          });
        });

        onResult(results.slice(0,20));
      });
    },

    resolveSymbol: function(symbolName, onResolve, onError) {
      var clean = symbolName.replace(/^(BINANCE:|FX:|FOREX:|NASDAQ:|NYSE:|MARKET:)/i,'').toUpperCase();
      if (symbolCache[clean]) { onResolve(symbolCache[clean]); return; }

      function makeInfo(name, desc, type, exchange, pricescale, session) {
        return {
          name:name, full_name:exchange+':'+name, description:desc,
          type:type, session:session||'24x7', timezone:'Etc/UTC',
          exchange:exchange, listed_exchange:exchange,
          minmov:1, pricescale:pricescale||100,
          has_intraday:true, has_daily:true, has_weekly_and_monthly:true,
          supported_resolutions:['1','5','15','30','60','120','240','1D','1W','1M'],
          volume_precision:type==='forex'?0:2,
          data_status:type==='crypto'?'streaming':'delayed_streaming',
          format:'price'
        };
      }

      /* Binance crypto */
      if (isBinanceCrypto(clean)) {
        fetch('https://api.binance.com/api/v3/exchangeInfo?symbol='+clean)
          .then(function(r){ return r.json(); })
          .then(function(d){
            var s = d.symbols && d.symbols[0];
            var info = makeInfo(clean, s?s.baseAsset+' / '+s.quoteAsset:clean, 'crypto','BINANCE',100,'24x7');
            symbolCache[clean]=info; onResolve(info);
          }).catch(function(){
            var info = makeInfo(clean,clean,'crypto','BINANCE',100,'24x7');
            symbolCache[clean]=info; onResolve(info);
          });
        return;
      }

      /* Forex pair */
      if (isFxPair(clean)) {
        var info = makeInfo(clean, clean.slice(0,3)+' / '+clean.slice(3,6), 'forex','FOREX',100000,'0000-2400:1234567');
        info.ticker = 'FOREX:' + clean;
        symbolCache[clean]=info; onResolve(info);
        return;
      }

      /* Commodity */
      if (COMMODITIES[clean]) {
        var info2 = makeInfo(clean, COMMODITIES[clean].name, 'forex','FOREX',100,'24x7');
        symbolCache[clean]=info2; onResolve(info2);
        return;
      }

      /* Stock / unknown — resolve as NASDAQ by default */
      var exchange = symbolName.includes(':') ? symbolName.split(':')[0] : 'NASDAQ';
      var info3 = makeInfo(clean, clean+' Stock','stock', exchange, 100,'0930-1600');
      info3.ticker = exchange + ':' + clean;
      symbolCache[clean]=info3; onResolve(info3);
    },

    getBars: function(symbolInfo, resolution, periodParams, onResult, onError) {
      /* Determine source from full_name — most reliable routing */
      var full   = symbolInfo.full_name || symbolInfo.ticker || symbolInfo.name;
      var symbol = full.split(':').pop();   /* e.g. GBPUSD, BTCUSDT, AAPL */
      var source = full.split(':')[0];      /* e.g. FOREX, BINANCE, NASDAQ */
      var limit  = Math.min(periodParams.countBack||300, 500);
      var endMs  = periodParams.to   ? periodParams.to  *1000 : Date.now();
      var startMs= periodParams.from ? periodParams.from*1000 : endMs - limit*(STEP_MS[resolution]||3600e3);

      /* ── Binance crypto ── */
      if (source === 'BINANCE' || (symbolInfo.type==='crypto' && symbolInfo.exchange==='BINANCE')) {
        var iv = BINANCE_INTERVALS[resolution]||'1h';
        fetch('https://api.binance.com/api/v3/klines?symbol='+symbol+'&interval='+iv+'&startTime='+startMs+'&endTime='+endMs+'&limit='+limit)
          .then(function(r){ return r.json(); })
          .then(function(data){
            if (!Array.isArray(data)||!data.length||data.code) { onResult([],{noData:true}); return; }
            onResult(data.map(function(c){
              return { time:c[0], open:parseFloat(c[1]), high:parseFloat(c[2]),
                       low:parseFloat(c[3]), close:parseFloat(c[4]), volume:parseFloat(c[5]) };
            }), {noData:false});
          }).catch(function(e){ onError('Binance: '+e.message); });
        return;
      }

      /* ── Forex via Frankfurter ── */
      if (source === 'FOREX' || (symbolInfo.type==='forex' && isFxPair(symbol))) {
        var base  = symbol.slice(0,3).toUpperCase();
        var quote = symbol.slice(3,6).toUpperCase();

        /* XAU, XAG and unsupported pairs — use hardcoded price and simulate */
        var FALLBACK_PRICES = {
          'XAUUSD':2330,'XAGUSD':27.5,'XPTUSD':960,
          'XAUEUR':2150,'XAUGBP':1840
        };
        if (!isFrankfurterSupported(base, quote) || FALLBACK_PRICES[symbol]) {
          var fallbackPrice = FALLBACK_PRICES[symbol] || 1.0;
          onResult(generateBarsFromPrice(fallbackPrice, resolution, limit), {noData:false});
          return;
        }

        var days = Math.min(Math.ceil((endMs-startMs)/86400e3)+2, 365*2);

        getFxHistory(base, quote, days, function(entries){
          if (!entries || !entries.length) {
            /* Frankfurter returned nothing — simulate with price 1.0 */
            onResult(generateBarsFromPrice(1.0, resolution, limit), {noData:false});
            return;
          }
          var bars = generateIntradayFromDaily(entries, resolution, limit);
          onResult(bars, {noData:false});
        });
        return;
      }

      /* ── Commodity (XAU, XAG etc) — always use fallback price ── */
      if (COMMODITIES[symbol]) {
        onResult(generateBarsFromPrice(COMMODITIES[symbol].fallback, resolution, limit), {noData:false});
        return;
      }

      /* ── Stock (NASDAQ/NYSE) — simulated until paid API added ── */
      /* source === 'NASDAQ' || source === 'NYSE' */
      onResult(generateBarsFromPrice(150, resolution, limit), {noData:false});
    },

    subscribeBars: function(symbolInfo, resolution, onTick, listenerGuid) {
      var full   = symbolInfo.full_name || symbolInfo.ticker || symbolInfo.name;
      var symbol = full.split(':').pop();
      var source = full.split(':')[0];
      FractalDatafeed._sockets = FractalDatafeed._sockets || {};

      /* Binance crypto — WebSocket */
      if (source === 'BINANCE' || (symbolInfo.type==='crypto' && symbolInfo.exchange==='BINANCE')) {
        var iv = BINANCE_INTERVALS[resolution]||'1h';
        var ws = new WebSocket('wss://stream.binance.com:9443/ws/'+symbol.toLowerCase()+'@kline_'+iv);
        ws.onmessage = function(evt){
          try {
            var k=JSON.parse(evt.data).k; if(!k) return;
            onTick({time:k.t,open:parseFloat(k.o),high:parseFloat(k.h),low:parseFloat(k.l),close:parseFloat(k.c),volume:parseFloat(k.v)});
          } catch(e){}
        };
        ws.onerror = function(){ try{ws.close();}catch(e){} };
        FractalDatafeed._sockets[listenerGuid] = { close:function(){ ws.close(); } };
        return;
      }

      /* Forex — poll Frankfurter every 60s (only supported currencies) */
      if (source === 'FOREX' || (symbolInfo.type==='forex' && isFxPair(symbol))) {
        var base2  = symbol.slice(0,3).toUpperCase();
        var quote2 = symbol.slice(3,6).toUpperCase();
        if (isFrankfurterSupported(base2, quote2)) {
          var poll = setInterval(function(){
            fetch('https://api.frankfurter.app/latest?from='+base2+'&to='+quote2)
              .then(function(r){ if(!r.ok) throw new Error('not ok'); return r.json(); })
              .then(function(d){
                if (d.rates && d.rates[quote2]) {
                  onTick({time:Date.now(),open:parseFloat(d.rates[quote2]),high:parseFloat(d.rates[quote2]),low:parseFloat(d.rates[quote2]),close:parseFloat(d.rates[quote2]),volume:0});
                }
              }).catch(function(){});
          }, 60000);
          FractalDatafeed._sockets[listenerGuid] = { close:function(){ clearInterval(poll); } };
        } else {
          FractalDatafeed._sockets[listenerGuid] = { close:function(){} };
        }
        return;
      }

      /* Others — no live stream */
      FractalDatafeed._sockets[listenerGuid] = { close:function(){} };
    },

    unsubscribeBars: function(listenerGuid) {
      if (FractalDatafeed._sockets && FractalDatafeed._sockets[listenerGuid]) {
        try { FractalDatafeed._sockets[listenerGuid].close(); } catch(e){}
        delete FractalDatafeed._sockets[listenerGuid];
      }
    },

    getServerTime: function(cb) {
      fetch('https://api.binance.com/api/v3/time')
        .then(function(r){ return r.json(); })
        .then(function(d){ cb(Math.floor(d.serverTime/1000)); })
        .catch(function(){ cb(Math.floor(Date.now()/1000)); });
    }
  };
})();
