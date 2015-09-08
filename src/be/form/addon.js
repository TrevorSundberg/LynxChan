'use strict';

var formOps = require('../engine/formOps');
var loadedAddons = require('../boot').getGeneralSettings().addons || [];
var lang = require('../engine/langOps').languagePack();
var url = require('url');

exports.process = function(req, res) {

  var requestedAddon = url.parse(req.url).pathname.split('/')[2];

  if (loadedAddons.indexOf(requestedAddon) === -1) {
    formOps.outputError(lang.errUnloadedAddon, 500, res);

  } else {

    require('../addons/' + requestedAddon).formRequest(req, res);

  }

};