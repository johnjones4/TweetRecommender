const request = require('request');
const querystring = require('querystring');
const kue = require('kue');

const URLBase = 'https://api.twitter.com/1.1/';
const JobName = 'tweet';
const Delay = 60000;

var users;

const queue = kue.createQueue({
  'prefix': 'q',
  'redis': {
    'port': (process.env.REDIS_PORT || 6379),
    'host': (process.env.REDIS_HOST || 'localhost'),
  }
});

queue.on('error',function(err) {
  console.error(err);
});

kue.app.listen(process.env.KUE_PORT || 3000);

process.once('SIGTERM',function ( sig ) {
  queue.shutdown(5000,function(err) {
    if (err) {
      console.error(err);
    }
    process.exit(0);
  });
});

exports.tweet = function(user,tweet) {
  queue.create(JobName, {
    'title': tweet,
    'user': user.id
  }).delay(Math.random() * (86400000 * 3)).save();
}

exports.init = function(usersArray) {
  users = {};
  usersArray.forEach(function(user) {
    users[user.id] = user;
    users[user.id].lastJobTime = 0;
  })
  queue.process(JobName, function(job,done){
    var domain = require('domain').create();
    domain.on('error',function(err){
      done(err);
    });
    domain.run(function(){
      var now = new Date().getTime();
      if (now - users[job.data.user].lastJobTime > Delay) {
        processJob(job,done);
      } else {
        var backoff = ((Math.random() * (Delay / 2)) + Delay) - (now - users[job.data.user].lastJobTime);
        console.log('Delaying job by ' + backoff)
        setTimeout(function() {
          processJob(job,done);
        },backoff);
      }
    });
  });

  function processJob(job,done) {
    users[job.data.user].lastJobTime = new Date().getTime();
    request.post({
      'url': URLBase + 'statuses/update.json?' + querystring.stringify({
        'status': job.data.title
      }),
      'oauth': users[job.data.user].oauth,
      'json': true
    },function(err, r, body) {
      if (err) {
        done(err);
      } else {
        if (body.errors) {
          done(JSON.stringify(body));
        } else {
          done(null,body);
        }
      }
    });
  }
}
