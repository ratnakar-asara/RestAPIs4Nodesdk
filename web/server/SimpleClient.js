'use strict';

const FabricClient = require('fabric-client');
const FabricCAServices = require('fabric-ca-client');
const FabricClientUtils = require('fabric-client/lib/utils.js');
const fs = require('fs');
const path = require('path');
const winston = require('winston');
const util = require('util');

function assert (condition, message) {
    if (!condition) {
        logger.error('!!! assert FAILED !!! message: ' + message);
        logger.error('!!! stack trace:');
        const err = new Error(message);
        logger.error(err.stack);
        throw err;
    }
}

function assemble_url_from_remote (remote, tls_enabled) {
    assert(remote.base_protocol == 'http' || remote.base_protocol == 'grpc', 'unsupported base_protocol');
    const protocol = remote.base_protocol + (tls_enabled ? 's' : '');
    return protocol + '://' + remote.host + ':' + remote.port;
}

const logger = new(winston.Logger)({
    level: 'debug',
    transports: [
        new(winston.transports.Console)({
            colorize: true
        }),
    ]
});

class SimpleClient {
    // TODO: Supply netcfg only -- appcfg shouldn't be a concern of SimpleClient
    constructor (netcfg, appcfg, tls_enabled) {
        // TODO: Use protobuf instead (with text-based reader so these config files can be read/written by humans)
        this.netcfg         = netcfg;
        this.appcfg         = appcfg;
        this.tls_enabled    = tls_enabled;

        logger.info('SimpleClient()');
        logger.info('netcfg:', netcfg);
        logger.info('appcfg:', appcfg);
        logger.info('tls_enabled:', tls_enabled);

        // Set up the GOPATH env var; NOTE: This is bad encapsulation, but it's used by fabric-sdk-node.
        process.env.GOPATH = path.resolve(__dirname, appcfg.GOPATH);

        // Create organizations.
        this.organizations  = {};
        for (const org_name in netcfg.organizations) {
            const org_cfg   = netcfg.organizations[org_name];
            logger.info('creating organization "%s" using cfg %j', org_name, org_cfg);
            const org       = {};
            const client    = new FabricClient();
            // TODO: client.addConfigFile

            org.client = client;

            // Add the CA, if it's defined.
            if (org_cfg.ca) {
                const ca_cfg            = org_cfg.ca;
                logger.info('creating CA using cfg %j', ca_cfg);
                const cryptoSuite_path  = appcfg.cryptoSuite_path_prefix + org_name;
                const cryptoSuite       = FabricClient.newCryptoSuite({
                    software    : true,
//                     keysize     : 256, // This may be optional as well.  TODO: Specify in appcfg, or perhaps this is tied to the generated crypto materials.
                    algorithm   : 'EC', // Docs say (as of v1.0.0) this is the only supported value
                    hash        : 'SHA2' // Does this need to match some external thing?
                });
                org.ca = new FabricCAServices(
                    assemble_url_from_remote(ca_cfg.remote, this.tls_enabled),
                    ca_cfg.tlsOptions,
                    ca_cfg.caname,
                    cryptoSuite
                );
            }

            // Add the orderers.
            org.orderers = {};
            for (const orderer_name in org_cfg.orderers) {
                const orderer_cfg                       = org_cfg.orderers[orderer_name];
                logger.info('creating orderer "%s" using cfg %j', orderer_name, orderer_cfg);
                const orderer_url                       = assemble_url_from_remote(orderer_cfg.remote, this.tls_enabled);
                const opts                              = {
//                     'request-timeout' : 30000
                }
                if (this.tls_enabled) {
                    const orderer_tls_cacert            = fs.readFileSync(path.resolve(__dirname, orderer_cfg.orderer_tls_cacert_path));
                    opts['pem']                         = Buffer.from(orderer_tls_cacert).toString();
                    opts['ssl-target-name-override']    = orderer_cfg.ssl_target_name_override;
                }
                logger.info('calling client.newOrderer with url "%s"', orderer_url);
                org.orderers[orderer_name]              = client.newOrderer(orderer_url, opts);
            }

            // Add the peers and eventhubs
            org.peers = {};
            for (const peer_name in org_cfg.peers) {
                const peer_cfg                          = org_cfg.peers[peer_name];
                logger.info('creating peer "%s" using cfg %j', peer_name, peer_cfg);
                const peer_url                          = assemble_url_from_remote(peer_cfg.requests_remote, this.tls_enabled);
                const opts                              = {
//                     'request-timeout' : 30000
                }
                if (this.tls_enabled) {
                    const peer_tls_cacert               = fs.readFileSync(path.resolve(__dirname, peer_cfg.peer_tls_cacert_path));
                    opts['pem']                         = Buffer.from(peer_tls_cacert).toString();
                    opts['ssl-target-name-override']    = peer_cfg.ssl_target_name_override;
                }
                logger.info('calling client.newPeer with url "%s"', peer_url);
                const peer                              = client.newPeer(peer_url, opts);

                org.peers[peer_name] = peer;
            }

            // Make empty channels dict.
            org.channels = {};

            // TODO: Maybe save org_cfg as org.cfg

            this.organizations[org_name] = org;
        }

        // Create channel architectures.  The way this works is that organizations which are listed as participants in
        // a channel have newChain called on their Client object.
        // TODO: Do this as part of create_channel__p (once that is implemented)
        for (const channel_name in appcfg.channels) {
            const channel_cfg                       = appcfg.channels[channel_name];
            logger.info('processing from appcfg: channel_cfg:', channel_cfg);
            logger.info('participating_peer_organizations:', channel_cfg.participating_peer_organizations);

            for (const participating_peer_org_name in channel_cfg.participating_peer_organizations) {
                logger.info('creating channel architecture for channel "%s" and participating org "%s"', channel_name, participating_peer_org_name);
                const participating_peer_org_cfg    = channel_cfg.participating_peer_organizations[participating_peer_org_name];
                const participating_peer_org        = this.organizations[participating_peer_org_name];
                const client                        = participating_peer_org.client;
                const channel                       = client.newChannel(channel_name);

                logger.info('created channel with name:', channel.getName());

                // Add the participating orderer to the channel.
                {
                    const participating_orderer_org_names   = Object.keys(channel_cfg.participating_orderer_organizations)
                    assert(participating_orderer_org_names.length == 1, 'must specify exactly one element in the participating_orderer_organizations attribute of each channel in appcfg.json (for now -- this is a temporary limitation)');
                    const participating_orderer_org_name    = participating_orderer_org_names[0]
                    const participating_orderer_org_cfg     = channel_cfg.participating_orderer_organizations[participating_orderer_org_name];
                    const participating_orderer_org         = this.organizations[participating_orderer_org_name];
                    assert(participating_orderer_org_cfg.length == 1, 'must specify exactly one element in the single participating orderer org entry for each channel in appcfg.json (for now -- this is a temporary limitation)');
                    const participating_orderer_name        = participating_orderer_org_cfg[0];
                    logger.info('for channel "%s", adding orderer "%s" from organization "%s"', channel_name, participating_orderer_name, participating_orderer_org_name);
                    channel.addOrderer(participating_orderer_org.orderers[participating_orderer_name]);
                }

                // Add the participating org's peers to the channel
                for (const participating_peer_name of participating_peer_org_cfg.peers) {
                    logger.info('for channel "%s", adding peer "%s" from organization "%s"', channel_name, participating_peer_name, participating_peer_org_name);
                    channel.addPeer(participating_peer_org.peers[participating_peer_name]);
                }

                participating_peer_org.channels[channel_name] = channel;
            }
        }
    }

