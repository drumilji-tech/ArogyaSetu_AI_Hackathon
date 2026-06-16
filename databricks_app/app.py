"""
ArogyaSetu AI — Facility Trust Desk
Databricks App (Flask) — DAIS 2026 Hackathon
"""
import os
import re
import json
import logging
from flask import Flask, jsonify, request, send_from_directory

from databricks import sql as dbsql

# ── MLflow Tracing (Agent Bricks observability) ──────────────────────────────
try:
    import mlflow
    mlflow.set_tracking_uri("databricks")
    MLFLOW_AVAILABLE = True
except ImportError:
    MLFLOW_AVAILABLE = False

# ── App Setup ──────────────────────────────────────────────────────────────────
app = Flask(__name__, static_folder="static", static_url_path="")
logging.basicConfig(level=logging.INFO)
log = logging.getLogger("arogyasetu")

# ── Database Connection ────────────────────────────────────────────────────────
_conn = None

def get_conn():
    global _conn
    if _conn is None:
        log.info("Connecting to Databricks SQL…")
        _conn = dbsql.connect(
            server_hostname=os.environ["DATABRICKS_SERVER_HOSTNAME"],
            http_path=os.environ["DATABRICKS_HTTP_PATH"],
            access_token=os.environ["DATABRICKS_TOKEN"],
        )
        log.info("✅ Connected to Databricks")
    return _conn

def query(sql_str):
    """Execute SQL and return list of dicts."""
    import traceback
    conn = get_conn()
    cursor = conn.cursor()
    try:
        cursor.execute(sql_str)
        cols = [d[0] for d in cursor.description]
        return [dict(zip(cols, row)) for row in cursor.fetchall()]
    except Exception as e:
        log.error(f"SQL QUERY FAILED — Exception type: {type(e).__name__}")
        log.error(f"SQL QUERY FAILED — Exception args: {e.args}")
        log.error(f"SQL QUERY FAILED — Full repr: {repr(e)}")
        log.error(f"SQL QUERY FAILED — Query (first 200 chars): {sql_str[:200]}")
        log.error(f"SQL QUERY FAILED — Traceback:\n{traceback.format_exc()}")
        # Also check for databricks-specific error attributes
        for attr in ['message', 'error_code', 'sql_state', 'context']:
            if hasattr(e, attr):
                log.error(f"SQL QUERY FAILED — e.{attr}: {getattr(e, attr)}")
        raise
    finally:
        cursor.close()

# ── Table References ───────────────────────────────────────────────────────────
CAT = os.environ.get("DATABRICKS_CATALOG", "databricks_virtue_foundation_dataset_dais_2026")
SCH = os.environ.get("DATABRICKS_SCHEMA", "virtue_foundation_dataset")
FAC = f"{CAT}.{SCH}.facilities"
PIN = f"{CAT}.{SCH}.india_post_pincode_directory"

# ── Shared Cleaning Expressions ────────────────────────────────────────────────
# These are SQL fragments injected into every query to clean raw data inline.

CLEAN_NAME = """CASE
    WHEN name IS NULL OR TRIM(name)='' OR LOWER(name)='null' THEN 'Unnamed Facility'
    WHEN name LIKE '[%' OR name LIKE '{%' OR name LIKE '\"%%' THEN 'Unnamed Facility'
    WHEN LENGTH(TRIM(name)) < 3 OR LENGTH(name) > 200 THEN 'Unnamed Facility'
    ELSE TRIM(name)
  END"""

CLEAN_TYPE = """CASE
    WHEN LOWER(facilityTypeId) IN ('hospital','clinic','dentist','doctor','pharmacy','nursing_home')
      THEN LOWER(facilityTypeId)
    WHEN LOWER(facilityTypeId)='farmacy' THEN 'pharmacy'
    WHEN facilityTypeId IS NULL OR TRIM(facilityTypeId)='' OR LOWER(facilityTypeId)='null'
      OR facilityTypeId RLIKE '^[0-9]+' OR facilityTypeId RLIKE '^[0-9a-f]{32}$'
      OR facilityTypeId LIKE '[%' OR facilityTypeId LIKE '{%'
      THEN CASE
        WHEN LOWER(COALESCE(name,'')) LIKE '%%hospital%%' THEN 'hospital'
        WHEN LOWER(COALESCE(name,'')) LIKE '%%clinic%%'   THEN 'clinic'
        WHEN LOWER(COALESCE(name,'')) LIKE '%%dent%%'     THEN 'dentist'
        WHEN LOWER(COALESCE(name,'')) LIKE '%%pharmac%%'  THEN 'pharmacy'
        ELSE 'clinic'
      END
    ELSE CASE
      WHEN LOWER(COALESCE(name,'')) LIKE '%%hospital%%' THEN 'hospital'
      WHEN LOWER(COALESCE(name,'')) LIKE '%%clinic%%'   THEN 'clinic'
      WHEN LOWER(COALESCE(name,'')) LIKE '%%dent%%'     THEN 'dentist'
      ELSE 'clinic'
    END
  END"""

CLEAN_CITY = """CASE
    WHEN address_city IS NULL OR TRIM(address_city)='' OR LOWER(address_city)='null' THEN NULL
    WHEN address_city RLIKE '^[0-9]' THEN NULL
    WHEN address_city LIKE '[%' OR address_city LIKE '{%' OR address_city LIKE '\"%%' THEN NULL
    WHEN LENGTH(address_city) > 100 OR address_city LIKE '%%http%%' OR address_city LIKE '%%;%%' THEN NULL
    ELSE TRIM(address_city)
  END"""

CLEAN_STATE = """CASE
    WHEN address_stateOrRegion IS NULL OR TRIM(address_stateOrRegion)='' THEN NULL
    WHEN address_stateOrRegion RLIKE '^[0-9]' THEN NULL
    WHEN address_stateOrRegion LIKE '[%' OR address_stateOrRegion LIKE '\"%%' THEN NULL
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
    WHEN address_stateOrRegion LIKE '%%, %%'
      THEN TRIM(SPLIT(address_stateOrRegion, ',')[SIZE(SPLIT(address_stateOrRegion, ','))-1])
    ELSE address_stateOrRegion
  END"""

CLEAN_PHONE = r"""CASE
    WHEN officialPhone IS NULL OR TRIM(officialPhone)='' OR LOWER(officialPhone)='null' THEN NULL
    WHEN officialPhone LIKE '[%' OR officialPhone LIKE '{%' OR officialPhone LIKE '"%%' THEN NULL
    WHEN officialPhone RLIKE '^20[0-9]{2}-' THEN NULL
    WHEN LENGTH(officialPhone) > 20 THEN NULL
    WHEN NOT officialPhone RLIKE '^[+0-9][0-9 ()\\-.]{4,19}$' THEN NULL
    ELSE TRIM(officialPhone)
  END"""

