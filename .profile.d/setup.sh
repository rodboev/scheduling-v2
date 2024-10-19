#!/bin/bash
echo "Starting setup.sh"

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
mkdir -p /app/.ssh
chmod 700 /app/.ssh
echo "$SSH_PRIVATE_KEY" > /app/.ssh/id_rsa
chmod 600 /app/.ssh/id_rsa

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

echo "Finished setup.sh"
