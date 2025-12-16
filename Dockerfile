# Multi-stage build for optimal image size and security
FROM node:20-alpine AS builder

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install all dependencies (including dev) for potential build steps
RUN npm ci --ignore-scripts

# Copy source code
COPY . .

# Production stage
FROM node:20-alpine

# Add security labels
LABEL maintainer="abdulkadersh0002-dev" \
      version="1.0.0" \
      description="Intelligent Auto-Trading System"

# Install dumb-init for proper signal handling
RUN apk add --no-cache dumb-init

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install production dependencies only
RUN npm ci --omit=dev --ignore-scripts && \
    npm cache clean --force

# Copy application code from builder
COPY --from=builder --chown=nodejs:nodejs /app .

# Set environment variables
ENV NODE_ENV=production \
    PORT=4101 \
    ALLOW_SYNTHETIC_DATA=false \
    REQUIRE_REALTIME_DATA=true

# Switch to non-root user
USER nodejs

# Expose port
EXPOSE 4101

# Add health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:4101/api/healthz || exit 1

# Use dumb-init for proper signal handling
ENTRYPOINT ["dumb-init", "--"]

# Start the application
CMD ["npm", "start"]
