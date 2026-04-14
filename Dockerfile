FROM node:18-alpine

# Install MediaSoup dependencies and build tools
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    linux-headers \
    gcc \
    pkgconfig \
    pixman-dev \
    libx11-dev \
    libxtst-dev

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Build MediaSoup worker from source
RUN cd node_modules/mediasoup/worker && \
    npm run build:worker && \
    cd ../../

# Copy source code
COPY . .

# Create non-root user
RUN addgroup -g 1001 -S nodejs
RUN adduser -S nodejs -u 1001

# Change ownership
RUN chown -R nodejs:nodejs /app
USER nodejs

# Expose ports
EXPOSE 8000
EXPOSE 40000-49999/udp

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:8000', (res) => { process.exit(res.statusCode === 200 ? 0 : 1) })"

CMD ["npm", "start"]
