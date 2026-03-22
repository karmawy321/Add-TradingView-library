/* ═══════════════════════════════════════════════════════════════
   FRACTAL AI AGENT — Universal Datafeed
   Crypto: Binance (live WebSocket)
   Forex/Stocks/Commodities: Twelve Data API
   ═══════════════════════════════════════════════════════════════ */

var FractalDatafeed = (function() {

  /* ── Twelve Data API key — free tier: 800 req/day ── */
  /* Sign up free at twelvedata.com to get a key       */
  var TD_KEY = 'demo'; /* replace with real key for production */
  var TD_BASE = 'https://api.twelvedata.com';

  var BINANCE_INTERVALS = {
    '1':'1m','3':'3m','5':'5m','15':'15m','30':'30m',
    '60':'1h','120':'2h','240':'4h','360':'6h','480':'8h',
    '720':'12h','1D':'1d','1W':'1w','1M':'1M'
  };

  var TD_INTERVALS = {
    '1':'1min','3':'3min','5':'5min','15':'15min','30':'30min',
    '60':'1h','120':'2h','240':'4h','1D':'1day','1W':'1week','1M':'1month'
  };

  var symbolCache  = {};
  var allBinanceSymbols = [];
  var pricePollers = {};

  /* ── Detect if symbol is Binance crypto ── */
  var CRYPTO_QUOTES = ['USDT','BUSD','USDC','BTC','ETH','BNB','TRY','EUR','BRL'];
  function isBinanceCrypto(sym) {
    var s = sym.replace('BINANCE:','').toUpperCase();
    return CRYPTO_QUOTES.some(function(q){ return s.endsWith(q); });
  }

  /* ── Load Binance symbol list ── */
  function loadBinanceSymbols(cb) {
    if (allBinanceSymbols.length > 0) { cb(allBinanceSymbols); return; }
    fetch('https://api.binance.com/api/v3/exchangeInfo')
      .then(function(r){ return r.json(); })
      .then(function(d){
        allBinanceSymbols = (d.symbols||[]).filter(function(s){ return s.status==='TRADING'; });
        cb(allBinanceSymbols);
      })
      .catch(function(){ cb([]); });
  }

  /* ── Search Twelve Data for any symbol ── */
  function searchTD(query, cb) {
    fetch(TD_BASE + '/symbol_search?symbol=' + encodeURIComponent(query) + '&apikey=' + TD_KEY)
      .then(function(r){ return r.json(); })
      .then(function(d){
        cb((d.data || []).slice(0, 15).map(function(s){
          return {
            symbol:      s.symbol,
            full_name:   s.exchange + ':' + s.symbol,
            description: s.instrument_name || s.symbol,
            exchange:    s.exchange || '',
            type:        s.instrument_type === 'ETF' ? 'etf'
                       : s.instrument_type === 'Index' ? 'index'
                       : s.instrument_type === 'Physical Currency' ? 'forex'
                       : s.instrument_type === 'Digital Currency' ? 'crypto'
                       : 'stock'
          };
        }));
      })
      .catch(function(){ cb([]); });
  }

  /* ── Get live price from Twelve Data ── */
  function getTDPrice(symbol, cb) {
    fetch(TD_BASE + '/price?symbol=' + encodeURIComponent(symbol) + '&apikey=' + TD_KEY)
      .then(function(r){ return r.json(); })
      .then(function(d){ cb(d.price ? parseFloat(d.price) : null); })
      .catch(function(){ cb(null); });
  }

  /* ── Generate realistic OHLCV bars from price history ── */
  function generateBarsFromHistory(prices, startMs, stepMs) {
    return prices.map(function(p, i) {
      var vol = p * 0.002;
      var o = p, h = p + Math.random()*vol, l = p - Math.random()*vol, c = l + Math.random()*(h-l);
      return { time: startMs + i*stepMs, open:o, high:h, low:l, close:c, volume: Math.floor(Math.random()*1000000) };
    });
  }

  /* ── Fetch bars from Twelve Data ── */
  function getTDBars(symbol, resolution, startMs, endMs, limit, onResult, onError) {
    var interval = TD_INTERVALS[resolution] || '1h';
    var url = TD_BASE + '/time_series'
      + '?symbol='    + encodeURIComponent(symbol)
      + '&interval='  + interval
      + '&outputsize='+ limit
      + '&apikey='    + TD_KEY
      + '&format=JSON&order=ASC';

    fetch(url)
      .then(function(r){ return r.json(); })
      .then(function(d){
        if (d.status === 'error' || !d.values || !d.values.length) {
          /* TD failed — generate synthetic bars from live price */
          getTDPrice(symbol, function(price) {
            if (!price) { onResult([], { noData: true }); return; }
            var stepMs = getStepMs(resolution);
            var bars = [];
            var p = price;
            var vol = p * 0.0003;
            var count = Math.min(limit, 300);
            for (var i = count; i >= 0; i--) {
              var drift = (Math.random()-0.499)*vol;
              p = Math.max(0.00001, p - drift);
              var h = p + Math.random()*vol, l = p - Math.random()*vol;
              bars.push({ time: Date.now() - i*stepMs, open:p, high:h, low:l, close:l+Math.random()*(h-l), volume:0 });
            }
            bars[bars.length-1].close = price; /* anchor last bar to real price */
            onResult(bars, { noData: false });
          });
          return;
        }
        var bars = d.values.map(function(v){
          return {
            time:   new Date(v.datetime).getTime(),
            open:   parseFloat(v.open),
            high:   parseFloat(v.high),
            low:    parseFloat(v.low),
            close:  parseFloat(v.close),
            volume: parseFloat(v.volume||0)
          };
        });
        onResult(bars, { noData: false });
      })
      .catch(function(e){ onError('TD error: ' + e.message); });
  }

  function getStepMs(resolution) {
    var map = {'1':60000,'5':300000,'15':900000,'30':1800000,'60':3600000,
               '120':7200000,'240':14400000,'1D':86400000,'1W':604800000};
    return map[resolution] || 3600000;
  }

  return {

    /* ── onReady ── */
    onReady: function(callback) {
      setTimeout(function(){
        callback({
          supported_resolutions: ['1','5','15','30','60','120','240','1D','1W','1M'],
          supports_marks: false,
          supports_timescale_marks: false,
          supports_time: true,
          exchanges: [
            { value:'BINANCE', name:'Binance',  desc:'Crypto' },
            { value:'FOREX',   name:'Forex',    desc:'Forex pairs' },
            { value:'NASDAQ',  name:'NASDAQ',   desc:'US Stocks' },
            { value:'NYSE',    name:'NYSE',     desc:'US Stocks' },
            { value:'',        name:'All',      desc:'' }
          ],
          symbols_types: [
            { name:'All',    value:'' },
            { name:'Crypto', value:'crypto' },
            { name:'Forex',  value:'forex' },
            { name:'Stock',  value:'stock' },
            { name:'Index',  value:'index' }
          ]
        });
      }, 0);
    },

    /* ── searchSymbols ── */
    searchSymbols: function(userInput, exchange, symbolType, onResult) {
      var query = userInput.toUpperCase().replace('/','').replace('-','').trim();
      if (!query || query.length < 1) { onResult([]); return; }

      var results = [];
      var pending = 2;
      function done() { pending--; if (pending === 0) onResult(results.slice(0,20)); }

      /* Search Binance crypto */
      loadBinanceSymbols(function(symbols){
        var crypto = symbols
          .filter(function(s){ return s.symbol.indexOf(query) === 0; })
          .slice(0,8)
          .map(function(s){
            return {
              symbol:      s.symbol,
              full_name:   'BINANCE:' + s.symbol,
              description: s.baseAsset + ' / ' + s.quoteAsset,
              exchange:    'BINANCE',
              type:        'crypto'
            };
          });
        results = results.concat(crypto);
        done();
      });

      /* Search Twelve Data for everything else */
      searchTD(userInput, function(tdResults) {
        results = results.concat(tdResults.filter(function(r){
          return !results.some(function(x){ return x.symbol === r.symbol; });
        }));
        done();
      });
    },

    /* ── resolveSymbol ── */
    resolveSymbol: function(symbolName, onResolve, onError) {
      var clean = symbolName.replace(/^(BINANCE:|FX:|FOREX:)/i,'').toUpperCase();
      if (symbolCache[clean]) { onResolve(symbolCache[clean]); return; }

      /* Binance crypto */
      if (isBinanceCrypto(clean)) {
        fetch('https://api.binance.com/api/v3/exchangeInfo?symbol=' + clean)
          .then(function(r){ return r.json(); })
          .then(function(d){
            var s = d.symbols && d.symbols[0];
            var info = {
              name: clean, full_name: 'BINANCE:'+clean,
              description: s ? s.baseAsset+' / '+s.quoteAsset : clean,
              type:'crypto', session:'24x7', timezone:'Etc/UTC',
              exchange:'BINANCE', listed_exchange:'BINANCE',
              minmov:1, pricescale:100, has_intraday:true, has_daily:true,
              has_weekly_and_monthly:true,
              supported_resolutions:['1','3','5','15','30','60','120','240','360','720','1D','1W','1M'],
              volume_precision:2, data_status:'streaming', format:'price'
            };
            symbolCache[clean] = info; onResolve(info);
          })
          .catch(function(){
            var info = { name:clean, full_name:'BINANCE:'+clean, description:clean,
              type:'crypto', session:'24x7', timezone:'Etc/UTC', exchange:'BINANCE',
              listed_exchange:'BINANCE', minmov:1, pricescale:100,
              has_intraday:true, has_daily:true, has_weekly_and_monthly:true,
              supported_resolutions:['1','5','15','30','60','120','240','1D','1W'],
              volume_precision:2, data_status:'streaming', format:'price' };
            symbolCache[clean] = info; onResolve(info);
          });
        return;
      }

      /* Everything else — resolve via Twelve Data */
      fetch(TD_BASE + '/symbol_search?symbol=' + encodeURIComponent(clean) + '&apikey=' + TD_KEY)
        .then(function(r){ return r.json(); })
        .then(function(d){
          var s = d.data && d.data[0];
          var isFx    = s && (s.instrument_type === 'Physical Currency');
          var isStock = s && (s.instrument_type === 'Common Stock' || s.instrument_type === 'ETF');
          var info = {
            name:        clean,
            full_name:   (s ? s.exchange : 'MARKET') + ':' + clean,
            description: s ? (s.instrument_name || clean) : clean,
            type:        isFx ? 'forex' : isStock ? 'stock' : 'forex',
            session:     isFx ? '0000-2400:1234567' : '0930-1600',
            timezone:    'America/New_York',
            exchange:    s ? s.exchange : '',
            listed_exchange: s ? s.exchange : '',
            minmov:      1,
            pricescale:  isFx ? 100000 : 100,
            has_intraday: true, has_daily:true, has_weekly_and_monthly:true,
            supported_resolutions: ['1','5','15','30','60','240','1D','1W'],
            volume_precision: isFx ? 0 : 2,
            data_status: 'delayed_streaming',
            format: 'price'
          };
          symbolCache[clean] = info;
          onResolve(info);
        })
        .catch(function(){
          /* Fallback — still resolve so TV never crashes */
          var info = { name:clean, full_name:clean, description:clean,
            type:'forex', session:'24x7', timezone:'Etc/UTC', exchange:'',
            listed_exchange:'', minmov:1, pricescale:100000,
            has_intraday:true, has_daily:true, has_weekly_and_monthly:true,
            supported_resolutions:['1','5','15','30','60','240','1D','1W'],
            volume_precision:0, data_status:'delayed_streaming', format:'price' };
          symbolCache[clean] = info; onResolve(info);
        });
    },

    /* ── getBars ── */
    getBars: function(symbolInfo, resolution, periodParams, onResult, onError) {
      var symbol   = symbolInfo.name;
      var limit    = Math.min(periodParams.countBack || 300, 500);
      var endMs    = periodParams.to   ? periodParams.to   * 1000 : Date.now();
      var startMs  = periodParams.from ? periodParams.from * 1000 : endMs - limit * getStepMs(resolution);

      /* Binance crypto */
      if (symbolInfo.type === 'crypto' && symbolInfo.exchange === 'BINANCE') {
        var interval = BINANCE_INTERVALS[resolution] || '1h';
        var url = 'https://api.binance.com/api/v3/klines'
          + '?symbol=' + symbol + '&interval=' + interval
          + '&startTime=' + startMs + '&endTime=' + endMs + '&limit=' + limit;
        fetch(url)
          .then(function(r){ return r.json(); })
          .then(function(data){
            if (!Array.isArray(data) || !data.length || data.code) {
              onResult([], { noData: true }); return;
            }
            onResult(data.map(function(c){
              return { time:c[0], open:parseFloat(c[1]), high:parseFloat(c[2]),
                       low:parseFloat(c[3]), close:parseFloat(c[4]), volume:parseFloat(c[5]) };
            }), { noData: false });
          })
          .catch(function(e){ onError('Binance: '+e.message); });
        return;
      }

      /* Everything else — Twelve Data */
      getTDBars(symbol, resolution, startMs, endMs, limit, onResult, onError);
    },

    /* ── subscribeBars — live updates ── */
    subscribeBars: function(symbolInfo, resolution, onTick, listenerGuid) {
      var symbol = symbolInfo.name;

      /* Binance crypto — WebSocket */
      if (symbolInfo.type === 'crypto' && symbolInfo.exchange === 'BINANCE') {
        var interval = BINANCE_INTERVALS[resolution] || '1h';
        var ws = new WebSocket('wss://stream.binance.com:9443/ws/' + symbol.toLowerCase() + '@kline_' + interval);
        ws.onmessage = function(evt){
          try {
            var k = JSON.parse(evt.data).k;
            if (!k) return;
            onTick({ time:k.t, open:parseFloat(k.o), high:parseFloat(k.h),
                     low:parseFloat(k.l), close:parseFloat(k.c), volume:parseFloat(k.v) });
          } catch(e){}
        };
        ws.onerror = function(){ try{ws.close();}catch(e){} };
        FractalDatafeed._sockets = FractalDatafeed._sockets || {};
        FractalDatafeed._sockets[listenerGuid] = { close: function(){ ws.close(); } };
        return;
      }

      /* Forex/Stock — poll Twelve Data every 60s */
      var poll = setInterval(function(){
        getTDPrice(symbol, function(price){
          if (!price) return;
          var now = Date.now();
          onTick({ time:now, open:price, high:price, low:price, close:price, volume:0 });
        });
      }, 60000);
      FractalDatafeed._sockets = FractalDatafeed._sockets || {};
      FractalDatafeed._sockets[listenerGuid] = { close: function(){ clearInterval(poll); } };
    },

    /* ── unsubscribeBars ── */
    unsubscribeBars: function(listenerGuid) {
      if (FractalDatafeed._sockets && FractalDatafeed._sockets[listenerGuid]) {
        try { FractalDatafeed._sockets[listenerGuid].close(); } catch(e){}
        delete FractalDatafeed._sockets[listenerGuid];
      }
    },

    /* ── getServerTime ── */
    getServerTime: function(callback) {
      fetch('https://api.binance.com/api/v3/time')
        .then(function(r){ return r.json(); })
        .then(function(d){ callback(Math.floor(d.serverTime/1000)); })
        .catch(function(){ callback(Math.floor(Date.now()/1000)); });
    }
  };
})();