    // Returns a promise for creation of a kvs for each organization.
    // TODO: Specify kvs_path_prefix instead of using appcfg
    create_kvs_for_each_org__p () {
        logger.info('create_kvs_for_each_org__p();');
        const promises = [];
        for (const org_name in this.organizations) {
            const org       = this.organizations[org_name];
            const client    = org.client;
            const kvs_path  = this.appcfg.kvs_path_prefix + org_name;
            logger.info('    creating kvs for organization "%s" using path "%s"', org_name, kvs_path);
            promises.push(
                FabricClient.newDefaultKeyValueStore({
                    path: kvs_path
                }).then((kvs) => {
                    logger.info('    successfully created kvs for organization "%s"', org_name);
                    client.setStateStore(kvs);
                })
            );
        }
        return Promise.all(promises);
    }

    // Returns a promise for enrollment of all users for each organization.
    // This is not minimally necessary, but who cares for now.
    // Must have called and resolved create_kvs_for_each_org__p before calling this method.
    enroll_all_users_for_each_org__p () {
        logger.info('enroll_all_users_for_each_org__p();');
        const promises = [];
        for (const org_name in this.organizations) {
            const org           = this.organizations[org_name];
            const org_cfg       = this.netcfg.organizations[org_name];
            const client        = org.client;
            for (const user_name in org_cfg.users) {
                if (client.getUserContext(user_name, false) == null) { // false indicates synchronous call
                    const user_cfg                  = org_cfg.users[user_name];
                    // TODO: Probably specify cert/key filenames directly, instead of relying on particular dir structure/filename scheme
                    const user_msp_cert_dir         = fs.readdirSync(path.resolve(__dirname, user_cfg.msp_path, 'signcerts'));
                    assert(user_msp_cert_dir.length == 1, util.format('msp/signcerts directory must contain exactly 1 entry; actual was %j', user_msp_cert_dir));
                    const user_msp_key_dir          = fs.readdirSync(path.resolve(__dirname, user_cfg.msp_path, 'keystore'));
                    assert(user_msp_key_dir.length == 1, util.format('msp/keystore directory must contain exactly 1 entry; actual was %j', user_msp_key_dir));
                    logger.info('    org_name: "%s", user_name: "%s", user_msp_cert_dir: %j, user_msp_key_dir: %j', org_name, user_name, user_msp_cert_dir, user_msp_key_dir);
                    const user_msp_cert_filename    = path.resolve(__dirname, user_cfg.msp_path, 'signcerts', user_msp_cert_dir[0]);
                    const user_msp_key_filename     = path.resolve(__dirname, user_cfg.msp_path, 'keystore', user_msp_key_dir[0]);
                    const user_msp_cert             = fs.readFileSync(user_msp_cert_filename);
                    const user_msp_key              = fs.readFileSync(user_msp_key_filename);
                    logger.info('    calling client.createUser on user_cfg "%s" for organization "%s"', user_name, org_name);
                    promises.push(
                        client.createUser({
                            // Note -- this does not need to be the same as user_name -- it could be anything.
                            // It just identifies the user to the client.
                            username     : user_name,
                            mspid        : org_cfg.mspid,
                            cryptoContent: {
                                signedCertPEM: Buffer.from(user_msp_cert).toString(),
                                privateKeyPEM: Buffer.from(user_msp_key).toString()
                            }
                        })
                        .then((user) => {
                            logger.info('    client.createUser succeeded; user_name = "%s", org_name = "%s"', user_name, org_name);
                            // This doesn't work because client is not reentrant (the user parameter is client._userContext
                            // which if set by multiple parallel tasks, will screw things up).
    //                         logger.info('    client.createUser succeeded; user.getName() = "%s", org_name = "%s"', user.getName(), org_name);
                        })
                    );
                } else {
                    logger.info('    user "%s" already enrolled -- existed in KVS', user_name);
                }
            }
        }
        return Promise.all(promises);
//         // Normally Promise.all(promises) should be called to process these in parallel, but client
//         // is non-reentrant due to its "user context" state.
//         const initial_promise = Promise.resolve(42); // dummy value -- is this necessary?
//         let current_promise = initial_promise;
//         for (const promise of promises) {
//             current_promise = current_promise.then(promise);
//         }
//         return current_promise;
    }

