const express = require('express');
const url = require('url');
const async = require('async');
const bodyParser = require('body-parser');
const feed = require('./feed');
const RSS = require('rss');
const basicAuth = require('basic-auth-connect');
const config = require('../config');

var handles;

exports.init = function(_handles) {
  handles = _handles;
  var app = express();
  app.use(bodyParser.json());
  app.set('view engine','ejs');
  app.set('views', __dirname + '/../views');

  if (config.auth) {
    app.use(basicAuth(config.auth.username, config.auth.password));
  }

  app.get('/', function(req,res) {
    res.render('index',{});
  });

  app.get('/handle',function(req,res,next) {
    async.series(
      handles.map(function(handle) {
        return function(next1) {
          makeApiHandle(handle,next1);
        }
      }),
      function(err,outHandles) {
        if (err) {
          next(err);
        } else {
          res.send(outHandles);
        }
      }
    )
  });

  app.get('/handle/:slug',function(req,res,next) {
    if (req.params.slug) {
      var handle = handles.find(function(handle) {
        return handle.slug == req.params.slug;
      });
      if (handle) {
        makeApiHandle(handle,function(err,handle) {
          if (err) {
            next(err);
          } else {
            res.send(handle);
          }
        });
      } else {
        res.sendStatus(404);
      }
    } else {
      res.sendStatus(404);
    }
  });

  app.put('/handle/:slug',function(req,res,next) {
    if (req.params.slug) {
      var handle = handles.find(function(handle) {
        return handle.slug == req.params.slug;
      });
      if (handle) {
        async.waterfall([
          function(next1) {
            feed.setFeed(handle,req.body.items,function(err) {
              next1(err);
            });
          },
          function(next1) {
            makeApiHandle(handle,next1);
          }
        ],function(err,handle) {
          if (err) {
            next(err);
          } else {
            res.send(handle);
          }
        });
      } else {
        res.sendStatus(404);
      }
    } else {
      res.sendStatus(404);
    }
  });

  app.get('/:slug/feed',function(req,res,next) {
    if (req.params.slug) {
      var handle = handles.find(function(handle) {
        return handle.slug == req.params.slug;
      });
      if (handle) {
        feed.getFeed(handle,function(err,feed) {
          if (err) {
            next(err);
          } else {
            feed = feed.filter(function(item) {
              return item.shouldTweet;
            });
            var rssFeed = new RSS({
              'title': 'Tweets for ' + handle.name,
              'pubDate': new Date()
            });
            feed.forEach(function(item) {
              rssFeed.item({
                'title': item.tweet,
                'description': url.parse(item.url).host,
                'url': item.url,
                'date': new Date(item.date)
              })
            });
            res.setHeader('Content-type','application/xml');
            res.send(rssFeed.xml());
          }
        })
      } else {
        res.sendStatus(404);
      }
    } else {
      res.sendStatus(404);
    }
  });

  app.listen(process.env.WEB_PORT || 8000);
}

function makeApiHandle(handle,done) {
  feed.getFeed(handle,function(err,items) {
    if (err) {
      done(err);
    } else {
      done(null,{
        'slug': handle.slug,
        'name': handle.name,
        'items': items
      });
    }
  });
}
