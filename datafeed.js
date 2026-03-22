/* ═══════════════════════════════════════════════════════════════
   FRACTAL AI AGENT — TradingView Datafeed
   Crypto (Binance) + Forex/Stocks fallback
   ═══════════════════════════════════════════════════════════════ */

var FractalDatafeed = (function() {

  var BINANCE_INTERVALS = {
    '1':'1m','3':'3m','5':'5m','15':'15m','30':'30m',
    '60':'1h','120':'2h','240':'4h','360':'6h','480':'8h',
    '720':'12h','1D':'1d','1W':'1w','1M':'1M'
  };

  /* Known Binance quote currencies */
  var CRYPTO_QUOTES = ['USDT','BUSD','USDC','BTC','ETH','BNB','TRY','EUR','BRL'];

  var symbolCache = {};
  var allBinanceSymbols = [];

  function isCrypto(symbol) {
    var s = symbol.replace('BINANCE:','').toUpperCase();
    return CRYPTO_QUOTES.some(function(q){ return s.endsWith(q); });
  }

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

  /* Build a fake OHLCV series for symbols we can't get data for */
  function makeFallbackBars(from, to, resolution) {
    var bars = [];
    var step = parseInt(resolution) * 60 * 1000 || 3600000;
    var price = 1.1000;
    for (var t = from * 1000; t < to * 1000; t += step) {
      var change = (Math.random() - 0.5) * 0.002;
      price = Math.max(0.0001, price + change);
      bars.push({
        time:   t,
        open:   price,
        high:   price + Math.random() * 0.001,
        low:    price - Math.random() * 0.001,
        close:  price + (Math.random()-0.5)*0.0005,
        volume: Math.floor(Math.random() * 100000)
      });
    }
    return bars;
  }

  return {

    onReady: function(callback) {
      setTimeout(function(){
        callback({
          supported_resolutions: ['1','3','5','15','30','60','120','240','360','720','1D','1W','1M'],
          supports_marks:        false,
          supports_timescale_marks: false,
          supports_time:         true,
          exchanges: [
            { value:'BINANCE', name:'Binance',      desc:'Crypto' },
            { value:'FX',      name:'Forex',        desc:'Forex pairs' },
            { value:'',        name:'All Exchanges', desc:'' }
          ],
          symbols_types: [
            { name:'Crypto', value:'crypto' },
            { name:'Forex',  value:'forex'  },
            { name:'All',    value:''       }
          ]
        });
      }, 0);
    },

    searchSymbols: function(userInput, exchange, symbolType, onResult) {
      var query = userInput.toUpperCase().replace('/','').replace('-','');

      /* Always search Binance symbols */
      loadBinanceSymbols(function(symbols){
        var crypto = symbols
          .filter(function(s){ return s.symbol.indexOf(query) === 0; })
          .slice(0, 10)
          .map(function(s){
            return {
              symbol:      s.symbol,
              full_name:   'BINANCE:' + s.symbol,
              description: s.baseAsset + ' / ' + s.quoteAsset,
              exchange:    'BINANCE',
              type:        'crypto'
            };
          });

        /* Add common forex pairs if query looks like forex */
        var forexPairs = [
          'EURUSD','GBPUSD','USDJPY','AUDUSD','USDCAD','USDCHF',
          'NZDUSD','EURGBP','EURJPY','GBPJPY','XAUUSD','XAGUSD',
          'EURCAD','EURCHF','AUDCAD','CADJPY','GBPCAD','AUDNZD'
        ];
        var forex = forexPairs
          .filter(function(p){ return p.indexOf(query) === 0 || query.length < 2; })
          .slice(0, 5)
          .map(function(p){
            return {
              symbol:      p,
              full_name:   'FX:' + p,
              description: p.slice(0,3) + ' / ' + p.slice(3),
              exchange:    'FX',
              type:        'forex'
            };
          });

        onResult(crypto.concat(forex));
      });
    },

    resolveSymbol: function(symbolName, onResolve, onError) {
      var clean = symbolName.replace('BINANCE:','').replace('FX:','').toUpperCase();
      if (symbolCache[clean]) { onResolve(symbolCache[clean]); return; }

      /* Try Binance first */
      fetch('https://api.binance.com/api/v3/exchangeInfo?symbol=' + clean)
        .then(function(r){ return r.json(); })
        .then(function(d){
          if (d.symbols && d.symbols[0]) {
            var s = d.symbols[0];
            var info = {
              name:        s.symbol,
              full_name:   'BINANCE:' + s.symbol,
              description: s.baseAsset + ' / ' + s.quoteAsset,
              type:        'crypto',
              session:     '24x7',
              timezone:    'Etc/UTC',
              exchange:    'BINANCE',
              minmov:      1,
              pricescale:  100,
              has_intraday: true,
              has_daily:    true,
              has_weekly_and_monthly: true,
              supported_resolutions: ['1','3','5','15','30','60','120','240','360','720','1D','1W','1M'],
              volume_precision: 2,
              data_status: 'streaming',
              format:      'price'
            };
            symbolCache[clean] = info;
            onResolve(info);
          } else {
            /* Forex fallback */
            var fxInfo = {
              name:        clean,
              full_name:   'FX:' + clean,
              description: clean.slice(0,3) + ' / ' + clean.slice(3),
              type:        'forex',
              session:     '0000-2400:1234567',
              timezone:    'Etc/UTC',
              exchange:    'FX',
              minmov:      1,
              pricescale:  100000,
              has_intraday: true,
              has_daily:    true,
              has_weekly_and_monthly: true,
              supported_resolutions: ['1','5','15','30','60','240','1D','1W'],
              volume_precision: 0,
              data_status: 'delayed_streaming',
              format:      'price'
            };
            symbolCache[clean] = fxInfo;
            onResolve(fxInfo);
          }
        })
        .catch(function(){ onError('Resolution failed'); });
    },

    getBars: function(symbolInfo, resolution, periodParams, onResult, onError) {
      var symbol = symbolInfo.name.replace('BINANCE:','').replace('FX:','');
      var interval = BINANCE_INTERVALS[resolution] || '1h';
      var limit = Math.min(periodParams.countBack || 500, 1000);
      var endTime   = periodParams.to   ? periodParams.to   * 1000 : Date.now();
      var startTime = periodParams.from ? periodParams.from * 1000 : endTime - limit * 86400000;

      var url = 'https://api.binance.com/api/v3/klines'
        + '?symbol='    + symbol
        + '&interval='  + interval
        + '&startTime=' + startTime
        + '&endTime='   + endTime
        + '&limit='     + limit;

      fetch(url)
        .then(function(r){ return r.json(); })
        .then(function(data){
          if (!Array.isArray(data) || data.length === 0) {
            /* Symbol not on Binance — return no data so TV shows "no data" cleanly */
            onResult([], { noData: true });
            return;
          }
          var bars = data.map(function(c){
            return {
              time:   c[0],
              open:   parseFloat(c[1]),
              high:   parseFloat(c[2]),
              low:    parseFloat(c[3]),
              close:  parseFloat(c[4]),
              volume: parseFloat(c[5])
            };
          });
          onResult(bars, { noData: false });
        })
        .catch(function(e){ onError('Fetch error: ' + e.message); });
    },

    subscribeBars: function(symbolInfo, resolution, onTick, listenerGuid) {
      var symbol   = symbolInfo.name.replace('BINANCE:','').replace('FX:','').toLowerCase();
      var interval = BINANCE_INTERVALS[resolution] || '1h';

      /* Only stream crypto via Binance WebSocket */
      if (symbolInfo.type !== 'crypto' && !isCrypto(symbol.toUpperCase())) return;

      var wsUrl = 'wss://stream.binance.com:9443/ws/' + symbol + '@kline_' + interval;
      var ws = new WebSocket(wsUrl);

      ws.onmessage = function(evt){
        try {
          var msg = JSON.parse(evt.data);
          if (!msg.k) return;
          var k = msg.k;
          onTick({
            time:   k.t,
            open:   parseFloat(k.o),
            high:   parseFloat(k.h),
            low:    parseFloat(k.l),
            close:  parseFloat(k.c),
            volume: parseFloat(k.v)
          });
        } catch(e){}
      };
      ws.onerror = function(){ try { ws.close(); } catch(e){} };

      FractalDatafeed._sockets = FractalDatafeed._sockets || {};
      FractalDatafeed._sockets[listenerGuid] = ws;
    },

    unsubscribeBars: function(listenerGuid) {
      if (FractalDatafeed._sockets && FractalDatafeed._sockets[listenerGuid]) {
        try { FractalDatafeed._sockets[listenerGuid].close(); } catch(e){}
        delete FractalDatafeed._sockets[listenerGuid];
      }
    },

    getServerTime: function(callback) {
      fetch('https://api.binance.com/api/v3/time')
        .then(function(r){ return r.json(); })
        .then(function(d){ callback(Math.floor(d.serverTime/1000)); })
        .catch(function(){ callback(Math.floor(Date.now()/1000)); });
    }
  };
})();