    // NOTE: Must have already successfully enrolled the specified registrar for this org.
    // Can specify undefined for enrollment_secret to have the CA generate one for you.
    register_user_in_org__p (user_name, enrollment_secret, role_string, affiliation, org_name, registrar_name) {
        const org       = this.organizations[org_name];
        const org_cfg   = this.netcfg.organizations[org_name];

        logger.debug('register_user_in_org__p(); user_name = "%s", role_string = "%s", org_name = "%s", registrar_name = "%s"', user_name, role_string, org_name, registrar_name);
        return org.client.getUserContext(registrar_name, true)
        .then(registrar => {
            logger.debug('    successfully got user context for registrar "%s"; calling ca.register.', registrar_name);
            return org.ca.register(
                {
                    enrollmentID: user_name,
                    enrollmentSecret: enrollment_secret,
                    role: role_string,
                    affiliation: affiliation,
//                     affiliation: org_name, // TODO: Is this sufficient/correct?
//                     affiliation: org_cfg.mspid, // TODO: Is this sufficient/correct?
//                     affiliation: org_name+'_affiliation', // NOTE: For now, use a distinct string to see if there's a problem
                    maxEnrollments: 0, // no limit to number of enrollments
                    attrs: [] // NOTE: This is not used by fabric-sdk-node yet!
                },
                registrar
            );
        })
        .then(returned_enrollment_secret => {
            logger.debug('    successfully registered user "%s" within org "%s".', user_name, org_name);
            if (enrollment_secret) {
                assert(returned_enrollment_secret === enrollment_secret, 'enrollment secret returned from ca.register did not match provided one.');
            }
            return returned_enrollment_secret;
        });
    }