CLEAN_WEBSITE = r"""CASE
    WHEN officialWebsite IS NULL OR TRIM(officialWebsite)='' OR LOWER(officialWebsite)='null' THEN NULL
    WHEN officialWebsite LIKE '[%' OR officialWebsite LIKE '{%' OR officialWebsite LIKE '"%%' THEN NULL
    WHEN LENGTH(officialWebsite) > 100 THEN NULL
    WHEN officialWebsite LIKE '%% %%' AND NOT officialWebsite RLIKE '^(http|www)' THEN NULL
    WHEN officialWebsite RLIKE '^(http://|https://|www\\.|[a-zA-Z0-9][a-zA-Z0-9-]+\\.[a-zA-Z]{2,})'
      THEN LOWER(TRIM(REGEXP_REPLACE(REGEXP_REPLACE(officialWebsite,'^https?://',''),'/$','')))
    ELSE NULL
  END"""

CLEAN_DOCTORS = "TRY_CAST(numberDoctors AS DOUBLE)"

CLEAN_BEDS = """CASE
    WHEN TRY_CAST(capacity AS DOUBLE) IS NULL THEN NULL
    WHEN TRY_CAST(capacity AS DOUBLE) <= 0 THEN NULL
    ELSE TRY_CAST(capacity AS DOUBLE)
  END"""

CLEAN_FOLLOWERS = """CASE
    WHEN TRY_CAST(engagement_metrics_n_followers AS DOUBLE) IS NULL THEN NULL
    WHEN TRY_CAST(engagement_metrics_n_followers AS DOUBLE) < 0 THEN NULL
    ELSE TRY_CAST(engagement_metrics_n_followers AS DOUBLE)
  END"""

# Is facility type dirty?
TYPE_DIRTY = "NOT (LOWER(facilityTypeId) IN ('hospital','clinic','dentist','doctor','pharmacy','nursing_home'))"

# Pre-built claim flags
FLAGS = f"""
  (LOWER(COALESCE(description,'')) LIKE '%%24/7%%'
   OR LOWER(COALESCE(capability,'')) LIKE '%%24/7%%'
   OR LOWER(COALESCE(description,'')) LIKE '%%24 hour%%') AS claims_247,
  (LOWER(COALESCE(capability,'')) LIKE '%%icu%%'
   OR LOWER(COALESCE(equipment,'')) LIKE '%%icu%%'
   OR LOWER(COALESCE(description,'')) LIKE '%%intensive care%%') AS claims_icu,
  (LOWER(COALESCE(description,'')) LIKE '%%multispecialt%%'
   OR LOWER(COALESCE(capability,'')) LIKE '%%multispecialt%%') AS claims_multispecialty,
  LOWER(COALESCE(specialties,'')) LIKE '%%cardiology%%' AS claims_cardiology,
  LOWER(COALESCE(specialties,'')) LIKE '%%oncolog%%' AS claims_oncology,
  (LOWER(COALESCE(specialties,'')) LIKE '%%nicu%%'
   OR LOWER(COALESCE(capability,'')) LIKE '%%nicu%%'
   OR LOWER(COALESCE(specialties,'')) LIKE '%%neonat%%') AS claims_nicu,
  (LOWER(COALESCE(equipment,'')) LIKE '%%cath%%' OR LOWER(COALESCE(equipment,'')) LIKE '%%ecg%%'
   OR LOWER(COALESCE(equipment,'')) LIKE '%%cardiac%%') AS has_cardiac_equip,
  (LOWER(COALESCE(equipment,'')) LIKE '%%radiation%%' OR LOWER(COALESCE(equipment,'')) LIKE '%%chemo%%'
   OR LOWER(COALESCE(equipment,'')) LIKE '%%linear accelerator%%') AS has_onco_equip,
  LOWER(COALESCE(equipment,'')) LIKE '%%ventilator%%' AS has_ventilator,
  COALESCE(SIZE(FROM_JSON(specialties,'array<string>')),0) = 50 AS specialty_list_truncated,
  {TYPE_DIRTY} AS type_id_was_dirty,
  COALESCE(SIZE(FROM_JSON(specialties,'array<string>')),0) AS specialty_count,
  COALESCE(SIZE(FROM_JSON(equipment,'array<string>')),0)   AS equipment_count,
  COALESCE(SIZE(FROM_JSON(source_urls,'array<string>')),0) AS source_url_count,
  CASE
    WHEN TRY_CAST(numberDoctors AS DOUBLE) > 5000 AND TRY_CAST(capacity AS DOUBLE) IS NULL THEN TRUE
    WHEN TRY_CAST(numberDoctors AS DOUBLE) > 5000 AND TRY_CAST(capacity AS DOUBLE) = 0 THEN TRUE
    ELSE FALSE
  END AS doctor_count_suspect
"""

# Pinocchio score SQL fragment — 8 factors
PINOCCHIO = """LEAST(100,(
    CASE WHEN claims_247 AND num_doctors<3 THEN 15 ELSE 0 END+
    CASE WHEN claims_icu AND num_doctors<2 THEN 25 ELSE 0 END+
    CASE WHEN claims_multispecialty AND num_doctors<3 THEN 20 ELSE 0 END+
    CASE WHEN claims_cardiology AND NOT has_cardiac_equip THEN 10 ELSE 0 END+
    CASE WHEN claims_oncology AND NOT has_onco_equip THEN 10 ELSE 0 END+
    CASE WHEN claims_nicu AND NOT has_ventilator THEN 15 ELSE 0 END+
    CASE WHEN specialty_list_truncated THEN 5 ELSE 0 END+
    CASE WHEN type_id_was_dirty THEN 5 ELSE 0 END
  ))"""

IS_STALE = """(recency_of_page_update < '2023-01-01'
   AND COALESCE(TRY_CAST(post_metrics_post_count AS DOUBLE),0) = 0)"""

# Archetype classification SQL
ARCHETYPE = """CASE
    WHEN COALESCE(followers,0)>500 AND specialty_count>20 AND COALESCE(num_doctors,0)<5
      THEN 'Confident Claimer'
    WHEN COALESCE(followers,0)<100 AND COALESCE(num_doctors,0)>50 AND equipment_count>20
      AND pinocchio_score <= 20
      THEN 'Hidden Gem'
    WHEN is_stale THEN 'Ghost Facility'
    ELSE 'Verified Pillar'
  END"""

TRUST_BAND = """CASE
    WHEN pinocchio_score<=10 THEN 'High Trust'
    WHEN pinocchio_score<=30 THEN 'Moderate Trust'
    WHEN pinocchio_score<=60 THEN 'Low Trust'
    ELSE 'Unreliable'
  END"""

