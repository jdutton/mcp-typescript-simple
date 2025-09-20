FROM node:22-alpine

# Set working directory
WORKDIR /app

# Copy package files and npm configuration
COPY package*.json .npmrc ./

# Install all dependencies (needed for build)
RUN npm ci

# Copy source code and TypeScript config
COPY src/ ./src/
COPY tsconfig.json ./

# Build the TypeScript project
RUN npm run build

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

# Start the server
CMD ["node", "build/index.js"]