    enroll_user_in_org__p (user_name, enrollment_secret, org_name) {
        const org       = this.organizations[org_name];
        const org_cfg   = this.netcfg.organizations[org_name];

        logger.debug('enroll_user_in_org__p(); user_name = "%s", org_name = "%s"', user_name, org_name);
        return org.ca.enroll({
            enrollmentID: user_name,
            enrollmentSecret: enrollment_secret
        })
        .then(results => {
            logger.debug('    successfully enrolled user "%s" in org "%s"; saving user to client object by calling client.createUser', user_name, org_name);
            return org.client.createUser({
                username: user_name,
                mspid: org_cfg.mspid,
                cryptoContent: {
                    signedCertPEM: results.certificate,
                    privateKeyPEM: results.key.toBytes()
                }
            });
        })
        .then(user => {
            logger.debug('    create user "%s" in org "%s" finished successfully.', user_name, org_name);
            return user;
        });
    }

    register_and_enroll_user_in_org__p (user_name, enrollment_secret, role_string, affiliation, org_name, registrar_name) {
        return this.register_user_in_org__p(user_name, enrollment_secret, role_string, affiliation, org_name, registrar_name)
        .then(returned_enrollment_secret => {
            return this.enroll_user_in_org__p(user_name, returned_enrollment_secret, org_name);
        })
    }

    create_channels__p () {
        // TODO: Pass in the channel configuration instead of reading it from this.appcfg and this.netcfg
        logger.info('create_channels__p();');
        const promises = [];
        for (const channel_name in this.appcfg.channels) {
            const channel_cfg               = this.appcfg.channels[channel_name];
            logger.info('attempting to read config of channel "%s"; config is %j', channel_name, channel_cfg);
            const channel_creator_org_name  = channel_cfg.channel_creator_spec.organization_name;
            const channel_creator_org       = this.organizations[channel_creator_org_name];
            logger.info('channel_creator_org keys:', Object.keys(channel_creator_org));
            const channel_creator_client    = channel_creator_org.client;
            let channel_creator_user;

            let channel_orderer;
            {
                const participating_orderer_org_names   = Object.keys(channel_cfg.participating_orderer_organizations)
                assert(participating_orderer_org_names.length == 1, 'must specify exactly one element in the participating_orderer_organizations attribute of each channel in appcfg.json (for now -- this is a temporary limitation)');
                const participating_orderer_org_name    = participating_orderer_org_names[0];
                const participating_orderer_org_cfg     = channel_cfg.participating_orderer_organizations[participating_orderer_org_name];
                const participating_orderer_org         = this.organizations[participating_orderer_org_name];
                assert(participating_orderer_org_cfg.length == 1, 'must specify exactly one element in the single participating orderer org entry for each channel in appcfg.json (for now -- this is a temporary limitation)');
                const participating_orderer_name        = participating_orderer_org_cfg[0];
                logger.info('for channel "%s", adding orderer "%s" from organization "%s"', channel_name, participating_orderer_name, participating_orderer_org_name);
                channel_orderer                         = participating_orderer_org.orderers[participating_orderer_name];
            }

            const configtx                  = fs.readFileSync(path.resolve(__dirname, channel_cfg.configtx_path));
            promises.push(
                channel_creator_client.getUserContext(channel_cfg.channel_creator_spec.user_name, true)
                .then((channel_creator_user_) => {
                    const extracted_channel_config  = channel_creator_client.extractChannelConfig(configtx);
                    const signature                 = channel_creator_client.signChannelConfig(extracted_channel_config);
                    const txId                      = channel_creator_client.newTransactionID();

//                     // TEMP HACK
//                     {
//                         const config = FabricClientUtils.getConfig();
//                         logger.info('config:', config);
//                     }
                    logger.info('process.env.GRPC_SSL_CIPHER_SUITES = %j', process.env.GRPC_SSL_CIPHER_SUITES);
                    logger.info('creating channel "%s" using organization "%s"\'s client; channel_orderer = %j', channel_name, channel_creator_org_name, channel_orderer);
                    return channel_creator_client.createChannel({
                        name: channel_name,
                        orderer: channel_orderer,
                        config: extracted_channel_config,
                        signatures: [signature],
                        txId: txId
                    });
                })
                .then(result => {
                    // NOTE: The SDK docs say this resolution doesn't indicate the success of channel creation,
                    // that has to be polled for separately.
                    logger.info('    call to createChannel succeeded; channel is "%s", created using organization "%s"\'s client; result: %j', channel_name, channel_creator_org_name, result);
                })
            );
        }
        // NOTE: This might also suffer the non-reentrancy problem like the other one, and may
        // need to be executed serially.
        return Promise.all(promises);
    }

