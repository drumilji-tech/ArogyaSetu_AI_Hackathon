require('dotenv').config();
const { DBSQLClient } = require('@databricks/sql');
const CAT = process.env.DATABRICKS_CATALOG;
const SCH = process.env.DATABRICKS_SCHEMA;

async function main() {
  const client = new DBSQLClient();
  const conn = await client.connect({ host: process.env.DATABRICKS_HOST, path: process.env.DATABRICKS_HTTP_PATH, token: process.env.DATABRICKS_TOKEN });
  const session = await conn.openSession();

  console.log('\n=== HIGH DOCTOR COUNT FACILITIES (>500) ===');
  let op = await session.executeStatement(
    `SELECT name, TRY_CAST(numberDoctors AS DOUBLE) AS doctors,
            TRY_CAST(capacity AS DOUBLE) AS beds,
            address_stateOrRegion AS state
     FROM ${CAT}.${SCH}.facilities
     WHERE TRY_CAST(numberDoctors AS DOUBLE) > 500
     ORDER BY doctors DESC LIMIT 20`,
    { queryTimeout: 60, runAsync: false }
  );
  let rows = await op.fetchAll(); await op.close();
  rows.forEach(r => console.log(`  ${r.name} | Doctors: ${r.doctors} | Beds: ${r.beds} | State: ${r.state}`));

  console.log('\n=== HIGH BED COUNT FACILITIES (>3000) ===');
  op = await session.executeStatement(
    `SELECT name, TRY_CAST(capacity AS DOUBLE) AS beds,
            TRY_CAST(numberDoctors AS DOUBLE) AS doctors
     FROM ${CAT}.${SCH}.facilities
     WHERE TRY_CAST(capacity AS DOUBLE) > 3000
     ORDER BY beds DESC LIMIT 15`,
    { queryTimeout: 60, runAsync: false }
  );
  rows = await op.fetchAll(); await op.close();
  rows.forEach(r => console.log(`  ${r.name} | Beds: ${r.beds} | Doctors: ${r.doctors}`));

  console.log('\n=== HIGH FOLLOWER FACILITIES (>2M) ===');
  op = await session.executeStatement(
    `SELECT name, TRY_CAST(engagement_metrics_n_followers AS DOUBLE) AS followers,
            address_stateOrRegion AS state
     FROM ${CAT}.${SCH}.facilities
     WHERE TRY_CAST(engagement_metrics_n_followers AS DOUBLE) > 2000000
     ORDER BY followers DESC LIMIT 10`,
    { queryTimeout: 60, runAsync: false }
  );
  rows = await op.fetchAll(); await op.close();
  rows.forEach(r => console.log(`  ${r.name} | Followers: ${r.followers} | State: ${r.state}`));

  console.log('\n=== DISTRIBUTION: Doctor count buckets ===');
  op = await session.executeStatement(
    `SELECT
      CASE
        WHEN TRY_CAST(numberDoctors AS DOUBLE) IS NULL THEN 'NULL/Not reported'
        WHEN TRY_CAST(numberDoctors AS DOUBLE) = 0    THEN '0'
        WHEN TRY_CAST(numberDoctors AS DOUBLE) <= 5   THEN '1-5'
        WHEN TRY_CAST(numberDoctors AS DOUBLE) <= 20  THEN '6-20'
        WHEN TRY_CAST(numberDoctors AS DOUBLE) <= 100 THEN '21-100'
        WHEN TRY_CAST(numberDoctors AS DOUBLE) <= 500 THEN '101-500'
        WHEN TRY_CAST(numberDoctors AS DOUBLE) <= 2000 THEN '501-2000'
        ELSE '>2000 (outlier?)'
      END AS bucket,
      COUNT(*) AS count
    FROM ${CAT}.${SCH}.facilities
    GROUP BY 1 ORDER BY count DESC`,
    { queryTimeout: 60, runAsync: false }
  );
  rows = await op.fetchAll(); await op.close();
  rows.forEach(r => console.log(`  ${r.bucket}: ${r.count}`));

  await session.close(); await conn.close();
}
main().catch(e => console.error('Error:', e.message));
