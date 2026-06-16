const { query } = require('./db');

// ── SOURCE TABLE (raw) ────────────────────────────────────────────────────────
const CAT  = process.env.DATABRICKS_CATALOG;
const SCH  = process.env.DATABRICKS_SCHEMA;
const FAC  = `${CAT}.${SCH}.facilities`;
const PIN  = `${CAT}.${SCH}.india_post_pincode_directory`;

// ── SHARED CLEANING EXPRESSIONS (injected into every query) ──────────────────
// These transform raw data into clean data at query time.
const CLEAN = {
  // name: reject JSON/sentences/too-short/too-long
  name: `CASE
    WHEN name IS NULL OR TRIM(name)='' OR LOWER(name)='null' THEN 'Unnamed Facility'
    WHEN name LIKE '[%' OR name LIKE '{%' OR name LIKE '"%' THEN 'Unnamed Facility'
    WHEN LENGTH(TRIM(name)) < 3 OR LENGTH(name) > 200 THEN 'Unnamed Facility'
    ELSE TRIM(name)
  END`,

  // facility_type: infer from name when field is garbage
  type: `CASE
    WHEN LOWER(facilityTypeId) IN ('hospital','clinic','dentist','doctor','pharmacy','nursing_home')
      THEN LOWER(facilityTypeId)
    WHEN LOWER(facilityTypeId)='farmacy' THEN 'pharmacy'
    WHEN facilityTypeId IS NULL OR TRIM(facilityTypeId)='' OR LOWER(facilityTypeId)='null'
      OR facilityTypeId RLIKE '^[0-9]+' OR facilityTypeId RLIKE '^[0-9a-f]{32}$'
      OR facilityTypeId LIKE '[%' OR facilityTypeId LIKE '{%'
      THEN CASE
        WHEN LOWER(COALESCE(name,'')) LIKE '%hospital%' THEN 'hospital'
        WHEN LOWER(COALESCE(name,'')) LIKE '%clinic%'   THEN 'clinic'
        WHEN LOWER(COALESCE(name,'')) LIKE '%dent%'     THEN 'dentist'
        WHEN LOWER(COALESCE(name,'')) LIKE '%pharmac%'  THEN 'pharmacy'
        ELSE 'clinic'
      END
    ELSE CASE
      WHEN LOWER(COALESCE(name,'')) LIKE '%hospital%' THEN 'hospital'
      WHEN LOWER(COALESCE(name,'')) LIKE '%clinic%'   THEN 'clinic'
      WHEN LOWER(COALESCE(name,'')) LIKE '%dent%'     THEN 'dentist'
      ELSE 'clinic'
    END
  END`,

  // city: reject numbers, dates, JSON, paragraphs
  city: `CASE
    WHEN address_city IS NULL OR TRIM(address_city)='' OR LOWER(address_city)='null' THEN NULL
    WHEN address_city RLIKE '^[0-9]' THEN NULL
    WHEN address_city LIKE '[%' OR address_city LIKE '{%' OR address_city LIKE '"%' THEN NULL
    WHEN LENGTH(address_city) > 100 OR address_city LIKE '%http%' OR address_city LIKE '%;%' THEN NULL
    ELSE TRIM(address_city)
  END`,

  // state: only real Indian states
  state: `CASE
    WHEN address_stateOrRegion IS NULL OR TRIM(address_stateOrRegion)='' THEN NULL
    WHEN address_stateOrRegion RLIKE '^[0-9]' THEN NULL
    WHEN address_stateOrRegion LIKE '[%' OR address_stateOrRegion LIKE '"%' THEN NULL
    WHEN LENGTH(address_stateOrRegion) > 80 THEN NULL
    WHEN address_stateOrRegion IN (
      'Andhra Pradesh','Arunachal Pradesh','Assam','Bihar','Chhattisgarh',
      'Goa','Gujarat','Haryana','Himachal Pradesh','Jharkhand','Karnataka',
      'Kerala','Madhya Pradesh','Maharashtra','Manipur','Meghalaya','Mizoram',
      'Nagaland','Odisha','Punjab','Rajasthan','Sikkim','Tamil Nadu','Telangana',
      'Tripura','Uttar Pradesh','Uttarakhand','West Bengal','Delhi','Chandigarh',
      'Jammu and Kashmir','Ladakh','Puducherry',
      'Andaman and Nicobar Islands','Lakshadweep',
      'Dadra and Nagar Haveli','Daman and Diu'
    ) THEN address_stateOrRegion
    WHEN address_stateOrRegion LIKE '%, %'
      THEN TRIM(SPLIT(address_stateOrRegion, ',')[SIZE(SPLIT(address_stateOrRegion, ','))-1])
    ELSE address_stateOrRegion
  END`,

  // phone: must be phone-shaped (digits/spaces/dashes/+); reject JSON, paragraphs, dates
  phone: `CASE
    WHEN officialPhone IS NULL OR TRIM(officialPhone)='' OR LOWER(officialPhone)='null' THEN NULL
    WHEN officialPhone LIKE '[%' OR officialPhone LIKE '{%' OR officialPhone LIKE '"%' THEN NULL
    WHEN officialPhone RLIKE '^20[0-9]{2}-' THEN NULL
    WHEN LENGTH(officialPhone) > 20 THEN NULL
    WHEN NOT officialPhone RLIKE '^[+0-9][0-9 ()\\-.]{4,19}$' THEN NULL
    ELSE TRIM(officialPhone)
  END`,

  // website: must look like a URL/domain; reject JSON blobs, sentences
  website: `CASE
    WHEN officialWebsite IS NULL OR TRIM(officialWebsite)='' OR LOWER(officialWebsite)='null' THEN NULL
    WHEN officialWebsite LIKE '[%' OR officialWebsite LIKE '{%' OR officialWebsite LIKE '"%' THEN NULL
    WHEN LENGTH(officialWebsite) > 100 THEN NULL
    WHEN officialWebsite LIKE '% %' AND NOT officialWebsite RLIKE '^(http|www)' THEN NULL
    WHEN officialWebsite RLIKE '^(http://|https://|www\\.|[a-zA-Z0-9][a-zA-Z0-9-]+\\.[a-zA-Z]{2,})'
      THEN LOWER(TRIM(REGEXP_REPLACE(REGEXP_REPLACE(officialWebsite,'^https?://',''),'/$','')))
    ELSE NULL
  END`,

  // doctors: show all real values.
  // ONLY null out values that are physically impossible for a single facility.
  // - 15,000 doctors claimed by a diagnostic lab (no beds) = scraping error
  // - 940 at KEM Mumbai = legitimate teaching hospital → keep
  // - We flag suspect cases separately for display context
  doctors: `TRY_CAST(numberDoctors AS DOUBLE)`,

  // beds: show all real values, no cap
  beds: `CASE
    WHEN TRY_CAST(capacity AS DOUBLE) IS NULL THEN NULL
    WHEN TRY_CAST(capacity AS DOUBLE) <= 0 THEN NULL
    ELSE TRY_CAST(capacity AS DOUBLE)
  END`,

  // followers: show all real values, no cap
  followers: `CASE
    WHEN TRY_CAST(engagement_metrics_n_followers AS DOUBLE) IS NULL THEN NULL
    WHEN TRY_CAST(engagement_metrics_n_followers AS DOUBLE) < 0 THEN NULL
    ELSE TRY_CAST(engagement_metrics_n_followers AS DOUBLE)
  END`,
};

