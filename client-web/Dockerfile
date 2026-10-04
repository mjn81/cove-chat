# Build stage
FROM --platform=$BUILDPLATFORM node:24-alpine AS builder

WORKDIR /app

# pnpm version is pinned by the "packageManager" field in package.json
RUN corepack enable

# Copy package files
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

# Copy source
COPY . .

# Build the application
# We set VITE_API_URL to a placeholder that will be replaced at runtime by entrypoint.sh
ENV VITE_API_URL=___VITE_API_URL_PLACEHOLDER___
RUN pnpm build

# Run stage
FROM nginx:alpine

# Copy built assets from builder stage
COPY --from=builder /app/dist /usr/share/nginx/html

# Copy custom nginx config for SPA routing
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy entrypoint script
COPY entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/entrypoint.sh

# Expose port 80
EXPOSE 80

# Use the custom entrypoint script
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["nginx", "-g", "daemon off;"]
