/**
 * ArogyaSetu AI — Deep Clean View Creator v2
 * Every field is validated and sanitized.
 * Garbage → NULL. NULL → context-aware default where possible.
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { DBSQLClient } = require('@databricks/sql');

const HOST  = process.env.DATABRICKS_HOST;
const PATH  = process.env.DATABRICKS_HTTP_PATH;
const TOKEN = process.env.DATABRICKS_TOKEN;
const SRC   = `${process.env.DATABRICKS_CATALOG}.${process.env.DATABRICKS_SCHEMA}.facilities`;
// View is created in the same catalog/schema as the source data (we have CREATE VIEW rights there)
const DEST  = `${process.env.DATABRICKS_CATALOG}.${process.env.DATABRICKS_SCHEMA}`;
const VIEW  = `${DEST}.facility_clean`;

async function run(session, sql, label) {
  console.log(`\n⚙️  ${label}…`);
  const op = await session.executeStatement(sql, { queryTimeout: 180, runAsync: false });
  await op.close();
  console.log(`   ✅ Done`);
}

async function main() {
  console.log('🔌 Connecting to Databricks…');
  const client = new DBSQLClient();
  const conn = await client.connect({ host: HOST, path: PATH, token: TOKEN });
  const session = await conn.openSession();
  console.log('✅ Connected\n');

  await run(session, `DROP VIEW IF EXISTS ${VIEW}`, 'Dropping old view');

  // Note: schema already exists in the hackathon catalog

  const createSQL = `
CREATE OR REPLACE VIEW ${VIEW} AS
WITH raw AS (SELECT * FROM ${SRC}),

-- ══════════════════════════════════════════════════════════════════
-- STEP 1: FIELD-LEVEL SANITIZATION
-- Every field validated. Garbage → NULL. Valid data preserved.
-- ══════════════════════════════════════════════════════════════════
sanitized AS (
  SELECT
    unique_id,

    -- NAME: must look like a real facility name
    CASE
      WHEN name IS NULL OR TRIM(name) = '' OR LOWER(TRIM(name)) = 'null' THEN NULL
      WHEN name LIKE '[%'                THEN NULL  -- JSON array stored as name
      WHEN name LIKE '{%'                THEN NULL  -- JSON object stored as name
      WHEN name LIKE '"%'                THEN NULL  -- quoted garbage
      WHEN LENGTH(TRIM(name)) < 3        THEN NULL  -- too short
      WHEN name RLIKE '^\\s*[a-z ]'      THEN NULL  -- starts lowercase = partial sentence
      WHEN LENGTH(name) > 200            THEN NULL  -- paragraph stored as name
      ELSE TRIM(name)
    END AS name,

    -- FACILITY TYPE: clean & infer
    CASE
      WHEN LOWER(facilityTypeId) IN ('hospital','clinic','dentist','doctor','pharmacy','nursing_home')
        THEN LOWER(facilityTypeId)
      WHEN LOWER(facilityTypeId) = 'farmacy'       THEN 'pharmacy'
      WHEN LOWER(facilityTypeId) = 'nursing home'  THEN 'nursing_home'
      WHEN facilityTypeId RLIKE '^[0-9]+\\.[0-9]+$' OR facilityTypeId RLIKE '^[0-9a-f]{32}$'
        OR facilityTypeId LIKE '[%' OR facilityTypeId LIKE '{%'
        OR facilityTypeId IS NULL OR TRIM(facilityTypeId)='' OR LOWER(facilityTypeId)='null'
        THEN CASE
          WHEN LOWER(COALESCE(name,'')) LIKE '%hospital%'  THEN 'hospital'
          WHEN LOWER(COALESCE(name,'')) LIKE '%clinic%'    THEN 'clinic'
          WHEN LOWER(COALESCE(name,'')) LIKE '%dent%'      THEN 'dentist'
          WHEN LOWER(COALESCE(name,'')) LIKE '%pharmac%'   THEN 'pharmacy'
          WHEN LOWER(COALESCE(name,'')) LIKE '%nursing%'   THEN 'nursing_home'
          ELSE 'clinic'
        END
      ELSE CASE
        WHEN LOWER(COALESCE(name,'')) LIKE '%hospital%'  THEN 'hospital'
        WHEN LOWER(COALESCE(name,'')) LIKE '%clinic%'    THEN 'clinic'
        WHEN LOWER(COALESCE(name,'')) LIKE '%dent%'      THEN 'dentist'
        ELSE 'clinic'
      END
    END AS facility_type_clean,

    CASE WHEN LOWER(facilityTypeId) IN ('hospital','clinic','dentist','doctor','pharmacy','nursing_home')
         THEN FALSE ELSE TRUE END AS type_id_was_dirty,

    -- CITY: must look like a city name (not a number, date, JSON, or paragraph)
    CASE
      WHEN address_city IS NULL OR TRIM(address_city)='' OR LOWER(address_city)='null' THEN NULL
      WHEN address_city RLIKE '^[0-9]'   THEN NULL  -- numeric
      WHEN address_city LIKE '[%'        THEN NULL  -- JSON
      WHEN address_city LIKE '{%'        THEN NULL  -- JSON
      WHEN address_city LIKE '"%'        THEN NULL  -- quoted
      WHEN LENGTH(address_city) > 100    THEN NULL  -- paragraph
      WHEN address_city LIKE '%http%'    THEN NULL  -- URL
      WHEN address_city LIKE '%;%'       THEN NULL  -- multi-value
      ELSE TRIM(address_city)
    END AS address_city,

    -- STATE: only real Indian states/UTs
    CASE
      WHEN address_stateOrRegion IS NULL OR TRIM(address_stateOrRegion)='' THEN NULL
      WHEN address_stateOrRegion RLIKE '^[0-9]'  THEN NULL
      WHEN address_stateOrRegion LIKE '[%'        THEN NULL
      WHEN address_stateOrRegion LIKE '"%'        THEN NULL
      WHEN LENGTH(address_stateOrRegion) > 80     THEN NULL
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
      -- comma-separated "City, State" → take last token
      WHEN address_stateOrRegion LIKE '%, %'
        THEN TRIM(SPLIT(address_stateOrRegion, ',')[SIZE(SPLIT(address_stateOrRegion, ','))-1])
      ELSE address_stateOrRegion
    END AS state_clean,

    -- PHONE: must match a phone pattern (digits, spaces, dashes, +, parens)
    -- Reject: JSON arrays, dates, sentences, specialty lists
    CASE
      WHEN officialPhone IS NULL OR TRIM(officialPhone)='' OR LOWER(officialPhone)='null' THEN NULL
      WHEN officialPhone LIKE '[%'                              THEN NULL  -- JSON array
      WHEN officialPhone LIKE '{%'                              THEN NULL  -- JSON object
      WHEN officialPhone LIKE '"%'                              THEN NULL  -- quoted
      WHEN officialPhone RLIKE '^20[0-9]{2}-'                  THEN NULL  -- date (2024-xx-xx)
      WHEN LENGTH(officialPhone) > 20                           THEN NULL  -- too long for a phone
      WHEN officialPhone LIKE '% %' AND officialPhone NOT RLIKE '^[+0-9]' THEN NULL -- sentence
      WHEN NOT officialPhone RLIKE '^[+0-9 ()\\-.]{5,20}$'     THEN NULL  -- not phone-shaped
      ELSE TRIM(officialPhone)
    END AS phone,

    -- WEBSITE: must look like a real URL or domain
    -- Reject: JSON arrays, sentences, specialty lists, marketing copy
    CASE
      WHEN officialWebsite IS NULL OR TRIM(officialWebsite)='' OR LOWER(officialWebsite)='null' THEN NULL
      WHEN officialWebsite LIKE '[%'      THEN NULL  -- JSON
      WHEN officialWebsite LIKE '{%'      THEN NULL  -- JSON
      WHEN officialWebsite LIKE '"%'      THEN NULL  -- quoted JSON
      WHEN LENGTH(officialWebsite) > 100  THEN NULL  -- paragraph
      WHEN officialWebsite LIKE '% %' AND NOT officialWebsite RLIKE '^(http|www)' THEN NULL -- sentence
      WHEN officialWebsite RLIKE '^(http://|https://|www\\.|[a-zA-Z0-9][a-zA-Z0-9-]+\\.[a-zA-Z]{2,})'
        THEN LOWER(TRIM(REGEXP_REPLACE(REGEXP_REPLACE(officialWebsite,'^https?://',''),'/$','')))
      ELSE NULL
    END AS website,

    -- DESCRIPTION: passthrough (used internally for claim detection only)
    description,
    capability,
    specialties,
    equipment,
    source_urls,

    -- NUMBERS: cap outliers, reject negatives
    -- Doctors: >1000 for a SINGLE facility is virtually impossible; >2000 flagged
    CASE
      WHEN TRY_CAST(numberDoctors AS DOUBLE) < 0     THEN NULL
      WHEN TRY_CAST(numberDoctors AS DOUBLE) > 2000  THEN NULL
      ELSE TRY_CAST(numberDoctors AS DOUBLE)
    END AS num_doctors_clean,
    CASE WHEN TRY_CAST(numberDoctors AS DOUBLE) > 2000 THEN TRUE ELSE FALSE END AS doctor_count_suspect,
    TRY_CAST(numberDoctors AS DOUBLE) AS num_doctors_raw,

    -- Beds: >5000 for a single building is impractical; 200,000 is clearly wrong
    CASE
      WHEN TRY_CAST(capacity AS DOUBLE) < 0    THEN NULL
      WHEN TRY_CAST(capacity AS DOUBLE) > 5000 THEN NULL
      ELSE TRY_CAST(capacity AS DOUBLE)
    END AS bed_capacity,

    -- Followers: >5M for an Indian hospital is a bot/error
    CASE
      WHEN TRY_CAST(engagement_metrics_n_followers AS DOUBLE) < 0        THEN NULL
      WHEN TRY_CAST(engagement_metrics_n_followers AS DOUBLE) > 5000000  THEN NULL
      ELSE TRY_CAST(engagement_metrics_n_followers AS DOUBLE)
    END AS followers,

    TRY_CAST(engagement_metrics_n_engagements AS DOUBLE)     AS engagements,
    TRY_CAST(post_metrics_post_count AS DOUBLE)              AS post_count,
    TRY_CAST(distinct_social_media_presence_count AS DOUBLE) AS social_platforms,

    -- Array sizes (safe: FROM_JSON returns NULL for bad JSON, SIZE(NULL)=0)
    COALESCE(SIZE(FROM_JSON(specialties, 'array<string>')), 0) AS specialty_count,
    COALESCE(SIZE(FROM_JSON(equipment,   'array<string>')), 0) AS equipment_count,
    COALESCE(SIZE(FROM_JSON(source_urls, 'array<string>')), 0) AS source_url_count,

    -- Recency: only pass through if it looks like a date
    CASE
      WHEN recency_of_page_update IS NULL THEN NULL
      WHEN recency_of_page_update RLIKE '^20[0-9]{2}-[0-9]{2}-[0-9]{2}' THEN recency_of_page_update
      ELSE NULL
    END AS recency_of_page_update

  FROM raw
),

-- ══════════════════════════════════════════════════════════════════
-- STEP 2: CLAIM FLAGS (computed on clean data)
-- ══════════════════════════════════════════════════════════════════
flagged AS (
  SELECT *,
    -- 24/7 claim
    (LOWER(COALESCE(description,'')) LIKE '%24/7%'
     OR LOWER(COALESCE(capability,'')) LIKE '%24/7%'
     OR LOWER(COALESCE(description,'')) LIKE '%24 hour%'
     OR LOWER(COALESCE(description,'')) LIKE '%24hrs%') AS claims_247,

    -- ICU claim
    (LOWER(COALESCE(capability,'')) LIKE '%icu%'
     OR LOWER(COALESCE(equipment,''))  LIKE '%icu%'
     OR LOWER(COALESCE(description,'')) LIKE '% icu %'
     OR LOWER(COALESCE(description,'')) LIKE '%intensive care%') AS claims_icu,

    -- Multi-specialty
    (LOWER(COALESCE(description,'')) LIKE '%multispecialt%'
     OR LOWER(COALESCE(capability,'')) LIKE '%multispecialt%'
     OR LOWER(COALESCE(description,'')) LIKE '%multi specialt%') AS claims_multispecialty,

    -- Specialty claims (from cleaned specialties array)
    LOWER(COALESCE(specialties,'')) LIKE '%cardiology%'      AS claims_cardiology,
    LOWER(COALESCE(specialties,'')) LIKE '%oncolog%'         AS claims_oncology,
    LOWER(COALESCE(specialties,'')) LIKE '%nicu%'            AS claims_nicu,

    -- Equipment verification (from cleaned equipment array)
    (LOWER(COALESCE(equipment,'')) LIKE '%cath%'
     OR LOWER(COALESCE(equipment,'')) LIKE '%ecg%'
     OR LOWER(COALESCE(equipment,'')) LIKE '%cardiac%'
     OR LOWER(COALESCE(equipment,'')) LIKE '%defibrillator%') AS has_cardiac_equip,

    (LOWER(COALESCE(equipment,'')) LIKE '%radiation%'
     OR LOWER(COALESCE(equipment,'')) LIKE '%chemotherapy%'
     OR LOWER(COALESCE(equipment,'')) LIKE '%pet scan%'
     OR LOWER(COALESCE(equipment,'')) LIKE '%linear accelerator%') AS has_onco_equip,

    LOWER(COALESCE(equipment,'')) LIKE '%ventilator%' AS has_ventilator,

    -- Specialty truncation (exactly 50 = pipeline cap)
    (COALESCE(SIZE(FROM_JSON(specialties, 'array<string>')), 0) = 50) AS specialty_list_truncated,

    -- Ghost: stale + zero posts
    (recency_of_page_update < '2023-01-01'
     AND COALESCE(TRY_CAST(post_metrics_post_count AS DOUBLE), 0) = 0) AS is_stale

  FROM sanitized
),

-- ══════════════════════════════════════════════════════════════════
-- STEP 3: SCORES & ARCHETYPES
-- ══════════════════════════════════════════════════════════════════
scored AS (
  SELECT *,
    LEAST(100, (
      CASE WHEN claims_247 AND COALESCE(num_doctors_clean, 0) < 3      THEN 15 ELSE 0 END +
      CASE WHEN claims_icu AND COALESCE(num_doctors_clean, 0) < 2      THEN 25 ELSE 0 END +
      CASE WHEN claims_multispecialty AND COALESCE(num_doctors_clean, 0) < 3 THEN 20 ELSE 0 END +
      CASE WHEN claims_cardiology AND NOT has_cardiac_equip             THEN 10 ELSE 0 END +
      CASE WHEN claims_oncology AND NOT has_onco_equip                  THEN 10 ELSE 0 END +
      CASE WHEN specialty_list_truncated                                THEN  5 ELSE 0 END +
      CASE WHEN type_id_was_dirty                                       THEN  5 ELSE 0 END
    )) AS pinocchio_score

  FROM flagged
),

banded AS (
  SELECT *,
    CASE
      WHEN pinocchio_score <= 10  THEN 'High Trust'
      WHEN pinocchio_score <= 30  THEN 'Moderate Trust'
      WHEN pinocchio_score <= 60  THEN 'Low Trust'
      ELSE 'Unreliable'
    END AS trust_band,

    CASE
      WHEN COALESCE(followers, 0) > 500
        AND COALESCE(specialty_count, 0) > 20
        AND COALESCE(num_doctors_clean, 0) < 5          THEN 'Confident Claimer'
      WHEN COALESCE(followers, 0) < 100
        AND COALESCE(num_doctors_clean, 0) > 50
        AND COALESCE(equipment_count, 0) > 20            THEN 'Hidden Gem'
      WHEN is_stale = TRUE                               THEN 'Ghost Facility'
      ELSE 'Verified Pillar'
    END AS archetype

  FROM scored
)

SELECT * FROM banded
`;

  await run(session, createSQL, `Creating deep-clean view: ${VIEW}`);

  // Post-creation verification
  const op = await session.executeStatement(
    `SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN name IS NULL THEN 1 ELSE 0 END) AS null_names,
      SUM(CASE WHEN phone IS NULL THEN 1 ELSE 0 END) AS null_phone,
      SUM(CASE WHEN website IS NULL THEN 1 ELSE 0 END) AS null_website,
      SUM(CASE WHEN archetype IS NULL THEN 1 ELSE 0 END) AS null_archetype,
      SUM(CASE WHEN pinocchio_score IS NULL THEN 1 ELSE 0 END) AS null_score,
      COUNT(DISTINCT state_clean) AS distinct_states,
      ROUND(AVG(pinocchio_score), 1) AS avg_pinocchio
    FROM ${VIEW}`,
    { queryTimeout: 60, runAsync: false }
  );

  const rows = await op.fetchAll();
  await op.close();

  console.log('\n📊 Post-Clean Audit:');
  const r = rows[0];
  console.log(`   Total rows:        ${r.total}`);
  console.log(`   Null names:        ${r.null_names}  (show "Unnamed Facility" in UI)`);
  console.log(`   Null phones:       ${r.null_phone}  (show "No phone listed" in UI)`);
  console.log(`   Null websites:     ${r.null_website}  (hide field in UI)`);
  console.log(`   Null archetypes:   ${r.null_archetype}  (should be 0)`);
  console.log(`   Null scores:       ${r.null_score}  (should be 0)`);
  console.log(`   Distinct states:   ${r.distinct_states}`);
  console.log(`   Avg Pinocchio:     ${(+r.avg_pinocchio).toFixed(1)}`);
  console.log(`\n✅ Deep-clean view created: ${VIEW}`);

  await session.close();
  await conn.close();
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