// Helper: is type field clean?
const TYPE_DIRTY = `NOT (LOWER(facilityTypeId) IN ('hospital','clinic','dentist','doctor','pharmacy','nursing_home'))`;

// Pre-built claim flags (inline)
const FLAGS = `
  (LOWER(COALESCE(description,'')) LIKE '%24/7%'
   OR LOWER(COALESCE(capability,'')) LIKE '%24/7%'
   OR LOWER(COALESCE(description,'')) LIKE '%24 hour%') AS claims_247,
  (LOWER(COALESCE(capability,'')) LIKE '%icu%'
   OR LOWER(COALESCE(equipment,'')) LIKE '%icu%'
   OR LOWER(COALESCE(description,'')) LIKE '%intensive care%') AS claims_icu,
  (LOWER(COALESCE(description,'')) LIKE '%multispecialt%'
   OR LOWER(COALESCE(capability,'')) LIKE '%multispecialt%') AS claims_multispecialty,
  LOWER(COALESCE(specialties,'')) LIKE '%cardiology%' AS claims_cardiology,
  LOWER(COALESCE(specialties,'')) LIKE '%oncolog%' AS claims_oncology,
  (LOWER(COALESCE(specialties,'')) LIKE '%nicu%'
   OR LOWER(COALESCE(capability,'')) LIKE '%nicu%'
   OR LOWER(COALESCE(specialties,'')) LIKE '%neonat%') AS claims_nicu,
  (LOWER(COALESCE(equipment,'')) LIKE '%cath%' OR LOWER(COALESCE(equipment,'')) LIKE '%ecg%'
   OR LOWER(COALESCE(equipment,'')) LIKE '%cardiac%') AS has_cardiac_equip,
  (LOWER(COALESCE(equipment,'')) LIKE '%radiation%' OR LOWER(COALESCE(equipment,'')) LIKE '%chemo%'
   OR LOWER(COALESCE(equipment,'')) LIKE '%linear accelerator%') AS has_onco_equip,
  LOWER(COALESCE(equipment,'')) LIKE '%ventilator%' AS has_ventilator,
  COALESCE(SIZE(FROM_JSON(specialties,'array<string>')),0) = 50 AS specialty_list_truncated,
  ${TYPE_DIRTY} AS type_id_was_dirty,
  COALESCE(SIZE(FROM_JSON(specialties,'array<string>')),0) AS specialty_count,
  COALESCE(SIZE(FROM_JSON(equipment,'array<string>')),0)   AS equipment_count,
  COALESCE(SIZE(FROM_JSON(source_urls,'array<string>')),0) AS source_url_count,
  CASE
    WHEN TRY_CAST(numberDoctors AS DOUBLE) > 5000 AND TRY_CAST(capacity AS DOUBLE) IS NULL THEN TRUE
    WHEN TRY_CAST(numberDoctors AS DOUBLE) > 5000 AND TRY_CAST(capacity AS DOUBLE) = 0 THEN TRUE
    ELSE FALSE
  END AS doctor_count_suspect
`;

