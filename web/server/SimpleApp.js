'use strict';

// const express = require('express');
// const app = express();
// const bodyParser = require('body-parser');
// const cors = require('cors');

// const EventHub = require('fabric-client/lib/EventHub.js'); // TEMP -- shouldn't have to require source internal to a module
// const FabricCAServices = require('fabric-ca-client');
// const FabricClient = require('fabric-client');
// const FabricClientUtils = require('fabric-client/lib/utils.js');
// const fs = require('fs');
// const http = require('http');
// const path = require('path');
const SimpleClient = require('./SimpleClient.js');
const winston = require('winston');
// const util = require('util');

function assert (condition, message) {
    if (!condition) {
        logger.error('!!! assert FAILED !!! message: ' + message);
        logger.error('!!! stack trace:');
        const err = new Error(message);
        logger.error(err.stack);
        throw err;
    }
}

function sleep (milliseconds) {
    return new Promise(resolve => setTimeout(resolve, milliseconds));
}

const logger = new(winston.Logger)({
    level: 'debug',
    transports: [
        new(winston.transports.Console)({
            colorize: true
        }),
    ]
});

// Make node do something more reasonable with this type of error.
process.on('unhandledRejection', (r) => logger.error(r));

// ../../netcfg.json is the read-only configuration for peer network
// ../../appcfg.json is the read-only configuration for application
const simple_client = new SimpleClient(require('../../netcfg.json'), require('../../appcfg.json'));

function sleep__p (delay_milliseconds) {
    for (let i = 0; i < 10; i++) {
        logger.debug('---------------------------------------------------------------------------');
    }
    logger.debug('-- BEGIN sleeping for %d ms', delay_milliseconds);
    return sleep(delay_milliseconds)
    .then(() => {
        logger.debug('-- DONE sleeping for %d ms', delay_milliseconds);
        for (let i = 0; i < 10; i++) {
            logger.debug('---------------------------------------------------------------------------');
        }
    });
}

Promise.resolve()
.then(() => {
    return simple_client.create_kvs_for_each_org__p()
})
.then(() => {
    return simple_client.enroll_all_users_for_each_org__p()
})
.then(() => {
    return simple_client.create_channels__p()
})
.then(() => {
    // This wait appears to be necessary -- is there some event that must be listened for
    // in order to wait for channel creation to complete?  Why doesn't it do that already?
    return sleep__p(1000)
})
.then(() => {
    return simple_client.join_channels__p()
})
.then(() => {
    const channel_name = 'mychannel';
    return simple_client.install_and_instantiate_chaincode_on_channel__p({
        channel_name: channel_name,
        invoking_user_name_for_org: { // TEMP HACK -- probably use channel joiner user
            'org0': 'Admin',
            'org1': 'Admin'
        },
        fcn: 'init',
        args: ['alice', '123', 'bob', '456']
    });
})
.then(() => {
    // This wait appears to be necessary -- is there some event that must be listened for
    // in order to wait for install/instantiate to complete?  Why doesn't it do that already?
    return sleep__p(5000)
})
.then(() => {
    const channel_name = 'mychannel';
    return Promise.all([
        simple_client.query__p({
            channel_name: channel_name,
            invoking_user_name: 'Admin', // TEMP HACK
            invoking_user_org_name: 'org0',
            fcn: 'query',
            args: ['alice']
        }),
        simple_client.query__p({
            channel_name: channel_name,
            invoking_user_name: 'Admin', // TEMP HACK
            invoking_user_org_name: 'org0',
            fcn: 'query',
            args: ['bob']
        })
    ]);
})
.then(balances => {
    logger.debug('balances = %j', balances);
    assert(balances[0] == '123' && balances[1] == '456', 'got incorrect balances from queries');
})
.then(() => {
    const channel_name = 'mychannel';
    return simple_client.invoke__p({
        channel_name: channel_name,
        invoking_user_name: 'Admin', // TEMP HACK
        invoking_user_org_name: 'org0',
        fcn: 'move',
        args: ['alice', 'bob', '20'],
        query_only: false
    });
})
.then(() => {
    const channel_name = 'mychannel';
    return Promise.all([
        simple_client.query__p({
            channel_name: channel_name,
            invoking_user_name: 'Admin', // TEMP HACK
            invoking_user_org_name: 'org0',
            fcn: 'query',
            args: ['alice']
        }),
        simple_client.query__p({
            channel_name: channel_name,
            invoking_user_name: 'Admin', // TEMP HACK
            invoking_user_org_name: 'org0',
            fcn: 'query',
            args: ['bob']
        })
    ]);
})
.then(balances => {
    logger.debug('balances = %j', balances);
    assert(balances[0] == '103' && balances[1] == '476', 'got incorrect balances from queries');
})
.then(() => {
    logger.debug('all calls behaved as expected.');
})
.catch(err => {
    logger.error('CAUGHT UNHANDLED ERROR: ', err);
    process.exit(1);
});

