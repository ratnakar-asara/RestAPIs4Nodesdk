# PHONY targets have no dependencies and they will be built unconditionally upon request.
.PHONY: generated-artifacts initialization-org0.example.com initialization-org1.example.com initialization-org2.example.com initialization-www.example.com initialization inspect-initialized-volumes up up-detached logs-follow down down-full down-chaincode down-chaincode-full show-all-generated-resources rm-state-volumes rm-node-modules rm-chaincode-docker-resources clean

# This is also hardcoded in .env, so if you change it here, you must change it there.  Note that
# it must be in all-lowercase, as docker-compose changes it to lowercase anyway.
COMPOSE_PROJECT_NAME := fabricwebapp

GENERATED_ARTIFACTS_VOLUME := $(COMPOSE_PROJECT_NAME)_generated_artifacts__volume
COM_EXAMPLE_ORG0_VOLUMES := $(COMPOSE_PROJECT_NAME)_com_example_org0_ca__volume $(COMPOSE_PROJECT_NAME)_com_example_org0_peer0__volume $(COMPOSE_PROJECT_NAME)_com_example_org0_peer1__volume
COM_EXAMPLE_ORG1_VOLUMES := $(COMPOSE_PROJECT_NAME)_com_example_org1_ca__volume $(COMPOSE_PROJECT_NAME)_com_example_org1_peer0__volume $(COMPOSE_PROJECT_NAME)_com_example_org1_peer1__volume
COM_EXAMPLE_ORG2_VOLUMES := $(COMPOSE_PROJECT_NAME)_com_example_org2_ca__volume $(COMPOSE_PROJECT_NAME)_com_example_org2_orderer__volume
COM_EXAMPLE_WWW_VOLUMES := $(COMPOSE_PROJECT_NAME)_com_example_www__config_volume

# Default make rule
all:
	@echo "See README.md for info on make targets."

generated-artifacts:
	docker-compose -f docker/generated-artifacts.yaml up crypto_config
	docker-compose -f docker/generated-artifacts.yaml up channel_config
	# This removes stopped containers, and importantly, the anonymous volume created by the fact that
	# the channel_config service uses the image hyperledger/fabric-tools:x86_64-1.0.1, which creates
	# an anonymous volume.
	docker-compose -f docker/generated-artifacts.yaml rm -v --force
	# This command succeeds if and only if the specified volumes exist -- TODO: This doesn't actually check
	# what we want, because docker-compose creates all these volumes upon startup, regardless of what happens later.
	docker volume inspect $(GENERATED_ARTIFACTS_VOLUME)

down-generated-artifacts:
	docker-compose -f docker/generated-artifacts.yaml down

# TODO: Put failsafes in to prevent calling this twice?
initialization-org0.example.com:
	# This command succeeds if and only if the specified volumes exist
	docker volume inspect $(GENERATED_ARTIFACTS_VOLUME)
	docker-compose -f docker/initialization.yaml up com_example_org0__initialize
	# This command succeeds if and only if the specified volumes exist
	docker volume inspect $(COM_EXAMPLE_ORG0_VOLUMES)

initialization-org1.example.com:
	# This command succeeds if and only if the specified volumes exist
	docker volume inspect $(GENERATED_ARTIFACTS_VOLUME)
	docker-compose -f docker/initialization.yaml up com_example_org1__initialize
	# This command succeeds if and only if the specified volumes exist
	docker volume inspect $(COM_EXAMPLE_ORG1_VOLUMES)

initialization-org2.example.com:
	# This command succeeds if and only if the specified volumes exist
	docker volume inspect $(GENERATED_ARTIFACTS_VOLUME)
	docker-compose -f docker/initialization.yaml up com_example_org2__initialize
	# This command succeeds if and only if the specified volumes exist
	docker volume inspect $(COM_EXAMPLE_ORG2_VOLUMES)

initialization-www.example.com:
	# This command succeeds if and only if the specified volumes exist
	docker volume inspect $(GENERATED_ARTIFACTS_VOLUME)
	docker-compose -f docker/initialization.yaml up com_example_www__initialize
	# This command succeeds if and only if the specified volumes exist
	docker volume inspect $(COM_EXAMPLE_WWW_VOLUMES)

# Copies necessary materials from generated_artifacts__volume to the volumes for various peers/orderers/etc.
# The -j1 is important here, otherwise docker creates multiple networks named fabricwebapp_default
# due to idiotic design in docker -- https://github.com/moby/moby/issues/18864
initialization:
	$(MAKE) -j1 initialization-org0.example.com initialization-org1.example.com initialization-org2.example.com initialization-www.example.com
	docker-compose -f docker/initialization.yaml down

# Brings down the services defined in docker/initialization.yaml
down-initialization:
	docker-compose -f docker/initialization.yaml down

# Note that this only checks for the presence of certain volumes.  It doesn't verify that the contents are correct.
inspect-initialized-volumes:
	docker volume inspect $(COM_EXAMPLE_ORG0_VOLUMES) $(COM_EXAMPLE_ORG1_VOLUMES) $(COM_EXAMPLE_ORG2_VOLUMES) $(COM_EXAMPLE_WWW_VOLUMES) || echo "must successfully run `make initialization` in order to generate the containers needed for the various services."