// Pinocchio score inline — 8 factors, 0-100
const PINOCCHIO_FACTORS = `
  CASE WHEN claims_247 AND num_doctors<3 THEN 15 ELSE 0 END+
  CASE WHEN claims_icu AND num_doctors<2 THEN 25 ELSE 0 END+
  CASE WHEN claims_multispecialty AND num_doctors<3 THEN 20 ELSE 0 END+
  CASE WHEN claims_cardiology AND NOT has_cardiac_equip THEN 10 ELSE 0 END+
  CASE WHEN claims_oncology AND NOT has_onco_equip THEN 10 ELSE 0 END+
  CASE WHEN claims_nicu AND NOT has_ventilator THEN 15 ELSE 0 END+
  CASE WHEN specialty_list_truncated THEN 5 ELSE 0 END+
  CASE WHEN type_id_was_dirty THEN 5 ELSE 0 END
`;
const PINOCCHIO_SCORE = `LEAST(100,(${PINOCCHIO_FACTORS}))`;

// ── KPI SUMMARY ───────────────────────────────────────────────────────────────
async function getKpiSummary() {
  const rows = await query(`
    WITH cleaned AS (
      SELECT
        ${CLEAN.doctors} AS num_doctors,
        ${CLEAN.followers} AS followers,
        ${FLAGS},
        (recency_of_page_update < '2023-01-01'
         AND COALESCE(TRY_CAST(post_metrics_post_count AS DOUBLE),0) = 0) AS is_stale
      FROM ${FAC}
    ),
    scored AS (
      SELECT *,
        ${PINOCCHIO_SCORE} AS ps,
        CASE
          WHEN COALESCE(followers,0)>500
            AND specialty_count>20
            AND COALESCE(num_doctors,0)<5
            THEN 'claimer'
          WHEN COALESCE(followers,0)<100
            AND COALESCE(num_doctors,0)>50
            AND equipment_count>20
            THEN 'gem'
          WHEN is_stale THEN 'ghost'
          ELSE 'other'
        END AS cat
      FROM cleaned
    )
    SELECT
      COUNT(*)                                                         AS total_facilities,
      SUM(CASE WHEN specialty_list_truncated THEN 1 ELSE 0 END)       AS truncated_50,
      SUM(CASE WHEN claims_247 AND num_doctors<3 THEN 1 ELSE 0 END)   AS suspicious_247,
      SUM(CASE WHEN claims_icu AND num_doctors<2 THEN 1 ELSE 0 END)   AS suspicious_icu,
      SUM(CASE WHEN type_id_was_dirty THEN 1 ELSE 0 END)              AS dirty_type_id,
      SUM(CASE WHEN cat='gem' THEN 1 ELSE 0 END)                      AS hidden_gems,
      SUM(CASE WHEN cat='ghost' THEN 1 ELSE 0 END)                    AS ghost_count,
      SUM(CASE WHEN ps <= 10 THEN 1 ELSE 0 END)                       AS high_trust,
      SUM(CASE WHEN ps > 60 THEN 1 ELSE 0 END)                        AS unreliable,
      ROUND(AVG(ps),1)                                                AS avg_pinocchio,
      -- Data coverage stats (uncertainty signals)
      COUNT(DISTINCT state) as total_states,
      ROUND(100.0 * SUM(CASE WHEN num_doctors IS NOT NULL THEN 1 ELSE 0 END) / COUNT(*), 1) AS pct_has_doctors,
      ROUND(100.0 * SUM(CASE WHEN equipment_count > 0 THEN 1 ELSE 0 END) / COUNT(*), 1) AS pct_has_equipment,
      ROUND(100.0 * SUM(CASE WHEN specialty_count > 0 THEN 1 ELSE 0 END) / COUNT(*), 1) AS pct_has_specialties,
      ROUND(100.0 * SUM(CASE WHEN followers IS NOT NULL AND followers > 0 THEN 1 ELSE 0 END) / COUNT(*), 1) AS pct_has_followers
    FROM scored
  `);
  return rows[0];
}

