const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { newDb } = require('pg-mem');

const {
  migrationVersion,
  listPendingMigrations,
  runMigrations,
} = require('../src/db/migrationRunner');

function createClient() {
  const database = newDb();
  const { Pool } = database.adapters.createPg();
  const pool = new Pool();

  return {
    async query(sql, params) {
      try {
        return await pool.query(sql, params);
      } catch (error) {
        if (/relation "schema_migrations" does not exist/i.test(error.message)) {
          error.code = '42P01';
        }
        throw error;
      }
    },
  };
}

async function createMigrationDirectory(t, migrations) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-eat-migrations-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  await Promise.all(migrations.map(({ name, sql }) => fs.writeFile(path.join(directory, name), sql)));
  return directory;
}

function initialMigrationSql() {
  return `
    CREATE TABLE schema_migrations (version TEXT PRIMARY KEY);
    CREATE TABLE migration_log (sequence SERIAL PRIMARY KEY, version TEXT NOT NULL);
    INSERT INTO schema_migrations(version) VALUES ('001_core');
    INSERT INTO migration_log(version) VALUES ('001_core');
  `;
}

function laterMigrationSql(version) {
  return `
    INSERT INTO schema_migrations(version) VALUES ('${version}');
    INSERT INTO migration_log(version) VALUES ('${version}');
  `;
}

test('migrationVersion removes the PostgreSQL SQL suffix', () => {
  assert.equal(migrationVersion('008_name.postgres.sql'), '008_name');
});

test('lists only 001 as pending when the migration state table does not exist yet', async () => {
  const client = createClient();

  const pending = await listPendingMigrations(client, ['002_later.sql', '001_core.sql']);

  assert.deepEqual(pending, ['001_core.sql']);
});

test('skips a migration whose version is already recorded', async t => {
  const client = createClient();
  await client.query('CREATE TABLE schema_migrations (version TEXT PRIMARY KEY)');
  await client.query("INSERT INTO schema_migrations(version) VALUES ('001_core')");
  const directory = await createMigrationDirectory(t, [
    { name: '001_core.sql', sql: 'SELECT * FROM should_not_run;' },
    { name: '002_later.sql', sql: "INSERT INTO schema_migrations(version) VALUES ('002_later');" },
  ]);

  const applied = await runMigrations(client, directory);

  assert.deepEqual(applied, ['002_later.sql']);
  const result = await client.query('SELECT version FROM schema_migrations ORDER BY version');
  assert.deepEqual(result.rows.map(row => row.version), ['001_core', '002_later']);
});

test('runs 001 first and applies later versions in filename order', async t => {
  const client = createClient();
  const directory = await createMigrationDirectory(t, [
    { name: '003_third.postgres.sql', sql: laterMigrationSql('003_third') },
    { name: '001_core.sql', sql: initialMigrationSql() },
    { name: '002_second.sql', sql: laterMigrationSql('002_second') },
  ]);

  const applied = await runMigrations(client, directory);

  assert.deepEqual(applied, ['001_core.sql', '002_second.sql', '003_third.postgres.sql']);
  const result = await client.query('SELECT version FROM migration_log ORDER BY sequence');
  assert.deepEqual(result.rows.map(row => row.version), ['001_core', '002_second', '003_third']);
});

test('rechecks migration state after 001 before applying later versions', async t => {
  const client = createClient();
  const directory = await createMigrationDirectory(t, [
    {
      name: '001_core.sql',
      sql: `
        CREATE TABLE schema_migrations (version TEXT PRIMARY KEY);
        CREATE TABLE migration_log (sequence SERIAL PRIMARY KEY, version TEXT NOT NULL);
        INSERT INTO schema_migrations(version) VALUES ('001_core'), ('002_already_recorded');
        INSERT INTO migration_log(version) VALUES ('001_core');
      `,
    },
    {
      name: '002_already_recorded.sql',
      sql: "INSERT INTO schema_migrations(version) VALUES ('002_already_recorded');",
    },
    { name: '003_later.sql', sql: laterMigrationSql('003_later') },
  ]);

  const applied = await runMigrations(client, directory);

  assert.deepEqual(applied, ['001_core.sql', '003_later.sql']);
  const result = await client.query('SELECT version FROM migration_log ORDER BY sequence');
  assert.deepEqual(result.rows.map(row => row.version), ['001_core', '003_later']);
});

test('requiring the migration CLI does not start a migration', () => {
  const script = path.join(__dirname, '..', 'scripts', 'migrate.js');
  const result = spawnSync(process.execPath, ['-e', `require(${JSON.stringify(script)})`], {
    encoding: 'utf8',
    env: {
      ...process.env,
      AI_EAT_SKIP_LOCAL_ENV: 'true',
      DATABASE_URL: '',
    },
  });

  assert.equal(result.status, 0);
  assert.equal(result.stderr, '');
});
