require('dotenv').config();
const { DBSQLClient } = require('@databricks/sql');
const CAT = process.env.DATABRICKS_CATALOG;
const SCH = process.env.DATABRICKS_SCHEMA;

async function main() {
  const client = new DBSQLClient();
  const conn = await client.connect({ host: process.env.DATABRICKS_HOST, path: process.env.DATABRICKS_HTTP_PATH, token: process.env.DATABRICKS_TOKEN });
  const session = await conn.openSession();

  const VIEW = `${CAT}.${SCH}.facility_clean`;
  console.log('Testing view:', VIEW);

  const op = await session.executeStatement(
    `SELECT COUNT(*) as total,
      SUM(CASE WHEN name IS NULL THEN 1 ELSE 0 END) as null_names,
      SUM(CASE WHEN phone IS NULL THEN 1 ELSE 0 END) as null_phone,
      SUM(CASE WHEN website IS NULL THEN 1 ELSE 0 END) as null_website,
      SUM(CASE WHEN archetype IS NULL THEN 1 ELSE 0 END) as null_archetype,
      SUM(CASE WHEN pinocchio_score IS NULL THEN 1 ELSE 0 END) as null_score,
      COUNT(DISTINCT state_clean) as distinct_states,
      ROUND(AVG(pinocchio_score),1) as avg_pinocchio
    FROM ${VIEW}`,
    { queryTimeout: 60, runAsync: false }
  );
  const rows = await op.fetchAll();
  await op.close();

  const r = rows[0];
  console.log('\n✅ View is LIVE and queryable!');
  console.log(`   Total rows:      ${r.total}`);
  console.log(`   Null names:      ${r.null_names} → shown as "Unnamed Facility"`);
  console.log(`   Null phones:     ${r.null_phone} → hidden in UI`);
  console.log(`   Null websites:   ${r.null_website} → hidden in UI`);
  console.log(`   Null archetypes: ${r.null_archetype} (should be 0)`);
  console.log(`   Null scores:     ${r.null_score} (should be 0)`);
  console.log(`   Distinct states: ${r.distinct_states}`);
  console.log(`   Avg Pinocchio:   ${r.avg_pinocchio}`);

  // Sample some rows
  const op2 = await session.executeStatement(
    `SELECT name, address_city, state_clean, phone, website, facility_type_clean, archetype, pinocchio_score
     FROM ${VIEW}
     WHERE name IS NOT NULL
     ORDER BY RAND() LIMIT 5`,
    { queryTimeout: 30, runAsync: false }
  );
  const sample = await op2.fetchAll();
  await op2.close();
  console.log('\n📋 Sample rows:');
  sample.forEach(r => console.log(`  [${r.archetype}] ${r.name} | ${r.address_city||'?'}, ${r.state_clean||'?'} | Phone:${r.phone||'none'} | Web:${r.website||'none'} | Score:${r.pinocchio_score}`));

  await session.close(); await conn.close();
}
main().catch(e => console.error('❌', e.message));
