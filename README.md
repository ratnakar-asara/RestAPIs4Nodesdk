# Hyperledger Fabric Example App using node.js SDK

This is a fork of https://github.com/ratnakar-asara/Fabric_SampleWebApp

## Instructions

Clone this repo with the following command.

    git clone https://github.com/vdods/Fabric_SampleWebApp.git

In one terminal, spin up the peer network, orderer, certificate authorities, and web server (which hosts the web app).

    make up

Once you see the following in the services log, the web server is ready to process requests.

    info: ****************** SERVER STARTED ************************
    info: **************  http://localhost:4000  ******************

In another terminal, execute the test script which issues HTTP requests using `curl` against the REST API offered by the web app.

    ./testAPIs.sh

The script should run to completion and exit without error (return code should be 0).

## Structure Of Project

TODO document
-   Project structure
-   What are source files
-   What are generated
-   docker-compose volumes

## Finer-grained Instructions

There are several `make` targets that make controlling the docker-compose services defined in `docker-compose.yaml`
easier.

-   The command

        make all-generated-artifacts

    will ensure that the following artifacts are generated:
    -   Cryptographic materials in `generated-artifacts/crypto-config`
    -   Configuration transaction in `generated-artifacts/mychannel.tx`
    -   Orderer genesis block in `generated-artifacts/orderer.genesis.block`

    The `generated-artifacts` directory contains all generated artifacts and only generated artifacts (no source artifacts),
    and therefore can be entirely deleted without worry.

-   The command

        make rm-generated-artifacts

    will delete all generated artifacts.  In particular, it will delete the entire `generated-artifacts` directory.

-   The command

        make up

    ensures that all necessary artifacts are generated (into the `generated-artifacts` subdir), and creates and starts all
    services, volumes, and networks and prints all services' logs to the console.  Hitting Ctrl+C in this mode
    will stop all services.  If any container exits, all will exit.  There are three volumes:
    -   `fabric_samplewebapp_webserver_homedir` : Stores the home directory of the user that runs the web server.  In particular, this
        stores the `~/.hfc-key-store` directory.
    -   `fabric_samplewebapp_webserver_homedir_node_modules` : Stores the `node_modules` directory for the web server.  This will really
        only be populated once and won't need updating often, nor does it typically need to be deleted before restarting the
        web server.
    -   `fabric_samplewebapp_webserver_tmp` : Stores the key/value store for each organization in the network.

-   The command

        make up-detached

    does the same as `make up` except that it spins up all services in the background and does not print logs to the console.

-   The command

        make logs-follow

    can be used voluntarily, in the case that `make up-detached` was used, to follow the services' log printouts.
    Hitting Ctrl+C will detach from the log printout but not stop the services.

-   The command

        make down

    brings down all services, but do not delete any volumes (i.e. docker-based persistent storage).

-   The command

        make down-full

    brings down all services and delete all volumes.  This clears all state (of peers, orderer, CAs, web server, etc).

-   The command

        make rm-state-volumes

    deletes the persistent storage of the web server (in particular, the `fabric_samplewebapp_webserver_tmp` and
    `fabric_samplewebapp_webserver_homedir` volumes), and can be used for example to reset the web server to a 'clean'
    state, not having anything in the key/value store(s).  This can be executed only if the services are not up.

-   The command

        make rm-node-modules

    deletes the node_modules directory of the web server (in particular, the `fabric_samplewebapp_webserver_homedir_node_modules` volume).
    This can be executed only if the services are not up.

-   And finally,

        make down && make rm-state-volumes && make up

    is a convenient single command you can use after stopping services to reset all services back to a clean state
    and restart them, following the services' logs.  There is typically no need to delete `node_modules` because
    it is not likely to qualitatively change or be corrupted (though that does happen sometimes during development
    for various reasons).  Note that the web server service in `docker-compose.yaml` does execute the
    command `npm install`, so any updates to `package.json` should automatically take effect.

## Random Notes

-   There is a bit of a hack in `docker-compose.yaml` in order to retrieve the private key filename in various situations.
    This is done by specifying

        --ca.keyfile `ls -1 /etc/hyperledger/fabric-ca-server-config/*_sk`

    in the command to start each CA service.  If there is more than one file in that directory matching the `*_sk` pattern,
    then this will cause the CA (in this case, `ca.org1.example.com`) to stop with error

        ca.org1.example.com       | 2017/06/01 19:31:53 [INFO] Created default configuration file at /etc/hyperledger/fabric-ca-server/fabric-ca-server-config.yaml
        ca.org1.example.com       | Error: Usage: too many arguments.
        ca.org1.example.com       | Usage:
        ca.org1.example.com       |   fabric-ca-server start [flags]

    This can occur if for some reason the cryptographic materials are generated (via rules in Makefile) more than once.
    The solution is to delete the cryptographic materials so they can be regenerated from scratch.  This can be done
    conveniently via the command

        make rm-generated-artifacts

    No explicit command is necessary to regenerate them for running the docker-compose services, as the `make up` command
    will generate them automatically.  However, they can be generated via the command

        make all-generated-artifacts
-   TODO: Make a separate directory of artifacts for use by the web server.  There should be a very clear
    demarcation between the artifacts directories for each logical server (e.g. peer, orderer, ca, webserver).
-   TODO: Get orderer TLS working.  Currently it fails within the grpc node module in the Orderer.sendBroadcast call.