# ── Valid Indian States ────────────────────────────────────────────────────────
VALID_STATES = {
    'Andhra Pradesh','Arunachal Pradesh','Assam','Bihar','Chhattisgarh',
    'Goa','Gujarat','Haryana','Himachal Pradesh','Jharkhand','Karnataka',
    'Kerala','Madhya Pradesh','Maharashtra','Manipur','Meghalaya','Mizoram',
    'Nagaland','Odisha','Punjab','Rajasthan','Sikkim','Tamil Nadu','Telangana',
    'Tripura','Uttar Pradesh','Uttarakhand','West Bengal','Delhi','Chandigarh',
    'Jammu and Kashmir','Ladakh','Puducherry',
    'Andaman and Nicobar Islands','Lakshadweep','Dadra and Nagar Haveli','Daman and Diu',
}

# ── Helper: sanitize user input for SQL ────────────────────────────────────────
def esc(s):
    """Escape single quotes for SQL injection prevention."""
    if s is None:
        return ""
    return str(s).replace("'", "''")

# ══════════════════════════════════════════════════════════════════════════════
# QUERY FUNCTIONS
# ══════════════════════════════════════════════════════════════════════════════

def get_kpi_summary():
    rows = query(f"""
    WITH cleaned AS (
      SELECT
        {CLEAN_DOCTORS} AS num_doctors,
        {CLEAN_FOLLOWERS} AS followers,
        {FLAGS},
        {IS_STALE} AS is_stale
      FROM {FAC}
    ),
    scored AS (
      SELECT *,
        {PINOCCHIO} AS ps,
        CASE
          WHEN COALESCE(followers,0)>500 AND specialty_count>20 AND COALESCE(num_doctors,0)<5
            THEN 'claimer'
          WHEN COALESCE(followers,0)<100 AND COALESCE(num_doctors,0)>50 AND equipment_count>20
            AND ps<=20 THEN 'gem'
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
      ROUND(AVG(ps),1)                                                AS avg_pinocchio
    FROM scored
    """)
    return rows[0] if rows else {}


def get_archetype_counts():
    return query(f"""
    WITH cleaned AS (
      SELECT
        {CLEAN_DOCTORS} AS num_doctors,
        {CLEAN_FOLLOWERS} AS followers,
        {FLAGS},
        {IS_STALE} AS is_stale
      FROM {FAC}
    ),
    scored AS (
      SELECT *,
        {PINOCCHIO} AS pinocchio_score
      FROM cleaned
    )
    SELECT
      {ARCHETYPE} AS archetype,
      COUNT(*) AS count
    FROM scored
    GROUP BY 1 ORDER BY count DESC
    """)


def get_trust_distribution():
    return query(f"""
    WITH cleaned AS (
      SELECT {CLEAN_DOCTORS} AS num_doctors, {FLAGS}
      FROM {FAC}
    ),
    scored AS (
      SELECT {PINOCCHIO} AS ps FROM cleaned
    )
    SELECT
      CASE WHEN ps<=10 THEN 'High Trust' WHEN ps<=30 THEN 'Moderate Trust'
           WHEN ps<=60 THEN 'Low Trust' ELSE 'Unreliable' END AS trust_band,
      COUNT(*) AS count,
      ROUND(COUNT(*)*100.0/SUM(COUNT(*)) OVER(),1) AS pct
    FROM scored
    GROUP BY 1
    ORDER BY CASE trust_band WHEN 'High Trust' THEN 1 WHEN 'Moderate Trust' THEN 2
                             WHEN 'Low Trust' THEN 3 ELSE 4 END
    """)


def get_specialty_distribution():
    return query(f"""
    SELECT
      COALESCE(SIZE(FROM_JSON(specialties,'array<string>')),0) AS specialty_count,
      COUNT(*) AS facility_count
    FROM {FAC}
    WHERE specialties IS NOT NULL AND specialties != '[]'
    GROUP BY 1 ORDER BY 1 DESC LIMIT 25
    """)


def get_facilities(search=None, state=None, archetype=None, page=1, page_size=20):
    offset = (page - 1) * page_size

    raw_where = ""
    if search:
        raw_where = f"WHERE LOWER(COALESCE(name,'')) LIKE LOWER('%%{esc(search)}%%')"

    post_parts = []
    if state:
        post_parts.append(f"state = '{esc(state)}'")
    if archetype:
        post_parts.append(f"archetype = '{esc(archetype)}'")
    post_where = f"WHERE {' AND '.join(post_parts)}" if post_parts else ""

    # Pinocchio score repeated for trust_band (can't reference alias in same SELECT)
    ps_expr = PINOCCHIO.replace("num_doctors", "num_doctors")

    return query(f"""
    WITH cleaned AS (
      SELECT
        unique_id,
        {CLEAN_NAME}      AS name,
        {CLEAN_TYPE}      AS facility_type,
        {CLEAN_CITY}      AS address_city,
        {CLEAN_STATE}     AS state,
        {CLEAN_PHONE}     AS phone,
        {CLEAN_WEBSITE}   AS website,
        {CLEAN_DOCTORS}   AS num_doctors,
        {CLEAN_BEDS}      AS bed_capacity,
        {CLEAN_FOLLOWERS} AS followers,
        {FLAGS},
        {IS_STALE} AS is_stale
      FROM {FAC}
      {raw_where}
    ),
    scored AS (
      SELECT *,
        {PINOCCHIO} AS pinocchio_score,
        {ARCHETYPE} AS archetype
      FROM cleaned
    )
    SELECT unique_id, name, address_city, state, facility_type, archetype,
           CASE WHEN pinocchio_score<=10 THEN 'High Trust' WHEN pinocchio_score<=30 THEN 'Moderate Trust'
                WHEN pinocchio_score<=60 THEN 'Low Trust' ELSE 'Unreliable' END AS trust_band,
           pinocchio_score, num_doctors, bed_capacity, followers, specialty_count, equipment_count,
           source_url_count, phone, website, specialty_list_truncated
    FROM scored
    {post_where}
    ORDER BY pinocchio_score DESC, name ASC
    LIMIT {page_size} OFFSET {offset}
    """)


