# ═══════════════════════════════════════════════════════════════════════════
# ASGARD CRM - API Server Dockerfile
# ═══════════════════════════════════════════════════════════════════════════

FROM node:20-alpine

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci --only=production

# Copy source
COPY src ./src
COPY migrations ./migrations
COPY config ./config

# Create directories
RUN mkdir -p uploads public

# Set permissions
RUN chown -R node:node /app

USER node

EXPOSE 3000

CMD ["node", "src/index.js"]
