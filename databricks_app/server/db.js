const { DBSQLClient } = require('@databricks/sql');
require('dotenv').config();

let client = null;
let connection = null;
let session = null;

async function getSession() {
  if (session) return session;

  client = new DBSQLClient();
  connection = await client.connect({
    host: process.env.DATABRICKS_HOST,
    path: process.env.DATABRICKS_HTTP_PATH,
    token: process.env.DATABRICKS_TOKEN,
  });

  session = await connection.openSession({
    initialCatalog: process.env.DATABRICKS_CATALOG,
    initialSchema: process.env.DATABRICKS_SCHEMA,
  });

  console.log('✅ Databricks connected');
  return session;
}

async function query(sql) {
  const s = await getSession();
  const op = await s.executeStatement(sql, { queryTimeout: 120, runAsync: false });
  const rows = await op.fetchAll();
  await op.close();
  return rows;
}

module.exports = { query, getSession };
