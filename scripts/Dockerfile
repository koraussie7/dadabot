# Dockerfile for Y.js WebSocket Sync Server
FROM node:22-alpine

# Install dependencies
RUN apk add --no-cache curl

WORKDIR /app

# Copy package files first for caching
COPY package*.json ./

# Install production dependencies
RUN npm ci --omit=dev

# Copy server code
COPY y-websocket-server.js ./

# Create non-root user
RUN addgroup -g 1000 -S nodejs && \
    adduser -S -u 1000 -G nodejs ysync

# Create data directory for persistence
RUN mkdir -p /app/data && chown -R ysync:nodejs /app/data

USER ysync

# Expose WebSocket port
EXPOSE 1234

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:1234/health || exit 1

# Start server
CMD ["node", "y-websocket-server.js", "1234"]