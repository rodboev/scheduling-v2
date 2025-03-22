#!/bin/bash
echo "Starting setupDB.sh script"

# Load environment variables
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Function to process environment file
process_env_file() {
    local env_file="$1"
    if [ -f "$env_file" ]; then
        echo "Loading $env_file..."
        # Process each line in the env file
        while IFS= read -r line || [ -n "$line" ]; do
            # Skip comments and empty lines
            [[ $line =~ ^#.*$ ]] || [ -z "$line" ] && continue
            
            # Split into key and value
            key=$(echo "$line" | cut -d'=' -f1)
            value=$(echo "$line" | cut -d'=' -f2-)
            
            # Remove surrounding quotes if they exist
            value=$(echo "$value" | sed -E 's/^["\x27](.*)["\x27]$/\1/')
            
            # Convert \n to actual newlines for SSH keys
            if [[ $key == *"KEY"* ]]; then
                value=$(echo "$value" | sed 's/\\n/\n/g')
            fi
            
            # Export the processed variable
            export "$key=$value"
        done < "$env_file"
    fi
}

# Load .env and .env.local
process_env_file "$PROJECT_ROOT/.env"
process_env_file "$PROJECT_ROOT/.env.local"

# Debug: Print environment variables (password masked)
echo "Environment variables:"
echo "SQL_DATABASE: ${SQL_DATABASE:-'not set'}"
echo "SQL_USERNAME: ${SQL_USERNAME:-'not set'}"
echo "SSH_TUNNEL_SERVER: ${SSH_TUNNEL_SERVER:-'not set'}"
echo "SQL_PASSWORD: ${SQL_PASSWORD:+'is set'}"

# Validate required environment variables
if  [ -z "$SSH_TUNNEL_SERVER" ] || [ -z "$SQL_DATABASE" ] || [ -z "$SQL_USERNAME" ] || [ -z "$SQL_PASSWORD" ]; then
    echo "❌ Error: Required environment variables are not set"
    echo "Please ensure these variables are set:"
    echo "SSH_TUNNEL_SERVER: ${SSH_TUNNEL_SERVER:-'not set'}"
    echo "SQL_DATABASE: ${SQL_DATABASE:-'not set'}"
    echo "SQL_USERNAME: ${SQL_USERNAME:-'not set'}"
    echo "SQL_PASSWORD: ${SQL_PASSWORD:+'is set'}"
    exit 1
fi

# Create project folders that will be needed for FreeTDS on Windows
# These folders are created regardless of OS to make sure they're in version control
FREETDS_DIR="$PROJECT_ROOT/freetds"
FREETDS_CONFIG_DIR="$FREETDS_DIR/config" 
FREETDS_DLL_DIR="$FREETDS_DIR/dll"

mkdir -p "$FREETDS_CONFIG_DIR"
mkdir -p "$FREETDS_DLL_DIR"

# OS-specific configuration
if [[ "$OSTYPE" == "msys" || "$OSTYPE" == "win32" ]]; then
    IS_WINDOWS=true
    
    # For Windows, use the project's FreeTDS folders
    WIN_CONFIG_DIR="$FREETDS_CONFIG_DIR"
    
    # Check if FreeTDS DLLs exist
    if [ ! -f "$FREETDS_DLL_DIR/libsybdb-5.dll" ]; then
        echo "⚠️ Warning: FreeTDS DLLs not found in $FREETDS_DLL_DIR"
        echo "Please extract FreeTDS DLLs to the $FREETDS_DLL_DIR folder"
        echo "Setup cannot continue without the DLL files"
        exit 1
    fi
    
    # For config file - need Windows path format with escaped backslashes
    WINDOWS_DLL_PATH=$(echo "$FREETDS_DLL_DIR/libsybdb-5.dll" | sed 's/\//\\\\/g')
    
    # Create proper Windows path for registry (C:\ format)
    # For Windows registry, we need a proper Windows path with drive letter
    # Get the absolute path first
    ABS_DLL_DIR="$(cd "$FREETDS_DLL_DIR" && pwd)"
    DLL_FILENAME="libsybdb-5.dll"
    
    # Convert paths like /c/Users/... to C:\Users\...
    if [[ "$ABS_DLL_DIR" =~ ^/([a-zA-Z])/ ]]; then
        # This is a path starting with /c/ or similar
        DRIVE_LETTER="${BASH_REMATCH[1]}"
        # Remove the /c/ prefix and replace with C:\
        WIN_ABS_PATH="${DRIVE_LETTER^^}:$(echo "$ABS_DLL_DIR" | sed "s|^/$DRIVE_LETTER/|\\\|")"
        # Replace all forward slashes with backslashes
        WIN_ABS_PATH=$(echo "$WIN_ABS_PATH" | sed 's|/|\\|g')
    else
        # Some other format - try best effort conversion
        WIN_ABS_PATH=$(echo "$ABS_DLL_DIR" | sed 's|^/|C:\\|' | sed 's|/|\\|g')
    fi
    
    # Create the full path to the DLL
    REG_DLL_PATH="$WIN_ABS_PATH\\$DLL_FILENAME"
    
    # For registry, we need to double-escape the backslashes
    REG_DLL_PATH=$(echo "$REG_DLL_PATH" | sed 's/\\/\\\\/g')
    
    # Debug - show the paths
    echo "DLL path for config: $WINDOWS_DLL_PATH"
    echo "DLL path for registry: $REG_DLL_PATH"
    
    # Create Windows config files
    echo "Creating FreeTDS configuration files for Windows..."
    
    # Create freetds.conf
    cat > "$WIN_CONFIG_DIR/freetds.conf" << EOL
[global]
        tds version = 7.4
        client charset = UTF-8
        text size = 64512

[PestPac]
        host = ${SSH_TUNNEL_SERVER}
        port = ${SSH_TUNNEL_PORT}
        tds version = 7.4
        database = ${SQL_DATABASE}
EOL

    # Create odbcinst.ini
    cat > "$WIN_CONFIG_DIR/odbcinst.ini" << EOL
[FreeTDS]
Description = FreeTDS Driver
Driver = ${WINDOWS_DLL_PATH}
Setup = ${WINDOWS_DLL_PATH}
UsageCount = 1
EOL

    # Create odbc.ini
    cat > "$WIN_CONFIG_DIR/odbc.ini" << EOL
[ODBC Data Sources]
PestPac6681=FreeTDS

[PestPac6681]
Driver = {FreeTDS}
Description = PestPac SQL Connection
Server = ${SSH_TUNNEL_SERVER}
Port = ${SSH_TUNNEL_PORT}
Database = ${SQL_DATABASE}
TDS_Version = 7.4
EOL

    # Dynamically create the registry file
    REGISTRY_FILE="$FREETDS_DIR/register-freetds.reg"
    echo "Creating Windows registry file at $REGISTRY_FILE..."
    
    cat > "$REGISTRY_FILE" << EOL
Windows Registry Editor Version 5.00

[HKEY_LOCAL_MACHINE\\SOFTWARE\\ODBC\\ODBCINST.INI\\ODBC Drivers]
"FreeTDS"="Installed"

[HKEY_LOCAL_MACHINE\\SOFTWARE\\ODBC\\ODBCINST.INI\\FreeTDS]
"Description"="FreeTDS Driver"
"Driver"="${REG_DLL_PATH}"
"Setup"="${REG_DLL_PATH}"
"APILevel"="2"
"ConnectFunctions"="YYY"
"DriverODBCVer"="03.50"
"FileUsage"="0"
"SQLLevel"="1"
"UsageCount"="1"

[HKEY_LOCAL_MACHINE\\SOFTWARE\\ODBC\\ODBC.INI\\ODBC Data Sources]
"PestPac6681"="FreeTDS"

[HKEY_LOCAL_MACHINE\\SOFTWARE\\ODBC\\ODBC.INI\\PestPac6681]
"Driver"="FreeTDS"
"Description"="PestPac SQL Connection"
"Server"="${SSH_TUNNEL_SERVER}"
"Port"="${SSH_TUNNEL_PORT}"
"Database"="${SQL_DATABASE}"
"TDS_Version"="7.4"
EOL

    # Display registry information without checking or prompting
    echo "ℹ️ If FreeTDS is not registered in Windows registry, please manually import the registry file:"
    echo "Double-click on: $REGISTRY_FILE"
    echo "Or if it's associated with something other than Registry Editor, use Open with > Registry Editor"
    echo ""
    echo "ℹ️ The application will first try to connect using the direct DLL path, which doesn't require registry entries."

    # Set Windows environment variables
    export ODBCINI="$WIN_CONFIG_DIR/odbc.ini"
    export ODBCINSTINI="$WIN_CONFIG_DIR/odbcinst.ini"
    export FREETDSCONF="$WIN_CONFIG_DIR/freetds.conf"
    
    # Check if folders and files exist
    echo "Checking if required folders and files exist:"

    folders_to_check=(
        "$WIN_CONFIG_DIR"
        "$FREETDS_DLL_DIR"
    )

    files_to_check=(
        "$WIN_CONFIG_DIR/freetds.conf"
        "$WIN_CONFIG_DIR/odbcinst.ini"
        "$WIN_CONFIG_DIR/odbc.ini"
        "$FREETDS_DLL_DIR/libsybdb-5.dll"
        "$REGISTRY_FILE"
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
            echo "Contents of $file:"
            if [[ "$file" == *".dll" ]]; then
                echo "(binary file)"
            else
                cat "$file"
            fi
            echo "-------------------"
        else
            echo "❌ File does not exist: $file"
        fi
    done
else
    IS_WINDOWS=false
    # Linux uses its own system paths, don't modify them
    LINUX_CONFIG_DIR="/app/.apt/etc"
    LINUX_DRIVER_PATH="/app/.apt/usr/lib/x86_64-linux-gnu/odbc/libtdsodbc.so"
    
    # No need to create config files for Linux - Heroku handles this
    echo "Running on Linux - using system FreeTDS configuration"
fi

# Test DB connection using existing db.js module
echo "Testing SQL connection..."
if node -e "import('./src/lib/db.js').then(({getPool}) => getPool().then(pool => pool.request().query('SELECT 1').then(() => process.exit(0))).catch(err => { console.error('Database connection error:', err); process.exit(1); }))"; then
    echo "✅ SQL connection test successful"
else
    echo "❌ SQL connection test failed"
    exit 1
fi

echo "setupDB.sh script completed"