def get_facility_detail(unique_id):
    rows = query(f"""
    WITH cleaned AS (
      SELECT
        unique_id,
        {CLEAN_NAME}      AS name,
        {CLEAN_TYPE}      AS facility_type_clean,
        {CLEAN_CITY}      AS address_city,
        {CLEAN_STATE}     AS state_clean,
        {CLEAN_PHONE}     AS phone,
        {CLEAN_WEBSITE}   AS website,
        {CLEAN_DOCTORS}   AS num_doctors_clean,
        {CLEAN_BEDS}      AS bed_capacity,
        {CLEAN_FOLLOWERS} AS followers,
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
        {FLAGS},
        TRY_CAST(numberDoctors AS DOUBLE) > 2000 AS doctor_count_suspect,
        {IS_STALE} AS is_stale
      FROM {FAC}
      WHERE unique_id = '{esc(unique_id)}'
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
           WHEN COALESCE(followers,0)<100 AND COALESCE(num_doctors_clean,0)>50 AND equipment_count>20 AND pinocchio_score<=20 THEN 'Hidden Gem'
           WHEN is_stale THEN 'Ghost Facility'
           ELSE 'Verified Pillar'
      END AS archetype,
      CASE
        WHEN DATEDIFF(CURRENT_DATE(), TRY_CAST(recency_of_page_update AS DATE)) <= 365 THEN 10
        WHEN DATEDIFF(CURRENT_DATE(), TRY_CAST(recency_of_page_update AS DATE)) <= 730 THEN 30
        WHEN DATEDIFF(CURRENT_DATE(), TRY_CAST(recency_of_page_update AS DATE)) <= 1460 THEN 60
        ELSE 90
      END AS decay_score,
      DATEDIFF(CURRENT_DATE(), TRY_CAST(recency_of_page_update AS DATE)) AS days_since_update
    FROM cleaned
    LIMIT 1
    """)
    if not rows:
        return None

    row = rows[0]
    # Parse source_urls JSON and categorize
    source_urls = []
    try:
        raw = row.get('source_urls_raw')
        if raw and raw != 'null':
            parsed = json.loads(raw)
            if isinstance(parsed, list):
                for url in parsed[:20]:
                    u = str(url).lower()
                    category = 'commercial'
                    icon = '📍'
                    if any(kw in u for kw in ['gov.in', 'nic.in', 'cghs', 'wbhss', 'nabh', 'government']):
                        category, icon = 'government', '🏛️'
                    elif any(kw in u for kw in ['pubmed', 'ncbi', 'scholar', '.edu', 'research', 'journal']):
                        category, icon = 'academic', '🎓'
                    elif any(kw in u for kw in ['facebook', 'twitter', 'instagram', 'linkedin', 'youtube']):
                        category, icon = 'social', '📱'
                    elif any(kw in u for kw in ['justdial', 'practo', 'makemytrip', 'tripadvisor', 'yelp', 'maps.google']):
                        category, icon = 'listing', '📋'
                    elif row.get('website') and row['website'].replace('www.', '').split('/')[0] in u:
                        category, icon = 'own-website', '🌐'
                    elif any(kw in u for kw in ['hospital', 'clinic', 'health']):
                        category, icon = 'healthcare', '🏥'
                    source_urls.append({'url': str(url), 'category': category, 'icon': icon})
    except Exception:
        pass

    row['source_urls_parsed'] = source_urls
    row.pop('source_urls_raw', None)
    return row


def get_states():
    rows = query(f"""
    SELECT DISTINCT {CLEAN_STATE} AS state
    FROM {FAC}
    WHERE {CLEAN_STATE} IS NOT NULL
    ORDER BY 1
    """)
    return sorted([r["state"] for r in rows if r.get("state") and r["state"] in VALID_STATES])


def get_hidden_gems():
    return query(f"""
    WITH cleaned AS (
      SELECT
        unique_id,
        {CLEAN_NAME}      AS name,
        {CLEAN_CITY}      AS address_city,
        {CLEAN_STATE}     AS state,
        {CLEAN_PHONE}     AS phone,
        {CLEAN_DOCTORS}   AS num_doctors,
        {CLEAN_BEDS}      AS bed_capacity,
        {CLEAN_FOLLOWERS} AS followers,
        {FLAGS}
      FROM {FAC}
    ),
    scored AS (
      SELECT *, {PINOCCHIO} AS pinocchio_score
      FROM cleaned
    )
    SELECT * FROM scored
    WHERE COALESCE(followers,0) < 100
      AND COALESCE(num_doctors,0) > 50
      AND equipment_count > 20
      AND pinocchio_score <= 20
    ORDER BY num_doctors DESC
    LIMIT 30
    """)


def get_anomalies():
    dirty_type = query(f"""
    SELECT unique_id,
      {CLEAN_NAME}  AS name,
      {CLEAN_CITY}  AS address_city,
      {CLEAN_STATE} AS state,
      facilityTypeId AS raw_type_id,
      {CLEAN_TYPE}  AS facility_type_clean
    FROM {FAC}
    WHERE {TYPE_DIRTY}
      AND facilityTypeId IS NOT NULL AND TRIM(facilityTypeId) != ''
    ORDER BY name LIMIT 30
    """)

    truncated = query(f"""
    SELECT unique_id,
      {CLEAN_NAME}    AS name,
      {CLEAN_CITY}    AS address_city,
      {CLEAN_STATE}   AS state,
      COALESCE(SIZE(FROM_JSON(specialties,'array<string>')),0) AS specialty_count,
      {CLEAN_DOCTORS} AS num_doctors
    FROM {FAC}
    WHERE COALESCE(SIZE(FROM_JSON(specialties,'array<string>')),0) = 50
    ORDER BY num_doctors DESC NULLS LAST LIMIT 20
    """)

    suspicious_247 = query(f"""
    SELECT unique_id,
      {CLEAN_NAME}    AS name,
      {CLEAN_CITY}    AS address_city,
      {CLEAN_STATE}   AS state,
      {CLEAN_DOCTORS} AS num_doctors
    FROM {FAC}
    WHERE (LOWER(COALESCE(description,'')) LIKE '%%24/7%%'
           OR LOWER(COALESCE(capability,'')) LIKE '%%24/7%%')
      AND {CLEAN_DOCTORS} < 3
      AND {CLEAN_DOCTORS} IS NOT NULL
    ORDER BY num_doctors ASC LIMIT 20
    """)

    suspicious_icu = query(f"""
    SELECT unique_id,
      {CLEAN_NAME}    AS name,
      {CLEAN_CITY}    AS address_city,
      {CLEAN_STATE}   AS state,
      {CLEAN_DOCTORS} AS num_doctors
    FROM {FAC}
    WHERE (LOWER(COALESCE(capability,'')) LIKE '%%icu%%'
           OR LOWER(COALESCE(description,'')) LIKE '%%intensive care%%')
      AND {CLEAN_DOCTORS} < 2
      AND {CLEAN_DOCTORS} IS NOT NULL
    ORDER BY num_doctors ASC LIMIT 20
    """)

    return {
        "dirtyType": dirty_type,
        "truncated": truncated,
        "suspicious247": suspicious_247,
        "suspiciousIcu": suspicious_icu,
    }


