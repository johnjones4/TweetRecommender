const express = require('express');
const url = require('url');
const bodyParser = require('body-parser');
const feed = require('./feed');
const tweet = require('./tweet');

var users;

exports.init = function(_users) {
  users = _users;
  var app = express();
  app.use(bodyParser.urlencoded({'extended': false}));
  app.set('view engine','ejs');
  app.set('views', __dirname + '/../views');

  app.get('/', function(req,res) {
    res.render('index',{
      'users': users,
      'user': false,
      'feed': false
    });
  });

  app.get('/:id',renderFeed);

  app.post('/:id',function(req,res,next) {
    if (req.params.id) {
      var user = users.find(function(user) {
        return user.id == req.params.id;
      });
      if (user) {
        feed.getFeed(user,function(err,items) {
          if (err) {
            next(err);
          } else {
            req.body['enqueue[]'] = req.body['enqueue[]'].filter(function(rowStr) {
              return !isNaN(parseInt(rowStr));
            });

            if (req.body['tweet[]'] && req.body['enqueue[]']) {
              if (!req.body['tweet[]'].forEach) {
                req.body['tweet[]'] = [req.body['tweet[]']];
              }
              if (!req.body['enqueue[]'].forEach) {
                req.body['enqueue[]'] = [req.body['enqueue[]']];
              }
              var tweets = req.body['enqueue[]'].map(function(rowStr) {
                return req.body['tweet[]'][parseInt(rowStr)];
              });
              tweets.forEach(function(tw) {
                tweet.tweet(user,tw);
              });
            }
            if (req.body['url[]']) {
              if (!req.body['url[]'].forEach) {
                req.body['url[]'] = [req.body['url[]']];
              }
              var urls = req.body['enqueue[]'].map(function(rowStr) {
                return req.body['url[]'][parseInt(rowStr)];
              });
              items.forEach(function(item) {
                if (urls.indexOf(item.url) >= 0) {
                  item.tweeted = true;
                }
              });
              feed.setFeed(user,items,function(err) {
                if (err) {
                  next(err);
                } else {
                  renderFeed(req,res,next);
                }
              });
            } else {
              renderFeed(req,res,next);
            }
          }
        });
      } else {
        res.sendStatus(404);
      }
    } else {
      res.sendStatus(404);
    }
  });

  app.listen(process.env.WEB_PORT || 8000);
}

function renderFeed(req,res,next) {
  if (req.params.id) {
    var user = users.find(function(user) {
      return user.id == req.params.id;
    });
    if (user) {
      feed.getFeed(user,function(err,feed) {
        if (err) {
          next(err);
        } else {
          feed = feed.filter(function(item) {
            return !item.tweeted;
          });
          feed.forEach(function(item) {
            item.title = item.title + ' (' + url.parse(item.url).host + ')';
            item.tweet = item.title + ' ' + item.url;
            item.date = new Date(item.date).toLocaleString({
              'timeZone': 'America/New_York'
            });
          });
          res.render('index',{
            'users': users,
            'user': user,
            'feed': feed
          });
        }
      })
    } else {
      res.sendStatus(404);
    }
  } else {
    res.sendStatus(404);
  }
}