# Bring up all services (and necessary volumes, networks, etc)
up: inspect-initialized-volumes
	docker-compose up --abort-on-container-exit

# Bring up all services (and necessary volumes, networks, etc) in detached mode
up-detached: inspect-initialized-volumes
	docker-compose up -d --abort-on-container-exit

# Follow the output of the logs
logs-follow:
	docker-compose logs --follow --tail="all"

# Bring down all services (delete associated containers, networks, but not volumes)
down:
	docker-compose down

# Bring down all services and volumes (delete associated containers, networks, AND volumes)
down-full:
	docker-compose down -v

# Bring down the chaincode containers
down-chaincode:
	docker rm dev-peer0.org0.example.com-mycc-v0 \
	          dev-peer1.org0.example.com-mycc-v0 \
	          dev-peer0.org1.example.com-mycc-v0 \
	          dev-peer1.org1.example.com-mycc-v0; \
	true

down-chaincode-full: down-chaincode
	docker rmi dev-peer0.org0.example.com-mycc-v0 \
	           dev-peer1.org0.example.com-mycc-v0 \
	           dev-peer0.org1.example.com-mycc-v0 \
	           dev-peer1.org1.example.com-mycc-v0; \
	true

# Shows all non-source resources that this project created that currently still exist.
# The shell "or" with `true` is so we don't receive the error code that find/grep produces when there are no matches.
show-all-generated-resources:
	docker network ls | grep $(COMPOSE_PROJECT_NAME)_ || true
	@echo ""
	docker ps -a | grep example.com || true
	@echo ""
	docker volume ls | grep $(COMPOSE_PROJECT_NAME)_ || true
	@echo ""
	docker images | grep -E "$(COMPOSE_PROJECT_NAME)|example.com" || true

# Build the chaincode using the hyperledger/fabric-ccenv image.  This make target would be
# used during chaincode development to quickly find and correct compile errors.
build-chaincode:
	docker-compose -f docker/build-chaincode.yaml up
	docker-compose -f docker/build-chaincode.yaml down

# Delete the volume created by the build-chaincode target.  This will not affect the production environment.
rm-build-chaincode-state:
	docker-compose -f docker/build-chaincode.yaml down && docker volume rm fabricwebapp_build_chaincode_volume

# Delete the "state" volumes -- tmp dir (which contains the webserver's key store) and HFC key/value store in
# home dir This can be done after `make down` to reset things to a "clean state", without needing to recompile go code or
# run `npm install` from scratch.  The shell "or" with `true` is so this command never fails.
rm-state-volumes:
	docker volume rm \
	$(COM_EXAMPLE_ORG0_VOLUMES) \
	$(COM_EXAMPLE_ORG1_VOLUMES) \
	$(COM_EXAMPLE_ORG2_VOLUMES) \
	$(COM_EXAMPLE_WWW_VOLUMES) \
	$(COMPOSE_PROJECT_NAME)_com_example_www__home_volume \
	|| true

# Delete the node_modules dir, in case things get inexplicably screwy and you just feel like you have to nuke something.
# The shell "or" with `true` is so this command never fails.
rm-node-modules:
	docker volume rm $(COMPOSE_PROJECT_NAME)_com_example_www__node_modules_volume || true

# Delete generated_artifacts__volume.  This contains all cryptographic material and some channel config material.
# BE REALLY CAREFUL ABOUT RUNNING THIS ONE, BECAUSE IT CONTAINS YOUR ROOT CA CERTS/KEYS.
rm-generated-artifacts: down-initialization
	docker volume rm $(GENERATED_ARTIFACTS_VOLUME) || true

# Delete the containers and images created by the peers that run chaincode.  This will be necessary if the chaincode
# is changed, because new docker images will have to be built with the new chaincode.  If the chaincode has not changed,
# then this is not necessary.  The semicolons are to run the commands sequentially without heeding the exit code.  The
# command `true` is called last so that the make rule is always considered to have succeeded.
rm-chaincode-docker-resources:
	docker rm dev-peer0.org0.example.com-mycc-v0 \
	          dev-peer1.org0.example.com-mycc-v0 \
	          dev-peer0.org1.example.com-mycc-v0 \
	          dev-peer1.org1.example.com-mycc-v0; \
	docker images | egrep dev-peer.*example.com | awk '{ print $$1 }' | xargs docker rmi -f; \
	true

# Deletes all non-source resources that this project created that currently still exist.  This should
# reset the project back to a "clean" state.  NOTE: USE WITH CAUTION! This will also wipe out
# generated_artifacts__volume which, unless you backed them up somewhere, if you have configured
# generation of intermediate CAs, then it contains the only copies of your root CAs' keys.
rm-all-generated-resources:
	$(MAKE) down down-generated-artifacts down-initialization
	$(MAKE) rm-state-volumes rm-node-modules rm-generated-artifacts rm-chaincode-docker-resources
	$(MAKE) rm-build-chaincode-state rm-chaincode-docker-resources

# Alias for rm-all-generated-resources.  NOTE: USE WITH CAUTION!
clean: rm-all-generated-resources
