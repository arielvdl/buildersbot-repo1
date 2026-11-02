FROM coturn/coturn:4.17.2-r0
COPY remote/coturn/turnserver.conf /etc/coturn/buildersbot.conf
COPY remote/coturn/entrypoint.sh /usr/local/bin/buildersbot-coturn
ENTRYPOINT ["/usr/local/bin/buildersbot-coturn"]