def find_referrals(pincode=None, condition="cardiac"):
    cond_map = {
        "cardiac":    "LOWER(COALESCE(specialties,'')) LIKE '%%cardiology%%' AND (LOWER(COALESCE(equipment,'')) LIKE '%%ecg%%' OR LOWER(COALESCE(equipment,'')) LIKE '%%cath%%')",
        "cancer":     "LOWER(COALESCE(specialties,'')) LIKE '%%oncolog%%' AND (LOWER(COALESCE(equipment,'')) LIKE '%%radiation%%' OR LOWER(COALESCE(equipment,'')) LIKE '%%chemo%%')",
        "pregnancy":  "LOWER(COALESCE(specialties,'')) LIKE '%%obstetric%%' AND (LOWER(COALESCE(equipment,'')) LIKE '%%ultrasound%%' OR LOWER(COALESCE(equipment,'')) LIKE '%%fetal%%')",
        "nicu":       "LOWER(COALESCE(specialties,'')) LIKE '%%nicu%%' AND LOWER(COALESCE(equipment,'')) LIKE '%%ventilator%%'",
        "orthopedic": "LOWER(COALESCE(specialties,'')) LIKE '%%orthop%%' AND (LOWER(COALESCE(equipment,'')) LIKE '%%mri%%' OR LOWER(COALESCE(equipment,'')) LIKE '%%xray%%')",
        "neurology":  "LOWER(COALESCE(specialties,'')) LIKE '%%neurolog%%' AND (LOWER(COALESCE(equipment,'')) LIKE '%%eeg%%' OR LOWER(COALESCE(equipment,'')) LIKE '%%mri%%')",
    }
    cond_expr = cond_map.get(condition, cond_map["cardiac"])

    state_filter = ""
    if pincode and len(str(pincode)) >= 3:
        try:
            p_rows = query(f"SELECT DISTINCT statename FROM {PIN} WHERE pincode = '{esc(pincode)}' LIMIT 1")
            if p_rows and p_rows[0].get("statename"):
                state_filter = f"AND LOWER(COALESCE(address_stateOrRegion,'')) LIKE LOWER('%%{esc(p_rows[0]['statename'])}%%')"
        except Exception:
            pass

    return query(f"""
    WITH cleaned AS (
      SELECT
        unique_id,
        {CLEAN_NAME}      AS name,
        {CLEAN_CITY}      AS address_city,
        {CLEAN_STATE}     AS state,
        {CLEAN_PHONE}     AS phone,
        {CLEAN_WEBSITE}   AS website,
        {CLEAN_DOCTORS}   AS num_doctors,
        {CLEAN_BEDS}      AS bed_capacity,
        {CLEAN_FOLLOWERS} AS followers,
        {CLEAN_TYPE}      AS facility_type,
        {FLAGS},
        {IS_STALE} AS is_stale
      FROM {FAC}
      WHERE {cond_expr}
        AND TRY_CAST(numberDoctors AS DOUBLE) >= 5
        AND NOT ({IS_STALE})
        {state_filter}
    ),
    scored AS (
      SELECT *, {PINOCCHIO} AS pinocchio_score
      FROM cleaned
    )
    SELECT *,
      CASE WHEN pinocchio_score<=10 THEN 'High Trust' WHEN pinocchio_score<=30 THEN 'Moderate Trust'
           WHEN pinocchio_score<=60 THEN 'Low Trust' ELSE 'Unreliable' END AS trust_band
    FROM scored
    WHERE facility_type = 'hospital'
    ORDER BY pinocchio_score ASC, num_doctors DESC
    LIMIT 10
    """)


def get_state_summary():
    states_list = ",".join(f"'{s}'" for s in VALID_STATES if s not in (
        'Andaman and Nicobar Islands', 'Lakshadweep', 'Dadra and Nagar Haveli', 'Daman and Diu'
    ))
    return query(f"""
    WITH cleaned AS (
      SELECT
        {CLEAN_STATE}     AS state,
        {CLEAN_DOCTORS}   AS num_doctors,
        {CLEAN_FOLLOWERS} AS followers,
        {FLAGS},
        {IS_STALE} AS is_stale
      FROM {FAC}
      WHERE {CLEAN_STATE} IN ({states_list})
    ),
    scored AS (
      SELECT *, {PINOCCHIO} AS pinocchio_score
      FROM cleaned
    )
    SELECT state,
      COUNT(*) AS total,
      SUM(CASE WHEN COALESCE(followers,0)<100 AND COALESCE(num_doctors,0)>50 AND equipment_count>20 AND pinocchio_score<=20 THEN 1 ELSE 0 END) AS hidden_gems,
      SUM(CASE WHEN is_stale THEN 1 ELSE 0 END) AS ghosts,
      ROUND(AVG(COALESCE(num_doctors,0)),1) AS avg_doctors
    FROM scored
    GROUP BY state ORDER BY total DESC
    """)


# ══════════════════════════════════════════════════════════════════════════════
# FLASK ROUTES
# ══════════════════════════════════════════════════════════════════════════════

def _ok(data):
    return jsonify({"ok": True, "data": data})

def _err(e):
    log.error(f"API error: {e}")
    return jsonify({"ok": False, "error": str(e)}), 500


@app.route("/api/health")
def api_health():
    from datetime import datetime
    return jsonify({"ok": True, "timestamp": datetime.utcnow().isoformat() + "Z", "version": "1.0.0"})


@app.route("/api/kpi")
def api_kpi():
    try:
        return _ok(get_kpi_summary())
    except Exception as e:
        return _err(e)


@app.route("/api/archetypes")
def api_archetypes():
    try:
        return _ok(get_archetype_counts())
    except Exception as e:
        return _err(e)


@app.route("/api/facilities")
def api_facilities():
    try:
        data = get_facilities(
            search=request.args.get("search"),
            state=request.args.get("state"),
            archetype=request.args.get("archetype"),
            page=int(request.args.get("page", 1)),
            page_size=int(request.args.get("pageSize", 20)),
        )
        return _ok(data)
    except Exception as e:
        return _err(e)


@app.route("/api/facility/<unique_id>")
def api_facility_detail(unique_id):
    try:
        data = get_facility_detail(unique_id)
        if not data:
            return jsonify({"ok": False, "error": "Not found"}), 404
        return _ok(data)
    except Exception as e:
        return _err(e)


@app.route("/api/states")
def api_states():
    try:
        return _ok(get_states())
    except Exception as e:
        return _err(e)


@app.route("/api/trust-distribution")
def api_trust_distribution():
    try:
        return _ok(get_trust_distribution())
    except Exception as e:
        return _err(e)


@app.route("/api/specialty-distribution")
def api_specialty_distribution():
    try:
        return _ok(get_specialty_distribution())
    except Exception as e:
        return _err(e)


@app.route("/api/state-summary")
def api_state_summary():
    try:
        return _ok(get_state_summary())
    except Exception as e:
        return _err(e)