    join_channels__p () {
        logger.info('join_channels__p();');
        const promises = [];

        for (const channel_name in this.appcfg.channels) {
            const channel_cfg               = this.appcfg.channels[channel_name];
            const channel_creator_org       = this.organizations[channel_cfg.channel_creator_spec.organization_name];
            const channel_creator_client    = channel_creator_org.client;
            logger.info('processing from appcfg: channel_cfg:', channel_cfg);
            logger.info('participating_peer_organizations:', channel_cfg.participating_peer_organizations);

            for (const participating_peer_org_name in channel_cfg.participating_peer_organizations) {
                logger.info('creating channel architecture for channel "%s" and participating org "%s"', channel_name, participating_peer_org_name);
                const participating_peer_org_cfg    = channel_cfg.participating_peer_organizations[participating_peer_org_name];
                const participating_peer_org        = this.organizations[participating_peer_org_name];
                const client                        = participating_peer_org.client;
                const channel                       = participating_peer_org.channels[channel_name];
                let genesis_block_protobuf;
                const targets                       = [];
                for (const participating_peer_name of participating_peer_org_cfg.peers) {
                    targets.push(participating_peer_org.peers[participating_peer_name]);
                }
                logger.info('targets for joinChannel:', targets);

                // NOTE: We have to retrieve the genesis block for each call to channel.joinChannel because
                // that call destroys it.  Alternatively, figure out how to deep copy genesis_block_protobuf
                // as retrieved earlier (because each retrieval is exactly the same).
                promises.push(
                    channel_creator_client.getUserContext(channel_cfg.channel_creator_spec.user_name, true)
                    .then(channel_creator_user => {
                        logger.info('    attempting to retrieve genesis block');
                        const txId = channel_creator_client.newTransactionID();
                        return channel.getGenesisBlock({
                            txId: txId
                        });
                    })
                    .then(genesis_block_protobuf_ => {
                        logger.info('successfully retrieved genesis block');
                        genesis_block_protobuf = genesis_block_protobuf_;
                        return client.getUserContext(participating_peer_org_cfg.channel_joiner_user_name, true);
                    })
                    // TODO: probably just make a "channel admin" user that does channel joining and install/instantiate.
                    .then(channel_joiner_user => {
                        logger.info('channel_joiner_user.getName():', channel_joiner_user.getName());
                        const txId                  = client.newTransactionID();
                        logger.info('calling channel.joinChannel on targets %j using user "%s" on behalf of peer org "%s"', targets, participating_peer_org_cfg.channel_joiner_user_name, participating_peer_org_name);
                        return channel.joinChannel({
                            targets: targets,
                            block: genesis_block_protobuf,
                            txId: txId
                        });
                    })
                    .then(result => {
                        assert(result.length == targets.length, 'should have received as many results as targets');
                        let err = null;
                        // TODO: Make this error more descriptive and useful
                        for (var i = 0; i < result.length; i++) {
                            if (result[i] instanceof Error) {
                                logger.info('channel.joinChannel produced error for peer org "%s", peer "%s"; error: %j', participating_peer_org_name, targets[i]._url, result[i]);
                                if (err == null)
                                    err = result[i];
                            }
                        }
                        if (err != null)
                            throw err;
                        logger.info('channel.joinChannel succeeded for peer org "%s"; result: %j', participating_peer_org_name, result);
                        logger.info('calling channel.initialize() for peer org "%s"', participating_peer_org_name);
                        return channel.initialize();
                    })
                    .then(result => {
                        logger.info('successfully initialized channel for peer org "%s"; result keys: %j', participating_peer_org_name, Object.keys(result));
                    })
                );
            }
        }
        return Promise.all(promises);
    }

