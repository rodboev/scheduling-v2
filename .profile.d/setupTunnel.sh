#!/bin/bash
echo "Starting setupTunnel.sh script"

# Create SSH directory and set permissions
mkdir -p /app/.ssh
chmod 700 /app/.ssh

# Write SSH key with proper format
echo "Writing SSH key..."
echo "$PRIVATE_SSH_KEY" | sed 's/^"\(.*\)"$/\1/' | sed 's/\\n/\n/g' > /app/.ssh/id_rsa
chmod 600 /app/.ssh/id_rsa

# Verify key format
echo "Verifying SSH key:"
echo "First 3 lines of processed key:"
head -n 3 /app/.ssh/id_rsa

# Function to start tunnel
start_tunnel() {
    echo "Starting SSH tunnel..."
    ssh -N -L "$SSH_TUNNEL_FORWARD" -p "$SSH_TUNNEL_PORT" "$SSH_TUNNEL_TARGET" \
        -o StrictHostKeyChecking=no \
        -o UserKnownHostsFile=/dev/null > /app/tunnel.log 2>&1 &
    TUNNEL_PID=$!
    
    # Wait briefly for tunnel to establish
    sleep 5
    
    # Check if tunnel is running
    if ! ps -p $TUNNEL_PID > /dev/null; then
        echo "❌ Tunnel failed to start. Logs:"
        cat /app/tunnel.log
        return 1
    fi
    
    echo "✅ Tunnel established (PID: $TUNNEL_PID)"
    return 0
}

# Function to restart tunnel
restart_tunnel() {
    echo "Restarting tunnel..."
    if [ ! -z "$TUNNEL_PID" ]; then
        kill $TUNNEL_PID 2>/dev/null
    fi
    start_tunnel
}

# Start initial tunnel
start_tunnel || exit 1

# Setup periodic restart (every 30 minutes)
while true; do
    sleep 1800  # 30 minutes
    echo "$(date): Performing scheduled tunnel restart"
    restart_tunnel
done &

echo "Tunnel monitor started"
