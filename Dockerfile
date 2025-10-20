FROM node:22-alpine

# Set working directory
WORKDIR /app

# Copy package files and npm configuration
COPY package*.json .npmrc ./
COPY tsconfig.json ./

# Copy workspace packages for build
COPY packages/ ./packages/

# Copy tools directory (needed for postinstall script)
COPY tools/ ./tools/

# Install all dependencies (needed for build)
# Note: postinstall script automatically builds workspace packages
RUN npm ci

# Copy source code
COPY src/ ./src/

# Build the TypeScript project
RUN npm run build

# Copy runtime files needed for server
COPY openapi.yaml ./

# Remove dev dependencies and source files to reduce image size
RUN rm -rf src/ tsconfig.json
RUN npm ci --only=production

# Create non-root user
RUN addgroup -g 1001 -S nodejs
RUN adduser -S mcpuser -u 1001 -G nodejs

# Change ownership of the app directory
RUN chown -R mcpuser:nodejs /app
USER mcpuser

# Expose port (MCP typically uses stdio, but this can be useful for HTTP variants)
EXPOSE 3000

# Start the server with observability instrumentation
CMD ["node", "--import", "./build/observability/register.js", "build/index.js"]