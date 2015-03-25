
function WalletOptionsModalViewModel() {
  var self = this;
  
  self.shown = ko.observable(false);
  self.availableThemes = ko.observableArray([
    {'id': 'ultraLight',   'name': i18n.t('theme_ultra_light'),   'styleName': 'smart-style-2'},
    {'id': 'simpleGrey',   'name': i18n.t('theme_simple_grey'),   'styleName': 'smart-style-0'},
    {'id': 'darkElegance', 'name': i18n.t('theme_dark_elegance'), 'styleName': 'smart-style-1'},
    {'id': 'googleSkin',   'name': i18n.t('theme_google_skin'),   'styleName': 'smart-style-3'}
  ]);

  self.availableLTCPayMethods = ko.observableArray([
    {'id': 'auto',   'name': i18n.t('automatic')},
    {'id': 'manual', 'name': i18n.t('manual')}
  ]);
  
  //set these properties to null as PREFERENCES is not available until login happens (they will be formally set on login)
  self.selectedLTCPayMethod = ko.observable(null); //set in login.js
  self.selectedTheme = ko.observable(null);
  self.ORIG_PREFERENCES_JSON = null;
  
  //Info table related props
  self.infoTableShown = ko.observable(false);
  self.myIPAddr = ko.observable('');
  self.myCookie = ko.observable('');
  self.myCountry = ko.observable('');

  var pctValidator = {
    required: true,
    isValidPositiveQuantityOrZero: self,
    max: 100
  }
  self.minLTCFeeProvidedPct = ko.observable(FEE_FRACTION_DEFAULT_FILTER).extend(pctValidator);
  self.maxLTCFeeRequiredPct = ko.observable(FEE_FRACTION_DEFAULT_FILTER).extend(pctValidator);
  self.defaultLTCFeeProvidedPct = ko.observable(FEE_FRACTION_PROVIDED_DEFAULT_PCT).extend(pctValidator);
  self.defaultLTCFeeRequiredPct = ko.observable(FEE_FRACTION_REQUIRED_DEFAULT_PCT).extend(pctValidator);

  self.orderDefaultExpiration = ko.observable(ORDER_DEFAULT_EXPIRATION).extend({
    required: true,
    isValidPositiveInteger: self
  });
  self.orderLTCSellDefaultExpiration = ko.observable(ORDER_LTCSELL_DEFAULT_EXPIRATION).extend({
    required: true,
    isValidPositiveInteger: self
  });

  self.showAdvancedOptions = ko.observable(false);
  self.urlPassword = ko.observable('');
  self.walletUrl = ko.computed(function() {
    if (self.urlPassword().length > 0 && WALLET.BITCOIN_WALLET) {
      return WALLET.BITCOIN_WALLET.getQuickUrl(self.urlPassword());
    }
  });

  self.advancedOptionValidation = ko.validatedObservable({
    minLTCFeeProvidedPct: self.minLTCFeeProvidedPct,
    maxLTCFeeRequiredPct: self.maxLTCFeeRequiredPct,
    defaultLTCFeeProvidedPct: self.defaultLTCFeeProvidedPct,
    defaultLTCFeeRequiredPct: self.defaultLTCFeeRequiredPct,
    orderDefaultExpiration: self.orderDefaultExpiration,
    orderLTCSellDefaultExpiration: self.orderLTCSellDefaultExpiration
  });
  
  self.dispMyCookiePresent = ko.computed(function() {
    return self.myCookie() ? i18n.t('present') : i18n.t('none');
  }, self);
  
  self.dispCWURLS = ko.computed(function() {
    return cwURLs() ? cwURLs().join(', ') : i18n.t('unknown');
  }, self);

  self.selectedLTCPayMethod.subscribeChanged(function(newSelection, prevSelection) {
    //if(!newSelection) newSelection = self.availableLTCPayMethods()[0]; //hack
    //assert(_.contains(['autoescrow', 'auto', 'manual'], newSelection));
    newSelection = ko.utils.arrayFirst(self.availableLTCPayMethods(), function(item) { return newSelection === item.id; });
    if (!newSelection) return;
    prevSelection = (prevSelection
      ? ko.utils.arrayFirst(self.availableLTCPayMethods(), function(item) { return prevSelection === item.id; }) : self.availableLTCPayMethods()[0]);
    if (prevSelection) {
      $.jqlog.debug("Changing ltcpay_method from " + prevSelection['name'] + " to " + newSelection['name']);
    }
    PREFERENCES['ltcpay_method'] = newSelection['id'];
  });
  
  self.addAutoLTCEscrowOptionIfAvailable = function() {
    if(AUTO_LTC_ESCROW_ENABLE) {
      self.availableLTCPayMethods.unshift({'id': 'autoescrow', 'name': i18n.t('automatic_escrow')});
    }
  }
  
  self.selectedTheme.subscribeChanged(function(newSelection, prevSelection) {
    newSelection = ko.utils.arrayFirst(self.availableThemes(), function(item) { return newSelection === item.id; });
    if (!newSelection) return;
    prevSelection = (prevSelection
      ? ko.utils.arrayFirst(self.availableThemes(), function(item) { return prevSelection === item.id; }) : self.availableThemes()[0]);
    
    $.jqlog.debug("Changing theme from " + prevSelection['name'] + " to " + newSelection['name']);
    $('body').removeClass(prevSelection['styleName']);
    $('body').addClass(newSelection['styleName']);
    if(PREFERENCES['selected_theme'] != newSelection['id']) {
      PREFERENCES['selected_theme'] = newSelection['id'];
    }
  });
  
  self.show = function(resetForm) {
    document.getElementById('urlPassword').autocomplete = 'off';
    self.urlPassword('');

    if(typeof(resetForm) === 'undefined') resetForm = true;
    self.ORIG_PREFERENCES_JSON = JSON.stringify(PREFERENCES); //store to be able to tell if we need to update prefs on the server

    //display current settings into the options UI
    self.selectedLTCPayMethod(PREFERENCES['ltcpay_method']);
    self.selectedTheme(PREFERENCES['selected_theme']);
    
    //ghetto ass hack -- select2 will not set itself properly when using the 'optionsValue' option, but it will
    // not fire off events when NOT using this option. wtf... o_O
    $('#themeSelector').select2("val", self.selectedTheme());
    $('#ltcPayMethodSelector').select2("val", self.selectedLTCPayMethod());

    self.getReflectedHostInfo();
    
    self.shown(true);
  }  

  self.getReflectedHostInfo = function() {
    failoverAPI("get_reflected_host_info", {}, function(data, endpoint) {
      $.jqlog.debug(data);

      self.myIPAddr(data['ip']);
      self.myCookie(data['cookie']);
      self.myCountry(data['country']);
    });
  }

  self.showInfoTable = function() {
    self.infoTableShown(true);
  }

  self.hide = function() {
    if(self.ORIG_PREFERENCES_JSON != JSON.stringify(PREFERENCES)) { //only update the preferences if they have changed
      WALLET.storePreferences();
    }
    self.shown(false);
  }  
}

/*NOTE: Any code here is only triggered the first time the page is visited. Put JS that needs to run on the
  first load and subsequent ajax page switches in the .html <script> tag*/
