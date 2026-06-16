require('dotenv').config();
const { DBSQLClient } = require('@databricks/sql');
const client = new DBSQLClient();
client.connect({ host: process.env.DATABRICKS_HOST, path: process.env.DATABRICKS_HTTP_PATH, token: process.env.DATABRICKS_TOKEN })
.then(async conn => {
  const session = await conn.openSession();

  // Check current catalog/schema
  let op = await session.executeStatement('SELECT current_catalog(), current_schema()', { queryTimeout: 30, runAsync: false });
  let rows = await op.fetchAll(); await op.close();
  console.log('Current catalog/schema:', rows[0]);

  // List all available catalogs
  op = await session.executeStatement('SHOW CATALOGS', { queryTimeout: 30, runAsync: false });
  rows = await op.fetchAll(); await op.close();
  console.log('\nAvailable catalogs:', rows.map(r => Object.values(r)[0]));

  // List schemas in main catalog  
  const cat = process.env.DATABRICKS_CATALOG;
  op = await session.executeStatement(`SHOW SCHEMAS IN ${cat}`, { queryTimeout: 30, runAsync: false });
  rows = await op.fetchAll(); await op.close();
  console.log(`\nSchemas in ${cat}:`, rows.map(r => Object.values(r)[0]));

  // Try creating a test view in hackathon catalog
  try {
    const testSchema = `${cat}.${process.env.DATABRICKS_SCHEMA}`;
    await session.executeStatement(`CREATE OR REPLACE VIEW ${testSchema}.test_view AS SELECT 1 as x`, { queryTimeout: 30, runAsync: false });
    console.log(`\n✅ Can CREATE VIEW in ${testSchema}`);
    await session.executeStatement(`DROP VIEW IF EXISTS ${testSchema}.test_view`, { queryTimeout: 30, runAsync: false });
  } catch(e) {
    console.log(`\n❌ Cannot CREATE VIEW in hackathon schema: ${e.message.substring(0, 100)}`);
  }

  await session.close(); await conn.close();
}).catch(e => console.error('Error:', e.message));
