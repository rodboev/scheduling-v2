#!/bin/bash
echo "Starting setup.sh script for Unix systems"

# Detect the operating system
if [[ "$OSTYPE" == "msys"* || "$OSTYPE" == "cygwin"* || "$OSTYPE" == "win"* ]] || [[ -n "$WINDIR" ]]; then
    echo "Detected Windows environment. This script is for Unix systems. Exiting."
    exit 1
fi

# Function to check if a variable is set and print its value
check_and_print_variable() {
    if [ -z "${!1}" ]; then
        echo "Warning: $1 is not set"
    elif [[ "$1" == *"KEY"* ]]; then
        echo "$1=${!1:0:10}..."
    else
        echo "$1=${!1}"
    fi
}

# SSH Tunnel Setup
echo "Setting up SSH tunnel..."

check_and_print_variable "SSH_TUNNEL_FORWARD"
check_and_print_variable "SSH_TUNNEL_PORT"
check_and_print_variable "SSH_TUNNEL_TARGET"
check_and_print_variable "PRIVATE_SSH_KEY"

mkdir -p ~/.ssh && chmod 700 ~/.ssh
echo "$PRIVATE_SSH_KEY" > ~/.ssh/id_rsa && chmod 600 ~/.ssh/id_rsa
echo "First 3 lines of ~/.ssh/id_rsa:"
head -n 3 ~/.ssh/id_rsa

# Function to check if the tunnel is running
is_tunnel_running() {
    [ -f ~/ssh_tunnel.pid ] && ps -p $(cat ~/ssh_tunnel.pid) > /dev/null && lsof -i :1433 -t > /dev/null
}

# Function to kill existing SSH tunnels
kill_existing_tunnels() {
    echo "Killing existing SSH tunnels..."
    pkill -f "ssh -.*$SSH_TUNNEL_TARGET" || true
    sleep 1
    pkill -9 -f "ssh -.*$SSH_TUNNEL_TARGET" || true
}

# Function to start the SSH tunnel
start_tunnel() {
    local attempt=1
    local max_attempts=3

    kill_existing_tunnels

    while [ $attempt -le $max_attempts ]; do
        echo "Attempt $attempt to start SSH tunnel..."
        
        ssh -N -L $SSH_TUNNEL_FORWARD -i ~/.ssh/id_rsa -o StrictHostKeyChecking=no -p $SSH_TUNNEL_PORT $SSH_TUNNEL_TARGET > ~/ssh_tunnel.log 2>&1 &
        local tunnel_pid=$!
        
        if [ -n "$tunnel_pid" ]; then
            echo $tunnel_pid > ~/ssh_tunnel.pid
            echo "Tunnel successfully established. PID: $tunnel_pid"
            return 0
        fi

        echo "Failed to start SSH tunnel. Retrying..."
        kill_existing_tunnels
        ((attempt++))
    done

    echo "Failed to establish tunnel after $max_attempts attempts."
    return 1
}

# Function to restart the tunnel
restart_tunnel() {
    [ -f ~/ssh_tunnel.pid ] && kill -9 $(cat ~/ssh_tunnel.pid) 2>/dev/null || true
    kill_existing_tunnels
    start_tunnel
}

# Run the entire tunnel setup and management in the background
(
    if start_tunnel; then
        while true; do
            sleep 1800
            echo "Restarting SSH tunnel..."
            restart_tunnel
        done
    else
        echo "Failed to set up initial tunnel. Exiting."
        exit 1
    fi
) &

# Save the PID of the background process
echo $! > ~/tunnel_manager.pid
echo "Tunnel setup and restart mechanism initiated in background. Manager PID: $(cat ~/tunnel_manager.pid)"

# ODBC and FreeTDS Setup
export ODBCSYSINI=/app/.apt/etc
export ODBCINI=/app/.apt/etc/odbc.ini
export FREETDSCONF=/app/.apt/etc/freetds/freetds.conf
export LD_LIBRARY_PATH=/app/.apt/usr/lib/x86_64-linux-gnu:/app/.apt/usr/lib/x86_64-linux-gnu/odbc:$LD_LIBRARY_PATH

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

echo "Finished setup.sh script"