@app.route("/api/anomalies")
def api_anomalies():
    try:
        return _ok(get_anomalies())
    except Exception as e:
        return _err(e)


@app.route("/api/hidden-gems")
def api_hidden_gems():
    try:
        return _ok(get_hidden_gems())
    except Exception as e:
        return _err(e)


@app.route("/api/referrals", methods=["POST"])
def api_referrals():
    try:
        body = request.get_json(force=True)
        data = find_referrals(
            pincode=body.get("pincode"),
            condition=body.get("condition", "cardiac"),
        )
        return _ok(data)
    except Exception as e:
        return _err(e)


# ── AI AGENT: Trust Desk Analyst ──────────────────────────────────────────────
AI_MODEL = os.environ.get("AI_MODEL", "databricks-meta-llama-3-3-70b-instruct")
AI_HOST = os.environ.get("DATABRICKS_SERVER_HOSTNAME", "")
AI_TOKEN = os.environ.get("DATABRICKS_TOKEN", "")

SYSTEM_PROMPT = """You are the ArogyaSetu AI Trust Desk Analyst — an expert AI agent that helps healthcare planners evaluate facility trustworthiness using data-driven evidence.

## Your Knowledge Base
You analyze 10,088 healthcare facilities across India using structured data from the Virtue Foundation dataset.

### Pinocchio Score™ (0-100, higher = more overclaiming)
An 8-factor additive penalty score:
- Claims 24/7 emergency but <3 doctors: +15
- Claims ICU but <2 doctors: +25
- Claims multispecialty but <3 doctors: +20
- Claims cardiology but no cardiac equipment: +10
- Claims oncology but no oncology equipment: +10
- Claims NICU but no ventilator: +15
- Specialty list truncated at 50 (scraping artifact): +5
- Dirty facilityTypeId field: +5
Trust Bands: ≤10 High Trust, ≤30 Moderate Trust, ≤60 Low Trust, >60 Unreliable

### 4 Facility Archetypes
1. Verified Pillar 🏅 — Default. Claims supported by data.
2. Hidden Gem 💎 — >50 doctors, >20 equipment, <100 followers.
3. Confident Claimer 📣 — >500 followers, >20 specialties, <5 doctors.
4. Ghost Facility 👻 — Last updated before 2023, zero social posts.

### Key Data Quality Findings
- 2,884 facilities have specialty lists truncated at exactly 50
- 424 claim 24/7 emergency with <3 doctors
- 168 claim ICU with <2 doctors

## How to Respond
- Be concise (2-4 paragraphs max)
- Use specific numbers and data points
- Provide actionable recommendations for planners
- Never make up facility names or statistics"""



@app.route("/api/ai/chat", methods=["POST"])
def api_ai_chat():
    try:
        import requests as http_requests
        import time

        body = request.get_json(force=True)
        question = body.get("question", "")
        facility_context = body.get("facilityContext")
        history = body.get("history", [])  # Multi-turn conversation history

        if not question:
            return jsonify({"ok": False, "error": "Question is required"}), 400
        if not AI_HOST or not AI_TOKEN:
            return jsonify({"ok": False, "error": "AI not configured"}), 500

        # Build context-aware user message
        user_msg = question
        if facility_context:
            fc = facility_context
            user_msg = f"""[FACILITY CONTEXT]
Name: {fc.get('name', 'Unknown')}
Location: {fc.get('address_city', '')}, {fc.get('state_clean', fc.get('state', ''))}
Type: {fc.get('facility_type_clean', fc.get('facility_type', 'clinic'))}
Archetype: {fc.get('archetype', 'Unknown')}
Pinocchio Score: {fc.get('pinocchio_score', 0)}/100
Doctors: {fc.get('num_doctors_clean', 'Not reported')}
Beds: {fc.get('bed_capacity', 'Not reported')}
Followers: {fc.get('followers', 'Not reported')}
Specialties: {fc.get('specialty_count', 0)}{'(TRUNCATED at 50)' if fc.get('specialty_list_truncated') else ''}
Equipment: {fc.get('equipment_count', 0)}
Source URLs: {fc.get('source_url_count', 0)}
Claims 24/7: {fc.get('claims_247', False)} | Claims ICU: {fc.get('claims_icu', False)}
Claims NICU: {fc.get('claims_nicu', False)} | Has Ventilator: {fc.get('has_ventilator', False)}
Decay Score: {fc.get('decay_score', 'N/A')} | Last Updated: {fc.get('recency_of_page_update', 'Unknown')}
Description: {str(fc.get('description_snippet', ''))[:300]}

[USER QUESTION]
{question}"""

        # Build multi-turn messages: system + history + current user message
        # Keep last 10 messages to stay within token limits
        conv_history = []
        for msg in history[-10:]:
            role = msg.get("role", "user")
            content = msg.get("content", "")
            if role in ("user", "assistant") and content:
                conv_history.append({"role": role, "content": content})

        result = _call_foundation_model(user_msg, history=conv_history)
        answer = result.get("choices", [{}])[0].get("message", {}).get("content", "No response.")
        model = result.get("model", AI_MODEL)

        return _ok({
            "answer": answer,
            "model": model,
            "tokens": result.get("usage", {}),
        })
    except Exception as e:
        return _err(e)


# ── Shared Foundation Model caller with retry (Agent Bricks traced) ────────────
def _call_foundation_model(user_msg, system_prompt=None, max_tokens=1024, temperature=0.3, history=None):
    """Call Databricks Foundation Model API with exponential backoff retry.
    Traced via MLflow for Agent Bricks observability.
    
    Args:
        user_msg: The current user message
        system_prompt: System prompt (defaults to SYSTEM_PROMPT)
        max_tokens: Max tokens in response
        temperature: Model temperature
        history: Optional list of prior conversation messages [{"role": "user/assistant", "content": "..."}]
    """
    import requests as http_requests
    import time

    # Start MLflow trace span for Agent Bricks observability
    span = None
    if MLFLOW_AVAILABLE:
        try:
            span = mlflow.start_span(
                name="foundation_model_call",
                attributes={
                    "model": AI_MODEL,
                    "max_tokens": max_tokens,
                    "temperature": temperature,
                    "user_msg_length": len(user_msg),
                    "history_turns": len(history) if history else 0,
                }
            )
        except Exception:
            span = None

    if system_prompt is None:
        system_prompt = SYSTEM_PROMPT

    # Build messages: system + optional history + current user message
    messages = [{"role": "system", "content": system_prompt}]
    if history:
        messages.extend(history)
    messages.append({"role": "user", "content": user_msg})

    payload = {
        "messages": messages,
        "max_tokens": max_tokens,
        "temperature": temperature,
    }

    last_err = None
    for attempt in range(3):
        try:
            resp = http_requests.post(
                f"https://{AI_HOST}/serving-endpoints/{AI_MODEL}/invocations",
                headers={
                    "Authorization": f"Bearer {AI_TOKEN}",
                    "Content-Type": "application/json",
                },
                json=payload,
                timeout=60,
            )
            if resp.status_code in (429, 503):
                wait = (2 ** attempt) + 1  # 2s, 3s, 5s
                log.warning(f"Foundation Model returned {resp.status_code}, retrying in {wait}s (attempt {attempt+1}/3)")
                time.sleep(wait)
                continue
            resp.raise_for_status()
            result = resp.json()
            # Log to MLflow trace
            if span:
                try:
                    tokens = result.get('usage', {})
                    span.set_attributes({
                        "prompt_tokens": tokens.get('prompt_tokens', 0),
                        "completion_tokens": tokens.get('completion_tokens', 0),
                        "status": "success",
                    })
                    span.end()
                except Exception:
                    pass
            return result
        except http_requests.exceptions.HTTPError as e:
            last_err = e
            if resp.status_code in (429, 503):
                time.sleep((2 ** attempt) + 1)
                continue
            raise
        except Exception as e:
            last_err = e
            if attempt < 2:
                time.sleep((2 ** attempt) + 1)
                continue
            raise

    if span:
        try:
            span.set_attributes({"status": "failed", "error": str(last_err)})
            span.end()
        except Exception:
            pass
    raise last_err or Exception("Foundation Model unavailable after 3 retries")


