var express = require('express');

var ArticleProvider = require('./articleProvider.js').ArticleProvider;
var connect = require('express/node_modules/connect');
var RedisStore = require('connect-redis')(express);
var sessionStore = new RedisStore();
var redis = require("redis");
var client = redis.createClient();
var bcrypt = require('bcrypt'); 

var Session = connect.middleware.session.Session,
    parseCookie = connect.utils.parseCookie

client.on("error", function (err) {
    console.log("Error " + err);
});
var app = module.exports = express.createServer();

// = Configuration

app.configure(function(){
  app.set('views', __dirname + '/views');
  app.set('view engine', 'jade');
  app.use(express.bodyParser());
  app.use(express.cookieParser());
  app.use(express.session({
    store: sessionStore,
    secret: 'shhhhhh',
    key: 'my.sid',
    cookie: {maxAge: 31557600000 }
  }));
  app.use(express.methodOverride());
  app.use(require('stylus').middleware({ src: __dirname + '/public' }));
  app.use(app.router);
  app.use(express.static(__dirname + '/public'));
});

app.configure('development', function(){
  app.use(express.errorHandler({ dumpExceptions: true, showStack: true })); 
});

app.configure('production', function(){
  app.use(express.errorHandler()); 
});

var userProvider = new ArticleProvider('users');
var countProvider = new ArticleProvider('count');

countProvider.getUniqueId('saves', function(error, count) { 
  if (error) {
    console.log('Could not determine count');
  }
  console.log('The count is: ' + count);
});

client.incr("connections", function (err, reply) {
  console.log("This has been run " + reply + " times!");
});


function validateUserData(req, callback) {
  errors = [];
  data = {};
  if (req.param('password')) {
    if (req.param('password').length < 5) {
      errors.push('Password too short.');  
    }
    else if (req.param('password') !== req.param('password_confirm')) {
      errors.push('Passwords did not match.' + req.param('password' + ' ' + req.param('password_confirm')));  
    }
    else {
      var salt = bcrypt.gen_salt_sync(10);  
      var hash = bcrypt.encrypt_sync(req.param('password'), salt);
      data.password = hash;
    }
  }
  else if (!req.param('id')) {
    errors.push('Password required.');  
  }
  if (!req.param('username')) {
    errors.push('Username required.');  
  }
  if (!req.param('name')) {
    errors.push('Name required.');  
  }
  if (!/.*@.*\..*/.test(req.param('email'))){
    errors.push('Valid email required.');  
  }
  if (errors.length == 0) {
    data.name = req.param('name');
    data.username = req.param('username');
    data.email = req.param('email');
    if (req.user.is_root) {
      data.is_root = req.param('is_root');
      data.is_admin = req.param('is_admin');
    }
    userProvider.find({_id: {$ne: parseInt(req.params.id)},
                          $or: [{username: req.param('username')},
                                {email: req.param('email')}]
                      }, function (error, users) {
      if (users.length > 0) {
        for (var i in users) {
          if (typeof users[i] !== 'function') {
            if (users[i].username == req.param('username')) {
              errors.push('Username already taken.');  
            }
            if (users[i].email == req.param('email')) {
              errors.push('Email Address already taken.');  
            }
          }
        }
        callback(errors);
      }
      else {
        callback( null, data);
      }
    });
  }
  else {
    callback(errors);
  }
}

function loadUser(req, res, next) {
  if (req.session.user && req.cookies.rememberme) {
    req.user = req.session.user;
  }
  else {
    req.user = {};
  }
  req.meOrAdmin = false;
  req.meOrRoot = false;
  if (req.params.id == req.user._id || req.user.is_root || req.user.is_admin) {
    req.meOrAdmin = true;
  }
  if (req.params.id == req.user._id || req.user.is_root) {
    req.meOrRoot = true;
  }
  next();
}

// Routes
app.get('/', loadUser, function(req, res){
  res.render('index', {
    title: 'Fun', loggedInUser:req.user 
  });
});

app.get('/about', loadUser, function(req, res){
  res.render('about', {
    title: 'About', loggedInUser:req.user 
  });
});

