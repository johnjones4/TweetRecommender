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

exports.init = function(handles) {
  setInterval(function() {
    refreshHandlesRSS(handles);
  },FeedRefreshInterval);
  refreshHandlesRSS(handles);
}

exports.getFeed = function(handle,done) {
  redisClient.get(makeHandleRSSKey(handle),function(err,data) {
    if (err) {
      done(err);
    } else if (!data) {
      done(null,[]);
    } else {
      done(null,JSON.parse(data));
    }
  });
}

exports.setFeed = function(handle,feed,done) {
  redisClient.set(makeHandleRSSKey(handle),JSON.stringify(feed),function(err) {
    done(err);
  });
}

function refreshHandlesRSS(handles) {
  async.parallel(
    handles.map(function(handle) {
      return function(next) {
        refreshHandleRSS(handle,next);
      }
    }),
    function(err) {
      if (err) {
        console.error(err);
      }
    }
  )
}

function makeHandleRSSKey(handle) {
  return 'rss_content_' + handle.slug;
}

function refreshHandleRSS(handle,done) {
  console.log('Refreshing feeds for ' + handle.name);
  async.waterfall([
    function(next) {
      redisClient.get(makeHandleRSSKey(handle),next);
    },
    function(rssContent,next) {
      if (!rssContent) {
        rssContent = [];
      } else {
        rssContent = JSON.parse(rssContent);
      }
      async.parallel(
        handle.feeds.map(function(feed) {
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
      );
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
      );
    },
    function(rssContent,next) {
      async.parallel(
        rssContent.map(function(item) {
          return function(next1) {
            if (!item.tweet) {
              item.tweet = item.title + ' ' + (item.bitlyUrl || item.url);
              if (item.hashtags) {
                item.hashtags.forEach(function(hashtag) {
                  if ((item.tweet + ' ' + hashtag).length < 140) {
                    item.tweet = (item.tweet + ' ' + hashtag);
                  }
                });
              }
              item.tweet = item.tweet.substring(0,140);
              next1();
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
      exports.setFeed(handle,rssContent,next);
    },
    function(next) {
      console.log('Done refreshing feeds for ' + handle.name);
      next(null);
    }
  ],done);
}
