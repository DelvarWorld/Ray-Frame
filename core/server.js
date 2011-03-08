var http = require('http'),
	sys = require('sys'),
	fs = require('fs'),
	path = require('path'),
	log = require('./lib/logger'),
	utils = require('./lib/utils'),
	templater = require('./lib/templater'),
    accessors = require('./access_functions'),
	express_lib = require('express'),
    server = module.exports,
    // TODO: Abstract this out into a config file. Roles are descending, so top level (admin) has access to all functions after it
    prefixii = {
		admin: '/access', // Change for one more quip of security
		'public': '/public'
	},
    // TODO: Authentication with login form, maybe user level permissions
    isAdmin = 1;

exports.createServer = function(options, cb) {
    log.log_level = 'info';

    // Set up express and couch and defaults
    var express = express_lib.createServer(),
        // TODO: If couch isn't running we just get a top level exception thrown on first access atempt. Would be nice to
        // tell user to start couch.
        couch_client = require('../../node-couchdb/index.js').createClient(5984, 'localhost'),
        couch = couch_client.db(options.db_name || 'rayframe'),
        theme = options.theme || 'ray-frame',
        core_static = 'core/static/',
        user_static = 'user/themes/'+theme+'/static/';

    this.couch = couch;
    this.express = express;
    express.use(express_lib.bodyParser());
    express.error(function(err, req, res) {
        log.warn('Server error: '+err);
        res.send('what the heck');
    });

    // Internal functions can have silly names, right?
    function prepareForGoTime() {
        // This is the core of URL routing functionality. Set up a handler for static files
        express.get(/.*/, function(req, res) {
            var urlPath = req.url.split('/'),
                dbPath = utils.sanitizeUrl(req.url);

            // Static file handling
            if(urlPath[1] == 'static') {
                // TODO: Right now all static content must be in the static/ directory. This obviously doesn't sit well with things like
                // favicons, rss feeds, etc, that need to be at root level. Should we serve everything in static out of root? Orrr make some
                // things specified as root servable? Design decision needs to be made here
                var stp = req.url.replace('/static', '');
                fs.readFile(user_static + stp, function(err, data) {
                    if(err) {
                        fs.readFile(core_static + stp, function(err, data) {
                            if(err) {
                                log.warn('Non-existant static file was requested (404): `'+req.url+'`: ',err);
                                res.writeHead(404, {'Content-Type': 'text/html'});
                                return res.end('Todo: this should be some standardized 404 page');
                            }
                            res.writeHead(200, {'Content-Type': utils.guessContentType(req.url)});
                            res.end(data.toString());
                        });
                    } else {
                        res.writeHead(200, {'Content-Type': utils.guessContentType(req.url)});
                        res.end(data.toString());
                    }
                });
            } else {
                // This is the handler for any web page. There are URL objects in the database that we look up. So basically every
                // URL on the site has its own URL object which contains the id to the model object, and a parent chain of other
                // URL objects so we can say, build a breadcrumb trail
                couch.getDoc(dbPath, function(err, urlObject) {
                    if(err) {
                        if(err.error == 'not_found') {
                            log.warn('Non-existant page was requested (404): `'+dbPath+'`: ',err);
                            res.writeHead(404, {'Content-Type': 'text/html'});
                            res.end('Todo: This should be some standardized 404 page');
                        } else {
                            log.error('Error fetching URL view `'+dbPath+'`: ',err);
                            res.writeHead(500, {'Content-Type': 'text/html'});
                            res.end('Internal server errrrrrror');
                        }
                    } else {
                        couch.getDoc(urlObject.reference, function(err, page) {
                            if(err) {
                                log.error('!!! URL object found but no page data found ('+urlObject.reference+')!: ',err);
                                res.writeHead(500, {'Content-Type': 'text/html'});
                                res.end('Internal server errrrrrror');
                            } else {
                                server.serveTemplate(urlObject, page, function(err, parsed) {
                                    if(err) {
                                        log.error('Error serving template for `'+req.url+'` (CouchDB key `'+dbPath+'`): ',err);
                                        res.writeHead(500, {'Content-Type': 'text/html'});
                                        res.end('Internal server errrrrrror');
                                    } else {
                                        res.writeHead(200, {'Content-Type': 'text/html'});
                                        res.end(parsed);
                                    }
                                });
                            }
                        });

                    }
                });
            }
        });

        // Tell our template library what theme to use
        templater.setTheme(theme, function(err) {
            if(err) {
                return log.error('Error setting theme!: ',err);
            }

            // Set up our transient functions (functions that can run server and client side, right now for core live in transient.js);
            var t = './transients.js';
            path.exists(t, function(ya) {
                if(ya) {
                    var transients = require(t);
                    for(var x in transients) {
                        templater.addTransientFunction([x, transients[x]]);
                    }
                }
                // Also copy over all the utility functions to be transients
                for(var x in utils) {
                    templater.addTransientFunction([x, utils[x]]);
                }

                templater.addTransientFunction('templater.getInstructions');
                templater.setReferences(isAdmin, couch, prefixii);

                server.setUpAccess(express);

                // Here we go!
                express.listen(options.server_port || 8080);
                log.info('Server running on '+(options.server_port || 8080)+'!');

                if(cb) {
                    cb(null, server);
                }
            });
        });
    }

    if(options.hard_reset) {
        server.resetDatabase(couch, function(err) {
            if(err) {
                return log.error('Fatal error encounted while trying to reset database: ',err);
            }
            prepareForGoTime();
        });
    } else {
        prepareForGoTime();
    }
};