// ── ARCHETYPE COUNTS ──────────────────────────────────────────────────────────
async function getArchetypeCounts() {
  return query(`
    WITH cleaned AS (
      SELECT
        ${CLEAN.doctors} AS num_doctors,
        ${CLEAN.followers} AS followers,
        COALESCE(SIZE(FROM_JSON(specialties,'array<string>')),0) AS specialty_count,
        COALESCE(SIZE(FROM_JSON(equipment,'array<string>')),0)   AS equipment_count,
        (recency_of_page_update<'2023-01-01'
         AND COALESCE(TRY_CAST(post_metrics_post_count AS DOUBLE),0)=0) AS is_stale
      FROM ${FAC}
    )
    SELECT
      CASE
        WHEN COALESCE(followers,0)>500 AND specialty_count>20 AND COALESCE(num_doctors,0)<5
          THEN 'Confident Claimer'
        WHEN COALESCE(followers,0)<100 AND COALESCE(num_doctors,0)>50 AND equipment_count>20
          THEN 'Hidden Gem'
        WHEN is_stale THEN 'Ghost Facility'
        ELSE 'Verified Pillar'
      END AS archetype,
      COUNT(*) AS count
    FROM cleaned
    GROUP BY 1 ORDER BY count DESC
  `);
}

// ── TRUST DISTRIBUTION ────────────────────────────────────────────────────────
async function getTrustDistribution() {
  return query(`
    WITH cleaned AS (
      SELECT
        ${CLEAN.doctors} AS num_doctors,
        ${FLAGS}
      FROM ${FAC}
    ),
    scored AS (
      SELECT ${PINOCCHIO_SCORE} AS ps
      FROM cleaned
    )
    SELECT
      CASE WHEN ps<=10 THEN 'High Trust' WHEN ps<=30 THEN 'Moderate Trust'
           WHEN ps<=60 THEN 'Low Trust' ELSE 'Unreliable' END AS trust_band,
      COUNT(*) AS count,
      ROUND(COUNT(*)*100.0/SUM(COUNT(*)) OVER(),1) AS pct
    FROM scored
    GROUP BY 1
    ORDER BY CASE trust_band WHEN 'High Trust' THEN 1 WHEN 'Moderate Trust' THEN 2 WHEN 'Low Trust' THEN 3 ELSE 4 END
  `);
}

// ── SPECIALTY DISTRIBUTION ────────────────────────────────────────────────────
async function getSpecialtyDistribution() {
  return query(`
    SELECT
      COALESCE(SIZE(FROM_JSON(specialties,'array<string>')),0) AS specialty_count,
      COUNT(*) AS facility_count
    FROM ${FAC}
    WHERE specialties IS NOT NULL AND specialties != '[]'
    GROUP BY 1
    ORDER BY 1 DESC
    LIMIT 25
  `);
}

// ── FACILITY LIST ─────────────────────────────────────────────────────────────
async function getFacilities({ archetype, state, search, page = 1, pageSize = 20 }) {
  const offset = (page - 1) * pageSize;

  // Filters applied to raw source (only search on name which is in the raw table)
  const rawWhere = [];
  if (search) rawWhere.push(`LOWER(COALESCE(name,'')) LIKE LOWER('%${search.replace(/'/g,"''").replace(/%/g,'\\%')}%')`);
  const RAW_WHERE = rawWhere.length ? `WHERE ${rawWhere.join(' AND ')}` : '';

  // Post-CTE filters (state and archetype — computed fields)
  const postWhere = [];
  if (state)     postWhere.push(`state = '${state.replace(/'/g,"''")}'`);
  if (archetype) postWhere.push(`archetype = '${archetype.replace(/'/g,"''")}'`);
  const POST_WHERE = postWhere.length ? `WHERE ${postWhere.join(' AND ')}` : '';

  return query(`
    WITH cleaned AS (
      SELECT
        unique_id,
        ${CLEAN.name}     AS name,
        ${CLEAN.type}     AS facility_type,
        ${CLEAN.city}     AS address_city,
        ${CLEAN.state}    AS state,
        ${CLEAN.phone}    AS phone,
        ${CLEAN.website}  AS website,
        ${CLEAN.doctors}  AS num_doctors,
        ${CLEAN.beds}     AS bed_capacity,
        ${CLEAN.followers} AS followers,
        ${FLAGS},
        (recency_of_page_update<'2023-01-01'
         AND COALESCE(TRY_CAST(post_metrics_post_count AS DOUBLE),0)=0) AS is_stale
      FROM ${FAC}
      ${RAW_WHERE}
    ),
    scored AS (
      SELECT *,
        ${PINOCCHIO_SCORE} AS pinocchio_score,
        CASE WHEN COALESCE(followers,0)>500 AND specialty_count>20 AND COALESCE(num_doctors,0)<5 THEN 'Confident Claimer'
             WHEN COALESCE(followers,0)<100 AND COALESCE(num_doctors,0)>50 AND equipment_count>20 THEN 'Hidden Gem'
             WHEN is_stale THEN 'Ghost Facility'
             ELSE 'Verified Pillar'
        END AS archetype,
        CASE WHEN ${PINOCCHIO_SCORE}<=10 THEN 'High Trust'
             WHEN ${PINOCCHIO_SCORE}<=30 THEN 'Moderate Trust'
             WHEN ${PINOCCHIO_SCORE}<=60 THEN 'Low Trust'
             ELSE 'Unreliable' END AS trust_band
      FROM cleaned
    )
    SELECT unique_id, name, address_city, state, facility_type, archetype, trust_band,
           pinocchio_score, num_doctors, bed_capacity, followers, specialty_count, equipment_count,
           source_url_count, phone, website, specialty_list_truncated
    FROM scored
    ${POST_WHERE}
    ORDER BY pinocchio_score DESC, name ASC
    LIMIT ${pageSize} OFFSET ${offset}
  `);
}


