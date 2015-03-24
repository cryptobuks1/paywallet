Payblock = {};

Payblock.getBalances = function(addresses, cwkeys, callback) {

  WALLET.retriveLTCAddrsInfo(addresses, function(ltcData) {
    failoverAPI("get_normalized_balances", {'addresses': addresses}, function(assetsData, endpoint) {
      var data = {};
      // extracts all asset except LTC
      for (var i in assetsData) {
        e = assetsData[i];
        data[e.address] = data[e.address] || {};
        data[e.address][e.asset] = {
          'balance': e.quantity,
          'owner': e.owner
        }
      }
      // extracts LTC only if balance>0 or other assets in data[e.addr]
      for (var i in ltcData) {
        e = ltcData[i];
        if (data[e.addr] || e.confirmedRawBal>0) {
          data[e.addr] = data[e.addr] || {};
          data[e.addr]['LTC'] = {            
            'balance': e.confirmedRawBal,
            'txouts': e.rawUtxoData.length  
          }; 
          if (cwkeys[e.addr]) {
            data[e.addr]['LTC']['privkey'] = cwkeys[e.addr].getWIF();
          }
        }        
      }
      callback(data);
    });
  });

}

