# syntax=docker/dockerfile:1

# ---- Build stage ----
# Pin the minor version for reproducible builds.
FROM node:22-alpine AS build

WORKDIR /app

# Cache dependencies first so source edits don't invalidate the node_modules layer.
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci

COPY . .

# VITE_API_BASE_URL is baked into the static bundle at build time (import.meta.env).
# Empty/unset -> same-origin /v1 requests; set -> direct calls to the backend
# (the echo API allows cross-origin requests, so no proxy is needed).
ARG VITE_API_BASE_URL=https://echo-443460999135.asia-southeast1.run.app
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL

RUN npm run build

# ---- Runtime stage ----
# nginx serves the static SPA. try_files falls back to index.html so
# client-side routes (e.g. /app/reports) resolve on hard navigation.
# The template is envsubst'd by the image entrypoint: ${PORT} resolves from
# the environment (Cloud Run injects 8080).
FROM nginx:1.27-alpine

COPY nginx.conf /etc/nginx/templates/default.conf.template
COPY --from=build /app/build /usr/share/nginx/html

# Cloud Run injects PORT=8080 and expects the server to listen there.
ENV PORT=8080
EXPOSE 8080