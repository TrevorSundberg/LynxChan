'use strict';

var formOps = require('../engine/formOps');
var boardOps = require('../engine/boardOps');

function createBanner(parameters, userData, res) {

  boardOps.addBanner(userData.login, parameters, function createdBanner(error) {
    if (error) {
      formOps.outputError(error, 500, res);
    } else {
      formOps.outputResponse('Banner created.',
          '/bannerManagement.js?boardUri=' + parameters.boardUri, res);
    }
  });

}

exports.process = function(req, res) {

  formOps.getAuthenticatedPost(req, res, true, function gotData(auth, userData,
      parameters) {

    createBanner(parameters, userData, res);

  });

};