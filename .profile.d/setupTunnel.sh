#!/bin/bash
echo "Starting setupTunnel.sh script"

# SSH Tunnel Setup
mkdir -p /app/.ssh
chmod 700 /app/.ssh
echo "$SSH_PRIVATE_KEY" > /app/.ssh/id_rsa
chmod 600 /app/.ssh/id_rsa

# Write the command to a file to be executed by pm2
echo "#!/bin/bash
ssh -N -L $SSH_TUNNEL_FORWARD -i /app/.ssh/id_rsa -o StrictHostKeyChecking=no -p $SSH_TUNNEL_PORT $SSH_TUNNEL_TARGET
" > /app/ssh_tunnel.sh
chmod +x /app/ssh_tunnel.sh

# Start the SSH tunnel using pm2
pm2 start /app/ssh_tunnel.sh --name "ssh-tunnel"
pm2 save

echo "setupTunnel.sh script completed"