app.get('/posts', loadUser, function(req, res){
  userProvider.findAll(function(error, posts) { 
    res.render('posts', { posts: posts, title: 'Posts', loggedInUser:req.user  });
  });
});

app.get('/users', loadUser, function(req, res){
  userProvider.findAll(function(error, users) { 
    res.render('users', { users: users, title: 'Users', loggedInUser:req.user });
  });
});

app.get('/user/:id/edit', loadUser, function(req, res, next){
  if (req.meOrAdmin) {
    localScripts = '$(document).ready(function(){$(\'#userForm\').validate();});';
    userProvider.findById(req.params.id, function(error, user) {
      res.render('users/edit', { user: user, title: 'User ' + req.params.id, loggedInUser:req.user });
    });
  }
  else {
    res.redirect('/users');
  }
});

app.get('/user/:id/remove', loadUser, function(req, res, next){
  if (req.params.id === 'null') {
    res.redirect('/users');
  }
  // TEST!!!! 
  if (req.meOrAdmin) {
    userProvider.remove(req.params.id, function(error, id){
      console.log('Deleted user ' + id);
    });
    if (req.user._id == req.params.id) { 
      res.redirect('/logout');
    }
    else {
      res.redirect('/users');
    }
  }
  else {
    console.log(typeof req.user._id + ' can\'t delete this user! ' + typeof req.params.id);
    res.redirect('/users')
  }
});

app.get('/user/create', loadUser, function(req, res, next){
  localScripts = '$(document).ready(function(){$(\'#userForm\').validate();});';
  res.render('users/create', { title: 'New User', user: {_id:'',username:'',name:'',email:''}, loggedInUser:req.user });
});

app.post('/user/submit/0?', loadUser, function(req, res, next){
  data = {};
  validateUserData(req, function (error, data){
    if (error) {
      console.log('Errors: ' + error);
      res.redirect('/user/create/?' + error);
    }
    else {
      countProvider.getUniqueId('users', function(error, id) {
        data._id = id;
        userProvider.save( data, function( error, docs) {
          res.redirect('/user/' + id);
        });
      });
    }
  });
});

app.post('/user/submit/:id', loadUser, function(req, res){
  if (req.meOrAdmin) {
    data = {};
    validateUserData(req, function (error, data){
      if (error) {
        console.log('Errors: ' + error);
        res.redirect('/user/' + req.params.id + '/edit/?' + error);
      }
      else {
        userProvider.update({
          _id: req.params.id,
          data : data
        }, function( error, docs) {
          res.redirect('/user/' + req.params.id);
        });
      }
    });
  }
  else {
    res.redirect('/');
  }
});

app.get('/user/:id', loadUser, function(req, res, next){
  userProvider.findById(req.params.id, function(error, user) {
    res.render('users/user', { user: user, title: 'User ' + req.params.id, loggedInUser:req.user });
  });
});

app.post('/login', loadUser, function(req, res){
  if (req.param('username') && req.param('password')) {
    userProvider.findOne({username: req.param('username')}, function (error, user) {
      if (error || !user) {
        console.log('Couldn\'t find user! ' + req.param('username'));
      }
      else {
        if (bcrypt.compare_sync(req.param('password'), user.password)) {
          if (req.session) {
            console.log('Someone logged in! ' + req.param('username') + ' ' + user._id);
            req.session.user = user;
            if (req.param('remember') == 'on') {
              res.cookie('rememberme', 'yes', { maxAge: 31557600000});
            }
            else {
              res.cookie('rememberme', 'yes');
            }
          }
        }
        else {
          console.log('Wrong password for ' + user.username + '!');
        }
      }
      res.redirect('back');
    });
  }
});

app.get('/logout', function(req, res){
    if (req.session.user) {
      console.log('Logging Out: ' + req.session.user.username);
      delete req.session.user;
      res.clearCookie('rememberme', {path:'/'});
    }
    res.redirect('/');
});

app.listen(3000);
console.log("Express server listening on port %d in %s mode", app.address().port, app.settings.env);
