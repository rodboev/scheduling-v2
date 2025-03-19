import sql from 'mssql/msnodesqlv8.js'
import dotenv from 'dotenv'
import path from 'path'
import { fileURLToPath } from 'url'
import fs from 'fs'

// Load environment variables
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(__dirname, '../../')

dotenv.config({
  path: path.join(projectRoot, '.env'),
})
dotenv.config({
  path: path.join(projectRoot, '.env.local'),
  override: true,
})

// Determine if we're on Windows or Linux
const isWindows = process.platform === 'win32'

// Set environment variables for FreeTDS on Windows
if (isWindows) {
  // Set environment variables for FreeTDS config files
  const freetdsDir = path.join(projectRoot, 'freetds')
  const configDir = path.join(freetdsDir, 'config')
  
  // Set environment variables that tell ODBC where to find config files
  process.env.ODBCINI = path.join(configDir, 'odbc.ini')
  process.env.ODBCINSTINI = path.join(configDir, 'odbcinst.ini')
  process.env.FREETDSCONF = path.join(configDir, 'freetds.conf')
  
  console.log('Set FreeTDS environment variables:')
  console.log(`ODBCINI=${process.env.ODBCINI}`)
  console.log(`ODBCINSTINI=${process.env.ODBCINSTINI}`)
  console.log(`FREETDSCONF=${process.env.FREETDSCONF}`)
  
  // Verify the files exist
  if (!fs.existsSync(process.env.ODBCINI)) {
    console.warn(`Warning: ODBCINI file not found: ${process.env.ODBCINI}`)
  }
  if (!fs.existsSync(process.env.ODBCINSTINI)) {
    console.warn(`Warning: ODBCINSTINI file not found: ${process.env.ODBCINSTINI}`)
  }
  if (!fs.existsSync(process.env.FREETDSCONF)) {
    console.warn(`Warning: FREETDSCONF file not found: ${process.env.FREETDSCONF}`)
  }
}

// Different connection configs for Windows and Linux
const config = isWindows
  ? {
      // Windows using direct DLL path (most reliable)
      connectionString: `Driver=${path.join(projectRoot, 'freetds/dll/libsybdb-5.dll').replace(/\//g, '\\')};Server=${process.env.SSH_TUNNEL_SERVER};Port=${process.env.SSH_TUNNEL_PORT};Database=${process.env.SQL_DATABASE};Uid=${process.env.SQL_USERNAME};Pwd=${process.env.SQL_PASSWORD};TDS_Version=7.4;`,
      options: {
        trustServerCertificate: true,
        encrypt: false,
        enableArithAbort: true,
      },
    }
  : {
      // Linux uses direct connection with FreeTDS
      driver: '/app/.apt/usr/lib/x86_64-linux-gnu/odbc/libtdsodbc.so',
      connectionString: `Driver=/app/.apt/usr/lib/x86_64-linux-gnu/odbc/libtdsodbc.so;Server=${process.env.SSH_TUNNEL_SERVER};Port=${process.env.SSH_TUNNEL_PORT};Database=${process.env.SQL_DATABASE};Uid=${process.env.SQL_USERNAME};Pwd=${process.env.SQL_PASSWORD};TDS_Version=7.4;`,
      options: {
        trustServerCertificate: true,
        encrypt: false,
        enableArithAbort: true,
      },
    }

// Fallback using DSN
const dsnConfig = {
  connectionString: `DSN=PestPac6681;Uid=${process.env.SQL_USERNAME};Pwd=${process.env.SQL_PASSWORD};`,
  options: {
    trustServerCertificate: true,
    encrypt: false,
    enableArithAbort: true,
  },
}

let pool = null

async function getPool() {
  try {
    if (pool) {
      try {
        await pool.request().query('SELECT 1')
        return pool
      } catch (err) {
        console.log('Existing pool failed, creating new connection...')
        pool = null
      }
    }

    // Safe logging that works for both configs
    const logConfig = {
      ...config,
      password: '***hidden***',
      connectionString: config.connectionString
        ? config.connectionString.replace(process.env.SQL_PASSWORD, '***hidden***')
        : undefined,
    }
    console.log('Connecting with direct DLL config:', logConfig)

    try {
      pool = await sql.connect(config)
      console.log('Connected successfully using direct DLL configuration')
      return pool
    } catch (directDllErr) {
      console.error('Direct DLL connection failed:', directDllErr)
      
      // Try DSN approach
      try {
        const logDsnConfig = {
          ...dsnConfig,
          password: '***hidden***',
          connectionString: dsnConfig.connectionString
            ? dsnConfig.connectionString.replace(process.env.SQL_PASSWORD, '***hidden***')
            : undefined,
        }
        console.log('Connecting with DSN config:', logDsnConfig)
        
        pool = await sql.connect(dsnConfig)
        console.log('Connected successfully using DSN configuration')
        return pool
      } catch (dsnErr) {
        console.error('DSN connection failed:', dsnErr)
        
        // Try Microsoft ODBC Driver as last resort
        try {
          // Windows 11 uses just "SQL Server" while older Windows uses "ODBC Driver 18 for SQL Server"
          // Try both versions
          const win11MsConfig = {
            connectionString: `Driver={SQL Server};Server=${process.env.SSH_TUNNEL_SERVER},${process.env.SSH_TUNNEL_PORT};Database=${process.env.SQL_DATABASE};Uid=${process.env.SQL_USERNAME};Pwd=${process.env.SQL_PASSWORD};TrustServerCertificate=yes;`,
            options: {
              trustServerCertificate: true,
              encrypt: false,
              enableArithAbort: true,
            }
          }
          
          const olderWinMsConfig = {
            connectionString: `Driver={ODBC Driver 18 for SQL Server};Server=${process.env.SSH_TUNNEL_SERVER},${process.env.SSH_TUNNEL_PORT};Database=${process.env.SQL_DATABASE};Uid=${process.env.SQL_USERNAME};Pwd=${process.env.SQL_PASSWORD};TrustServerCertificate=yes;`,
            options: {
              trustServerCertificate: true,
              encrypt: false,
              enableArithAbort: true,
            }
          }
          
          // Try Windows 11 style first
          try {
            // Log Win11 config
            const logWin11Config = {
              ...win11MsConfig,
              password: '***hidden***',
              connectionString: win11MsConfig.connectionString.replace(process.env.SQL_PASSWORD, '***hidden***')
            }
            console.log('Trying SQL Server driver (Windows 11 style):', logWin11Config)
            
            pool = await sql.connect(win11MsConfig)
            console.log('Connected successfully using SQL Server driver (Windows 11 style)')
            return pool
          } catch (win11Err) {
            console.error('Windows 11 style driver connection failed, trying older Windows style')
            
            // Log older Windows config
            const logOlderWinConfig = {
              ...olderWinMsConfig,
              password: '***hidden***',
              connectionString: olderWinMsConfig.connectionString.replace(process.env.SQL_PASSWORD, '***hidden***')
            }
            console.log('Trying ODBC Driver 18 for SQL Server (older Windows style):', logOlderWinConfig)
            
            pool = await sql.connect(olderWinMsConfig)
            console.log('Connected successfully using ODBC Driver 18 for SQL Server (older Windows style)')
            return pool
          }
        } catch (msErr) {
          console.error('All Microsoft ODBC Driver attempts failed:', msErr)
          throw directDllErr // Throw the original FreeTDS error
        }
      }
    }
  } catch (err) {
    console.error('All database connection attempts failed:', err)
    throw err
  }
}

export { sql, getPool }
