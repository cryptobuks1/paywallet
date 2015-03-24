
/* the life of a LTCpay:

* user makes order to sell LTC
* order is matched with another order (to buy LTC, in return for some other asset)
* user's order listed as an *upcoming* LTCPay for 6 blocks. Shows up in the Waiting LTCpay feed with a clock icon.
* After 6 blocks, it's "safe" for the user to make a LTCpay against the item:
   -if automatic, a create_ltcpay transaction is then immediately made. item does not show up in waiting LTCpays pane
   -if manual, the user is prompted to make payment. If they say "yes, do it now", things proceed simiarly to the automatic route
   above. if they say "no, hold off" the create_ltcpay transaction is made once the user chooses to make it.
   the item then shows up in the waiting LTCpay feed with an exclamation point icon, and the user must make payment
* Once the user DOES make payment (automatic or manually), the ltcpay is added to the pending actions list to show that
  the LTCPay is in progress (i.e. txn has been broadcast). (Note that if the user were to log out and back in during this time,
  we would see that the LTCpay is on the pending list and wouldn't show it as eligable to be paid.)
* Once confirmed on the network, the ltcpay data is received across the message feed:
   -WaitingLTCPay is no longer marked as "inprogress". localstorage data is removed for it
   -Waiting LTCpay item is removed from waitingLTCPays
   -Notification item for this LTCPay is added to the notifications feed pane

* Basically: upcomingLTCPay -> waitingLTCPay -> pendingLTCPay -> completedLTCPay
* */
function LTCPayFeedViewModel() {
  var self = this;
  
  self.dispCount = ko.computed(function() {
    return WAITING_LTCPAY_FEED.entries().length + UPCOMING_LTCPAY_FEED.entries().length;
  }, self);
  
  self.dispLastUpdated = ko.computed(function() {
    return WAITING_LTCPAY_FEED.lastUpdated() >= UPCOMING_LTCPAY_FEED.lastUpdated() ? WAITING_LTCPAY_FEED.lastUpdated() : UPCOMING_LTCPAY_FEED.lastUpdated();
  }, self);
}


function WaitingLTCPayViewModel(ltcPayData) {
  /* message is a message data object from the message feed for an order_match that requires a ltc pay from an address in our wallet*/
  var self = this;
  self.LTCPAY_DATA = ltcPayData;
  self.now = ko.observable(new Date()); //auto updates from the parent model every minute
  self.MATCH_EXPIRE_INDEX = self.LTCPAY_DATA['matchExpireIndex'];
  
  self.dispLTCQuantity = smartFormat(self.LTCPAY_DATA['ltcQuantity']);
  self.dispMyAddr = getAddressLabel(self.LTCPAY_DATA['myAddr']);
  self.dispMyOrderTxHash = getTxHashLink(self.LTCPAY_DATA['myOrderTxHash']);
  
  self.expiresInNumBlocks = ko.computed(function() {
    return self.LTCPAY_DATA['matchExpireIndex'] - WALLET.networkBlockHeight();
  }, self);
  
  self.approxExpiresInTime = ko.computed(function() {
    return self.now().getTime() + (self.expiresInNumBlocks() * APPROX_SECONDS_PER_BLOCK * 1000);
  }, self);

  self.approxExpiresInTimeDisp = ko.computed(function() {
    return moment(self.approxExpiresInTime()).fromNow();
  }, self);
  
  self.displayColor = ko.computed(function() {
    if(self.approxExpiresInTime() - self.now() > 7200 * 1000) return 'bg-color-greenLight'; //> 2 hours
    if(self.approxExpiresInTime() - self.now() > 3600 * 1000) return 'bg-color-yellow'; //> 1 hour
    if(self.approxExpiresInTime() - self.now() > 1800 * 1000) return 'bg-color-orange'; //> 30 min
    return 'bg-color-red'; // < 30 min, or already expired according to our reough estimate
  }, self);
  
  self.completeLTCPay = function() {
    //check duplicate
    if (PROCESSED_LTCPAY[ltcPayData['orderMatchID']]) {
      $.jqlog.error("Attempt to make duplicate ltcpay: " + ltcPayData['orderMatchID']);
      return false;
    } else if (self.expiresInNumBlocks()<=6) {
      $.jqlog.error("Attempt to make expired ltcpay: " + ltcPayData['orderMatchID']);
      return false;
    }
    
    //Pop up confirm dialog, and make LTC payment
    WALLET.retrieveLTCBalance(self.LTCPAY_DATA['myAddr'], function(balance) {
      if(balance < self.LTCPAY_DATA['ltcQuantityRaw'] + MIN_PRIME_BALANCE) {
        bootbox.alert(i18n.t("no_balance_for_ltc_pay", getAddressLabel(self.LTCPAY_DATA['myAddr'])));
        return;
      }
      
      bootbox.dialog({
        message: i18n.t("confirm_ltc_payment", self.LTCPAY_DATA['ltcQuantity'], getAddressLabel(self.LTCPAY_DATA['ltcDestAddr']), self.LTCPAY_DATA['myOrderTxIndex']),
        title: i18n.t("confirm_order_settlement"),
        buttons: {
          cancel: {
            label: i18n.t("cancel"),
            className: "btn-default",
            callback: function() { } //just close the dialog
          },
          confirm: {
            label: i18n.t("confirm_and_pay"),
            className: "btn-success",
            callback: function() {
              //complete the LTCpay. Start by getting the current LTC balance for the address
              
              PROCESSED_LTCPAY[self.LTCPAY_DATA['orderMatchID']] = true; // before the transaction and not onSuccess, to avoid two tx in parallele

              WALLET.doTransaction(self.LTCPAY_DATA['myAddr'], "create_ltcpay",
                { order_match_id: self.LTCPAY_DATA['orderMatchID'],
                  source: self.LTCPAY_DATA['myAddr'],
                  destBtcPay: self.LTCPAY_DATA['ltcDestAddr']
                },
                function(txHash, data, endpoint, addressType, armoryUTx) {
                  //remove the LTC payment from the notifications (even armory tx at this point...)
                  WAITING_LTCPAY_FEED.remove(self.LTCPAY_DATA['orderMatchID']);
                }
              );
            }
          }
        }
      });
    });    
  }
}

