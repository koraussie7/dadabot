# Minima node Dockerfile for MuhanAI integration
# Based on https://docs.minima.global/docs/install/docker
#
# Image: ~1.2 GB (OpenJDK + Minima JAR)
# Ports: 9001 (RPC), 9002 (WebSocket), 9003 (MDS)
# Volume: /root/muhanai-data (chain + keys)
#
# Build:    docker build -t muhanai/minima:latest ./minima
# Run:      docker compose -f ../docker-compose.muhanai.yml up

FROM eclipse-temurin:17-jre-jammy

ARG MINIMA_VERSION=1.0.18
ARG MINIMA_JAR=Minima_${MINIMA_VERSION}.jar

RUN apt-get update && apt-get install -y --no-install-recommends \
        curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/minima

# Download Minima JAR (override with --build-arg MINIMA_JAR_URL=... for air-gapped builds)
ARG MINIMA_JAR_URL=https://github.com/minima-global/Minima/raw/master/jar/${MINIMA_JAR}
RUN curl -fsSL -o /opt/minima/${MINIMA_JAR} "${MINIMA_JAR_URL}" \
    || (echo "Download failed; falling back to Maven Central" \
        && curl -fsSL -o /opt/minima/${MINIMA_JAR} \
           "https://repo1.maven.org/maven2/org/minima/Minima/${MINIMA_VERSION}/Minima-${MINIMA_VERSION}.jar") \
    && echo "Minima JAR downloaded: $(ls -lh /opt/minima/${MINIMA_JAR})"

RUN ln -s /opt/minima/${MINIMA_JAR} /opt/minima/minima.jar

# Minidapps
RUN mkdir -p /opt/minima/minidapps
COPY minidapps/ /opt/minima/minidapps/

# Default config (override via volume mount)
COPY minima-conf.yaml /opt/minima/minima-conf.yaml

EXPOSE 9001 9002 9003

ENV MINIMA_PASSWORD=changeme
ENV JAVA_OPTS="-Xmx2g"

HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD curl -fsS http://localhost:9001/status || exit 1

CMD ["sh", "-c", "java $JAVA_OPTS -jar minima.jar -daemon -port 9001 -ws 9002"]
