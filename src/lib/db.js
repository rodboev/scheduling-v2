import sql from 'mssql/msnodesqlv8.js'
import dotenv from 'dotenv'
import path from 'path'
import { fileURLToPath } from 'url'

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

// Different connection configs for Windows and Linux
const config = isWindows
  ? {
      // Windows uses DSN
      connectionString: `DSN=${process.env.SQL_DATABASE};UID=${process.env.SQL_USERNAME};PWD=${process.env.SQL_PASSWORD}`,
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

    console.log('Connecting with config:', {
      ...config,
      connectionString: config.connectionString.replace(process.env.SQL_PASSWORD, '***hidden***'),
    })

    pool = await sql.connect(config)
    return pool
  } catch (err) {
    console.error('Database connection error:', err)
    throw err
  }
}

export { sql, getPool }