function WaitingLTCPayFeedViewModel() {
  var self = this;
  self.entries = ko.observableArray([]);
  self.lastUpdated = ko.observable(new Date());
  
  self.entries.subscribe(function() {
    WALLET.isSellingLTC(self.entries().length + UPCOMING_LTCPAY_FEED.entries().length ? true : false);
  });

  //Every 60 seconds, run through all entries and update their 'now' members
  setInterval(function() {
    var now = new Date();
    for(var i=0; i < self.entries().length; i++) {
      self.entries()[i].now(now);
    }  
  }, 60 * 1000); 

  self.add = function(ltcPayData, resort) {
    assert(ltcPayData && ltcPayData['orderMatchID']);
    //^ must be a LTCPayData structure, not a plain message from the feed or result from the API
    
    if(typeof(resort)==='undefined') resort = true;
    self.entries.unshift(new WaitingLTCPayViewModel(ltcPayData));
    if(resort) self.sort();
    self.lastUpdated(new Date());
  }
  
  self.remove = function(orderHashOrMatchHash, data) {
    //data is supplied optionally to allow us to notify the user on a failed LTCpay...it's only used when called from messagesfeed.js
    // before we work with valid messages only
    var match = ko.utils.arrayFirst(self.entries(), function(item) {
      if(orderHashOrMatchHash == item.LTCPAY_DATA['orderMatchID']) return true; //matched by the entire order match hash
      //otherwise try to match on a single order hash
      var orderHash1 = item.LTCPAY_DATA['orderMatchID'].substring(0, 64);
      var orderHash2 = item.LTCPAY_DATA['orderMatchID'].substring(64);
      return orderHashOrMatchHash == orderHash1 || orderHashOrMatchHash == orderHash2;
    });
    if(match) {
      self.entries.remove(match);
      self.lastUpdated(new Date());
      return match;
    }
    return false;
  }
  
  self.sort = function() {
    //sort the pending LTCpays so that the entry most close to expiring is at top
    self.entries.sort(function(left, right) {
      return left.expiresInNumBlocks() == right.expiresInNumBlocks() ? 0 : (left.expiresInNumBlocks() < right.expiresInNumBlocks() ? -1 : 1);
    });      
  }

  self.restore = function() {
    //Get and populate any waiting LTC pays, filtering out those they are marked as in progress (i.e. are not waiting
    // for manual user payment, but waiting confirmation on the network instead -- we call these pendingLTCPays) to
    // avoid the possibility of double payment
    var addresses = WALLET.getAddressesList();
    var filters = [];
    for(var i=0; i < addresses.length; i++) {
      filters.push({'field': 'tx0_address', 'op': '==', 'value': addresses[i]});
      filters.push({'field': 'tx1_address', 'op': '==', 'value': addresses[i]});
    }

    failoverAPI("get_order_matches", {'filters': filters, 'filterop': 'or', status: 'pending'},
      function(data, endpoint) {
        $.jqlog.debug("Order matches: " + JSON.stringify(data));
        for(var i=0; i < data.length; i++) {
          //if the other party is the one that should be paying LTC for this specific order match, then skip it          
          if(   WALLET.getAddressObj(data['tx0_address']) && data['forward_asset'] == 'LTC'
             || WALLET.getAddressObj(data['tx1_address']) && data['backward_asset'] == 'LTC')
             continue;
          
          //if here, we have a pending order match that we owe LTC for. 
          var orderMatchID = data[i]['tx0_hash'] + data[i]['tx1_hash'];
          
          //next step is that we need to check if it's one we have paid, but just hasn't been confirmed yet. check
          // the pendingactions feed to see if the LTCpay is pending
          var pendingLTCPay = $.grep(PENDING_ACTION_FEED.entries(), function(e) {
            return e['CATEGORY'] == 'ltcpays' && e['DATA']['order_match_id'] == orderMatchID;
          })[0];
          if(pendingLTCPay) {
            $.jqlog.debug("pendingLTCPay:restore:not showing ltcpay request for order match ID: " + orderMatchID);
          } else {
            //not paid yet (confirmed), nor is it a pending action
            var ltcPayData = WaitingLTCPayFeedViewModel.makeLTCPayData(data[i]);            
            if (ltcPayData) {
              if(WALLET.networkBlockHeight() - ltcPayData['blockIndex'] < NUM_BLOCKS_TO_WAIT_FOR_LTCPAY) {
                //If the order match is younger than NUM_BLOCKS_TO_WAIT_FOR_LTCPAY blocks, then it's actually still an
                // order that should be in the upcomingLTCPay feed
                UPCOMING_LTCPAY_FEED.add(ltcPayData);
              } else {
                //otherwise, if not already paid and awaiting confirmation, show it as a waiting LTCpay
                WAITING_LTCPAY_FEED.add(ltcPayData);
              }
            }
          }
        }
          
        //Sort upcoming ltcpay and waiting ltcpay lists
        UPCOMING_LTCPAY_FEED.sort();
        WAITING_LTCPAY_FEED.sort();
      }
    );
  }
}
WaitingLTCPayFeedViewModel.makeLTCPayData = function(data) {
  //data is a pending order match object (from a data feed message received, or from a get_orders API result)
  var firstInPair = (WALLET.getAddressObj(data['tx0_address']) && data['forward_asset'] == 'LTC') ? true : false;
  if(!firstInPair) if (!(WALLET.getAddressObj(data['tx1_address']) && data['backward_asset'] == 'LTC')) return false;
  
  return {
    blockIndex: data['tx1_block_index'], //the latter block index, which is when the match was actually made
    matchExpireIndex: data['match_expire_index'],
    orderMatchID: data['tx0_hash'] + data['tx1_hash'],
    myAddr: firstInPair ? data['tx0_address'] : data['tx1_address'],
    ltcDestAddr: firstInPair ? data['tx1_address'] : data['tx0_address'],
    ltcQuantity: normalizeQuantity(firstInPair ? data['forward_quantity'] : data['backward_quantity'], true), //normalized
    ltcQuantityRaw: firstInPair ? data['forward_quantity'] : data['backward_quantity'],
    myOrderTxIndex: firstInPair ? data['tx0_index'] : data['tx1_index'],
    myOrderTxHash: firstInPair ? data['tx0_hash'] : data['tx1_hash'],
    otherOrderTxIndex: firstInPair ? data['tx1_index'] : data['tx0_index'],
    otherOrderAsset: firstInPair ? data['backward_asset'] : data['forward_asset'],
    otherOrderQuantity: normalizeQuantity(firstInPair ? data['backward_quantity'] : data['forward_quantity'],
      firstInPair ? data['_backward_asset_divisible'] : data['_forward_asset_divisible']), //normalized
    otherOrderQuantityRaw: firstInPair ? data['backward_quantity'] : data['forward_quantity']
  }
}


