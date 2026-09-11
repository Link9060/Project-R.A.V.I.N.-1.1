#!/bin/sh
set -eu

echo "Starting RAVIN web server..."
exec node server.js
