const BASE = 'http://localhost:3001';

async function test() {
  const results = [];
  
  // 1. Health
  try {
    const r = await fetch(`${BASE}/api/health`).then(r => r.json());
    results.push({ ep: 'GET /api/health', ok: r.ok, detail: 'Server alive' });
  } catch(e) { results.push({ ep: 'GET /api/health', ok: false, detail: e.message }); }

  // 2. KPIs
  try {
    const r = await fetch(`${BASE}/api/kpi`).then(r => r.json());
    const d = r.data;
    const checks = [
      d.total_facilities === 10088 ? 'total=10088✓' : `total=${d.total_facilities}✗`,
      d.high_trust > 0 ? `high_trust=${d.high_trust}✓` : 'high_trust=0✗',
      d.hidden_gems > 0 ? `gems=${d.hidden_gems}✓` : 'gems=0✗',
      d.ghost_count > 0 ? `ghosts=${d.ghost_count}✓` : 'ghosts=0✗',
      d.truncated_50 > 0 ? `trunc=${d.truncated_50}✓` : 'trunc=0✗',
      d.suspicious_247 > 0 ? `s247=${d.suspicious_247}✓` : 's247=0✗',
      d.suspicious_icu > 0 ? `sICU=${d.suspicious_icu}✓` : 'sICU=0✗',
    ];
    results.push({ ep: 'GET /api/kpi', ok: r.ok, detail: checks.join(' | ') });
  } catch(e) { results.push({ ep: 'GET /api/kpi', ok: false, detail: e.message }); }

  // 3. Archetypes
  try {
    const r = await fetch(`${BASE}/api/archetypes`).then(r => r.json());
    const names = r.data.map(a => `${a.archetype}:${a.count}`);
    const total = r.data.reduce((s,a) => s + (+a.count), 0);
    const match = total === 10088 ? '✓ sums to 10088' : `✗ sums to ${total}`;
    results.push({ ep: 'GET /api/archetypes', ok: r.ok, detail: `${names.join(' | ')} | ${match}` });
  } catch(e) { results.push({ ep: 'GET /api/archetypes', ok: false, detail: e.message }); }

  // 4. Trust Distribution
  try {
    const r = await fetch(`${BASE}/api/trust-distribution`).then(r => r.json());
    const bands = r.data.map(b => `${b.trust_band}:${b.count}`);
    const total = r.data.reduce((s,b) => s + (+b.count), 0);
    const match = total === 10088 ? '✓ sums to 10088' : `✗ sums to ${total}`;
    results.push({ ep: 'GET /api/trust-distribution', ok: r.ok, detail: `${bands.join(' | ')} | ${match}` });
  } catch(e) { results.push({ ep: 'GET /api/trust-distribution', ok: false, detail: e.message }); }

  // 5. KPI hidden_gems vs Archetype Hidden Gem — MUST MATCH
  try {
    const kpi = await fetch(`${BASE}/api/kpi`).then(r => r.json());
    const arch = await fetch(`${BASE}/api/archetypes`).then(r => r.json());
    const kpiGems = +kpi.data.hidden_gems;
    const archGems = +(arch.data.find(a => a.archetype === 'Hidden Gem')?.count || 0);
    const kpiGhosts = +kpi.data.ghost_count;
    const archGhosts = +(arch.data.find(a => a.archetype === 'Ghost Facility')?.count || 0);
    results.push({
      ep: 'CONSISTENCY CHECK',
      ok: kpiGems === archGems && kpiGhosts === archGhosts,
      detail: `KPI gems=${kpiGems} vs Arch gems=${archGems} ${kpiGems===archGems?'✓':'✗'} | KPI ghosts=${kpiGhosts} vs Arch ghosts=${archGhosts} ${kpiGhosts===archGhosts?'✓':'✗'}`
    });
  } catch(e) { results.push({ ep: 'CONSISTENCY CHECK', ok: false, detail: e.message }); }

  // 6. Specialty Distribution
  try {
    const r = await fetch(`${BASE}/api/specialty-distribution`).then(r => r.json());
    const spike = r.data.find(d => d.specialty_count === 50);
    results.push({ ep: 'GET /api/specialty-distribution', ok: r.ok, detail: `${r.data.length} bins | spike@50: ${spike?.facility_count || 'missing'}` });
  } catch(e) { results.push({ ep: 'GET /api/specialty-distribution', ok: false, detail: e.message }); }

  // 7. States
  try {
    const r = await fetch(`${BASE}/api/states`).then(r => r.json());
    results.push({ ep: 'GET /api/states', ok: r.ok, detail: `${r.data.length} states: ${r.data.slice(0,5).join(', ')}...` });
  } catch(e) { results.push({ ep: 'GET /api/states', ok: false, detail: e.message }); }

  // 8. Facilities (paginated)
  try {
    const r = await fetch(`${BASE}/api/facilities?page=1&pageSize=5`).then(r => r.json());
    const f = r.data[0];
    const hasFields = f && f.name && f.archetype && f.trust_band && f.pinocchio_score !== undefined;
    results.push({ ep: 'GET /api/facilities', ok: r.ok && hasFields, detail: `${r.data.length} rows | first: ${f?.name?.substring(0,30)} | arch:${f?.archetype} | trust:${f?.trust_band} | ps:${f?.pinocchio_score}` });
  } catch(e) { results.push({ ep: 'GET /api/facilities', ok: false, detail: e.message }); }

  // 9. Facility Detail
  try {
    const list = await fetch(`${BASE}/api/facilities?page=1&pageSize=1`).then(r => r.json());
    const id = list.data[0]?.unique_id;
    const r = await fetch(`${BASE}/api/facility/${id}`).then(r => r.json());
    const f = r.data;
    results.push({ ep: `GET /api/facility/:id`, ok: r.ok, detail: `${f?.name} | ps:${f?.pinocchio_score} | arch:${f?.archetype} | claims_247:${f?.claims_247}` });
  } catch(e) { results.push({ ep: 'GET /api/facility/:id', ok: false, detail: e.message }); }

  // 10. Anomalies
  try {
    const r = await fetch(`${BASE}/api/anomalies`).then(r => r.json());
    const d = r.data;
    const counts = `dirty:${d.dirtyType?.length||0} | trunc:${d.truncated?.length||0} | s247:${d.suspicious247?.length||0} | sICU:${d.suspiciousIcu?.length||0}`;
    results.push({ ep: 'GET /api/anomalies', ok: r.ok, detail: counts });
  } catch(e) { results.push({ ep: 'GET /api/anomalies', ok: false, detail: e.message }); }

  // 11. Hidden Gems
  try {
    const r = await fetch(`${BASE}/api/hidden-gems`).then(r => r.json());
    const f = r.data[0];
    results.push({ ep: 'GET /api/hidden-gems', ok: r.ok, detail: `${r.data.length} gems | top: ${f?.name?.substring(0,30)} | docs:${f?.num_doctors} | ps:${f?.pinocchio_score}` });
  } catch(e) { results.push({ ep: 'GET /api/hidden-gems', ok: false, detail: e.message }); }

  // 12. Referral Finder (cardiac + Mumbai pincode)
  try {
    const r = await fetch(`${BASE}/api/referrals`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pincode: '400001', condition: 'cardiac' })
    }).then(r => r.json());
    const f = r.data[0];
    results.push({ ep: 'POST /api/referrals (cardiac)', ok: r.ok, detail: `${r.data.length} results | top: ${f?.name?.substring(0,30)} | ps:${f?.pinocchio_score} | ${f?.trust_band}` });
  } catch(e) { results.push({ ep: 'POST /api/referrals', ok: false, detail: e.message }); }

  // 13. Referral Finder (cancer)
  try {
    const r = await fetch(`${BASE}/api/referrals`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pincode: '110001', condition: 'cancer' })
    }).then(r => r.json());
    results.push({ ep: 'POST /api/referrals (cancer)', ok: r.ok, detail: `${r.data.length} results` });
  } catch(e) { results.push({ ep: 'POST /api/referrals (cancer)', ok: false, detail: e.message }); }

  // 14. State Summary
  try {
    const r = await fetch(`${BASE}/api/state-summary`).then(r => r.json());
    results.push({ ep: 'GET /api/state-summary', ok: r.ok, detail: `${r.data.length} states | first: ${r.data[0]?.state}` });
  } catch(e) { results.push({ ep: 'GET /api/state-summary', ok: false, detail: e.message }); }

  // Print results
  console.log('\n' + '='.repeat(100));
  console.log('  AROGYA SETU AI — FULL TEST RESULTS');
  console.log('='.repeat(100));
  
  let passed = 0, failed = 0;
  for (const r of results) {
    const status = r.ok ? '✅ PASS' : '❌ FAIL';
    if (r.ok) passed++; else failed++;
    console.log(`\n${status}  ${r.ep}`);
    console.log(`       ${r.detail}`);
  }
  
  console.log('\n' + '='.repeat(100));
  console.log(`  TOTAL: ${passed} passed, ${failed} failed out of ${results.length} tests`);
  console.log('='.repeat(100) + '\n');
}

test();