function UpcomingLTCPayViewModel(ltcPayData) {
  /* message is a message data object from the message feed for an order_match that requires a ltc pay from an address in our wallet*/
  var self = this;
  self.LTCPAY_DATA = ltcPayData;
  self.now = ko.observable(new Date()); //auto updates from the parent model every minute
  
  self.dispLTCQuantity = smartFormat(self.LTCPAY_DATA['ltcQuantity']);
  self.dispMyOrderTxHash = getTxHashLink(self.LTCPAY_DATA['myOrderTxHash']);
  
  self.numBlocksUntilEligible = ko.computed(function() {
    return Math.max(NUM_BLOCKS_TO_WAIT_FOR_LTCPAY - (WALLET.networkBlockHeight() - self.LTCPAY_DATA['blockIndex']), 0);
  }, self);
  
  self.approxTimeUntilEligible = ko.computed(function() {
    return self.now().getTime() + (self.numBlocksUntilEligible() * APPROX_SECONDS_PER_BLOCK * 1000);
  }, self);

  self.approxTimeUntilEligibleDisp = ko.computed(function() {
    return moment().fromNow(self.approxTimeUntilEligible());
  }, self);
}

function UpcomingLTCPayFeedViewModel() {
  /* when an order match occurs where we owe LTC, a ltcpay transaction should be made. Due to the potential of a 
   * blockchain reorg happening at any time, we delay the ltcpay by 6 or so blocks so that (barring some kind of catastrophic
   * sized reorg) we're sure that by the time of the bTCpay, the user is making a payment against a real order (i.e. one
   * that won't "disappear" potentially, if there is a reorg)
   */
  var self = this;
  self.entries = ko.observableArray([]);
  self.lastUpdated = ko.observable(new Date());
  
  self.entries.subscribe(function() {
    WALLET.isSellingLTC(WAITING_LTCPAY_FEED.entries().length + self.entries().length ? true : false);
  });
  
  //Every 60 seconds, run through all entries and update their 'now' members
  setInterval(function() {
    var now = new Date();
    for(var i=0; i < self.entries().length; i++) {
      self.entries()[i].now(now);
      
      //if this ltcpay is now eligible, process it
      if(self.entries()[i].numBlocksUntilEligible() == 0)
        self.process(self.entries()[i]['LTCPAY_DATA']);
    }  
  }, 60 * 1000); 

  self.add = function(ltcPayData, resort) {
    assert(ltcPayData && ltcPayData['orderMatchID']);
    //^ must be a LTCPayData structure, not a plain message from the feed or result from the API

    if(typeof(resort)==='undefined') resort = true;
    // check duplicate
    for (var e in self.entries) {
      if (self.entries[e].LTCPAY_DATA && self.entries[e].LTCPAY_DATA['orderMatchID'] == ltcPayData['orderMatchID']) {
        $.jqlog.error("Attempt to make duplicate ltcpay: " + ltcPayData['orderMatchID']);
        return false;
      }
    }
    self.entries.unshift(new UpcomingLTCPayViewModel(ltcPayData));
    if(resort) self.sort();
    self.lastUpdated(new Date());
  }
  
  self.remove = function(orderHashOrMatchHash) {
    var match = ko.utils.arrayFirst(self.entries(), function(item) {
      if(orderHashOrMatchHash == item.LTCPAY_DATA['orderMatchID']) return true; //matched by the entire order match hash
      //otherwise try to match on a single order hash
      var orderHash1 = item.LTCPAY_DATA['orderMatchID'].substring(0, 64);
      var orderHash2 = item.LTCPAY_DATA['orderMatchID'].substring(64);
      return orderHashOrMatchHash == orderHash1 || orderHashOrMatchHash == orderHash2;
    });
    if(match) {
      self.entries.remove(match);
      self.lastUpdated(new Date());
      return match;
    }
    return false;
  }
  
  self.sort = function() {
    //sort the upcoming LTCpays so that the entry most close to becoming eligible is on top
    self.entries.sort(function(left, right) {
      return left.numBlocksUntilEligible() == right.numBlocksUntilEligible() ? 0 : (left.numBlocksUntilEligible() < right.numBlocksUntilEligible() ? -1 : 1);
    });
  }
  
  self.process = function(ltcPayData) {
    //The ltcpay required is no longer "upcoming" and a create_ltcpay should be broadcast...

    //check duplicate
    if (PROCESSED_LTCPAY[ltcPayData['orderMatchID']]) {
      $.jqlog.error("Attempt to make duplicate ltcpay: " + ltcPayData['orderMatchID']);
      return false;
    } else if (ltcPayData['matchExpireIndex'] - WALLET.networkBlockHeight() <= 6) {
      $.jqlog.error("Attempt to make expired ltcpay: " + ltcPayData['orderMatchID']);
      return false;
    } else {
      PROCESSED_LTCPAY[ltcPayData['orderMatchID']] = true;
    }
    
    //remove the entry from the "upcoming" list, as it will be migrating to the "waiting" list
    self.remove(ltcPayData['orderMatchID']);
        
    //If automatic LTC pays are enabled, just take care of the LTC pay right now
    if(PREFERENCES['auto_ltcpay']) {

      if(WALLET.getBalance(ltcPayData['myAddr'], 'LTC', false) >= (ltcPayData['ltcQuantityRaw']) + MIN_PRIME_BALANCE) {
        
         //user has the sufficient balance
        WALLET.doTransaction(ltcPayData['myAddr'], "create_ltcpay",
          { order_match_id: ltcPayData['orderMatchID'], source: ltcPayData['myAddr'], destBtcPay: ltcPayData['ltcDestAddr'] },
          function(txHash, data, endpoint, addressType, armoryUTx) {
            //notify the user of the automatic LTC payment
            var message = i18n.t("auto_ltcpay_done", ltcPayData['ltcQuantity'], ltcPayData['myAddr'], ltcPayData['otherOrderQuantity'], ltcPayData['otherOrderAsset']);
            WALLET.showTransactionCompleteDialog(message + " " + i18n.t(ACTION_PENDING_NOTICE), message, armoryUTx);
          }, function() {
            WAITING_LTCPAY_FEED.add(ltcPayData);
            bootbox.alert(i18n.t("auto_ltcpay_error"));
          }
        );

      } else {

        //The user doesn't have the necessary balance on the address... let them know and add the LTC as pending
        WAITING_LTCPAY_FEED.add(ltcPayData);
        WALLET.showTransactionCompleteDialog(i18n.t("ltcpay_required", ltcPayData['ltcQuantity'], getAddressLabel(ltcPayData['myAddr'])));  
      }

    } else {
      //Otherwise, prompt the user to make the LTC pay
      var prompt = i18n.t("order_match_succesfull", ltcPayData['otherOrderQuantity'], ltcPayData['otherOrderAsset'], ltcPayData['ltcQuantity'], getAddressLabel(ltcPayData['myAddr']));          
      bootbox.dialog({
        message: prompt,
        title: i18n.t("order_settlement"),
        buttons: {
          success: {
            label: i18n.t("no_hold_off"),
            className: "btn-danger",
            callback: function() {
              //If the user says no, then throw the LTC pay in pending LTC pays
              WAITING_LTCPAY_FEED.add(ltcPayData);
            }
          },
          danger: {
            label: i18n.t("yes"),
            className: "btn-success",
            callback: function() {
              WALLET.doTransaction(ltcPayData['myAddr'], "create_ltcpay",
                { order_match_id: ltcPayData['orderMatchID'], source: ltcPayData['myAddr'], destBtcPay: ltcPayData['ltcDestAddr'] },
                function(txHash, data, endpoint, addressType, armoryUTx) {
                  //notify the user of the automatic LTC payment
                  var message = "";
                  if (armoryUTx) {
                    message = i18n.t("auto_ltcpay_to_be_made", ltcPayData['ltcQuantity'], getAddressLabel(ltcPayData['myAddr']), ltcPayData['otherOrderQuantity'], ltcPayData['otherOrderAsset']);
                  } else {
                    message = i18n.t("auto_ltcpay_made", ltcPayData['ltcQuantity'], getAddressLabel(ltcPayData['myAddr']), ltcPayData['otherOrderQuantity'], ltcPayData['otherOrderAsset']);
                  } 
                  WALLET.showTransactionCompleteDialog(message + " " + i18n.t(ACTION_PENDING_NOTICE), message, armoryUTx);
                }, function() {
                  WAITING_LTCPAY_FEED.add(ltcPayData);
                  bootbox.alert(i18n.t("auto_ltcpay_error"));
                }
              );
            }
          }
        }
      });    
    }
  }


}


/*NOTE: Any code here is only triggered the first time the page is visited. Put JS that needs to run on the
  first load and subsequent ajax page switches in the .html <script> tag*/
