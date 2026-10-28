#!/bin/bash
cd "$(dirname "$0")"
export PORT=${PORT:-3000}
export ADMIN_KEY=${ADMIN_KEY:-}
node server.js
