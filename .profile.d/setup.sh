#!/bin/bash

### setup.sh

echo "$(date): Starting setup.sh script"

# ODBC and FreeTDS Setup
export ODBCSYSINI=/app/.apt/etc
export ODBCINI=/app/.apt/etc/odbc.ini
export FREETDSCONF=/app/.apt/etc/freetds/freetds.conf
export LD_LIBRARY_PATH=/app/.apt/usr/lib/x86_64-linux-gnu:/app/.apt/usr/lib/x86_64-linux-gnu/odbc:$LD_LIBRARY_PATH

mkdir -p /app/.apt/etc/freetds
echo "[global]
tds version = 7.4
" > /app/.apt/etc/freetds/freetds.conf

mkdir -p $ODBCSYSINI
cat > "$ODBCSYSINI/odbcinst.ini" << EOL
[FreeTDS]
Description = FreeTDS Driver
Driver = /app/.apt/usr/lib/x86_64-linux-gnu/odbc/libtdsodbc.so
Setup = /app/.apt/usr/lib/x86_64-linux-gnu/odbc/libtdsS.so
EOL

cat > "$ODBCINI" << EOL
[MSSQL]
Driver = FreeTDS
Server = 127.0.0.1
Port = 1433
Database = ${SQL_DATABASE}
EOL

# Add FreeTDS bin to PATH
export PATH=$PATH:/app/.apt/usr/bin

# Check if folders and files exist
echo "Checking if required folders and files exist:"

folders_to_check=(
    "/app/.apt/etc/freetds"
    "$ODBCSYSINI"
)

files_to_check=(
    "/app/.apt/etc/freetds/freetds.conf"
    "$ODBCSYSINI/odbcinst.ini"
    "$ODBCINI"
)

for folder in "${folders_to_check[@]}"; do
    if [ -d "$folder" ]; then
        echo "✅ Folder exists: $folder"
    else
        echo "❌ Folder does not exist: $folder"
    fi
done

for file in "${files_to_check[@]}"; do
    if [ -f "$file" ]; then
        echo "✅ File exists: $file"
    else
        echo "❌ File does not exist: $file"
    fi
done

echo "$(date): setup.sh script completed"

### setupTunnel.sh

echo "$(date): Starting setupTunnel.sh script"

# Detect the operating system
if [[ "$OSTYPE" == "msys"* || "$OSTYPE" == "cygwin"* || "$OSTYPE" == "win"* ]] || [[ -n "$WINDIR" ]]; then
    echo "$(date): Detected Windows environment. This script is for Unix systems. Exiting."
    exit 1
fi

# Function to check if a variable is set and print its value
check_and_print_variable() {
    if [ -z "${!1}" ]; then
        echo "$(date): Warning: $1 is not set"
    elif [[ "$1" == *"KEY"* ]]; then
        echo "$(date): $1=${!1:0:10}..."
    else
        echo "$(date): $1=${!1}"
    fi
}

# SSH Tunnel Setup
echo "$(date): Setting up SSH tunnel..."

check_and_print_variable "SSH_TUNNEL_FORWARD"
check_and_print_variable "SSH_TUNNEL_PORT"
check_and_print_variable "SSH_TUNNEL_TARGET"
check_and_print_variable "PRIVATE_SSH_KEY"

mkdir -p ~/.ssh && chmod 700 ~/.ssh
echo "$PRIVATE_SSH_KEY" > ~/.ssh/id_rsa && chmod 600 ~/.ssh/id_rsa
echo "$(date): First 3 lines of ~/.ssh/id_rsa:"
head -n 3 ~/.ssh/id_rsa

# Function to check if the tunnel is running using netcat
is_tunnel_running() {
    local host=$(echo $SSH_TUNNEL_FORWARD | cut -d ':' -f 1)
    local port=$(echo $SSH_TUNNEL_FORWARD | cut -d ':' -f 2)
    nc -z -w 5 $host $port > /dev/null 2>&1
    local result=$?
    echo "$(date): Tunnel check result: $result (0 means running)"
    echo "$(date): Checking $host:$port"
    return $result
}

# Function to kill existing SSH tunnels
kill_existing_tunnels() {
    echo "$(date): Killing existing SSH tunnels..."
    pkill -f "ssh -.*$SSH_TUNNEL_TARGET" || true
    sleep 1
    pkill -9 -f "ssh -.*$SSH_TUNNEL_TARGET" || true
    echo "$(date): Existing tunnels killed."
}

# Function to start the SSH tunnel
start_tunnel() {
    local attempt=1
    local max_attempts=3

    kill_existing_tunnels

    while [ $attempt -le $max_attempts ]; do
        echo "$(date): Attempt $attempt to start SSH tunnel..."
        
        ssh -v -N -L $SSH_TUNNEL_FORWARD -i ~/.ssh/id_rsa -o StrictHostKeyChecking=no -p $SSH_TUNNEL_PORT $SSH_TUNNEL_TARGET > ~/ssh_tunnel.log 2>&1 &
        local tunnel_pid=$!
        
        echo "$(date): Waiting for tunnel to establish..."
        sleep 10  # Increased wait time to 10 seconds

        if is_tunnel_running; then
            echo $tunnel_pid > ~/ssh_tunnel.pid
            echo "$(date): Tunnel successfully established. PID: $tunnel_pid"
            return 0
        else
            echo "$(date): Tunnel failed to establish on attempt $attempt"
            echo "$(date): SSH tunnel log:"
            cat ~/ssh_tunnel.log
            kill $tunnel_pid 2>/dev/null
        fi

        echo "$(date): Failed to start SSH tunnel. Retrying..."
        kill_existing_tunnels
        ((attempt++))
    done

    echo "$(date): Failed to establish tunnel after $max_attempts attempts."
    return 1
}

# Function to restart the tunnel
restart_tunnel() {
    echo "$(date): Restarting SSH tunnel..."
    [ -f ~/ssh_tunnel.pid ] && kill -9 $(cat ~/ssh_tunnel.pid) 2>/dev/null || true
    kill_existing_tunnels
    start_tunnel
}

# Run the entire tunnel setup and management in the background
(
    if start_tunnel; then
        while true; do
            sleep 300  # Check every 5 minutes
            if ! is_tunnel_running; then
                echo "$(date): Tunnel is down. Restarting..."
                restart_tunnel
            else
                echo "$(date): Tunnel is up and running."
            fi
        done
    else
        echo "$(date): Failed to set up initial tunnel. Exiting."
        exit 1
    fi
) &

# Save the PID of the background process
echo $! > ~/tunnel_manager.pid
echo "$(date): Tunnel setup and restart mechanism initiated in background. Manager PID: $(cat ~/tunnel_manager.pid)"

echo "$(date): Finished setupTunnel.sh script"

# Final check to ensure tunnel is running
sleep 10  # Give the background process some time to start the tunnel
if is_tunnel_running; then
    echo "$(date): Final check: Tunnel is up and running."
else
    echo "$(date): Final check: Tunnel is not running. Please check the logs."
    echo "$(date): SSH tunnel log:"
    cat ~/ssh_tunnel.log
    echo "$(date): Environment variables:"
    env | grep SSH_
fi
