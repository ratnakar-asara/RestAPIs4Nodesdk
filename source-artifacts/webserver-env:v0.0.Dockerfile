# Start with an image that's set up to do things we need
FROM hyperledger/fabric-baseimage:x86_64-0.3.0
# Declare USERNAME and HOME var- for convenience.
ENV USERNAME minion
# Install python2.7-minimal for use by node-gyp.
# Install nmap for random network debugging during development.
# Upgrade node and npm to specific versions.
# The mkdir and chown nonsense is because docker has idiotic policies regarding the root user, especially when mounting a volume.
RUN apt-get update && \
    apt-get --assume-yes --no-install-recommends --no-install-suggests install python2.7-minimal python-pip nmap && \
    useradd --user-group --create-home --shell /bin/false $USERNAME && \
    mkdir /home/$USERNAME/node_modules && \
    chown -R $USERNAME:$USERNAME $GOPATH && \
    chown -R $USERNAME:$USERNAME /home/$USERNAME
# Switch to the non-root user.
USER $USERNAME
# Set the HOME env var.
ENV HOME /home/$USERNAME
# Set the working directory to the user's home dir.
WORKDIR $HOME
