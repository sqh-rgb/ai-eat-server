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
    if (missingMigrationTable(error)) {
      return sortedFiles.filter(file => migrationVersion(file) === '001_core');
    }
    throw error;
  }

  const appliedVersions = new Set(result.rows.map(row => row.version));
  return sortedFiles.filter(file => !appliedVersions.has(migrationVersion(file)));
}

async function runMigrations(client, directory) {
  const files = (await fs.readdir(directory)).filter(name => name.endsWith('.sql')).sort();
  const appliedFiles = [];

  async function apply(filesToApply) {
    for (const file of filesToApply) {
      const sql = await fs.readFile(path.join(directory, file), 'utf8');
      await client.query(sql);
      appliedFiles.push(file);
    }
  }

  await apply(await listPendingMigrations(client, files));
  await apply((await listPendingMigrations(client, files)).filter(file => !appliedFiles.includes(file)));

  return appliedFiles;
}

module.exports = { migrationVersion, listPendingMigrations, runMigrations };