// ── FACILITY DETAIL (enhanced: source URLs + temporal decay) ──────────────────
async function getFacilityDetail(uniqueId) {
  const safeId = uniqueId.replace(/'/g,"''");
  const rows = await query(`
    WITH cleaned AS (
      SELECT
        unique_id,
        ${CLEAN.name}     AS name,
        ${CLEAN.type}     AS facility_type_clean,
        ${CLEAN.city}     AS address_city,
        ${CLEAN.state}    AS state_clean,
        ${CLEAN.phone}    AS phone,
        ${CLEAN.website}  AS website,
        ${CLEAN.doctors}  AS num_doctors_clean,
        ${CLEAN.beds}     AS bed_capacity,
        ${CLEAN.followers} AS followers,
        facilityTypeId,
        recency_of_page_update,
        yearEstablished,
        COALESCE(TRY_CAST(post_metrics_post_count AS DOUBLE),0) AS post_count,
        COALESCE(TRY_CAST(distinct_social_media_presence_count AS DOUBLE),0) AS social_platforms,
        source_urls AS source_urls_raw,
        SUBSTRING(COALESCE(description,''), 1, 800) AS description_snippet,
        SUBSTRING(COALESCE(capability,''), 1, 800) AS capability_snippet,
        SUBSTRING(COALESCE(procedure,''), 1, 800) AS procedure_snippet,
        SUBSTRING(COALESCE(equipment,''), 1, 800) AS equipment_snippet,
        ${FLAGS},
        TRY_CAST(numberDoctors AS DOUBLE) > 2000 AS doctor_count_suspect,
        (recency_of_page_update<'2023-01-01'
         AND COALESCE(TRY_CAST(post_metrics_post_count AS DOUBLE),0)=0) AS is_stale
      FROM ${FAC}
      WHERE unique_id = '${safeId}'
    )
    SELECT *,
      LEAST(100,(
        CASE WHEN claims_247 AND num_doctors_clean<3 THEN 15 ELSE 0 END+
        CASE WHEN claims_icu AND num_doctors_clean<2 THEN 25 ELSE 0 END+
        CASE WHEN claims_multispecialty AND num_doctors_clean<3 THEN 20 ELSE 0 END+
        CASE WHEN claims_cardiology AND NOT has_cardiac_equip THEN 10 ELSE 0 END+
        CASE WHEN claims_oncology AND NOT has_onco_equip THEN 10 ELSE 0 END+
        CASE WHEN claims_nicu AND NOT has_ventilator THEN 15 ELSE 0 END+
        CASE WHEN specialty_list_truncated THEN 5 ELSE 0 END+
        CASE WHEN type_id_was_dirty THEN 5 ELSE 0 END
      )) AS pinocchio_score,
      CASE WHEN followers>500 AND specialty_count>20 AND COALESCE(num_doctors_clean,0)<5 THEN 'Confident Claimer'
           WHEN COALESCE(followers,0)<100 AND COALESCE(num_doctors_clean,0)>50 AND equipment_count>20 THEN 'Hidden Gem'
           WHEN is_stale THEN 'Ghost Facility'
           ELSE 'Verified Pillar'
      END AS archetype,
      -- Temporal Decay Score (0-100, higher = more stale)
      CASE
        WHEN DATEDIFF(CURRENT_DATE(), TRY_CAST(recency_of_page_update AS DATE)) <= 365 THEN 10
        WHEN DATEDIFF(CURRENT_DATE(), TRY_CAST(recency_of_page_update AS DATE)) <= 730 THEN 30
        WHEN DATEDIFF(CURRENT_DATE(), TRY_CAST(recency_of_page_update AS DATE)) <= 1460 THEN 60
        ELSE 90
      END AS decay_score,
      DATEDIFF(CURRENT_DATE(), TRY_CAST(recency_of_page_update AS DATE)) AS days_since_update
    FROM cleaned
    LIMIT 1
  `);
  if (!rows[0]) return null;

  // Parse source_urls JSON and categorize
  const row = rows[0];
  let sourceUrls = [];
  try {
    const raw = row.source_urls_raw;
    if (raw && raw !== 'null') {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        sourceUrls = parsed.slice(0, 20).map(url => {
          const u = String(url).toLowerCase();
          let category = 'commercial';
          let icon = '📍';
          if (u.includes('gov.in') || u.includes('nic.in') || u.includes('cghs') || u.includes('wbhss') || u.includes('nabh') || u.includes('government')) {
            category = 'government'; icon = '🏛️';
          } else if (u.includes('pubmed') || u.includes('ncbi') || u.includes('scholar') || u.includes('.edu') || u.includes('research') || u.includes('journal')) {
            category = 'academic'; icon = '🎓';
          } else if (u.includes('facebook') || u.includes('twitter') || u.includes('instagram') || u.includes('linkedin') || u.includes('youtube')) {
            category = 'social'; icon = '📱';
          } else if (u.includes('justdial') || u.includes('practo') || u.includes('makemytrip') || u.includes('tripadvisor') || u.includes('yelp') || u.includes('maps.google')) {
            category = 'listing'; icon = '📋';
          } else if (row.website && u.includes(row.website.replace(/^www\./, '').split('/')[0])) {
            category = 'own-website'; icon = '🌐';
          } else if (u.includes('hospital') || u.includes('clinic') || u.includes('health')) {
            category = 'healthcare'; icon = '🏥';
          }
          return { url: String(url), category, icon };
        });
      }
    }
  } catch (e) { /* ignore parse errors */ }
  row.source_urls_parsed = sourceUrls;
  delete row.source_urls_raw;
  return row;
}

