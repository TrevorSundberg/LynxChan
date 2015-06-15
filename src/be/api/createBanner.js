'use strict';

var apiOps = require('../engine/apiOps');
var boardOps = require('../engine/boardOps');

function createBanner(parameters, userData, res) {

  boardOps.addBanner(userData.login, parameters, function createdBanner(error) {
    if (error) {
      apiOps.outputError(error, res);
    } else {
      apiOps.outputResponse(null, null, 'ok', res);
    }
  });

}

exports.process = function(req, res) {

  apiOps.getAuthenticatedData(req, res, function gotData(auth, userData,
      parameters) {

    createBanner(parameters, userData, res);

  });

};