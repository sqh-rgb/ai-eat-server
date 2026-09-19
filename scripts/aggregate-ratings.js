const { getPool, closePool } = require('../src/db/pool');
const { aggregateRatings } = require('../src/jobs/aggregateRatings');

function argument(name, fallback = '') {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

aggregateRatings({ pool: getPool(), asOf: argument('--as-of', new Date().toISOString()) })
  .then(result => console.log(JSON.stringify(result, null, 2)))
  .catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(closePool);
