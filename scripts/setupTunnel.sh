#!/bin/bash
echo "Starting setupTunnel.sh script"
set -e  # Exit immediately if a command exits with a non-zero status

# Only run in local Windows environment
if [[ "$OSTYPE" != "msys"* && "$OSTYPE" != "cygwin"* && "$OSTYPE" != "win"* ]] && [[ -z "$WINDIR" ]]; then
    echo "Detected non-Windows environment. Skipping tunnel setup."
    exit 0
fi

# Load environment variables
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Load .env and .env.local
source "$PROJECT_ROOT/.env" 2>/dev/null || true
source "$PROJECT_ROOT/.env.local" 2>/dev/null || true

# Create SSH directory and set permissions
mkdir -p ~/.ssh
chmod 700 ~/.ssh

# Write SSH key
echo "Writing SSH key..."
echo "$PRIVATE_SSH_KEY" | sed 's/^"\(.*\)"$/\1/' | sed 's/\\n/\n/g' > ~/.ssh/id_rsa
chmod 600 ~/.ssh/id_rsa

# Verify SSH key format and content
echo "Verifying SSH key:"
if ! grep -q "BEGIN OPENSSH PRIVATE KEY" ~/.ssh/id_rsa; then
    echo "❌ SSH key missing BEGIN marker"
    echo "First 3 lines of key:"
    head -n 3 ~/.ssh/id_rsa
    exit 1
fi

echo "First 3 lines of processed key:"
head -n 3 ~/.ssh/id_rsa

# Create tunnel script
cat << EOF > ~/tunnel.sh
#!/bin/bash

# Start tunnel
ssh -vvv -N -L ${SSH_TUNNEL_FORWARD} \\
    -i ~/.ssh/id_rsa \\
    -o StrictHostKeyChecking=no \\
    -o ServerAliveInterval=30 \\
    -o ServerAliveCountMax=3 \\
    -o ExitOnForwardFailure=yes \\
    -p ${SSH_TUNNEL_PORT} \\
    ${SSH_TUNNEL_TARGET}
EOF

chmod +x ~/tunnel.sh

# Kill any existing tunnels
echo "Killing existing tunnels..."
taskkill //F //FI "IMAGENAME eq ssh.exe" //FI "WINDOWTITLE eq SSH" 2>/dev/null || true
netstat -ano | findstr :1433 | findstr LISTENING | awk '{print $NF}' | xargs -r taskkill //F //PID 2>/dev/null || true

# Start tunnel in background
echo "Starting tunnel..."
nohup ~/tunnel.sh > ~/tunnel.log 2>&1 &
TUNNEL_PID=$!

# Wait for tunnel to establish
echo "Waiting for tunnel to establish..."
sleep 10

# Check if tunnel is running
if ! ps -p $TUNNEL_PID > /dev/null; then
    echo "❌ Tunnel failed to start. Logs:"
    cat ~/tunnel.log
    exit 1
fi

# Verify port is listening
if ! netstat -an | findstr :1433 | findstr LISTENING > /dev/null; then
    echo "❌ Port 1433 is not listening. Logs:"
    cat ~/tunnel.log
    exit 1
fi

echo "✅ Tunnel established successfully"
echo "Finished setupTunnel.sh script"
