const config = require('./config');
const feed = require('./lib/feed');
const web = require('./lib/web');
const tweet = require('./lib/tweet');

feed.init(config.users);
web.init(config.users)
tweet.init(config.users)