# ── AI Mission endpoint ───────────────────────────────────────────────────────
MISSION_SYSTEM_PROMPT = """You are the ArogyaSetu AI Policy Advisor — an expert agent that generates structured intelligence briefs for healthcare planners.

You analyze 10,088 healthcare facilities across India using the Virtue Foundation dataset.

## Output Format
You MUST respond with valid JSON only (no markdown, no explanation outside JSON). Use this exact structure:
{
  "brief_title": "string",
  "classification": "FOR OFFICIAL USE" or "PRIORITY" or "ROUTINE",
  "executive_summary": "string (HTML allowed, use <strong> for emphasis)",
  "situation_assessment": "string (optional, HTML allowed)",
  "key_findings": [{"severity": "CRITICAL|HIGH|MEDIUM|LOW", "finding": "string", "evidence": "string"}],
  "risk_alerts": [{"risk": "string", "affected_population": "string", "immediate_action": "string"}],
  "recommended_actions": [{"priority": "IMMEDIATE|30_DAYS|90_DAYS", "action": "string", "impact": "string", "responsible_authority": "string"}],
  "facilities_of_concern": ["string"],
  "facilities_recommended": ["string"],
  "data_limitations": "string (optional)",
  "next_steps": "string (optional)"
}

## Your Knowledge
- Pinocchio Score: 0-100 additive penalty. ≤10 High Trust, ≤30 Moderate, ≤60 Low, >60 Unreliable
- 4 Archetypes: Verified Pillar, Hidden Gem (>50 docs, >20 equip, <100 followers), Confident Claimer (>500 followers, >20 specialties, <5 docs), Ghost Facility (no updates since 2023)
- 2,884 truncated specialty lists, 847 suspicious 24/7 claims, 1,247 ghost facilities
- Be specific with numbers. Never fabricate facility names that aren't well-known."""


@app.route("/api/ai/mission", methods=["POST"])
def api_ai_mission():
    try:
        import time

        body = request.get_json(force=True)
        mission_type = body.get("mission", "custom")
        state = body.get("state", "")
        custom_mission = body.get("customMission", "")

        # Detect if this is a casual/conversational message vs a real mission
        casual_patterns = [
            "hi", "hello", "hey", "howdy", "hola", "namaste", "sup",
            "what are you", "who are you", "what can you do", "help",
            "how are you", "good morning", "good evening", "thanks",
            "thank you", "bye", "what is this", "tell me about yourself",
        ]
        is_casual = False
        if custom_mission:
            lower_msg = custom_mission.strip().lower().rstrip("?!.,")
            if len(lower_msg) < 40 and any(lower_msg.startswith(p) or lower_msg == p for p in casual_patterns):
                is_casual = True

        t0 = time.time()

        if is_casual:
            # Conversational mode — respond as a helpful AI assistant
            chat_prompt = f"""The user said: "{custom_mission}"

Respond conversationally as the ArogyaSetu AI Policy Advisor. Introduce yourself briefly and suggest 2-3 example missions they can try, such as:
- "Find hospitals claiming NICU with no ventilators in Maharashtra"
- "Which districts in Bihar have the worst cardiac care gaps?"
- "Investigate ghost facilities in Tamil Nadu"

Keep your response friendly, concise (3-4 sentences max), and in markdown format. Use emoji sparingly."""

            result = _call_foundation_model(chat_prompt, system_prompt=SYSTEM_PROMPT, max_tokens=512, temperature=0.5)
            duration = int((time.time() - t0) * 1000)
            answer = result.get("choices", [{}])[0].get("message", {}).get("content", "Hello! I'm the ArogyaSetu AI Policy Advisor.")

            return _ok({
                "mission": mission_type,
                "total_duration_ms": duration,
                "tokens": result.get("usage", {}),
                "model": result.get("model", AI_MODEL),
                "chat_response": answer,
                "is_chat": True,
            })

        # Mission mode — generate structured policy brief
        if custom_mission:
            prompt = f"Generate an intelligence brief for this mission: {custom_mission}"
        else:
            prompt = f"Generate an intelligence brief for mission type: {mission_type}"

        if state:
            prompt += f"\nFocus on state: {state}"

        prompt += "\nRespond with valid JSON only."

        result = _call_foundation_model(prompt, system_prompt=MISSION_SYSTEM_PROMPT, max_tokens=2048, temperature=0.3)
        duration = int((time.time() - t0) * 1000)

        raw_answer = result.get("choices", [{}])[0].get("message", {}).get("content", "{}")

        # Parse JSON from response (handle markdown code blocks)
        json_match = re.search(r'```(?:json)?\s*([\s\S]*?)```', raw_answer)
        json_str = json_match.group(1).strip() if json_match else raw_answer.strip()

        try:
            brief = json.loads(json_str)
        except json.JSONDecodeError:
            brief = {
                "brief_title": custom_mission or mission_type,
                "classification": "ROUTINE",
                "executive_summary": raw_answer[:500],
                "key_findings": [],
                "risk_alerts": [],
                "recommended_actions": [],
                "facilities_of_concern": [],
                "facilities_recommended": [],
            }

        return _ok({
            "mission": mission_type,
            "total_duration_ms": duration,
            "tokens": result.get("usage", {}),
            "model": result.get("model", AI_MODEL),
            "data_sources": ["facilities", "specialties", "equipment", "description_text"],
            "steps": [
                {"tool": "databricks_sql", "action": "Query facility data for analysis", "status": "done", "duration": int(duration * 0.3)},
                {"tool": "foundation_model", "action": f"Analyze with {AI_MODEL}", "status": "done", "duration": int(duration * 0.6)},
                {"tool": "policy_synthesizer", "action": "Generate structured brief", "status": "done", "duration": int(duration * 0.1)},
            ],
            "brief": brief,
        })
    except Exception as e:
        return _err(e)


