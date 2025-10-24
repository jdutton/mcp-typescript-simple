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

# Copy docs directory (needed for homepage build)
COPY docs/ ./docs/

# Install all dependencies (needed for build)
# Note: postinstall script automatically builds workspace packages
RUN npm ci

# Build the TypeScript project
# Note: packages/ already copied above, postinstall builds workspace packages
RUN npm run build

# Copy runtime files needed for server
COPY openapi.yaml ./

# Remove dev dependencies and package source files to reduce image size
RUN rm -rf packages/*/src/ packages/*/test/ tsconfig.json
RUN npm prune --production

# Create non-root user
RUN addgroup -g 1001 -S nodejs
RUN adduser -S mcpuser -u 1001 -G nodejs

# Change ownership of the app directory
RUN chown -R mcpuser:nodejs /app
USER mcpuser

# Expose port (MCP typically uses stdio, but this can be useful for HTTP variants)
EXPOSE 3000

# Start the server with observability instrumentation
# Note: main entry point is now in packages/example-mcp
CMD ["node", "--import", "./packages/observability/dist/register.js", "packages/example-mcp/dist/index.js"]