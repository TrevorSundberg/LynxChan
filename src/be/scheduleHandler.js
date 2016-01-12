'use strict';

var fs = require('fs');
var kernel = require('./kernel');
var settingsHandler = require('./settingsHandler');
var settings = settingsHandler.getGeneralSettings();
var verbose = settings.verbose;
var tempDirectory = settings.tempDirectory;
var captchaExpiration = settings.captchaExpiration;
var debug = kernel.debug();
var gridFsHandler = require('./engine/gridFsHandler');
var db = require('./db');
var delOps = require('./engine/deletionOps').miscDeletions;
var boards = db.boards();
var stats = db.stats();
var uniqueIps = db.uniqueIps();
var files = db.files();
var torHandler = require('./engine/torOps');

// handles schedules in general.
// currently it handles the removal of expired captcha's images, applies board
// hourly stats and removes invalid temporary files.

exports.reload = function() {

  settings = settingsHandler.getGeneralSettings();

  verbose = settings.verbose;
  tempDirectory = settings.tempDirectory;
  captchaExpiration = settings.captchaExpiration;
  gridFsHandler = require('./engine/gridFsHandler');
  delOps = require('./engine/deletionOps').miscDeletions;
  torHandler = require('./engine/torOps');
};

exports.start = function() {

  if (debug) {
    tempFiles(true);
  }

  if (!settings.master) {
    expiredCaptcha(true);
    boardsStats();
    torRefresh();
    early404(true);
    uniqueIpCount();
  }

};

// Section 1: Early 404 check {
function cleanEarly404() {

  delOps.cleanEarly404(function cleanedUp(error) {
    if (error) {
      if (verbose) {
        console.log(error);
      }

      if (debug) {
        throw error;
      }
    }

    early404();
  });
}

function early404(immediate) {

  if (immediate) {
    cleanEarly404();
  } else {

    setTimeout(function() {
      cleanEarly404();
    }, 1000 * 60 * 30);
  }
}
// } Section 1: Early 404 check

// Section 2: TOR refresh {
function refreshTorEntries() {

  torHandler.updateIps(function updatedTorIps(error) {
    if (error) {

      if (verbose) {
        console.log(error);
      }

      if (debug) {
        throw error;
      }
    }

    torRefresh();

  });

}

function torRefresh() {

  var nextRefresh = new Date();

  nextRefresh.setUTCSeconds(0);
  nextRefresh.setUTCMinutes(0);
  nextRefresh.setUTCHours(0);
  nextRefresh.setUTCDate(nextRefresh.getUTCDate() + 1);

  setTimeout(function() {
    refreshTorEntries();
  }, nextRefresh.getTime() - new Date().getTime());

}
// } Section 2: TOR refresh

// Section 3: Board stats recording {
function applyStats(stats) {

  var operations = [];

  var foundBoards = [];

  for (var i = 0; i < stats.length; i++) {
    var stat = stats[i];

    foundBoards.push(stat.boardUri);

    operations.push({
      updateOne : {
        filter : {
          boardUri : stat.boardUri
        },
        update : {
          $set : {
            postsPerHour : stat.posts
          }
        }
      }
    });
  }

  operations.push({
    updateMany : {
      filter : {
        boardUri : {
          $nin : foundBoards
        }
      },
      update : {
        $set : {
          postsPerHour : 0
        }
      }
    }
  });

  boards.bulkWrite(operations, function updatedStats(error) {
    if (error) {
      if (verbose) {
        console.log(error.toString());
      }

      if (debug) {
        throw error;
      }
    } else {

      if (settings.topBoardsCount) {
        require('./generationQueue').queue({
          frontPage : true
        });
      }

      boardsStats();
    }

  });

}

function getStats() {

  var timeToApply = new Date();
  timeToApply.setUTCMilliseconds(0);
  timeToApply.setUTCSeconds(0);
  timeToApply.setUTCMinutes(0);
  timeToApply.setUTCHours(timeToApply.getUTCHours() - 1);

  if (verbose) {
    console.log('Applying stats for ' + timeToApply);
  }

  stats.aggregate([ {
    $match : {
      startingTime : timeToApply
    }
  }, {
    $group : {
      _id : 0,
      stats : {
        $push : {
          boardUri : '$boardUri',
          posts : '$posts'
        }
      }
    }
  } ], function gotStats(error, result) {

    if (error) {
      if (verbose) {
        console.log(error.toString());
      }
      if (debug) {
        throw error;
      }

    } else if (!result.length) {
      applyStats([]);
    } else {
      applyStats(result[0].stats);
    }

  });

}