// ── STATE LIST (only real Indian states present in data) ─────────────────────
async function getStates() {
  const VALID = new Set([
    'Andhra Pradesh','Arunachal Pradesh','Assam','Bihar','Chhattisgarh',
    'Goa','Gujarat','Haryana','Himachal Pradesh','Jharkhand','Karnataka',
    'Kerala','Madhya Pradesh','Maharashtra','Manipur','Meghalaya','Mizoram',
    'Nagaland','Odisha','Punjab','Rajasthan','Sikkim','Tamil Nadu','Telangana',
    'Tripura','Uttar Pradesh','Uttarakhand','West Bengal','Delhi','Chandigarh',
    'Jammu and Kashmir','Ladakh','Puducherry',
    'Andaman and Nicobar Islands','Lakshadweep','Dadra and Nagar Haveli','Daman and Diu'
  ]);
  const rows = await query(`
    SELECT DISTINCT ${CLEAN.state} AS state
    FROM ${FAC}
    WHERE ${CLEAN.state} IS NOT NULL
    ORDER BY 1
  `);
  return rows.map(r => r.state).filter(s => s && VALID.has(s)).sort();
}

// ── HIDDEN GEMS ───────────────────────────────────────────────────────────────
async function getHiddenGems() {
  return query(`
    WITH cleaned AS (
      SELECT
        unique_id,
        ${CLEAN.name}      AS name,
        ${CLEAN.city}      AS address_city,
        ${CLEAN.state}     AS state,
        ${CLEAN.phone}     AS phone,
        ${CLEAN.doctors}   AS num_doctors,
        ${CLEAN.beds}      AS bed_capacity,
        ${CLEAN.followers} AS followers,
        ${FLAGS}
      FROM ${FAC}
    ),
    scored AS (
      SELECT *,
        ${PINOCCHIO_SCORE} AS pinocchio_score
      FROM cleaned
    )
    SELECT * FROM scored
    WHERE COALESCE(followers,0) < 100
      AND COALESCE(num_doctors,0) > 50
      AND equipment_count > 20
    ORDER BY num_doctors DESC
    LIMIT 30
  `);
}