exports.resetDatabase = function(couch, callback) {
    // Reset the database on every startup for now
    couch.exists(function(err, exists) {
        function recreate() {
            couch.create(function(err) {
                if(err) {
                    log.error('There was a fatal error creating the database! ',err);
                    return callback(err);
                } else {
                    log.info('Recreated database `'+couch.name+'`');

                    // Create a view in a design doc TODO: Is there a way to multi these two calls?
                    couch.saveDesign('master', {
                        views: {
                            // Not currently needed, but this is the syntax for a view save
                            'url':{
                                map: function(doc) {
                                    if(doc.reference) {
                                        emit(doc.reference, doc);
                                    }
                                }
                            }
                        }
                    }, function(err) {
                        // Create our homepage object and url object for it
                        couch.bulkDocs({docs: [
                            // Bulkdocs takes _id, not key
                            {_id:'root', template:'index.html', title:'hello'}, // root is special case. Let couch name other keys for page objects
                            {_id:'global', template:'global.html'}, // another by convention
                            {_id:utils.sanitizeUrl('/'), reference:'root', parents:[]}]}, // TODO: Should URLs get their own database, or view?
                            function(err) {
                                log.info('Welcome to Ray-Frame. Your home page has been automatically added to the database.');
                                callback(err);
                        });
                    });
                }
            });
        }

        if(exists) {
            log.info('Existing database found, deleting for development');
            couch.remove(recreate);
        } else {
            recreate();
        }
    });
};

// Set up access functions for admin AJAX calls
exports.setUpAccess = function(express) {
    // Set up each external access function as a post with express
	for(var role in accessors.functions) {
        var funcs = accessors.functions[role];

        function createPost(role, funcs, funcName) {
			express.post((prefixii[role] || '')+'/'+funcName, function(req, res) {
                // TODO: Determine authenticaiton here. Session / cookie based? All higher level roles have access to lower level roles
                if(isAdmin) {
                    exports.couch.getDocsByKey([req.body.current_id, req.body.current_url_id], function(err, result) {
                        funcs[funcName](req, res, result.rows[0].doc, result.rows[1].doc, exports.couch);
                    });
                }
            });
        }

        // Call closure function on every function for this role
        if(funcs) {
            for(var funcName in funcs) {
                createPost(role, funcs, funcName);
            }
        }
    }
};

// Serve a template from cache or get new version
exports.serveTemplate = function(urlObj, pageData, cb) {
	// TODO: Right now we are forcing the recreation of the template from disk. Original plan was to store those parsed files in compiled/ directory. Look into this
	templater.parseTemplate(urlObj, pageData, true, cb);
    
	//try {
		//var f = fs.readFileSync('compiled/'+obj.template);
		//return f;
	//} catch(e) {
		//return parseTemplate(obj);
	//}
};