function boardsStats() {

  var tickTime = new Date();

  var current = tickTime.getTime();

  tickTime.setUTCMilliseconds(0);
  tickTime.setUTCSeconds(5);
  tickTime.setUTCMinutes(0);
  tickTime.setUTCHours(tickTime.getUTCHours() + 1);

  setTimeout(function() {

    getStats();

  }, tickTime.getTime() - current);
}
// } Section 3: Board stats recording

// Section 4: Temp files cleanup {
function oldEnoughToDelete(date) {

  date.setMinutes(date.getMinutes() + 1);

  return new Date() > date;

}

function iterateFiles(files) {

  if (files.length) {
    var file = tempDirectory + '/' + files.shift();

    fs.stat(file, function gotStats(error, stats) {

      if (error) {
        throw error;
      } else {

        var deleteFile = stats.isFile() && !stats.size;

        if (deleteFile && oldEnoughToDelete(stats.ctime)) {

          if (verbose) {
            console.log('Removing expired tmp file ' + file);
          }

          fs.unlink(file);
        }

        iterateFiles(files);
      }

    });
  } else {
    tempFiles();

  }

}

function removeExpiredTempFiles() {
  fs.readdir(tempDirectory, function gotFiles(error, files) {
    if (error) {
      throw error;
    } else {
      iterateFiles(files);
    }

  });
}

function tempFiles(immediate) {

  if (immediate) {
    removeExpiredTempFiles();
  } else {
    setTimeout(function() {
      removeExpiredTempFiles();
    }, 1000 * 60);
  }

}
// } Section 4: Temp files cleanup

// Section 5: Captcha cleanup {
function expiredCaptcha(immediate) {
  if (immediate) {
    checkExpiredCaptchas();
  } else {

    setTimeout(function() {
      checkExpiredCaptchas();
    }, captchaExpiration * 1000 * 1);

  }
}

function checkExpiredCaptchas() {

  files.aggregate([ {
    $match : {
      'metadata.type' : 'captcha',
      'metadata.expiration' : {
        $lte : new Date()
      }
    }
  }, {
    $group : {
      _id : 0,
      files : {
        $push : '$filename'
      }
    }
  } ], function gotExpiredFiles(error, results) {
    if (error) {

      if (verbose) {
        console.log(error);
      }

      if (debug) {
        throw error;
      }

    } else if (results.length) {

      var expiredFiles = results[0].files;

      if (verbose) {
        var message = 'Deleting expired captchas: ';
        message += JSON.stringify(expiredFiles, null, 2);
        console.log(message);
      }

      // style exception, too simple
      gridFsHandler.removeFiles(expiredFiles, function deletedFiles(error) {
        if (error) {
          if (verbose) {
            console.log(error);
          }

          if (debug) {
            throw error;
          }
        } else {
          expiredCaptcha();
        }
      });

      // style exception, too simple

    } else {
      expiredCaptcha();
    }
  });

}
// } Section 5: Captcha cleanup

// Section 6: Unique IP counting {
function setUniqueIpCount(results) {

  var operations = [];
  var foundBoards = [];

  for (var i = 0; i < results.length; i++) {

    var result = results[i];

    foundBoards.push(result.boardUri);

    operations.push({
      updateOne : {
        filter : {
          boardUri : result.boardUri
        },
        update : {
          $set : {
            uniqueIps : result.count
          }
        }
      }
    });

  }

  operations.push({
    updateMany : {
      filter : {
        boardUri : {
          $nin : foundBoards
        }
      },
      update : {
        $set : {
          uniqueIps : 0
        }
      }
    }
  });

  boards.bulkWrite(operations, function updatedUniqueIps(error) {

    if (error) {
      if (verbose) {
        console.log(error.toString());
      }

      if (debug) {
        throw error;
      }
    }

    if (settings.topBoardsCount) {
      require('./generationQueue').queue({
        frontPage : true
      });
    }

    uniqueIpCount();

  });

}

function updateUniqueIpCount() {

  uniqueIps.aggregate([ {
    $project : {
      boardUri : 1,
      count : {
        $size : '$ips'
      }
    }
  } ], function gotCount(error, results) {

    if (error) {

      if (verbose) {
        console.log(error);
      }

      if (debug) {
        throw error;
      }
    }

    uniqueIps.deleteMany({});

    setUniqueIpCount(results);

  });

}

function uniqueIpCount() {

  var nextRefresh = new Date();

  nextRefresh.setUTCSeconds(0);
  nextRefresh.setUTCMinutes(0);
  nextRefresh.setUTCHours(0);
  nextRefresh.setUTCDate(nextRefresh.getUTCDate() + 1);

  setTimeout(function() {
    updateUniqueIpCount();
  }, nextRefresh.getTime() - new Date().getTime());

}
// } Section 6: Unique IP counting