// ── ANOMALIES ─────────────────────────────────────────────────────────────────
async function getAnomalies() {
  const [dirtyType, truncated, suspicious247, suspiciousICU] = await Promise.all([
    query(`
      SELECT unique_id,
        ${CLEAN.name}  AS name,
        ${CLEAN.city}  AS address_city,
        ${CLEAN.state} AS state,
        facilityTypeId AS raw_type_id,
        ${CLEAN.type}  AS facility_type_clean
      FROM ${FAC}
      WHERE ${TYPE_DIRTY}
        AND facilityTypeId IS NOT NULL AND TRIM(facilityTypeId) != ''
      ORDER BY name LIMIT 30
    `),
    query(`
      SELECT unique_id,
        ${CLEAN.name}    AS name,
        ${CLEAN.city}    AS address_city,
        ${CLEAN.state}   AS state,
        COALESCE(SIZE(FROM_JSON(specialties,'array<string>')),0) AS specialty_count,
        ${CLEAN.doctors} AS num_doctors
      FROM ${FAC}
      WHERE COALESCE(SIZE(FROM_JSON(specialties,'array<string>')),0) = 50
      ORDER BY num_doctors DESC NULLS LAST LIMIT 20
    `),
    query(`
      SELECT unique_id,
        ${CLEAN.name}    AS name,
        ${CLEAN.city}    AS address_city,
        ${CLEAN.state}   AS state,
        ${CLEAN.doctors} AS num_doctors
      FROM ${FAC}
      WHERE (LOWER(COALESCE(description,'')) LIKE '%24/7%'
             OR LOWER(COALESCE(capability,'')) LIKE '%24/7%')
        AND ${CLEAN.doctors} < 3
        AND ${CLEAN.doctors} IS NOT NULL
      ORDER BY num_doctors ASC LIMIT 20
    `),
    query(`
      SELECT unique_id,
        ${CLEAN.name}    AS name,
        ${CLEAN.city}    AS address_city,
        ${CLEAN.state}   AS state,
        ${CLEAN.doctors} AS num_doctors
      FROM ${FAC}
      WHERE (LOWER(COALESCE(capability,'')) LIKE '%icu%'
             OR LOWER(COALESCE(description,'')) LIKE '%intensive care%')
        AND ${CLEAN.doctors} < 2
        AND ${CLEAN.doctors} IS NOT NULL
      ORDER BY num_doctors ASC LIMIT 20
    `),
  ]);
  return { dirtyType, truncated, suspicious247, suspiciousICU };
}

// ── REFERRAL FINDER ────────────────────────────────────────────────────────────
async function findReferrals({ pincode, condition }) {
  const condMap = {
    cardiac:    `LOWER(COALESCE(specialties,'')) LIKE '%cardiology%' AND (LOWER(COALESCE(equipment,'')) LIKE '%ecg%' OR LOWER(COALESCE(equipment,'')) LIKE '%cath%')`,
    cancer:     `LOWER(COALESCE(specialties,'')) LIKE '%oncolog%' AND (LOWER(COALESCE(equipment,'')) LIKE '%radiation%' OR LOWER(COALESCE(equipment,'')) LIKE '%chemo%')`,
    pregnancy:  `LOWER(COALESCE(specialties,'')) LIKE '%obstetric%' AND (LOWER(COALESCE(equipment,'')) LIKE '%ultrasound%' OR LOWER(COALESCE(equipment,'')) LIKE '%fetal%')`,
    nicu:       `LOWER(COALESCE(specialties,'')) LIKE '%nicu%' AND LOWER(COALESCE(equipment,'')) LIKE '%ventilator%'`,
    orthopedic: `LOWER(COALESCE(specialties,'')) LIKE '%orthop%' AND (LOWER(COALESCE(equipment,'')) LIKE '%mri%' OR LOWER(COALESCE(equipment,'')) LIKE '%xray%')`,
    neurology:  `LOWER(COALESCE(specialties,'')) LIKE '%neurolog%' AND (LOWER(COALESCE(equipment,'')) LIKE '%eeg%' OR LOWER(COALESCE(equipment,'')) LIKE '%mri%')`,
  };
  const condExpr = condMap[condition] || condMap.cardiac;

  let stateFilter = '';
  if (pincode?.length >= 3) {
    const pRows = await query(`SELECT DISTINCT statename FROM ${PIN} WHERE pincode = '${pincode}' LIMIT 1`).catch(() => []);
    if (pRows[0]?.statename) {
      stateFilter = `AND LOWER(COALESCE(address_stateOrRegion,'')) LIKE LOWER('%${pRows[0].statename.replace(/'/g,"''")}%')`;
    }
  }

  return query(`
    WITH cleaned AS (
      SELECT
        unique_id,
        ${CLEAN.name}      AS name,
        ${CLEAN.city}      AS address_city,
        ${CLEAN.state}     AS state,
        ${CLEAN.phone}     AS phone,
        ${CLEAN.website}   AS website,
        ${CLEAN.doctors}   AS num_doctors,
        ${CLEAN.beds}      AS bed_capacity,
        ${CLEAN.followers} AS followers,
        ${CLEAN.type}      AS facility_type,
        ${FLAGS},
        (recency_of_page_update<'2023-01-01'
         AND COALESCE(TRY_CAST(post_metrics_post_count AS DOUBLE),0)=0) AS is_stale
      FROM ${FAC}
      WHERE ${condExpr}
        AND TRY_CAST(numberDoctors AS DOUBLE) >= 5
        AND NOT (recency_of_page_update<'2023-01-01'
         AND COALESCE(TRY_CAST(post_metrics_post_count AS DOUBLE),0)=0)
        ${stateFilter}
    ),
    scored AS (
      SELECT *,
        ${PINOCCHIO_SCORE} AS pinocchio_score
      FROM cleaned
    )
    SELECT *,
      CASE WHEN pinocchio_score<=10 THEN 'High Trust' WHEN pinocchio_score<=30 THEN 'Moderate Trust'
           WHEN pinocchio_score<=60 THEN 'Low Trust' ELSE 'Unreliable' END AS trust_band
    FROM scored
    WHERE facility_type = 'hospital'
    ORDER BY pinocchio_score ASC, num_doctors DESC
    LIMIT 10
  `);
}

