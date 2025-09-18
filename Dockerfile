FROM node:20-alpine

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy source code
COPY src/ ./src/
COPY tsconfig.json ./

# Install TypeScript and build
RUN npm install -g typescript
RUN npm run build

# Remove dev dependencies and source files
RUN rm -rf src/ tsconfig.json node_modules/
RUN npm ci --only=production

# Create non-root user
RUN addgroup -g 1001 -S nodejs
RUN adduser -S nextjs -u 1001

# Change ownership of the app directory
RUN chown -R nextjs:nodejs /app
USER nextjs

# Expose port (MCP typically uses stdio, but this can be useful for HTTP variants)
EXPOSE 3000

# Start the server
CMD ["node", "build/index.js"]