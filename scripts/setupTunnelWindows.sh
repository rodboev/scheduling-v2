#!/bin/bash
echo "Starting setupTunnelWindows.sh"

# Detect the operating system
if [[ "$OSTYPE" != "msys"* && "$OSTYPE" != "cygwin"* && "$OSTYPE" != "win"* ]] && [[ -z "$WINDIR" ]]; then
    echo "Detected non-Windows environment. This script is for Windows systems. Exiting."
    exit 1
fi

# Determine the script's directory and project root
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Check for .env and .env.local in the project root
ENV_FILE="$PROJECT_ROOT/.env"
ENV_LOCAL_FILE="$PROJECT_ROOT/.env.local"

# Function to convert \n to newlines and remove surrounding quotes
convert_newlines_and_remove_quotes() {
    local value="$1"
    value="${value%\"}"
    value="${value#\"}"
    echo -e "${value//\\n/\\n}"
}

# Function to load variables from a file
load_env_file() {
    local file="$1"
    echo "Loading environment variables from $file"
    while IFS= read -r line || [[ -n "$line" ]]; do
        if [[ $line =~ ^#.*$ ]] || [[ -z $line ]]; then
            continue
        fi
        var_name="${line%%=*}"
        var_value="${line#*=}"
        export "$var_name"="$(convert_newlines_and_remove_quotes "$var_value")"
    done < "$file"
}

# Load variables from .env and .env.local if they exist
[ -f "$ENV_FILE" ] && load_env_file "$ENV_FILE"
[ -f "$ENV_LOCAL_FILE" ] && load_env_file "$ENV_LOCAL_FILE"

# If neither .env nor .env.local exist, use local environment variables
if [ ! -f "$ENV_FILE" ] && [ ! -f "$ENV_LOCAL_FILE" ]; then
    echo "No .env or .env.local files found. Using local environment variables."
    while IFS='=' read -r name value ; do
        [[ $name == *_* ]] && export "$name"="$(convert_newlines_and_remove_quotes "$value")"
    done < <(env)
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
    [ -f ~/ssh_tunnel.pid ] && tasklist //FI "PID eq $(cat ~/ssh_tunnel.pid)" //NH | findstr $(cat ~/ssh_tunnel.pid) > /dev/null && \
    netstat -ano | findstr :1433 | findstr LISTENING > /dev/null
}

# Function to kill existing SSH tunnels
kill_existing_tunnels() {
    echo "Killing existing SSH tunnels..."
    port_1433_pids=($(netstat -ano | findstr :1433 | findstr LISTENING | awk '{print $NF}' | sort -u))
    for pid in "${port_1433_pids[@]}"; do
        taskkill //F //PID $pid > /dev/null 2>&1
        if [ $? -eq 0 ]; then
            echo "Terminated process using port 1433 with PID: $pid"
        else
            echo "Failed to terminate process using port 1433 with PID: $pid"
        fi
    done

    ssh_pids=($(tasklist //FI "IMAGENAME eq ssh.exe" //FO CSV //NH | findstr /I "ssh.exe" | awk -F'","' '{print $2}' 2> /dev/null))
    for pid in "${ssh_pids[@]}"; do
        taskkill //F //PID $pid > /dev/null 2>&1
    done
    sleep 1
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
        echo $tunnel_pid > ~/ssh_tunnel.pid
        
        sleep 1
        
        if netstat -ano | findstr :1433 | findstr LISTENING > /dev/null; then
            echo "Tunnel successfully established. PID: $tunnel_pid"
            return 0
        fi

        echo "Failed to establish tunnel. Retrying..."
        kill_existing_tunnels
        ((attempt++))
    done

    echo "Failed to establish tunnel after $max_attempts attempts."
    return 1
}

# Function to restart the tunnel
restart_tunnel() {
    [ -f ~/ssh_tunnel.pid ] && taskkill //F //PID $(cat ~/ssh_tunnel.pid) 2>/dev/null || true
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

echo "Finished setupTunnelWindows.sh script"
