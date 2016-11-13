const async = require('async');
const redis = require('redis');
const parser = require('rss-parser');

const redisClient = redis.createClient({
  'port': (process.env.REDIS_PORT || 6379),
  'host': (process.env.REDIS_HOST || 'localhost'),
});
const FeedRefreshInterval = 3600000;

exports.init = function(usersArray) {
  setInterval(function() {
    refreshUsersRSS(usersArray);
  },FeedRefreshInterval);
  refreshUsersRSS(usersArray);
}

exports.getFeed = function(user,done) {
  redisClient.get(makeUserRSSKey(user),function(err,data) {
    if (err) {
      done(err);
    } else if (!data) {
      done(null,[]);
    } else {
      done(null,JSON.parse(data));
    }
  });
}

exports.setFeed = function(user,feed,done) {
  redisClient.set(makeUserRSSKey(user),JSON.stringify(feed),function(err) {
    done(err);
  });
}

function refreshUsersRSS(usersArray) {
  async.parallel(
    usersArray.map(function(user) {
      return function(next) {
        refreshUserRSS(user,next);
      }
    }),
    function(err) {
      if (err) {
        console.error(err);
      }
    }
  )
}

function makeUserRSSKey(user) {
  return 'rss_content_' + user.id;
}

function refreshUserRSS(user,done) {
  console.log('Refreshing feeds for ' + user.id);
  async.waterfall([
    function(next) {
      redisClient.get(makeUserRSSKey(user),next);
    },
    function(rssContent,next) {
      if (!rssContent) {
        rssContent = [];
      } else {
        rssContent = JSON.parse(rssContent);
      }
      async.parallel(
        user.feeds.map(function(feed) {
          return function(next1) {
            parser.parseURL(feed,next1);
          }
        }),
        function(err,feedContent) {
          if (err) {
            next(err);
          } else {
            feedContent.forEach(function(feed) {
              feed.feed.entries.forEach(function(entry) {
                var found = rssContent.find(function(item) {
                  return item.url == entry.link;
                });
                if (!found) {
                  rssContent.push({
                    'title': entry.title,
                    'url': entry.link,
                    'date': Date.parse(entry.pubDate)
                  })
                }
              })
            });
            next(null,rssContent);
          }
        }
      );
    },
    function(rssContent,next) {
      var now = new Date().getTime();
      var updatedRssContent = rssContent.filter(function(item) {
        return item.date >= now - 86400000;
      });
      updatedRssContent.sort(function(a,b) {
        return b.date - a.date;
      });
      exports.setFeed(user,updatedRssContent,next);
    }
  ],done);
}
