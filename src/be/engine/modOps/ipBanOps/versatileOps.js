'use strict';

var mongo = require('mongodb');
var ObjectID = mongo.ObjectID;
var db = require('../../../db');
var logs = db.logs();
var bans = db.bans();
var flood = db.flood();
var boards = db.boards();
var proxyBans = db.proxyBans();
var settings = require('../../../settingsHandler').getGeneralSettings();
var blockTor = settings.torAccess < 1;
var blockProxy = settings.proxyAccess < 1;
var disableFloodCheck = settings.disableFloodCheck;
var lang;
var logger;
var miscOps;
var torOps;
var common;

exports.loadDependencies = function() {

  common = require('..').common;
  torOps = require('../../torOps');
  logger = require('../../../logger');
  lang = require('../../langOps').languagePack();
  miscOps = require('../../miscOps');

};

// Section 1: Bans {
exports.readBans = function(parameters, callback) {
  var queryBlock = {
    ip : {
      $exists : true
    },
    expiration : {
      $gt : new Date()
    },
    boardUri : parameters.boardUri ? parameters.boardUri : {
      $exists : false
    }
  };

  bans.find(queryBlock, {
    reason : 1,
    expiration : 1,
    appliedBy : 1
  }).sort({
    creation : -1
  }).toArray(function gotBans(error, bans) {
    callback(error, bans);
  });
};

exports.getBans = function(userData, parameters, callback) {

  var isOnGlobalStaff = userData.globalRole < miscOps.getMaxStaffRole();

  if (parameters.boardUri) {
    boards.findOne({
      boardUri : parameters.boardUri
    }, function gotBoard(error, board) {
      if (error) {
        callback(error);
      } else if (!board) {
        callback(lang.errBoardNotFound);
      } else if (!common.isInBoardStaff(userData, board, 2)) {
        callback(lang.errDeniedBoardBanManagement);
      } else {
        exports.readBans(parameters, callback);
      }
    });
  } else if (!isOnGlobalStaff) {
    callback(lang.errDeniedGlobalBanManagement);
  } else {
    exports.readBans(parameters, callback);
  }

};
// } Section 1: Bans

// Section 2: Ban check {
exports.getActiveBan = function(ip, boardUri, callback) {

  var range = miscOps.getRange(ip);

  var singleBanAnd = {
    $and : [ {
      expiration : {
        $gt : new Date()
      }
    }, {
      ip : ip
    } ]
  };

  var rangeBanCondition = {
    range : range
  };

  var globalOrLocalOr = {
    $or : [ {
      boardUri : boardUri
    }, {
      boardUri : {
        $exists : false
      }
    } ]
  };

  var finalCondition = {
    $and : [ globalOrLocalOr, {
      $or : [ rangeBanCondition, singleBanAnd ]
    } ]
  };

  bans.findOne(finalCondition, callback);

};

exports.checkForBan = function(req, boardUri, callback) {

  torOps.markAsTor(req, function markedAsTor(error) {
    if (error) {
      callback(error);
    } else if (req.isTor) {
      callback(blockTor ? lang.errBlockedTor : null);
    } else if (req.isProxy) {
      if (blockProxy) {
        callback(lang.errBlockedProxy);
      } else {

        proxyBans.findOne({
          proxyIp : logger.ip(req, true),
          boardUri : {
            $in : [ boardUri, null ]
          }
        }, callback);
      }

    } else {

      var ip = logger.ip(req);

      // style exception, too simple
      flood.findOne({
        ip : ip,
        expiration : {
          $gt : new Date()
        }
      }, function gotFlood(error, flood) {
        if (error) {
          callback(error);
        } else if (flood && !disableFloodCheck) {
          callback(lang.errFlood);
        } else {
          exports.getActiveBan(ip, boardUri, callback);
        }
      });
      // style exception, too simple

    }

  });

};
// } Section 2: Ban check

// Section 3: Lift ban {
exports.getLiftedBanLogMessage = function(ban, userData) {

  var pieces = lang.logBanLift;

  var logMessage = pieces.startPiece.replace('{$login}', userData.login);

  if (ban.ip) {

    if (!ban.boardUri) {
      logMessage += pieces.globalBanPiece;
    } else {
      logMessage += pieces.boardBanPiece.replace('{$board}', ban.boardUri);
    }

    logMessage += pieces.finalBanPiece.replace('{$ban}', ban._id).replace(
        '{$expiration}', ban.expiration);
  } else if (ban.range) {

    if (!ban.boardUri) {
      logMessage += pieces.globalRangeBanPiece;
    } else {
      logMessage += pieces.boardRangeBanPiece.replace('{$board}', ban.boardUri);
    }

    logMessage += pieces.finalRangeBanPIece.replace('{$range}', ban.range);

  } else {
    logMessage += pieces.unknownPiece.replace('{$ban}', ban._id);
  }

  return logMessage;
};

exports.removeBan = function(ban, userData, callback) {

  bans.deleteOne({
    _id : new ObjectID(ban._id)
  }, function banRemoved(error) {

    if (error) {
      callback(error);
    } else {
      // style exception, too simple

      var logMessage = exports.getLiftedBanLogMessage(ban, userData);

      logs.insert({
        user : userData.login,
        global : ban.boardUri ? false : true,
        time : new Date(),
        description : logMessage,
        type : 'banLift',
        boardUri : ban.boardUri
      }, function insertedLog(error) {
        if (error) {

          logger.printLogError(logMessage, error);
        }

        callback(null, ban.range ? true : false, ban.boardUri);
      });

      // style exception, too simple
    }

  });

};

exports.checkForBoardBanLiftPermission = function(ban, userData, callback) {

  boards.findOne({
    boardUri : ban.boardUri
  }, function gotBoard(error, board) {
    if (error) {
      callback(error);
    } else if (!board) {
      callback();
    } else {

      if (common.isInBoardStaff(userData, board, 2)) {
        exports.removeBan(ban, userData, callback);
      } else {
        callback(lang.errDeniedBoardBanManagement);
      }
    }
  });

};

exports.liftBan = function(userData, parameters, callback) {

  var globalStaff = userData.globalRole < miscOps.getMaxStaffRole();

  try {
    bans.findOne({
      _id : new ObjectID(parameters.banId)
    }, function gotBan(error, ban) {
      if (error) {
        callback(error);
      } else if (!ban) {
        callback();
      } else if (ban.boardUri) {
        exports.checkForBoardBanLiftPermission(ban, userData, callback);
      } else if (!globalStaff) {
        callback(lang.errDeniedGlobalBanManagement);
      } else {
        exports.removeBan(ban, userData, callback);
      }
    });
  } catch (error) {
    callback(error);
  }

};
// } Section 3: Lift ban