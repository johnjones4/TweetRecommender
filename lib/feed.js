const async = require('async');
const redis = require('redis');
const request = require('request');
const querystring = require('querystring');
const parser = require('rss-parser');
const config = require('../config');

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
      next(null,updatedRssContent);
    },
    function(rssContent,next) {
      async.parallel(
        rssContent.map(function(item) {
          return function(next1) {
            if (!item.hashtags) {
              request({
                'url': 'https://api.aylien.com/api/v1/hashtags?' + querystring.stringify({
                  'url': item.url
                }),
                'headers': {
                  'X-AYLIEN-TextAPI-Application-Key': config.aylien.key,
                  'X-AYLIEN-TextAPI-Application-ID': config.aylien.app
                },
                'json': true
              },function(err,res,body) {
                if (err) {
                  next1(err);
                } else {
                  if (res.body && res.body.headers) {
                    console.log('Hashtag rate limit at ' + res.body.headers['x-ratelimit-remaining']);
                  }
                  if (body.hashtags) {
                    item.hashtags = body.hashtags;
                  } else {
                    item.hashtags = [];
                  }
                  next1();
                }
              })
            } else {
              next1();
            }
          }
        }),
        function(err) {
          next(err,rssContent);
        }
      )
    },
    function(rssContent,next) {
      async.parallel(
        rssContent.map(function(item) {
          return function(next1) {
            if (!item.bitlyUrl) {
              request({
                'url': 'https://api-ssl.bitly.com/v3/shorten?' + querystring.stringify({
                  'login': config.bitly.login,
                  'apiKey': config.bitly.key,
                  'longUrl': item.url
                }),
                'json': true
              },function(err,res,body) {
                if (err) {
                  next1(err);
                } else {
                  if (body.data && body.data.url) {
                    item.bitlyUrl = body.data.url;
                  } else {
                    item.bitlyUrl = item.url;
                  }
                  next1();
                }
              })
            } else {
              next1();
            }
          }
        }),
        function(err) {
          next(err,rssContent);
        }
      )
    },
    function(rssContent,next) {
      rssContent.sort(function(a,b) {
        if (b.hashtags.length != a.hashtags.length) {
          return b.hashtags.length - a.hashtags.length;
        } else {
          return b.date - a.date
        }
      });
      next(null,rssContent);
    },
    function(rssContent,next) {
      exports.setFeed(user,rssContent,next);
    }
  ],done);
}