// ── STATE SUMMARY ─────────────────────────────────────────────────────────────
async function getStateSummary() {
  return query(`
    WITH cleaned AS (
      SELECT
        ${CLEAN.state}     AS state,
        ${CLEAN.doctors}   AS num_doctors,
        ${CLEAN.followers} AS followers,
        COALESCE(SIZE(FROM_JSON(specialties,'array<string>')),0) AS specialty_count,
        COALESCE(SIZE(FROM_JSON(equipment,'array<string>')),0)   AS equipment_count,
        (recency_of_page_update<'2023-01-01'
         AND COALESCE(TRY_CAST(post_metrics_post_count AS DOUBLE),0)=0) AS is_stale
      FROM ${FAC}
      WHERE ${CLEAN.state} IN (
        'Andhra Pradesh','Arunachal Pradesh','Assam','Bihar','Chhattisgarh',
        'Goa','Gujarat','Haryana','Himachal Pradesh','Jharkhand','Karnataka',
        'Kerala','Madhya Pradesh','Maharashtra','Manipur','Meghalaya','Mizoram',
        'Nagaland','Odisha','Punjab','Rajasthan','Sikkim','Tamil Nadu','Telangana',
        'Tripura','Uttar Pradesh','Uttarakhand','West Bengal','Delhi','Chandigarh',
        'Jammu and Kashmir','Ladakh','Puducherry'
      )
    )
    SELECT state,
      COUNT(*) AS total,
      SUM(CASE WHEN COALESCE(followers,0)<100 AND COALESCE(num_doctors,0)>50 AND equipment_count>20 THEN 1 ELSE 0 END) AS hidden_gems,
      SUM(CASE WHEN is_stale THEN 1 ELSE 0 END) AS ghosts,
      ROUND(AVG(COALESCE(num_doctors,0)),1) AS avg_doctors
    FROM cleaned
    GROUP BY state ORDER BY total DESC
  `);
}

// ── MAP DATA (lat/lng + trust) ────────────────────────────────────────────────
async function getMapData() {
  return query(`
    WITH cleaned AS (
      SELECT
        id,
        ${CLEAN.name} AS name,
        ${CLEAN.type} AS facility_type,
        ${CLEAN.city} AS city,
        ${CLEAN.state} AS state,
        TRY_CAST(latitude AS DOUBLE) AS lat,
        TRY_CAST(longitude AS DOUBLE) AS lng,
        ${CLEAN.doctors} AS num_doctors,
        ${CLEAN.followers} AS followers,
        ${FLAGS},
        (recency_of_page_update<'2023-01-01'
         AND COALESCE(TRY_CAST(post_metrics_post_count AS DOUBLE),0)=0) AS is_stale
      FROM ${FAC}
    )
    SELECT
      id, name, facility_type, city, state, lat, lng,
      ${PINOCCHIO_SCORE} AS pinocchio_score,
      CASE
        WHEN (${PINOCCHIO_SCORE}) <= 10 THEN 'High Trust'
        WHEN (${PINOCCHIO_SCORE}) <= 30 THEN 'Moderate Trust'
        WHEN (${PINOCCHIO_SCORE}) <= 60 THEN 'Low Trust'
        ELSE 'Unreliable'
      END AS trust_band,
      CASE
        WHEN COALESCE(followers,0)>500 AND specialty_count>20 AND COALESCE(num_doctors,0)<5 THEN 'Confident Claimer'
        WHEN COALESCE(followers,0)<100 AND COALESCE(num_doctors,0)>50 AND equipment_count>20 THEN 'Hidden Gem'
        WHEN is_stale THEN 'Ghost Facility'
        ELSE 'Verified Pillar'
      END AS archetype
    FROM cleaned
    WHERE lat IS NOT NULL AND lng IS NOT NULL
      AND lat BETWEEN 6 AND 38 AND lng BETWEEN 68 AND 98
  `);
}

module.exports = {
  getKpiSummary, getArchetypeCounts, getTrustDistribution,
  getSpecialtyDistribution, getFacilities, getFacilityDetail,
  getStates, getHiddenGems, getAnomalies, findReferrals, getStateSummary,
  getMapData,
};
