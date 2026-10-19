# Dockerfile for Y.js WebSocket sync server
FROM node:22-alpine

WORKDIR /app

# Install dependencies
RUN npm install ws yjs y-websocket

# Copy server
COPY y-websocket-server.js ./

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:1234/health || exit 1

EXPOSE 1234

CMD ["node", "y-websocket-server.js", "1234"]