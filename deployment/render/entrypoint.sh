#!/bin/sh
# ============================================================================
# FILE: entrypoint.sh
# LOCATION: deployment/render/entrypoint.sh
# ============================================================================
# PURPOSE:
#    Container bootstrap script to substitute dynamic $PORT and start NGINX + Node.
# ============================================================================

set -e
export PORT="${PORT:-10000}"

# Substitute $PORT into NGINX configuration
envsubst '$PORT' < /etc/nginx/nginx.conf.template > /etc/nginx/nginx.conf

# Start NGINX in background
nginx

# Start NestJS backend in foreground as primary process
cd /app/backend && exec node dist/main.js