/*
///////////////////////////////////////////////////////////////////////////////
//////////////////////////////// START SERVER /////////////////////////////////
///////////////////////////////////////////////////////////////////////////////

const server = http.createServer(app).listen(simple_client.appcfg.port, function(){});
logger.info('****************** SERVER STARTED ************************');
logger.info('**************  http://' + simple_client.appcfg.host + ':' + simple_client.appcfg.port + '  ******************');
server.timeout = 240000;

///////////////////////////////////////////////////////////////////////////////
///////////////////////// REST ENDS START HERE ////////////////////////////////
///////////////////////////////////////////////////////////////////////////////

// Register and enroll user
app.post('/users', function(req, res) {
    logger.debug('End point : /users');
    logger.debug('User name : ' + req.body.username);
    logger.debug('Org name  : ' + req.body.orgName);
    var token = jwt.sign({
        exp: Math.floor(Date.now() / 1000) + parseInt(config.jwt_expiretime),
        username: req.body.username,
        //TODO: Are we using existing user or to register new users ?
        //password: req.body.password,
        orgName: req.body.orgName
    }, app.get('secret'));
    var promise = helper.getRegisteredUsers(req.body.username, req.body.orgName, true);
    promise.then(function(response) {
        if (response && typeof response !== 'string') {
                    response.token = token;
                    res.json(response);
        } else {
            res.json({
                success: false,
                message: response
            });
        }
    });
});

// Create Channel
app.post('/channels', function(req, res) {
    logger.info('<<<<<<<<<<<<<<<<< C R E A T E  C H A N N E L >>>>>>>>>>>>>>>>>');
    logger.debug('End point : /channels');
    logger.debug('Channel name : ' + req.body.channelName);
    logger.debug('channelConfigPath : ' + req.body.channelConfigPath);
    var token = req.body.token || req.query.token || req.headers['x-access-token'];
    jwt.verify(token, app.get('secret'), function(err, decoded) {
        if (err) {
            res.send({
                success: false,
                message: 'Failed to authenticate token.'
            });
        } else {
            //res.send(d);
            logger.debug('User name : ' + decoded.username);
            logger.debug('Org name  : ' + decoded.orgName);
            var promise = channels.createChannel(req.body.channelName, req.body.channelConfigPath, decoded.username, decoded.orgName);
            promise.then(function(message) {
                res.send(message);
            });
        }
    });
});

// Join Channel
app.post('/channels/:channelName/peers', function(req, res) {
    logger.info('<<<<<<<<<<<<<<<<< J O I N  C H A N N E L >>>>>>>>>>>>>>>>>');
    logger.debug('peers : ' + req.body.peers);
    var token = req.body.token || req.query.token || req.headers['x-access-token'];
    jwt.verify(token, app.get('secret'), function(err, decoded) {
        if (err) {
            res.send({
                success: false,
                message: 'Failed to authenticate token.'
            });
        } else {
            //res.send(d);
            logger.debug('User name : ' + decoded.username);
            logger.debug('Org name  : ' + decoded.orgName);
            var promise = join.joinChannel(req.params.channelName, req.body.peers, decoded.username, decoded.orgName);
            promise.then(function(message) {
                res.send(message);
            }, (err) => {
                var error_message = util.format('join channel promise failed; error was: %j', err);
                logger.info(error_message);
                res.send({
                    success: false,
                    message: error_message
                });
            });
        }
    });
});

// Install chaincode on target peers
app.post('/chaincodes', function(req, res) {
    logger.debug('==================== INSTALL CHAINCODE ==================');
    logger.debug('peers : ' + req.body.peers); // target peers list
    logger.debug('chaincodeName : ' + req.body.chaincodeName);
    logger.debug('chaincodePath  : ' + req.body.chaincodePath);
    logger.debug('chaincodeVersion  : ' + req.body.chaincodeVersion);
    var token = req.body.token || req.query.token || req.headers['x-access-token'];
    jwt.verify(token, app.get('secret'), function(err, decoded) {
        if (err) {
            res.send({
                success: false,
                message: 'Failed to authenticate token.'
            });
        } else {
            //res.send(d);
            logger.debug('User name : ' + decoded.username);
            logger.debug('Org name  : ' + decoded.orgName);
            var promise = install.installChaincode(req.body.peers, req.body.chaincodeName, req.body.chaincodePath, req.body.chaincodeVersion, decoded.username, decoded.orgName);
            promise.then(function(message) {
                res.send(message);
            });
        }
    });
});

// Instantiate chaincode on target peers
app.post('/channels/:channelName/chaincodes', function(req, res) {
    logger.debug('==================== INSTANTIATE CHAINCODE ==================');
    logger.debug('peers : ' + req.body.peers); // target peers list
    logger.debug('chaincodeName : ' + req.body.chaincodeName);
    logger.debug('chaincodePath  : ' + req.body.chaincodePath);
    logger.debug('chaincodeVersion  : ' + req.body.chaincodeVersion);
    var token = req.body.token || req.query.token || req.headers['x-access-token'];
    jwt.verify(token, app.get('secret'), function(err, decoded) {
        if (err) {
            res.send({
                success: false,
                message: 'Failed to authenticate token.'
            });
        } else {
            //res.send(d);
            logger.debug('User name : ' + decoded.username);
            logger.debug('Org name  : ' + decoded.orgName);
            var promise = instantiate.instantiateChaincode(req.body.peers, req.params.channelName, req.body.chaincodeName, req.body.chaincodePath, req.body.chaincodeVersion, req.body.functionName, req.body.args, decoded.username, decoded.orgName);
            promise.then(function(message) {
                res.send(message);
            });
        }
    });
});

// Invoke transaction on chaincode on target peers
app.post('/channels/:channelName/chaincodes/:chaincodeName', function(req, res) {
    logger.debug('==================== INVOKE ON CHAINCODE ==================');
    logger.debug('peers : ' + req.body.peers); // target peers list
    logger.debug('chaincodeName : ' + req.params.chaincodeName);
    logger.debug('Args : ' + req.body.args);
    logger.debug('chaincodeVersion  : ' + req.body.chaincodeVersion);
    var token = req.body.token || req.query.token || req.headers['x-access-token'];
    jwt.verify(token, app.get('secret'), function(err, decoded) {
        if (err) {
            res.send({
                success: false,
                message: 'Failed to authenticate token.'
            });
        } else {
            //res.send(d);
            logger.debug('User name : ' + decoded.username);
            logger.debug('Org name  : ' + decoded.orgName);
            let promise = invoke.invokeChaincode(req.body.peers, req.params.channelName, req.params.chaincodeName, req.body.chaincodeVersion, req.body.args, decoded.username, decoded.orgName);
            promise.then(function(message) {
                res.send(message);
            });
        }
    });
});

// Query on chaincode on target peers
app.get('/channels/:channelName/chaincodes/:chaincodeName', function(req, res) {
    logger.debug('==================== QUERY ON CHAINCODE ==================');
    logger.debug('channelName : ' + req.params.channelName);
    logger.debug('chaincodeName : ' + req.params.chaincodeName);
    let peer = req.query.peer;
    let args = req.query.args;
    args = args.replace(/'/g, '"');
    args = JSON.parse(args);
    logger.debug(args);
    let version = req.query.chaincodeVersion;
    var token = req.body.token || req.query.token || req.headers['x-access-token'];
    jwt.verify(token, app.get('secret'), function(err, decoded) {
        if (err) {
            res.send({
                success: false,
                message: 'Failed to authenticate token.'
            });
        } else {
            //res.send(d);
            logger.debug('User name : ' + decoded.username);
            logger.debug('Org name  : ' + decoded.orgName);
            var promise = query.queryChaincode(peer, req.params.channelName, req.params.chaincodeName, version, args, decoded.username, decoded.orgName);
            promise.then(function(message) {
                res.send(message);
            });
        }
    });
});

//  Query Get Block by BlockNumber
app.get('/channels/:channelName/blocks/:blockId', function(req, res) {
    logger.debug('==================== GET BLOCK BY NUMBER ==================');
    //logger.debug('peers : '+req.body.peers);// target peers list
    let blockId = req.params.blockId;
    let peer = req.query.participatingPeer;
    logger.debug('channelName : ' + req.params.channelName);
    logger.debug('BlockID : ' + blockId);
    logger.debug('PEER : ' + peer);
    var token = req.body.token || req.query.token || req.headers['x-access-token'];
    jwt.verify(token, app.get('secret'), function(err, decoded) {
        if (err) {
            res.send({
                success: false,
                message: 'Failed to authenticate token.'
            });
        } else {
            logger.debug('User name : ' + decoded.username);
            logger.debug('Org name  : ' + decoded.orgName);
            var promise = query.getBlockByNumber(peer, blockId, decoded.username, decoded.orgName);
            promise.then(function(message) {
                res.send(message);
            });
        }
    });
});

// Query Get Transaction by Transaction ID
app.get('/channels/:channelName/transactions/:trxnId', function(req, res) {
    logger.debug('================ GET TRANSACTION BY TRANSACTION_ID ======================');
    logger.debug('channelName : ' + req.params.channelName);
    let trxnId = req.params.trxnId;
    let peer = req.query.participatingPeer;
    var token = req.body.token || req.query.token || req.headers['x-access-token'];
    jwt.verify(token, app.get('secret'), function(err, decoded) {
        if (err) {
            res.send({
                success: false,
                message: 'Failed to authenticate token.'
            });
        } else {
            logger.debug('User name : ' + decoded.username);
            logger.debug('Org name  : ' + decoded.orgName);
            var promise = query.getTransactionByID(peer, trxnId, decoded.username, decoded.orgName);
            promise.then(function(message) {
                res.send(message);
            });
        }
    });
});

// Query Get Block by Hash
app.get('/channels/:channelName/blocks', function(req, res) {
    logger.debug('================ GET BLOCK BY HASH ======================');
    //logger.debug('peers : '+req.body.peers);// target peers list
    logger.debug('channelName : ' + req.params.channelName);
    let hash = req.query.hash;
    let peer = req.query.participatingPeer;
    var token = req.body.token || req.query.token || req.headers['x-access-token'];
    jwt.verify(token, app.get('secret'), function(err, decoded) {
        if (err) {
            res.send({
                success: false,
                message: 'Failed to authenticate token.'
            });
        } else {
            logger.debug('User name : ' + decoded.username);
            logger.debug('Org name  : ' + decoded.orgName);
            var promise = query.getBlockByHash(peer, hash, decoded.username, decoded.orgName);
            promise.then(function(message) {
                res.send(message);
            });
        }
    });
});

//Query for Channel Information
app.get('/channels/:channelName', function(req, res) {
    logger.debug('================ GET CHANNEL INFORMATION ======================');
    //logger.debug('peers : '+req.body.peers);// target peers list
    logger.debug('channelName : ' + req.params.channelName);
    let peer = req.query.participatingPeer;
    var token = req.body.token || req.query.token || req.headers['x-access-token'];
    jwt.verify(token, app.get('secret'), function(err, decoded) {
        if (err) {
            res.send({
                success: false,
                message: 'Failed to authenticate token.'
            });
        } else {
            logger.debug('User name : ' + decoded.username);
            logger.debug('Org name  : ' + decoded.orgName);
            var promise = query.getChainInfo(peer, decoded.username, decoded.orgName);
            promise.then(function(message) {
                res.send(message);
            });
        }
    });
});

// Query to fetch all Installed/instantiated chaincodes
app.get('/chaincodes', function(req, res) {
    var hostingPeer = req.query.hostingPeer;
    var isInstalled = req.query.installed;
    if (isInstalled === 'true') {
        logger.debug('================ GET INSTALLED CHAINCODES ======================');
    } else {
        logger.debug('================ GET INSTANTIATED CHAINCODES ======================');
    }
    //logger.debug('peers : '+req.body.peers);// target peers list
    logger.debug('hostingPeer: ' + req.query.hostingPeer);
    var token = req.body.token || req.query.token || req.headers['x-access-token'];
    jwt.verify(token, app.get('secret'), function(err, decoded) {
        if (err) {
            res.send({
                success: false,
                message: 'Failed to authenticate token.'
            });
        } else {
            logger.debug('User name : ' + decoded.username);
            logger.debug('Org name  : ' + decoded.orgName);
            var promise = query.getInstalledChaincodes(hostingPeer, isInstalled, decoded.username, decoded.orgName);
            promise.then(function(message) {
                res.send(message);
            });
        }
    });
});

// Query to fetch channels
app.get('/channels', function(req, res) {
    logger.debug('================ GET CHANNELS ======================');
    logger.debug('End point : /channels');
    //logger.debug('peers : '+req.body.peers);// target peers list
    logger.debug('participatingPeer: ' + req.query.participatingPeer);
    var participatingPeer = req.query.participatingPeer;
    var token = req.body.token || req.query.token || req.headers['x-access-token'];
    jwt.verify(token, app.get('secret'), function(err, decoded) {
        if (err) {
            res.send({
                success: false,
                message: 'Failed to authenticate token.'
            });
        } else {
            logger.debug('User name : ' + decoded.username);
            logger.debug('Org name  : ' + decoded.orgName);
            var promise = query.getChannels(participatingPeer, decoded.username, decoded.orgName);
            promise.then(function(message) {
                res.send(message);
            });
        }
    });
});
*/
