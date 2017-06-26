'use strict';

const EventHub = require('fabric-client/lib/EventHub.js'); // TEMP -- shouldn't have to require source internal to a module
const FabricCAServices = require('fabric-ca-client');
const FabricClient = require('fabric-client');
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

function assemble_url_from_remote (remote) {
    return remote.protocol + '://' + remote.host + ':' + remote.port;
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
    constructor (netcfg, appcfg) {
        // TODO: Use protobuf instead (with text-based reader so these config files can be read/written by humans)
        this.netcfg = netcfg;
        this.appcfg = appcfg;

        logger.debug('SimpleClient()');
        logger.debug('netcfg:', netcfg);
        logger.debug('appcfg:', appcfg);

        // Set up the GOPATH env var; NOTE: This is bad encapsulation, but it's used by fabric-sdk-node.
        process.env.GOPATH = path.join(__dirname, appcfg.GOPATH);

        // Create organizations.
        this.organizations  = {};
        for (const org_name in netcfg.organizations) {
            const org_cfg   = netcfg.organizations[org_name];
            logger.debug('creating organization "%s" using cfg %j', org_name, org_cfg);
            const org       = {};
            const client    = new FabricClient();
            // TODO: client.addConfigFile

            org.client = client;

            // Add the CA, if it's defined.
            if (org_cfg.ca) {
                const ca_cfg            = org_cfg.ca;
                logger.debug('creating CA using cfg %j', ca_cfg);
                const cryptoSuite_path  = appcfg.cryptoSuite_path_prefix + org_name;
                const cryptoSuite       = client.newCryptoSuite({
                    path: cryptoSuite_path
                });
                org.ca = new FabricCAServices(
                    assemble_url_from_remote(ca_cfg.remote),
                    ca_cfg.tlsOptions,
                    ca_cfg.caname,
                    cryptoSuite
                );
            }

            // Add the orderers.
            org.orderers = {};
            for (const orderer_name in org_cfg.orderers) {
                const orderer_cfg           = org_cfg.orderers[orderer_name];
                logger.debug('creating orderer "%s" using cfg %j', orderer_name, orderer_cfg);
//                 const orderer_tls_cacerts = fs.readFileSync(path.join(__dirname, orderer_cfg.orderer_tls_cacerts_path));
                org.orderers[orderer_name]  = client.newOrderer(
                    assemble_url_from_remote(orderer_cfg.remote),
                    {
                        // NOTE: Currently TLS is disabled on the orderer, so leaving this out is fine.
    //                     'pem'                     : Buffer.from(orderer_tls_cacerts).toString(),
    //                     'ssl-target-name-override': orderer_cfg.ssl_target_name_override
                    }
                );
            }

            // Add the peers and eventhubs
            org.peers = {};
            for (const peer_name in org_cfg.peers) {
                const peer_cfg          = org_cfg.peers[peer_name];
                logger.debug('creating peer "%s" using cfg %j', peer_name, peer_cfg);
                const peer_tls_cacerts  = fs.readFileSync(path.join(__dirname, peer_cfg.peer_tls_cacerts_path));
                const peer              = client.newPeer(
                    assemble_url_from_remote(peer_cfg.requests_remote),
                    {
                        'pem'                     : Buffer.from(peer_tls_cacerts).toString(),
                        'ssl-target-name-override': peer_cfg.ssl_target_name_override,
                        'request-timeout'         : 120000 // NOTE: This is probably excessive, but for now use it.
                    }
                );
//                 chain.addPeer(peer); // TODO: add the peer to chain in a separate pass -- the application defines the chain/channel

                org.peers[peer_name] = peer;
            }

            // Make empty channels dict.
            org.channels = {};

            // TODO: Maybe save org_cfg as org.cfg

            this.organizations[org_name] = org;
        }

        // Create channel architectures.  The way this works is that organizations which are listed as participants in
        // a channel have newChain called on their Client object.
        for (const channel_name in appcfg.channels) {
            const channel_cfg                       = appcfg.channels[channel_name];
            logger.debug('processing from appcfg: channel_cfg:', channel_cfg);
            logger.debug('participating_peer_organizations:', channel_cfg.participating_peer_organizations);

            for (const participating_peer_org_name in channel_cfg.participating_peer_organizations) {
                logger.debug('creating channel architecture for channel "%s" and participating org "%s"', channel_name, participating_peer_org_name);
                const participating_peer_org_cfg    = channel_cfg.participating_peer_organizations[participating_peer_org_name];
                const participating_peer_org        = this.organizations[participating_peer_org_name];
                const client                        = participating_peer_org.client;
                const channel                       = {};
                const chain                         = client.newChain(channel_name);

                logger.debug('created chain:', chain);
                channel.chain                       = chain;

                // Add the participating orderer to the chain.
                {
                    const participating_orderer_org_names   = Object.keys(channel_cfg.participating_orderer_organizations)
                    assert(participating_orderer_org_names.length == 1, 'must specify exactly one element in the participating_orderer_organizations attribute of each channel in appcfg.json (for now -- this is a temporary limitation)');
                    const participating_orderer_org_name    = participating_orderer_org_names[0]
                    const participating_orderer_org_cfg     = channel_cfg.participating_orderer_organizations[participating_orderer_org_name];
                    const participating_orderer_org         = this.organizations[participating_orderer_org_name];
                    assert(participating_orderer_org_cfg.length == 1, 'must specify exactly one element in the single participating orderer org entry for each channel in appcfg.json (for now -- this is a temporary limitation)');
                    const participating_orderer_name        = participating_orderer_org_cfg[0];
                    logger.debug('for channel "%s", adding orderer "%s" from organization "%s"', channel_name, participating_orderer_name, participating_orderer_org_name);
                    chain.addOrderer(participating_orderer_org.orderers[participating_orderer_name]);
                }

                // Add the participating org's peers to the chain
                for (const participating_peer_name of participating_peer_org_cfg.peers) {
                    logger.debug('for channel "%s", adding peer "%s" from organization "%s"', channel_name, participating_peer_name, participating_peer_org_name);
                    chain.addPeer(participating_peer_org.peers[participating_peer_name]);
                }

                participating_peer_org.channels[channel_name] = channel;
            }
        }
    }

    // Returns a promise for creation of a kvs for each organization.
    create_kvs_for_each_org__p () {
        logger.debug('create_kvs_for_each_org__p();');
        const promises = [];
        for (const org_name in this.organizations) {
            const org       = this.organizations[org_name];
            const client    = org.client;
            const kvs_path  = this.appcfg.kvs_path_prefix + org_name;
            logger.debug('    creating kvs for organization "%s" using path "%s"', org_name, kvs_path);
            promises.push(
                FabricClient.newDefaultKeyValueStore({
                    path: kvs_path
                }).then((kvs) => {
                    logger.debug('    successfully created kvs for organization "%s"', org_name);
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
        logger.debug('enroll_all_users_for_each_org__p();');
        const promises = [];
        for (const org_name in this.organizations) {
            const org           = this.organizations[org_name];
            const org_cfg       = this.netcfg.organizations[org_name];
            const client        = org.client;
            for (const user_name in org_cfg.users) {
                const user_cfg                  = org_cfg.users[user_name];
                // TODO: Probably specify cert/key filenames directly, instead of relying on particular dir structure/filename scheme
                const user_msp_cert_dir         = fs.readdirSync(path.join(__dirname, user_cfg.msp_path, 'signcerts'));
                assert(user_msp_cert_dir.length == 1, util.format('msp/signcerts directory must contain exactly 1 entry; actual was %j', user_msp_cert_dir));
                const user_msp_key_dir          = fs.readdirSync(path.join(__dirname, user_cfg.msp_path, 'keystore'));
                assert(user_msp_key_dir.length == 1, util.format('msp/keystore directory must contain exactly 1 entry; actual was %j', user_msp_key_dir));
                logger.debug('    org_name: "%s", user_name: "%s", user_msp_cert_dir: %j, user_msp_key_dir: %j', org_name, user_name, user_msp_cert_dir, user_msp_key_dir);
                const user_msp_cert_filename    = path.join(__dirname, user_cfg.msp_path, 'signcerts', user_msp_cert_dir[0]);
                const user_msp_key_filename     = path.join(__dirname, user_cfg.msp_path, 'keystore', user_msp_key_dir[0]);
                const user_msp_cert             = fs.readFileSync(user_msp_cert_filename);
                const user_msp_key              = fs.readFileSync(user_msp_key_filename);
                logger.debug('    calling client.createUser on user_cfg "%s" for organization "%s"', user_name, org_name);
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
                        logger.debug('    client.createUser succeeded; user_name = "%s", org_name = "%s"', user_name, org_name);
                        // This doesn't work because client is not reentrant (the user parameter is client._userContext
                        // which if set by multiple parallel tasks, will screw things up).
//                         logger.debug('    client.createUser succeeded; user.getName() = "%s", org_name = "%s"', user.getName(), org_name);
                    })
                );
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

    create_channels__p () {
        logger.debug('create_channels__p();');
        const promises = [];
        for (const channel_name in this.appcfg.channels) {
            const channel_cfg               = this.appcfg.channels[channel_name];
            logger.debug('attempting to read config of channel "%s"; config is %j', channel_name, channel_cfg);
            const channel_creator_org       = this.organizations[channel_cfg.channel_creator_spec.organization_name];
            logger.debug('channel_creator_org keys:', Object.keys(channel_creator_org));
            const channel_creator_client    = channel_creator_org.client;
            let channel_creator_user;
            const channel                   = channel_creator_org.channels[channel_name];
            const channel_orderers          = channel.chain.getOrderers();
            assert(channel_orderers.length == 1, 'currently you may only specify one orderer per channel');
            const channel_orderer           = channel_orderers[0];
            const configtx                  = fs.readFileSync(path.join(__dirname, channel_cfg.configtx_path));
            promises.push(
                channel_creator_client.getUserContext(channel_cfg.channel_creator_spec.user_name, true)
                .then((channel_creator_user_) => {
                    channel_creator_user = channel_creator_user_;
                    const extracted_channel_config  = channel_creator_client.extractChannelConfig(configtx);
                    const signature                 = channel_creator_client.signChannelConfig(extracted_channel_config);
                    const nonce                     = FabricClientUtils.getNonce();
                    const txId                      = FabricClient.buildTransactionID(nonce, channel_creator_user);
                    logger.debug('creating channel "%s" using organization "%s"\'s client', channel_name, channel_creator_org);
                    return channel_creator_client.createChannel({
                        name: channel_name,
                        orderer: channel_orderer,
                        config: extracted_channel_config,
                        signatures: [signature],
                        txId: txId,
                        nonce: nonce
                    });
                })
                .then(result => {
                    logger.debug('    successfully created channel "%s" using organization "%s"\'s client; result: %j', channel_name, channel_creator_org, result);
                })
            );
        }
        // NOTE: This might also suffer the non-reentrancy problem like the other one, and may
        // need to be executed serially.
        return Promise.all(promises);
    }

    join_channels__p () {
        logger.debug('join_channels__p();');
        const promises = [];

        for (const channel_name in this.appcfg.channels) {
            const channel_cfg               = this.appcfg.channels[channel_name];
            const channel_creator_org       = this.organizations[channel_cfg.channel_creator_spec.organization_name];
            const channel_creator_client    = channel_creator_org.client;
            logger.debug('processing from appcfg: channel_cfg:', channel_cfg);
            logger.debug('participating_peer_organizations:', channel_cfg.participating_peer_organizations);

            for (const participating_peer_org_name in channel_cfg.participating_peer_organizations) {
                logger.debug('creating channel architecture for channel "%s" and participating org "%s"', channel_name, participating_peer_org_name);
                const participating_peer_org_cfg    = channel_cfg.participating_peer_organizations[participating_peer_org_name];
                const participating_peer_org        = this.organizations[participating_peer_org_name];
                const client                        = participating_peer_org.client;
                const channel                       = participating_peer_org.channels[channel_name];
                let genesis_block_protobuf;
                const chain                         = channel.chain;
                const targets                       = [];
                for (const participating_peer_name of participating_peer_org_cfg.peers) {
                    targets.push(participating_peer_org.peers[participating_peer_name]);
                }
                logger.debug('targets for joinChannel:', targets);

                // NOTE: We have to retrieve the genesis block for each call to chain.joinChannel because
                // that call destroys it.  Alternatively, figure out how to deep copy genesis_block_protobuf
                // as retrieved earlier (because each retrieval is exactly the same).
                promises.push(
                    channel_creator_client.getUserContext(channel_cfg.channel_creator_spec.user_name, true)
                    .then(channel_creator_user => {
                        logger.debug('    attempting to retrieve genesis block');
                        const nonce = FabricClientUtils.getNonce();
                        const txId = FabricClient.buildTransactionID(nonce, channel_creator_user);
                        return channel.chain.getGenesisBlock({
                            txId: txId,
                            nonce: nonce
                        });
                    })
                    .then(genesis_block_protobuf_ => {
                        logger.debug('successfully retrieved genesis block');
                        genesis_block_protobuf = genesis_block_protobuf_;
                        return client.getUserContext(participating_peer_org_cfg.channel_joiner_user_name, true)
                    })
                    // TODO: probably just make a "channel admin" user that does channel joining and install/instantiate.
                    .then(channel_joiner_user => {
                        logger.debug('channel_joiner_user.getName():', channel_joiner_user.getName());
                        const nonce                 = FabricClientUtils.getNonce();
                        const txId                  = FabricClient.buildTransactionID(nonce, channel_joiner_user);
                        logger.debug('calling chain.joinChannel on targets %j using user "%s" on behalf of peer org "%s"', targets, participating_peer_org_cfg.channel_joiner_user_name, participating_peer_org_name);
                        return chain.joinChannel({
                            targets: targets,
                            block: genesis_block_protobuf,
                            txId: txId,
                            nonce: nonce
                        });
                    })
                    .then(result => {
                        logger.debug('chain.joinChannel succeeded for peer org "%s"; result: %j', participating_peer_org_name, result);
                        logger.debug('calling chain.initialize() for peer org "%s"', participating_peer_org_name);
                        return chain.initialize();
                    })
                    .then(result => {
                        logger.debug('successfully initialized chain for peer org "%s"; result keys: %j', participating_peer_org_name, Object.keys(result));
                    })
                );
            }
        }
        return Promise.all(promises);
    }

    install_and_instantiate_chaincode_on_channel__p (request) {
        logger.debug('install_and_instantiate_chaincode_on_channel__p(); request: ', request);

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
            const chain                         = channel.chain;
            const targets                       = [];
            for (const participating_peer_name of participating_peer_org_cfg.peers) {
                targets.push(participating_peer_org.peers[participating_peer_name]);
            }
            logger.debug('targets for installChaincode:', targets);

            promises.push(
                client.getUserContext(invoking_user_name, true)
                .then(admin_user => {
                    const nonce = FabricClientUtils.getNonce();
                    const txId = FabricClient.buildTransactionID(nonce, admin_user);
                    return client.installChaincode({
                        targets: targets,
                        chaincodePath: channel_cfg.chaincode.path,
                        chaincodeId: channel_cfg.chaincode.id,
                        chaincodeVersion: channel_cfg.chaincode.version,
                        txId: txId,
                        nonce: nonce
                    });
                })
                .then(result => {
                    logger.debug('client.installChaincode call on peers of peer org "%s" returned', participating_peer_org_name);
                    const proposal_responses = result[0];
                    for (var i = 0; i < proposal_responses.length; i++) {
                        if (proposal_responses[i] instanceof Error) {
                            logger.debug('error received in client.installChaincode response:', proposal_responses[i]);
                            throw new Error(proposal_responses[i]);
                        }
                    }
                    logger.debug('installChaincode proposal response succeeded on peers of peer org "%s".', participating_peer_org_name);
                    // This constant retrieving of user contexts is dumb and should be fixed
                    return client.getUserContext(invoking_user_name, true);
                })
                .then(admin_user => {
                    const nonce = FabricClientUtils.getNonce();
                    const txId = FabricClient.buildTransactionID(nonce, admin_user);
                    logger.debug('calling chain.sendInstantiateProposal on peers of peer org "%s"; fcn = "%s", args = %j.', participating_peer_org_name, fcn, args);
                    // TODO: specify unanimous endorsement policy
                    return chain.sendInstantiateProposal({
                        targets: targets,
                        chaincodePath: channel_cfg.chaincode.path,
                        chaincodeId: channel_cfg.chaincode.id,
                        chaincodeVersion: channel_cfg.chaincode.version,
                        fcn: fcn,
                        args: args,
                        chainId: channel_name,
                        txId: txId,
                        nonce: nonce
                    })
                })
                .then(result => {
                    logger.debug('call to chain.sendInstantiateProposal succeeded');
                    const proposal_responses = result[0];
                    const proposal = result[1];
                    const header   = result[2];
                    for (var i = 0; i < proposal_responses.length; i++) {
                        if (proposal_responses[i] instanceof Error) {
                            logger.debug('error received in chain.sendInstantiateProposal response:', proposal_responses[i]);
                            throw new Error(proposal_responses[i]);
                        }
                    }
                    logger.debug('calling chain.sendTransaction on for sendInstantiateProposal responses; peer org is "%s".', participating_peer_org_name);
                    return chain.sendTransaction({
                        proposalResponses: proposal_responses,
                        proposal: proposal,
                        header: header
                    });
                })
                .then(result => {
                    logger.debug('successfully sent transaction for sendInstantiateProposal; peer org is "%s"; result: %j', participating_peer_org_name, result);
                })
            );
        }
        return Promise.all(promises);
    }

    // request should be a dict with elements:
    // - channel_name
    // - invoking_user_name
    // - invoking_user_org_name
    // - args (the first of which should be the function name)
    // - query_only (a boolean indicating if the payload should just be returned after transaction
    //   proposal; i.e. the transaction won't be committed to the ledger)
    invoke__p (request) {
        logger.debug('---------------------------------');
        logger.debug('---------------------------------');
        logger.debug('---------------------------------');
        logger.debug('INVOKE; request: ', request);

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
        const chain                         = channel.chain;

        let txId;

        // TEMP HACK - just invoke using Admin account
        return client.getUserContext(invoking_user_name, true)
        .then(user => {
            const nonce = FabricClientUtils.getNonce();
            txId = FabricClient.buildTransactionID(nonce, user);
            logger.debug('    calling chain.sendTransactionProposal');
            return chain.sendTransactionProposal({
                chaincodeId: channel_cfg.chaincode.id,
                chainId: channel_name,
                txId: txId,
                nonce: nonce,
                fcn: fcn,
                args: args
            })
        })
        .then(result => {
            logger.debug('call to chain.sendTransactionProposal succeeded');
            const proposal_responses = result[0];
            const proposal = result[1];
            const header   = result[2];
            // Make sure all proposal_responses are the same.
            if (!chain.compareProposalResponseResults(proposal_responses)) {
                logger.debug('chain.compareProposalResponseResults failed');
                throw new Error('chain.compareProposalResponseResults failed');
            }
            // Verify that the proposal responses are signed correctly.
            for (var i = 0; i < proposal_responses.length; i++) {
                if (!chain.verifyProposalResponse(proposal_responses[i])) {
                    logger.debug('chain.verifyProposalResponses failed');
                    throw new Error('chain.verifyProposalResponses failed');
                }
            }
            // Check if the response is an error.
            assert(proposal_responses.length > 0, 'proposal_responses has no elements');
            if (proposal_responses[0] instanceof Error) {
                logger.debug('error received in chain.sendInstantiateProposal response:', proposal_responses[0]);
                throw new Error(proposal_responses[0]);
            }
            // Otherwise everything is good, so grab the payload.
            const payload = proposal_responses[0].response.payload;
            const payload_as_string = Buffer.from(payload).toString();
            logger.debug('*** invoke succeeded, response payload (as string) was "%s"', payload_as_string);
            // If query_only was specified, then return now.
            if (query_only) {
                // TODO: probably should return the payload itself
                return payload_as_string;
            }

            // In fabric-sdk-node v1.0.0-alpha2, there is no way to create an EventHub via Client
            // or Chain like there should be, so we have to require the internal EventHub.js source
            // directly and create it by hand.

            // Create and connect to event hub after transaction proposal.  This is to be notified
            // when the transaction is committed or rejected.
            const eventhub = new EventHub(client);
            // Arbitrarily choose the "first" peer to connect to
            const peer_cfg = invoking_user_org_cfg.peers[Object.keys(invoking_user_org_cfg.peers)[0]];
            const eventhub_url = assemble_url_from_remote(peer_cfg.events_remote);
            logger.debug('Connecting the event hub: ', eventhub_url);
            eventhub.setPeerAddr(
                eventhub_url,
                undefined // TEMP TLS is disabled for now
            );
            eventhub.connect();

            const eventhub_txId = txId.toString();
            // Set up event hub to listen for this transaction
            const eventhub_promise = new Promise(function(resolve, reject) {
                const timeout_handle = setTimeout(
                    () => {
                        logger.debug('eventhub %s timed out waiting for txId ', eventhub_url, txId);
                        eventhub.unregisterTxEvent(eventhub_txId);
                        logger.debug('disconnecting eventhub %s', eventhub_url);
                        eventhub.disconnect();
                        reject(new Error('eventhub ' + eventhub_url + ' timed out waiting for txId ' + eventhub_txId));
                    },
                    30000
                );
                logger.debug('registering eventhub %s to listen for transaction ', eventhub_url, txId);

                eventhub.registerTxEvent(eventhub_txId, function(txid, code) {
                    logger.debug('from eventhub %s : event %j received; code: %j', eventhub_url, txid, code);
                    clearTimeout(timeout_handle);
                    eventhub.unregisterTxEvent(txid);
                    logger.debug('disconnecting eventhub %s', eventhub_url);
                    eventhub.disconnect();

                    if (code !== 'VALID') {
                        return reject(new Error('Transaction failure reported by eventhub ' + eventhub_url + ' for txId ' + eventhub_txId + '; code: ' + code));
                    } else {
                        return resolve({status: code});
                    }
                });
            });

            logger.debug('calling chain.sendTransaction on for sendTransactionProposal responses');
            const transaction_promise = chain.sendTransaction({
                proposalResponses: proposal_responses,
                proposal: proposal,
                header: header
            })
            .then(result => {
                logger.debug('sendTransaction promise resolved; result: ', result);
                return result;
            })
            .catch(err => {
                logger.debug('caught error during invoke__p(); err: ', err);
                logger.debug('disconnecting eventhub %s', eventhub_url);
                eventhub.disconnect();
                throw err;
            });

            // TODO: Maybe return the promises separately, so that the user has more control
            return Promise.all([
                transaction_promise,
                eventhub_promise
            ])
            .then((sendTransaction_result, transaction_result) => {
                logger.debug('successfully received sendTransaction result %j and eventhub notification of transaction completion with result %j', sendTransaction_result, transaction_result);
                return transaction_result;
            })
        })
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
