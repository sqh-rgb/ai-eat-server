const fs = require('node:fs/promises');
const path = require('node:path');

function migrationVersion(filename) {
  return filename.replace(/\.postgres\.sql$|\.sql$/, '');
}

function missingMigrationTable(error) {
  return error && error.code === '42P01';
}

async function listPendingMigrations(client, files) {
  const sortedFiles = [...files].sort();
  let result;
  try {
    result = await client.query('SELECT version FROM schema_migrations');
  } catch (error) {
    if (missingMigrationTable(error)) return sortedFiles;
    throw error;
  }

  const appliedVersions = new Set(result.rows.map(row => row.version));
  return sortedFiles.filter(file => !appliedVersions.has(migrationVersion(file)));
}

async function runMigrations(client, directory) {
  const files = (await fs.readdir(directory)).filter(name => name.endsWith('.sql')).sort();
  const pendingFiles = await listPendingMigrations(client, files);

  for (const file of pendingFiles) {
    const sql = await fs.readFile(path.join(directory, file), 'utf8');
    await client.query(sql);
  }

  return pendingFiles;
}

module.exports = { migrationVersion, listPendingMigrations, runMigrations };
