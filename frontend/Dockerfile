# ─── ServerPilot Frontend Dockerfile ─────────────────────────────────────────
#
# Two-stage build:
#   1. Node builder: installs deps, builds production Vite bundle
#   2. Nginx server: serves the static bundle with optimal config

FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files and install dependencies
COPY package.json package-lock.json* ./
RUN npm ci --silent

# Copy source and build
COPY . .
ARG VITE_API_URL=/api
ARG VITE_WS_URL=""
ENV VITE_API_URL=$VITE_API_URL
ENV VITE_WS_URL=$VITE_WS_URL
RUN npm run build

# ─── Production stage ─────────────────────────────────────────────────────────

FROM nginx:alpine

# Remove default nginx config
RUN rm /etc/nginx/conf.d/default.conf

# Copy custom nginx config for SPA routing
COPY nginx-spa.conf /etc/nginx/conf.d/default.conf

# Copy built assets
COPY --from=builder /app/dist /usr/share/nginx/html

# Non-root execution
RUN chown -R nginx:nginx /usr/share/nginx/html && \
    chmod -R 755 /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
