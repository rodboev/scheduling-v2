#!/bin/bash

# Set ODBCINI and FREETDSCONF environment variables
export ODBCINI="$APPDATA\\FreeTDS\\odbc.ini"
export FREETDSCONF="$APPDATA\\FreeTDS\\freetds.conf"

# Function to clean up processes on exit
cleanup() {
    echo "Cleaning up Next.js process..."
    pkill -f "next dev"
    exit 0
}

# Set up trap to call cleanup function on script exit
trap cleanup EXIT INT TERM

# Run the tunnel setup script in the background
bash scripts/setupTunnelWindows.sh &

# Start the Next.js development server
npx next dev --experimental-https

# The script will wait here until Next.js exits or is interrupted
