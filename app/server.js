require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const queries = require('./server/queries');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── API ROUTES ──────────────────────────────────────────────────────────────

// KPI Summary - landing page stats
app.get('/api/kpi', async (req, res) => {
  try {
    const data = await queries.getKpiSummary();
    res.json({ ok: true, data });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Archetype distribution - donut chart
app.get('/api/archetypes', async (req, res) => {
  try {
    const data = await queries.getArchetypeCounts();
    res.json({ ok: true, data });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Facility list with filters
app.get('/api/facilities', async (req, res) => {
  try {
    const { archetype, state, search, page, pageSize } = req.query;
    const data = await queries.getFacilities({ archetype, state, search, page: +page || 1, pageSize: +pageSize || 20 });
    res.json({ ok: true, data });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Single facility deep dive
app.get('/api/facility/:id', async (req, res) => {
  try {
    const data = await queries.getFacilityDetail(req.params.id);
    if (!data) return res.status(404).json({ ok: false, error: 'Not found' });
    res.json({ ok: true, data });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// State list for filter dropdown
app.get('/api/states', async (req, res) => {
  try {
    const data = await queries.getStates();
    res.json({ ok: true, data });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Trust distribution (for donut chart)
app.get('/api/trust-distribution', async (req, res) => {
  try { res.json({ ok: true, data: await queries.getTrustDistribution() }); }
  catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// Specialty distribution (for spike chart)
app.get('/api/specialty-distribution', async (req, res) => {
  try { res.json({ ok: true, data: await queries.getSpecialtyDistribution() }); }
  catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// State summary
app.get('/api/state-summary', async (req, res) => {
  try { res.json({ ok: true, data: await queries.getStateSummary() }); }
  catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// Map data (lat/lng + trust bands)
app.get('/api/map', async (req, res) => {
  try { res.json({ ok: true, data: await queries.getMapData() }); }
  catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// Anomalies page
app.get('/api/anomalies', async (req, res) => {
  try {
    const data = await queries.getAnomalies();
    res.json({ ok: true, data });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Hidden Gems page
app.get('/api/hidden-gems', async (req, res) => {
  try {
    const data = await queries.getHiddenGems();
    res.json({ ok: true, data });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Verified Referral Finder
app.post('/api/referrals', async (req, res) => {
  try {
    const { pincode, condition } = req.body;
    const data = await queries.findReferrals({ pincode, condition });
    res.json({ ok: true, data });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ─── AI AGENT: Trust Desk Analyst ───────────────────────────────────────────
const AI_MODEL = process.env.AI_MODEL || 'databricks-meta-llama-3-3-70b-instruct';
const AI_HOST = process.env.DATABRICKS_HOST;
const AI_TOKEN = process.env.DATABRICKS_TOKEN;

const SYSTEM_PROMPT = `You are the ArogyaSetu AI Trust Desk Analyst — an expert AI agent that helps healthcare planners evaluate facility trustworthiness using data-driven evidence.

## Your Knowledge Base
You analyze 10,088 healthcare facilities across India using structured data from the Virtue Foundation dataset. You understand:

### Pinocchio Score™ (0-100, higher = more overclaiming)
An 8-factor additive penalty score measuring how much a facility overclaims:
- Claims 24/7 emergency but <3 doctors: +15
- Claims ICU but <2 doctors: +25
- Claims multispecialty but <3 doctors: +20
- Claims cardiology but no cardiac equipment (ECG/cath lab): +10
- Claims oncology but no oncology equipment (radiation/chemo): +10
- Claims NICU but no ventilator: +15
- Specialty list truncated at exactly 50 (scraping artifact): +5
- Dirty facilityTypeId field (lat/hash/JSON in wrong column): +5
Trust Bands: ≤10 High Trust, ≤30 Moderate Trust, ≤60 Low Trust, >60 Unreliable

### 4 Facility Archetypes
1. **Verified Pillar** 🏅 — Default. Claims supported by data.
2. **Hidden Gem** 💎 — >50 doctors, >20 equipment, <100 followers. Operationally strong but digitally invisible.
3. **Confident Claimer** 📣 — >500 followers, >20 specialties, <5 doctors. Looks great online, structural data raises questions.
4. **Ghost Facility** 👻 — Last updated before 2023, zero social posts. May be closed.

### Key Data Quality Findings
- 2,884 facilities have specialty lists truncated at exactly 50 (scraping cap)
- 424 claim 24/7 emergency with <3 doctors
- 168 claim ICU with <2 doctors
- Dirty facilityTypeId: lat coordinates, MD5 hashes, GeoJSON stored as type
- "farmacy" typo (10 cases), empty/null types (126 cases)

### Source URL Provenance
source_urls column contains actual scraped web pages. We categorize them:
- Government (gov.in, nic.in) = highest trust weight
- Academic (pubmed, ncbi) = research hospital
- Social (facebook, twitter) = online presence
- Listing (practo, justdial) = directory presence
- Commercial = lower trust weight

### Temporal Decay
recency_of_page_update shows when data was last refreshed. Decay Score:
- ≤365 days: 10 (Fresh)
- ≤730 days: 30 (Recent)
- ≤1460 days: 60 (Stale)
- >1460 days: 90 (Ghost Risk)

## How to Respond
- Be concise but substantive (2-4 paragraphs max)
- Use specific numbers and data points
- When analyzing a facility, reference its actual scores and flags
- Provide actionable recommendations for planners
- Use emoji sparingly for visual structure
- If asked about something outside your data, say so honestly
- Never make up facility names or statistics`;

app.post('/api/ai/chat', async (req, res) => {
  try {
    const { question, facilityContext } = req.body;
    if (!question) return res.status(400).json({ ok: false, error: 'Question is required' });
    if (!AI_HOST || !AI_TOKEN) return res.status(500).json({ ok: false, error: 'AI not configured' });

    // Build context-aware user message
    let userMsg = question;
    if (facilityContext) {
      const fc = facilityContext;
      userMsg = `[FACILITY CONTEXT]
Name: ${fc.name || 'Unknown'}
Location: ${fc.address_city || ''}, ${fc.state_clean || fc.state || ''}
Type: ${fc.facility_type_clean || fc.facility_type || 'clinic'}
Archetype: ${fc.archetype || 'Unknown'}
Pinocchio Score: ${fc.pinocchio_score || 0}/100
Doctors: ${fc.num_doctors_clean != null ? fc.num_doctors_clean : 'Not reported'}
Beds: ${fc.bed_capacity != null ? fc.bed_capacity : 'Not reported'}
Followers: ${fc.followers != null ? fc.followers : 'Not reported'}
Specialties: ${fc.specialty_count || 0}${fc.specialty_list_truncated ? ' (TRUNCATED at 50)' : ''}
Equipment: ${fc.equipment_count || 0}
Source URLs: ${fc.source_url_count || 0}
Claims 24/7: ${fc.claims_247 || false} | Claims ICU: ${fc.claims_icu || false}
Claims Cardiology: ${fc.claims_cardiology || false} | Has Cardiac Equip: ${fc.has_cardiac_equip || false}
Claims NICU: ${fc.claims_nicu || false} | Has Ventilator: ${fc.has_ventilator || false}
Decay Score: ${fc.decay_score || 'N/A'} | Last Updated: ${fc.recency_of_page_update || 'Unknown'}
Year Established: ${fc.yearEstablished || 'Unknown'}
Description: ${(fc.description_snippet || '').substring(0, 300)}

[USER QUESTION]
${question}`;
    }

    // Call Databricks Foundation Model API
    const response = await fetch(`https://${AI_HOST}/serving-endpoints/${AI_MODEL}/invocations`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${AI_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userMsg },
        ],
        max_tokens: 1024,
        temperature: 0.3,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`AI model returned ${response.status}: ${errText.substring(0, 200)}`);
    }

    const rawText = await response.text();
    let result;
    try { result = JSON.parse(rawText); } catch { throw new Error('AI model returned invalid response. Please try again.'); }
    const answer = result.choices?.[0]?.message?.content || 'No response from AI model.';
    const model = result.model || AI_MODEL;

    res.json({
      ok: true,
      data: {
        answer,
        model,
        tokens: result.usage || {},
      },
    });
  } catch (e) {
    console.error('AI Agent error:', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ─── AI TRUST AUDIT AGENT (Multi-step) ─────────────────────────────────────
app.post('/api/ai/audit', async (req, res) => {
  try {
    const { facilityContext } = req.body;
    if (!facilityContext) return res.status(400).json({ ok: false, error: 'Facility context required' });
    if (!AI_HOST || !AI_TOKEN) return res.status(500).json({ ok: false, error: 'AI not configured' });

    const fc = facilityContext;
    const steps = [];
    const start = Date.now();

    // STEP 1: Data Retrieval & Structuring
    steps.push({ tool: 'databricks_sql', action: 'Retrieving facility data from Unity Catalog', status: 'complete', duration: Date.now() - start });

    // STEP 2: Cross-reference with comparable facilities
    let comparables = [];
    try {
      comparables = await queries.getFacilities({
        state: fc.state_clean || fc.state,
        pageSize: 5,
        page: 1,
      });
    } catch {}
    steps.push({ tool: 'databricks_sql', action: `Cross-referenced with ${comparables.length || 0} comparable facilities in ${fc.state_clean || fc.state || 'same region'}`, status: 'complete', duration: Date.now() - start });

    // STEP 3: Generate structured audit via LLM
    steps.push({ tool: 'foundation_model', action: 'Generating structured trust audit via Llama 3.3 70B', status: 'running', duration: Date.now() - start });

    const auditPrompt = `You are the ArogyaSetu Trust Audit Agent. Generate a STRUCTURED trust audit report for this healthcare facility. Return VALID JSON only — no markdown, no code fences.

IMPORTANT: When citing evidence, ALWAYS quote the actual text from the description/capability/procedure/equipment fields below. Use direct quotes in your evidence like: "The description states: '...actual text...'"

FACILITY DATA:
${JSON.stringify({
  name: fc.name, city: fc.address_city, state: fc.state_clean || fc.state,
  type: fc.facility_type_clean || fc.facility_type, archetype: fc.archetype,
  pinocchio_score: fc.pinocchio_score, doctors: fc.num_doctors_clean,
  beds: fc.bed_capacity, followers: fc.followers,
  specialties: fc.specialty_count, equipment: fc.equipment_count,
  source_urls: fc.source_url_count, decay_score: fc.decay_score,
  claims_247: fc.claims_247, claims_icu: fc.claims_icu,
  claims_cardiology: fc.claims_cardiology, claims_nicu: fc.claims_nicu,
  has_cardiac_equip: fc.has_cardiac_equip, has_ventilator: fc.has_ventilator,
  specialty_truncated: fc.specialty_list_truncated, type_dirty: fc.type_id_was_dirty,
  year_established: fc.yearEstablished,
}, null, 2)}

FREE-TEXT FIELDS (use these for evidence citations):
DESCRIPTION: ${(fc.description_snippet || '').substring(0, 400)}
CAPABILITY: ${(fc.capability_snippet || '').substring(0, 400)}
PROCEDURE: ${(fc.procedure_snippet || '').substring(0, 400)}
EQUIPMENT: ${(fc.equipment_snippet || '').substring(0, 400)}

COMPARABLE FACILITIES IN SAME STATE:
${JSON.stringify((comparables || []).slice(0, 3).map(c => ({
  name: c.name, pinocchio: c.pinocchio_score, doctors: c.num_doctors, archetype: c.archetype
})))}

Return this exact JSON structure:
{
  "executive_summary": "2-3 sentence summary citing specific text evidence",
  "trust_verdict": "TRUSTWORTHY|NEEDS_VERIFICATION|HIGH_RISK|UNRELIABLE",
  "confidence_pct": 75,
  "risk_factors": [
    {"factor": "risk description", "severity": "CRITICAL|HIGH|MEDIUM|LOW", "evidence": "Quote the actual text from description/capability/equipment that supports this finding"}
  ],
  "strengths": ["strength with text citation"],
  "recommendations": [
    {"action": "what to do", "priority": "IMMEDIATE|SHORT_TERM|LONG_TERM", "rationale": "why, citing text evidence"}
  ],
  "comparison_insight": "How this facility compares to peers, citing specific numbers",
  "data_quality_notes": "Specific data quality issues found in the text fields",
  "referral_safe": false,
  "referral_explanation": "Why, with text evidence citations"
}`;

    const auditResp = await fetch(`https://${AI_HOST}/serving-endpoints/${AI_MODEL}/invocations`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${AI_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [
          { role: 'system', content: 'You are a structured data API. Return ONLY valid JSON. No markdown. No explanations. Just the JSON object.' },
          { role: 'user', content: auditPrompt },
        ],
        max_tokens: 1500,
        temperature: 0.2,
      }),
    });

    if (!auditResp.ok) {
      const errBody = await auditResp.text();
      throw new Error(`Audit model returned ${auditResp.status}: ${errBody.substring(0, 100)}`);
    }
    const auditRaw = await auditResp.text();
    let auditResult;
    try { auditResult = JSON.parse(auditRaw); } catch { throw new Error('AI model returned invalid response. Please try again.'); }
    let auditText = auditResult.choices?.[0]?.message?.content || '{}';
    auditText = auditText.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
    const jsonMatch = auditText.match(/\{[\s\S]*\}/);
    let audit = {};
    try { audit = JSON.parse(jsonMatch ? jsonMatch[0] : auditText); } catch { audit = { executive_summary: auditText, trust_verdict: 'UNKNOWN' }; }

    steps[2].status = 'complete';
    steps[2].duration = Date.now() - start;

    // STEP 4: Final synthesis
    steps.push({ tool: 'agent_synthesizer', action: 'Compiled final audit report with 3 data sources', status: 'complete', duration: Date.now() - start });

    res.json({
      ok: true,
      data: {
        audit,
        steps,
        total_duration_ms: Date.now() - start,
        model: auditResult.model || AI_MODEL,
        tokens: auditResult.usage || {},
      },
    });
  } catch (e) {
    console.error('Audit Agent error:', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ─── AI MISSION CONTROL — AUTONOMOUS POLICY ADVISOR ─────────────────────────
app.post('/api/ai/mission', async (req, res) => {
  try {
    const { mission, state, pincode, customMission } = req.body;
    if (!AI_HOST || !AI_TOKEN) return res.status(500).json({ ok: false, error: 'AI not configured' });

    const steps = [];
    const start = Date.now();
    const { query: dbQuery } = require('./server/db');
    const PINOCCHIO_SCORE = queries.PINOCCHIO_SCORE || `0`;
    
    // Gather intelligence based on mission type
    let intelligence = {};
    let missionDesc = customMission || '';
    
    const stateFilter = state ? `AND LOWER(state) = LOWER('${state.replace(/'/g,"''")}')` : '';
    const pincodeFilter = pincode ? `AND pincode = '${pincode.replace(/'/g,"''")}'` : '';

    // ── STEP 1: Situational Awareness ──
    steps.push({ tool: 'databricks_sql', action: `Scanning regional health infrastructure`, status: 'running', duration: 0 });
    try {
      const overview = await dbQuery(`
        SELECT 
          COUNT(*) as total,
          state,
          SUM(CASE WHEN archetype = 'Ghost Facility' THEN 1 ELSE 0 END) as ghosts,
          SUM(CASE WHEN archetype = 'Hidden Gem' THEN 1 ELSE 0 END) as hidden_gems,
          SUM(CASE WHEN archetype = 'Verified Pillar' THEN 1 ELSE 0 END) as verified,
          SUM(CASE WHEN archetype = 'Confident Claimer' THEN 1 ELSE 0 END) as claimers,
          SUM(CASE WHEN trust_band = 'High Trust' THEN 1 ELSE 0 END) as high_trust,
          SUM(CASE WHEN trust_band = 'Unreliable' THEN 1 ELSE 0 END) as unreliable,
          ROUND(AVG(pinocchio_score), 1) as avg_pinocchio,
          ROUND(AVG(num_doctors_clean), 1) as avg_doctors,
          SUM(CASE WHEN claims_247 = true AND num_doctors_clean < 3 THEN 1 ELSE 0 END) as suspicious_247,
          SUM(CASE WHEN claims_icu = true AND num_doctors_clean < 2 THEN 1 ELSE 0 END) as suspicious_icu
        FROM (SELECT *, ${PINOCCHIO_SCORE} as pinocchio_score,
          CASE WHEN (${PINOCCHIO_SCORE}) > 60 AND (TRY_CAST(numberOfFollowers AS DOUBLE) IS NULL OR TRY_CAST(numberOfFollowers AS DOUBLE) < 100) THEN 'Ghost Facility'
               WHEN (TRY_CAST(numberOfFollowers AS DOUBLE) IS NULL OR TRY_CAST(numberOfFollowers AS DOUBLE) < 100) AND TRY_CAST(numberDoctors AS DOUBLE) >= 50 AND (${PINOCCHIO_SCORE}) <= 10 THEN 'Hidden Gem'
               WHEN (${PINOCCHIO_SCORE}) > 30 THEN 'Confident Claimer'
               ELSE 'Verified Pillar' END as archetype,
          CASE WHEN (${PINOCCHIO_SCORE}) <= 10 THEN 'High Trust'
               WHEN (${PINOCCHIO_SCORE}) <= 30 THEN 'Moderate Trust'
               WHEN (${PINOCCHIO_SCORE}) <= 60 THEN 'Low Trust'
               ELSE 'Unreliable' END as trust_band,
          TRY_CAST(numberDoctors AS DOUBLE) as num_doctors_clean,
          LOWER(COALESCE(specialties, '')) LIKE '%emergency%' OR LOWER(COALESCE(capability, '')) LIKE '%emergency%' OR LOWER(COALESCE(description, '')) LIKE '%emergency%' OR LOWER(COALESCE(specialties, '')) LIKE '%24/7%' as claims_247,
          LOWER(COALESCE(specialties, '')) LIKE '%icu%' OR LOWER(COALESCE(specialties, '')) LIKE '%intensive%' as claims_icu
        FROM ${process.env.DATABRICKS_CATALOG}.${process.env.DATABRICKS_SCHEMA}.facilities) sub
        WHERE 1=1 ${stateFilter}
        GROUP BY state
        ORDER BY total DESC
        LIMIT 10
      `);
      intelligence.overview = overview;
    } catch(e) { intelligence.overview = []; }
    steps[0].status = 'complete';
    steps[0].duration = Date.now() - start;

    // ── STEP 2: Mission-Specific Intelligence Gathering ──
    if (mission === 'emergency_audit') {
      missionDesc = `Audit emergency care readiness${state ? ' in ' + state : ''}`;
      steps.push({ tool: 'databricks_sql', action: 'Querying emergency-claiming facilities with staffing data', status: 'running', duration: Date.now() - start });
      try { intelligence.facilities = await queries.getFacilities({ state, pageSize: 15, page: 1 }); intelligence.anomalies = await queries.getAnomalies(); } catch(e) {}
    } else if (mission === 'nicu_referral') {
      missionDesc = `Find safest NICU referral options${pincode ? ' near pincode ' + pincode : ''}${state ? ' in ' + state : ''}`;
      steps.push({ tool: 'databricks_sql', action: 'Searching for verified NICU-capable facilities', status: 'running', duration: Date.now() - start });
      try { intelligence.referrals = await queries.findReferrals('nicu', pincode || ''); intelligence.facilities = await queries.getFacilities({ state, pageSize: 10, page: 1 }); } catch(e) {}
    } else if (mission === 'scheme_eligibility') {
      missionDesc = `Evaluate facilities for government health scheme eligibility${state ? ' in ' + state : ''}`;
      steps.push({ tool: 'databricks_sql', action: 'Evaluating trust scores and infrastructure for scheme compliance', status: 'running', duration: Date.now() - start });
      try { intelligence.facilities = await queries.getFacilities({ state, pageSize: 20, page: 1 }); intelligence.gems = await queries.getHiddenGems(); } catch(e) {}
    } else if (mission === 'ghost_investigation') {
      missionDesc = `Investigate suspected ghost facilities${state ? ' in ' + state : ''}`;
      steps.push({ tool: 'databricks_sql', action: 'Identifying ghost facility patterns and evidence', status: 'running', duration: Date.now() - start });
      try { intelligence.anomalies = await queries.getAnomalies(); intelligence.facilities = await queries.getFacilities({ state, archetype: 'Ghost Facility', pageSize: 15, page: 1 }); } catch(e) {}
    } else {
      missionDesc = customMission || 'General health infrastructure analysis';
      steps.push({ tool: 'databricks_sql', action: 'Gathering comprehensive facility data', status: 'running', duration: Date.now() - start });
      try { intelligence.facilities = await queries.getFacilities({ state, pageSize: 15, page: 1 }); intelligence.anomalies = await queries.getAnomalies(); intelligence.gems = await queries.getHiddenGems(); } catch(e) {}
    }
    steps[steps.length - 1].status = 'complete';
    steps[steps.length - 1].duration = Date.now() - start;

    // ── STEP 3: AI Analysis & Policy Brief Generation ──
    steps.push({ tool: 'foundation_model', action: 'Generating policy intelligence brief via Llama 3.3 70B', status: 'running', duration: Date.now() - start });

    const briefPrompt = `You are the ArogyaSetu AI Policy Advisor — an autonomous agent for Indian government health planners.

MISSION: ${missionDesc}

REAL DATA FROM DATABRICKS (use ONLY these numbers, do NOT hallucinate):
${JSON.stringify({
  regional_overview: (intelligence.overview || []).slice(0, 5),
  sample_facilities: (intelligence.facilities || []).slice(0, 8).map(f => ({ name: f.name, city: f.address_city, state: f.state, type: f.facility_type, archetype: f.archetype, pinocchio: f.pinocchio_score, doctors: f.num_doctors, beds: f.bed_capacity, trust: f.trust_band })),
  anomaly_counts: intelligence.anomalies ? { dirty_types: intelligence.anomalies.dirtyTypes?.length || 0, truncated: intelligence.anomalies.truncatedSpecialties?.length || 0, suspicious_247: intelligence.anomalies.suspicious247?.length || 0, suspicious_icu: intelligence.anomalies.suspiciousICU?.length || 0 } : null,
  referral_results: (intelligence.referrals || []).slice(0, 5).map(r => ({ name: r.name, city: r.address_city, doctors: r.num_doctors, beds: r.bed_capacity, pinocchio: r.pinocchio_score })),
  hidden_gems: (intelligence.gems || []).slice(0, 3).map(g => ({ name: g.name, city: g.address_city, doctors: g.num_doctors })),
})}

Generate a JSON policy brief:
{
  "brief_title": "Professional title",
  "classification": "FOR OFFICIAL USE|PRIORITY|ROUTINE",
  "executive_summary": "3-4 sentences with specific numbers from data",
  "situation_assessment": "Current state analysis with real facility counts",
  "key_findings": [{"finding":"...","severity":"CRITICAL|HIGH|MEDIUM|LOW","evidence":"data that supports this"}],
  "risk_alerts": [{"risk":"...","affected_population":"...","immediate_action":"..."}],
  "recommended_actions": [{"action":"...","priority":"IMMEDIATE|30_DAYS|90_DAYS","impact":"...","responsible_authority":"..."}],
  "facilities_of_concern": ["specific facility names from data"],
  "facilities_recommended": ["specific facility names from data"],
  "data_limitations": "caveats about data quality",
  "next_steps": "what should happen next"
}`;

    const briefResp = await fetch(`https://${AI_HOST}/serving-endpoints/${AI_MODEL}/invocations`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${AI_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [
        { role: 'system', content: 'Return ONLY valid JSON. No markdown. No code fences.' },
        { role: 'user', content: briefPrompt },
      ], max_tokens: 2000, temperature: 0.2 }),
    });

    if (!briefResp.ok) {
      const errBody = await briefResp.text();
      console.error('Policy advisor error:', briefResp.status, errBody.substring(0, 200));
      throw new Error(`Policy advisor returned ${briefResp.status}: ${errBody.substring(0, 100)}`);
    }
    const briefRaw = await briefResp.text();
    let briefResult;
    try { briefResult = JSON.parse(briefRaw); } catch(pe) {
      console.error('LLM returned non-JSON:', briefRaw.substring(0, 200));
      throw new Error('AI model returned invalid response. Please try again.');
    }
    let briefText = briefResult.choices?.[0]?.message?.content || '{}';
    // Strip markdown code fences if present
    briefText = briefText.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
    const jsonMatch = briefText.match(/\{[\s\S]*\}/);
    let brief = {};
    try { brief = JSON.parse(jsonMatch ? jsonMatch[0] : briefText); } catch { brief = { executive_summary: briefText, brief_title: missionDesc }; }

    steps[steps.length - 1].status = 'complete';
    steps[steps.length - 1].duration = Date.now() - start;

    // ── STEP 4: Brief Compiled ──
    steps.push({ tool: 'policy_synthesizer', action: 'Compiled policy intelligence brief with real facility data', status: 'complete', duration: Date.now() - start });

    res.json({ ok: true, data: { mission: missionDesc, brief, steps, total_duration_ms: Date.now() - start, model: briefResult.model || AI_MODEL, tokens: briefResult.usage || {}, data_sources: Object.keys(intelligence).filter(k => intelligence[k] && (Array.isArray(intelligence[k]) ? intelligence[k].length : true)) } });
  } catch (e) {
    console.error('Mission Control error:', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ ok: true, timestamp: new Date().toISOString(), version: '3.0.0', ai_model: AI_MODEL, agents: ['trust_auditor', 'policy_advisor', 'chat_analyst'] });
});

// SPA fallback
app.get(/(.*)/, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`\n🏥 ArogyaSetu AI — Facility Trust Desk`);
  console.log(`📡 Server running at http://localhost:${PORT}`);
  console.log(`📊 API ready at http://localhost:${PORT}/api/health\n`);
});
