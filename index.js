const config = require('./config');
const feed = require('./lib/feed');
const web = require('./lib/web');

feed.init(config.handles);
web.init(config.handles)
