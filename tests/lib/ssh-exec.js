/**
 * SSH execution wrapper using ssh2
 */

const fs = require('fs');
const { SSH } = require('../config');

let Client;
try {
  Client = require('ssh2').Client;
} catch {
  Client = null;
}

/**
 * Execute a command on the remote server via SSH
 * @param {string} command - Shell command to execute
 * @param {object} [opts] - Override SSH config
 * @returns {Promise<{stdout: string, stderr: string, code: number}>}
 */
async function sshExec(command, opts = {}) {
  if (!Client) {
    throw new Error('ssh2 not installed. Run: npm install ssh2');
  }

  const config = { ...SSH, ...opts };

  // Read private key if no agent
  let privateKey;
  if (!config.agent) {
    try {
      privateKey = fs.readFileSync(config.privateKeyPath, 'utf8');
    } catch (e) {
      throw new Error(`Cannot read SSH key at ${config.privateKeyPath}: ${e.message}`);
    }
  }

  return new Promise((resolve, reject) => {
    const conn = new Client();
    let stdout = '';
    let stderr = '';

    conn.on('ready', () => {
      conn.exec(command, (err, stream) => {
        if (err) { conn.end(); return reject(err); }

        stream.on('close', (code) => {
          conn.end();
          resolve({ stdout, stderr, code: code || 0 });
        });
        stream.on('data', (data) => { stdout += data.toString(); });
        stream.stderr.on('data', (data) => { stderr += data.toString(); });
      });
    });

    conn.on('error', (err) => reject(err));

    const connOpts = {
      host: config.host,
      port: config.port,
      username: config.username,
    };

    if (config.agent) {
      connOpts.agent = config.agent;
    } else if (privateKey) {
      connOpts.privateKey = privateKey;
    }

    conn.connect(connOpts);
  });
}

/**
 * Execute a SQL query on the remote PostgreSQL database
 * @param {string} sql - SQL query
 * @returns {Promise<string>} Query output
 */
async function sshPsql(sql) {
  const escapedSql = sql.replace(/'/g, "'\\''");
  const command = `sudo -u ${SSH.dbUser} psql ${SSH.dbName} -c '${escapedSql}'`;
  const result = await sshExec(command);
  if (result.code !== 0 && result.stderr) {
    console.warn(`[SSH-PSQL] stderr: ${result.stderr}`);
  }
  return result.stdout;
}

module.exports = { sshExec, sshPsql };