    install_and_instantiate_chaincode_on_channel__p (request) {
        logger.info('install_and_instantiate_chaincode_on_channel__p(); request: ', request);

        const channel_name                      = request.channel_name;
        const invoking_user_name_for_org        = request.invoking_user_name_for_org;
        const fcn                               = request.fcn;
        const args                              = request.args;

        const channel_cfg                       = this.appcfg.channels[channel_name];

        const promises = [];
        for (const participating_peer_org_name in channel_cfg.participating_peer_organizations) {
            const participating_peer_org_cfg    = channel_cfg.participating_peer_organizations[participating_peer_org_name];
            const participating_peer_org        = this.organizations[participating_peer_org_name];
            const invoking_user_name            = invoking_user_name_for_org[participating_peer_org_name];
            const client                        = participating_peer_org.client;
            const channel                       = participating_peer_org.channels[channel_name];
            const targets                       = [];
            for (const participating_peer_name of participating_peer_org_cfg.peers) {
                targets.push(participating_peer_org.peers[participating_peer_name]);
            }
            logger.info('targets for installChaincode:', targets);

            promises.push(
                client.getUserContext(invoking_user_name, true)
                .then(admin_user => {
                    return client.installChaincode({
                        targets: targets,
                        chaincodePath: channel_cfg.chaincode.path,
                        chaincodeId: channel_cfg.chaincode.id,
                        chaincodeVersion: channel_cfg.chaincode.version
                    });
                })
                .then(result => {
                    logger.info('client.installChaincode call on peers of peer org "%s" returned', participating_peer_org_name);
                    const proposal_responses = result[0];
                    for (var i = 0; i < proposal_responses.length; i++) {
                        if (proposal_responses[i] instanceof Error) {
                            logger.info('error received in client.installChaincode response:', proposal_responses[i]);
                            throw new Error(proposal_responses[i]);
                        }
                    }
                    logger.info('installChaincode proposal response succeeded on peers of peer org "%s".', participating_peer_org_name);
                    // This constant retrieving of user contexts is dumb and should be fixed
                    return client.getUserContext(invoking_user_name, true);
                })
                .then(admin_user => {
                    const txId = client.newTransactionID();
                    logger.info('calling channel.sendInstantiateProposal on peers of peer org "%s"; fcn = "%s", args = %j.', participating_peer_org_name, fcn, args);
                    // TODO: specify unanimous endorsement policy
                    // NOTE: targets, if not specified, is the list of peers added to this channel.
                    return channel.sendInstantiateProposal({
                        chaincodeId: channel_cfg.chaincode.id,
                        chaincodeVersion: channel_cfg.chaincode.version,
                        fcn: fcn,
                        args: args,
                        txId: txId
                        // TODO: Can now specify endorsement policy here -- see ChaincodeInstantiateUpgradeRequest in docs
                    })
                })
                .then(result => {
                    logger.info('call to channel.sendInstantiateProposal succeeded');
                    const proposal_responses = result[0];
                    const proposal = result[1];
                    const header   = result[2];
                    for (var i = 0; i < proposal_responses.length; i++) {
                        if (proposal_responses[i] instanceof Error) {
                            logger.info('error received in channel.sendInstantiateProposal response:', proposal_responses[i]);
                            throw new Error(proposal_responses[i]);
                        }
                    }
                    logger.info('calling channel.sendTransaction on for sendInstantiateProposal responses; peer org is "%s".', participating_peer_org_name);
                    return channel.sendTransaction({
                        proposalResponses: proposal_responses,
                        proposal: proposal,
                        header: header
                    });
                })
                .then(result => {
                    logger.info('successfully sent transaction for sendInstantiateProposal; peer org is "%s"; result: %j', participating_peer_org_name, result);
                })
            );
        }
        return Promise.all(promises);
    }

