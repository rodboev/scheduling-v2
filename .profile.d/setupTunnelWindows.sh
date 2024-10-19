#!/bin/bash
echo "Starting setupTunnelWindows.sh script"

# Detect the operating system
if [[ "$OSTYPE" == "msys"* || "$OSTYPE" == "cygwin"* || "$OSTYPE" == "win"* ]] || [[ -n "$WINDIR" ]]; then
    echo "Detected Windows environment. Proceeding with setup."
else
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

# Load variables from .env if it exists
if [ -f "$ENV_FILE" ]; then
    load_env_file "$ENV_FILE"
else
    echo "No .env file found."
fi

# Load variables from .env.local if it exists (overriding .env)
if [ -f "$ENV_LOCAL_FILE" ]; then
    load_env_file "$ENV_LOCAL_FILE"
else
    echo "No .env.local file found."
fi

# If neither .env nor .env.local exist, use local environment variables
if [ ! -f "$ENV_FILE" ] && [ ! -f "$ENV_LOCAL_FILE" ]; then
    echo "No .env or .env.local files found. Using local environment variables."
    while IFS='=' read -r name value ; do
        if [[ $name == *_* ]]; then
            export "$name"="$(convert_newlines_and_remove_quotes "$value")"
        fi
    done < <(env)
fi

# Function to check if a variable is set and print its value
check_and_print_variable() {
    if [ -z "${!1}" ]; then
        echo "Warning: $1 is not set"
    else
        if [[ "$1" == *"KEY"* ]]; then
            echo "$1=${!1:0:10}..."
        else
            echo "$1=${!1}"
        fi
    fi
}

# SSH Tunnel Setup
echo "Setting up SSH tunnel..."

check_and_print_variable "SSH_TUNNEL_FORWARD"
check_and_print_variable "SSH_TUNNEL_PORT"
check_and_print_variable "SSH_TUNNEL_TARGET"
check_and_print_variable "PRIVATE_SSH_KEY"

mkdir -p ~/.ssh
chmod 700 ~/.ssh

echo "$PRIVATE_SSH_KEY" > ~/.ssh/id_rsa
chmod 600 ~/.ssh/id_rsa

echo "First 3 lines of ~/.ssh/id_rsa:"
head -n 3 ~/.ssh/id_rsa

# Function to check if the tunnel is running
is_tunnel_running() {
    if [ -f ~/ssh_tunnel.pid ]; then
        local pid=$(cat ~/ssh_tunnel.pid)
        tasklist //FI "PID eq $pid" //NH | findstr $pid > /dev/null && \
        netstat -ano | findstr :1433 | findstr LISTENING > /dev/null
        return $?
    else
        return 1
    fi
}

# Function to kill existing SSH tunnels
kill_existing_tunnels() {
    echo "Attempting to kill existing SSH tunnels..."
    port_1433_pids=($(netstat -ano | findstr :1433 | findstr LISTENING | awk '{print $NF}' | sort -u))

    if [ ${#port_1433_pids[@]} -gt 0 ]; then
        echo "Found processes using port 1433: ${port_1433_pids[*]}"
        for pid in "${port_1433_pids[@]}"; do
            echo "Attempting to terminate process with PID $pid using port 1433"
            taskkill //F //PID $pid > /dev/null 2>&1
            if [ $? -eq 0 ]; then
                echo "Successfully terminated process with PID $pid using port 1433"
            else
                echo "Failed to terminate process with PID $pid using port 1433"
            fi
        done
    else
        echo "No processes found using port 1433."
    fi

    ssh_pids=($(tasklist //FI "IMAGENAME eq ssh.exe" //FO CSV //NH | findstr /I "ssh.exe" | awk -F'","' '{print $2}' 2> /dev/null))
    if [ ${#ssh_pids[@]} -gt 0 ]; then
        echo "Found additional SSH processes: ${ssh_pids[*]}"
        for pid in "${ssh_pids[@]}"; do
            echo "Attempting to terminate SSH process with PID $pid"
            taskkill //F //PID $pid > /dev/null 2>&1
            if [ $? -eq 0 ]; then
                echo "Successfully terminated SSH process with PID $pid"
            else
                echo "Failed to terminate SSH process with PID $pid"
            fi
        done
    fi
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
        echo "Tunnel started. PID: $tunnel_pid"
        
        sleep 1
        
        if netstat -ano | findstr :1433 | findstr LISTENING > /dev/null; then
            echo "Tunnel successfully established."
            return 0
        fi

        echo "Failed to establish tunnel or bind to port."
        if [ $attempt -lt $max_attempts ]; then
            echo "Killing existing tunnels and retrying..."
            kill_existing_tunnels
        fi

        attempt=$((attempt+1))
    done

    echo "Failed to establish tunnel after $max_attempts attempts."
    return 1
}

# Function to restart the tunnel
restart_tunnel() {
    if [ -f ~/ssh_tunnel.pid ]; then
        taskkill //F //PID $(cat ~/ssh_tunnel.pid) 2>/dev/null || true
    fi
    kill_existing_tunnels
    start_tunnel
}

# Run the entire tunnel setup and management in the background
(
    if start_tunnel; then
        echo "Initial tunnel setup completed. PID: $(cat ~/ssh_tunnel.pid)"
        
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
