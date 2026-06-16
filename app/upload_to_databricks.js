/**
 * Upload databricks_app/ directory to Databricks Workspace via REST API
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');

const HOST = process.env.DATABRICKS_HOST;
const TOKEN = process.env.DATABRICKS_TOKEN;
const WORKSPACE_PATH = '/Users'; // will auto-detect user below

const BASE_URL = `https://${HOST}/api/2.0`;

async function api(endpoint, body) {
  const r = await fetch(`${BASE_URL}${endpoint}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  try { return { status: r.status, data: JSON.parse(text) }; }
  catch { return { status: r.status, data: text }; }
}

async function apiGet(endpoint) {
  const r = await fetch(`${BASE_URL}${endpoint}`, {
    headers: { 'Authorization': `Bearer ${TOKEN}` },
  });
  return { status: r.status, data: await r.json() };
}

async function main() {
  console.log(`\n📡 Connecting to Databricks: ${HOST}\n`);

  // 1. Get current user
  const me = await apiGet('/preview/scim/v2/Me');
  const username = me.data.userName || me.data.emails?.[0]?.value || 'unknown';
  console.log(`👤 User: ${username}`);

  const appDir = `/Users/${username}/arogyasetu_ai_app`;
  console.log(`📁 Target workspace path: ${appDir}\n`);

  // 2. Create the workspace directory
  const mkdirRes = await api('/workspace/mkdirs', { path: appDir });
  if (mkdirRes.status === 200 || mkdirRes.status === 201) {
    console.log(`✅ Created directory: ${appDir}`);
  } else {
    console.log(`⚠️  mkdir response (${mkdirRes.status}):`, JSON.stringify(mkdirRes.data).substring(0, 200));
  }

  // Create static subdirectory
  await api('/workspace/mkdirs', { path: `${appDir}/static` });
  console.log(`✅ Created directory: ${appDir}/static`);

  // 3. Upload each file
  const files = [
    { local: '../databricks_app/app.yaml', remote: `${appDir}/app.yaml` },
    { local: '../databricks_app/requirements.txt', remote: `${appDir}/requirements.txt` },
    { local: '../databricks_app/app.py', remote: `${appDir}/app.py` },
    { local: '../databricks_app/static/index.html', remote: `${appDir}/static/index.html` },
  ];

  for (const f of files) {
    const content = fs.readFileSync(path.resolve(__dirname, f.local));
    const b64 = content.toString('base64');

    const res = await api('/workspace/import', {
      path: f.remote,
      content: b64,
      format: 'AUTO',
      overwrite: true,
      language: null,
    });

    if (res.status === 200) {
      console.log(`✅ Uploaded: ${f.remote} (${content.length} bytes)`);
    } else {
      console.log(`❌ Failed: ${f.remote} — ${JSON.stringify(res.data).substring(0, 200)}`);
    }
  }

  console.log(`\n🎉 Upload complete!`);
  console.log(`\n📋 Next steps to deploy as a Databricks App:`);
  console.log(`   1. Go to your Databricks workspace → Compute → Apps`);
  console.log(`   2. Click "Create App"`);
  console.log(`   3. Select source: workspace path "${appDir}"`);
  console.log(`   4. Set environment variables:`);
  console.log(`      DATABRICKS_SERVER_HOSTNAME = ${HOST}`);
  console.log(`      DATABRICKS_HTTP_PATH = ${process.env.DATABRICKS_HTTP_PATH}`);
  console.log(`      DATABRICKS_TOKEN = (your PAT token)`);
  console.log(`   5. Click Deploy\n`);
}

main().catch(e => { console.error('❌ Error:', e.message); process.exit(1); });