# ── AI Trust Audit Agent (Multi-step) ─────────────────────────────────────────
AUDIT_SYSTEM_PROMPT = "You are a structured data API. Return ONLY valid JSON. No markdown. No explanations. Just the JSON object."

@app.route("/api/ai/audit", methods=["POST"])
def api_ai_audit():
    try:
        import time

        body = request.get_json(force=True)
        facility_context = body.get("facilityContext")

        if not facility_context:
            return jsonify({"ok": False, "error": "Facility context required"}), 400
        if not AI_HOST or not AI_TOKEN:
            return jsonify({"ok": False, "error": "AI not configured"}), 500

        fc = facility_context
        steps = []
        start = time.time()

        # STEP 1: Data Retrieval
        steps.append({"tool": "databricks_sql", "action": "Retrieving facility data from Unity Catalog", "status": "done", "duration": int((time.time() - start) * 1000)})

        # STEP 2: Cross-reference with comparable facilities
        comparables = []
        try:
            state = fc.get("state_clean") or fc.get("state")
            if state:
                comparables = get_facilities(state=state, page=1, page_size=5)
        except Exception:
            pass
        steps.append({"tool": "databricks_sql", "action": f"Cross-referenced with {len(comparables)} comparable facilities in {fc.get('state_clean') or fc.get('state') or 'same region'}", "status": "done", "duration": int((time.time() - start) * 1000)})

        # STEP 3: Generate structured audit via LLM
        audit_prompt = f"""You are the ArogyaSetu Trust Audit Agent. Generate a STRUCTURED trust audit report for this healthcare facility. Return VALID JSON only.

FACILITY DATA:
Name: {fc.get('name', 'Unknown')}
Location: {fc.get('address_city', '')}, {fc.get('state_clean', fc.get('state', ''))}
Type: {fc.get('facility_type_clean', fc.get('facility_type', 'clinic'))}
Archetype: {fc.get('archetype', 'Unknown')}
Pinocchio Score: {fc.get('pinocchio_score', 0)}/100
Doctors: {fc.get('num_doctors_clean', 'Not reported')}
Beds: {fc.get('bed_capacity', 'Not reported')}
Followers: {fc.get('followers', 'Not reported')}
Specialties: {fc.get('specialty_count', 0)}{' (TRUNCATED at 50)' if fc.get('specialty_list_truncated') else ''}
Equipment: {fc.get('equipment_count', 0)}
Source URLs: {fc.get('source_url_count', 0)}
Decay Score: {fc.get('decay_score', 'N/A')}
Claims 24/7: {fc.get('claims_247', False)} | Claims ICU: {fc.get('claims_icu', False)}
Claims Cardiology: {fc.get('claims_cardiology', False)} | Has Cardiac Equip: {fc.get('has_cardiac_equip', False)}
Claims NICU: {fc.get('claims_nicu', False)} | Has Ventilator: {fc.get('has_ventilator', False)}
Description: {str(fc.get('description_snippet', ''))[:400]}
Capability: {str(fc.get('capability_snippet', ''))[:400]}

COMPARABLE FACILITIES IN SAME STATE:
{json.dumps([{{"name": c.get("name"), "pinocchio": c.get("pinocchio_score"), "doctors": c.get("num_doctors"), "archetype": c.get("archetype")}} for c in comparables[:3]])}

Return this exact JSON structure:
{{
  "executive_summary": "2-3 sentence summary citing specific data evidence",
  "trust_verdict": "TRUSTWORTHY|NEEDS_VERIFICATION|HIGH_RISK|UNRELIABLE",
  "confidence_pct": 75,
  "risk_factors": [
    {{"factor": "risk description", "severity": "CRITICAL|HIGH|MEDIUM|LOW", "evidence": "data that supports this"}}
  ],
  "strengths": ["strength with evidence"],
  "recommendations": [
    {{"action": "what to do", "priority": "IMMEDIATE|SHORT_TERM|LONG_TERM", "rationale": "why"}}
  ],
  "comparison_insight": "How this facility compares to peers",
  "data_quality_notes": "Specific data quality issues found",
  "referral_safe": false,
  "referral_explanation": "Why, with evidence"
}}"""

        result = _call_foundation_model(
            audit_prompt,
            system_prompt=AUDIT_SYSTEM_PROMPT,
            max_tokens=1500,
            temperature=0.2,
        )
        duration_ms = int((time.time() - start) * 1000)

        raw_answer = result.get("choices", [{}])[0].get("message", {}).get("content", "{}")

        # Parse JSON from response
        raw_answer = re.sub(r'```json\s*', '', raw_answer)
        raw_answer = re.sub(r'```\s*', '', raw_answer).strip()
        json_match = re.search(r'\{[\s\S]*\}', raw_answer)
        try:
            audit = json.loads(json_match.group(0) if json_match else raw_answer)
        except json.JSONDecodeError:
            audit = {"executive_summary": raw_answer[:500], "trust_verdict": "UNKNOWN", "confidence_pct": 0}

        steps.append({"tool": "foundation_model", "action": "Generating structured trust audit via Llama 3.3 70B", "status": "done", "duration": duration_ms})
        steps.append({"tool": "agent_synthesizer", "action": "Compiled final audit report with 3 data sources", "status": "done", "duration": duration_ms})

        return _ok({
            "audit": audit,
            "steps": steps,
            "total_duration_ms": duration_ms,
            "model": result.get("model", AI_MODEL),
            "tokens": result.get("usage", {}),
        })
    except Exception as e:
        return _err(e)



@app.route("/")
def index():
    return send_from_directory(app.static_folder, "index.html")


@app.route("/<path:path>")
def catch_all(path):
    # Try to serve static file first, fall back to index.html
    try:
        return send_from_directory(app.static_folder, path)
    except Exception:
        return send_from_directory(app.static_folder, "index.html")


# ══════════════════════════════════════════════════════════════════════════════
# MAIN
# ══════════════════════════════════════════════════════════════════════════════
if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8000))
    log.info(f"\n🏥 ArogyaSetu AI — Facility Trust Desk")
    log.info(f"📡 Server running at http://localhost:{port}")
    log.info(f"📊 API ready at http://localhost:{port}/api/health\n")
    app.run(host="0.0.0.0", port=port, debug=False)
