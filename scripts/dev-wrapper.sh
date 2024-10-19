#!/bin/bash

# Set ODBCINI and FREETDSCONF environment variables
export ODBCINI="$APPDATA\\FreeTDS\\odbc.ini"
export FREETDSCONF="$APPDATA\\FreeTDS\\freetds.conf"

# Run the tunnel setup script
bash scripts/setupTunnelWindows.sh &

# Start the Next.js development server
npx next dev &