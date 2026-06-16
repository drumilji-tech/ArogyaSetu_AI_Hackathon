/**
 * ArogyaSetu — Data Audit Script
 * Scans every key field and reports: null counts, garbage patterns, outliers
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { DBSQLClient } = require('@databricks/sql');

const HOST  = process.env.DATABRICKS_HOST;
const PATH  = process.env.DATABRICKS_HTTP_PATH;
const TOKEN = process.env.DATABRICKS_TOKEN;
const V = 'workspace.default.facility_clean';

async function q(session, sql) {
  const op = await session.executeStatement(sql, { queryTimeout: 60, runAsync: false });
  const rows = await op.fetchAll();
  await op.close();
  return rows;
}

async function main() {
  const client = new DBSQLClient();
  const conn = await client.connect({ host: HOST, path: PATH, token: TOKEN });
  const session = await conn.openSession();

  console.log('\n====== FIELD NULL AUDIT ======\n');

  const nullAudit = await q(session, `
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN name IS NULL OR TRIM(name)='' OR LOWER(name)='null' THEN 1 ELSE 0 END) AS null_name,
      SUM(CASE WHEN address_city IS NULL OR TRIM(address_city)='' OR LOWER(address_city)='null' THEN 1 ELSE 0 END) AS null_city,
      SUM(CASE WHEN state_clean IS NULL OR TRIM(state_clean)='' THEN 1 ELSE 0 END) AS null_state,
      SUM(CASE WHEN num_doctors_clean IS NULL THEN 1 ELSE 0 END) AS null_doctors,
      SUM(CASE WHEN bed_capacity IS NULL THEN 1 ELSE 0 END) AS null_beds,
      SUM(CASE WHEN followers IS NULL THEN 1 ELSE 0 END) AS null_followers,
      SUM(CASE WHEN specialty_count IS NULL OR specialty_count=0 THEN 1 ELSE 0 END) AS null_specialties,
      SUM(CASE WHEN equipment_count IS NULL OR equipment_count=0 THEN 1 ELSE 0 END) AS null_equipment,
      SUM(CASE WHEN officialPhone IS NULL OR TRIM(officialPhone)='' OR LOWER(officialPhone)='null' THEN 1 ELSE 0 END) AS null_phone,
      SUM(CASE WHEN officialWebsite IS NULL OR TRIM(officialWebsite)='' OR LOWER(officialWebsite)='null' THEN 1 ELSE 0 END) AS null_website,
      SUM(CASE WHEN pinocchio_score IS NULL THEN 1 ELSE 0 END) AS null_pinocchio,
      SUM(CASE WHEN archetype IS NULL THEN 1 ELSE 0 END) AS null_archetype,
      SUM(CASE WHEN trust_band IS NULL THEN 1 ELSE 0 END) AS null_trust
    FROM ${V}
  `);

  const r = nullAudit[0];
  console.log(`Total rows: ${r.total}`);
  Object.entries(r).filter(([k])=>k!=='total').forEach(([k,v])=>{
    const pct = ((+v/+r.total)*100).toFixed(1);
    const flag = +v > 0 ? '⚠️' : '✅';
    console.log(`  ${flag}  ${k.padEnd(20)} ${String(v).padStart(6)} / ${r.total}  (${pct}%)`);
  });

  console.log('\n====== GARBAGE NAME SAMPLES ======\n');
  const badNames = await q(session, `
    SELECT name FROM ${V}
    WHERE name RLIKE '^[^A-Za-z]' OR LENGTH(TRIM(name)) < 4
      OR name RLIKE '[<>{};]' OR LOWER(name) LIKE '%null%'
    LIMIT 20
  `);
  if (badNames.length) badNames.forEach(r => console.log('  BAD NAME:', r.name));
  else console.log('  ✅ All names look clean');

  console.log('\n====== GARBAGE CITY SAMPLES ======\n');
  const badCity = await q(session, `
    SELECT DISTINCT address_city FROM ${V}
    WHERE address_city IS NOT NULL
      AND (address_city RLIKE '^[0-9]' OR address_city LIKE '"%'
           OR LENGTH(address_city) > 60 OR address_city LIKE '%http%'
           OR address_city RLIKE '^[^A-Za-z]')
    LIMIT 20
  `);
  if (badCity.length) badCity.forEach(r => console.log('  BAD CITY:', r.address_city));
  else console.log('  ✅ All cities look clean');

  console.log('\n====== DOCTOR COUNT OUTLIERS ======\n');
  const drOut = await q(session, `
    SELECT name, num_doctors_raw, num_doctors_clean, state_clean
    FROM ${V}
    WHERE num_doctors_raw > 500 OR num_doctors_raw < 0
    ORDER BY num_doctors_raw DESC LIMIT 15
  `);
  if (drOut.length) drOut.forEach(r => console.log(`  ${r.name} | raw=${r.num_doctors_raw} cleaned=${r.num_doctors_clean}`));
  else console.log('  ✅ No outliers');

  console.log('\n====== BED CAPACITY OUTLIERS ======\n');
  const bedOut = await q(session, `
    SELECT name, bed_capacity FROM ${V}
    WHERE bed_capacity > 10000 OR bed_capacity < 0
    LIMIT 10
  `);
  if (bedOut.length) bedOut.forEach(r => console.log(`  ${r.name} | beds=${r.bed_capacity}`));
  else console.log('  ✅ No outliers');

  console.log('\n====== FOLLOWER OUTLIERS ======\n');
  const folOut = await q(session, `
    SELECT name, followers FROM ${V}
    WHERE followers > 10000000
    LIMIT 10
  `);
  if (folOut.length) folOut.forEach(r => console.log(`  ${r.name} | followers=${r.followers}`));
  else console.log('  ✅ No outliers');

  console.log('\n====== PHONE GARBAGE ======\n');
  const phones = await q(session, `
    SELECT DISTINCT officialPhone FROM ${V}
    WHERE officialPhone IS NOT NULL AND TRIM(officialPhone) != ''
      AND LOWER(officialPhone) != 'null'
      AND officialPhone NOT RLIKE '^[+0-9][0-9 \\-().+]{5,}$'
    LIMIT 20
  `);
  if (phones.length) phones.forEach(r => console.log('  GARBAGE PHONE:', r.officialPhone));
  else console.log('  ✅ All phones look clean');

  console.log('\n====== WEBSITE GARBAGE ======\n');
  const webs = await q(session, `
    SELECT DISTINCT officialWebsite FROM ${V}
    WHERE officialWebsite IS NOT NULL AND TRIM(officialWebsite) != ''
      AND LOWER(officialWebsite) != 'null'
      AND officialWebsite NOT RLIKE '^(www\\.|http|[a-z0-9])'
    LIMIT 20
  `);
  if (webs.length) webs.forEach(r => console.log('  GARBAGE WEBSITE:', r.officialWebsite));
  else console.log('  ✅ All websites look clean');

  await session.close(); await conn.close();
  console.log('\n====== AUDIT COMPLETE ======\n');
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