    // request should be a dict with elements:
    // - channel_name
    // - invoking_user_name
    // - invoking_user_org_name
    // - fcn
    // - args
    // - query_only (a boolean indicating if the payload should just be returned after transaction
    //   proposal; i.e. the transaction won't be committed to the ledger).  Default is false.
    invoke__p (request) {
        logger.info('---------------------------------');
        logger.info('---------------------------------');
        logger.info('---------------------------------');
        logger.info('INVOKE; request: ', request);

        const channel_name                  = request.channel_name;
        const invoking_user_name            = request.invoking_user_name;
        const invoking_user_org_name        = request.invoking_user_org_name;
        const fcn                           = request.fcn;
        const args                          = request.args;
        const query_only                    = request.query_only;

        const channel_cfg                   = this.appcfg.channels[channel_name];
        const invoking_user_org_cfg         = this.netcfg.organizations[invoking_user_org_name];
        const invoking_user_org             = this.organizations[invoking_user_org_name];
        const client                        = invoking_user_org.client;
        const channel                       = invoking_user_org.channels[channel_name];

        let txId;

        // TODO: create "empty" promises for proposal and commit here, and resolve them
        // as each operation finishes.  return a dict having keys proposal_promise
        // and completion_promise (or commit_promise)

        // TEMP HACK - just invoke using Admin account
        return client.getUserContext(invoking_user_name, true)
        .then(user => {
            txId = client.newTransactionID();
            logger.info('    calling channel.sendTransactionProposal');
            // NOTE: Can optionally specify targets -- these would be the endorsing peers that the
            // transaction is being proposed to.
            return channel.sendTransactionProposal({
                chaincodeId: channel_cfg.chaincode.id,
                txId: txId,
                fcn: fcn,
                args: args
            })
        })
        .then(result => {
            const proposal_responses    = result[0];
            logger.info('    call to channel.sendTransactionProposal succeeded; proposal_responses[0] instanceof Error: %j', proposal_responses[0] instanceof Error);
            const proposal              = result[1];
            const header                = result[2];
            // If any of the proposal_responses are instances of Error, throw an error.
            {
                let error_count         = 0;
                let error_messages      = '';
                for (var i = 0; i < proposal_responses.length; i++) {
                    if (proposal_responses[i] instanceof Error) {
                        error_count     += 1;
                        error_messages  += util.format('%s; ', proposal_responses[i].message);
                    }
                }
                if (error_count > 0) {
                    const error_message = util.format('channel.sendTransactionProposal response contained %d errors (out of %d responses); error messages were %s', error_count, proposal_responses.length, error_messages);
                    logger.error('    %s', error_message);
                    const e = util.format('channel.sendTransactionProposal failed; error(s): %s', error_messages);
                    throw new Error(e);
                }
            }
            // Make sure all proposal_responses are the same.
            if (!channel.compareProposalResponseResults(proposal_responses)) {
                logger.info('    channel.compareProposalResponseResults failed');
                throw new Error('channel.compareProposalResponseResults failed');
            }
            // Verify that the proposal responses are signed correctly.
            for (var i = 0; i < proposal_responses.length; i++) {
                if (!channel.verifyProposalResponse(proposal_responses[i])) {
                    logger.info('    channel.verifyProposalResponses failed');
                    throw new Error('channel.verifyProposalResponses failed');
                }
            }
            // Check if the response is an error.
            assert(proposal_responses.length > 0, 'proposal_responses has no elements');
            if (proposal_responses[0] instanceof Error) {
                logger.info('    error received in channel.sendInstantiateProposal response:', proposal_responses[0]);
                throw new Error(proposal_responses[0]);
            }
            // Otherwise everything is good, so grab the payload.
            const payload = proposal_responses[0].response.payload;
            const payload_as_string = Buffer.from(payload).toString();
            logger.info('    *** invoke succeeded, response payload (as string) was:');
            logger.info(payload_as_string);
            logger.info('')
            // If query_only was specified, then return now.
            if (query_only) {
                return payload;
            }

            // Create and connect to event hub after transaction proposal.  This is to be notified
            // when the transaction is committed or rejected.
            const eventhub                          = client.newEventHub();
            // Arbitrarily choose the "first" peer to connect to
            const peer_cfg                          = invoking_user_org_cfg.peers[Object.keys(invoking_user_org_cfg.peers)[0]];
            const eventhub_url                      = assemble_url_from_remote(peer_cfg.events_remote, this.tls_enabled);
            const opts                              = {
                // default opts here
            };
            if (this.tls_enabled) {
                const peer_tls_cacert               = fs.readFileSync(path.resolve(__dirname, peer_cfg.peer_tls_cacert_path));
                opts['pem']                         = Buffer.from(peer_tls_cacert).toString();
                opts['ssl-target-name-override']    = peer_cfg.ssl_target_name_override;
            }
            logger.info('Connecting the event hub: ', eventhub_url);
            eventhub.setPeerAddr(eventhub_url, opts);
            eventhub.connect();

            const eventhub_txId = txId.getTransactionID().toString();
            // Set up event hub to listen for this transaction
            const eventhub_promise = new Promise(function(resolve, reject) {
                const timeout_handle = setTimeout(
                    () => {
                        logger.info('eventhub %s timed out waiting for txId ', eventhub_url, txId.getTransactionID());
                        eventhub.unregisterTxEvent(eventhub_txId);
                        logger.info('disconnecting eventhub %s', eventhub_url);
                        eventhub.disconnect();
                        reject(new Error('eventhub ' + eventhub_url + ' timed out waiting for txId ' + eventhub_txId));
                    },
                    30000
                );
                logger.info('registering eventhub %s to listen for transaction ', eventhub_url, txId.getTransactionID());

                eventhub.registerTxEvent(eventhub_txId, function(numeric_txid, code) {
                    logger.info('from eventhub %s : event %j received; code: %j', eventhub_url, numeric_txid, code);
                    clearTimeout(timeout_handle);
//                     eventhub.unregisterTxEvent(numeric_txid);
                    eventhub.unregisterTxEvent(eventhub_txId);
                    logger.info('disconnecting eventhub %s', eventhub_url);
                    eventhub.disconnect();

                    if (code !== 'VALID') {
                        return reject(new Error('Transaction failure reported by eventhub ' + eventhub_url + ' for txId ' + eventhub_txId + '; code: ' + code));
                    } else {
                        return resolve({status: code});
                    }
                });
            });

            logger.info('calling channel.sendTransaction on for sendTransactionProposal responses');
            const transaction_promise = channel.sendTransaction({
                proposalResponses: proposal_responses,
                proposal: proposal,
                header: header
            })
            .then(result => {
                logger.info('sendTransaction promise resolved; result: ', result);
                return result;
            })
            .catch(err => {
                logger.info('caught error during invoke__p(); err: ', err);
                logger.info('disconnecting eventhub %s', eventhub_url);
                eventhub.disconnect();
                throw err;
            });

            // TODO: Maybe return the promises separately, so that the user has more control
            return Promise.all([
                transaction_promise,
                eventhub_promise
            ])
            .then(results => {
                logger.info('successfully received sendTransaction result %j and eventhub notification of transaction completion with result %j', results[0], results[1]);
                return results[1];
            });
        });
    }

    // A convenient frontend to invoke__p which does a query; returns a promise for the query result.
    // request must be a dict having the keys
    // - channel_name
    // - invoking_user_name
    // - invoking_user_org_name
    // - fcn
    // - args
    query__p (request) {
        const invoke_request = {
            channel_name: request.channel_name,
            invoking_user_name: request.invoking_user_name,
            invoking_user_org_name: request.invoking_user_org_name,
            fcn: request.fcn,
            args: request.args,
            query_only: true
        }
        return this.invoke__p(invoke_request);
    }

    // NOTE: Transactions (and other user-dependent actions) should call setUserContext before transacting.
};

module.exports = SimpleClient;
