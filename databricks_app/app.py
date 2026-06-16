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
    conn = get_conn()
    cursor = conn.cursor()
    try:
        cursor.execute(sql_str)
        cols = [d[0] for d in cursor.description]
        return [dict(zip(cols, row)) for row in cursor.fetchall()]
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
        COALESCE(SIZE(FROM_JSON(specialties,'array<string>')),0) AS specialty_count,
        COALESCE(SIZE(FROM_JSON(equipment,'array<string>')),0)   AS equipment_count,
        {IS_STALE} AS is_stale
      FROM {FAC}
    )
    SELECT
      {ARCHETYPE} AS archetype,
      COUNT(*) AS count
    FROM cleaned
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
        SUBSTRING(COALESCE(description,''), 1, 500) AS description_snippet,
        SUBSTRING(COALESCE(capability,''), 1, 500) AS capability_snippet,
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
           WHEN COALESCE(followers,0)<100 AND COALESCE(num_doctors_clean,0)>50 AND equipment_count>20 THEN 'Hidden Gem'
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
        COALESCE(SIZE(FROM_JSON(specialties,'array<string>')),0) AS specialty_count,
        COALESCE(SIZE(FROM_JSON(equipment,'array<string>')),0)   AS equipment_count,
        {IS_STALE} AS is_stale
      FROM {FAC}
      WHERE {CLEAN_STATE} IN ({states_list})
    )
    SELECT state,
      COUNT(*) AS total,
      SUM(CASE WHEN COALESCE(followers,0)<100 AND COALESCE(num_doctors,0)>50 AND equipment_count>20 THEN 1 ELSE 0 END) AS hidden_gems,
      SUM(CASE WHEN is_stale THEN 1 ELSE 0 END) AS ghosts,
      ROUND(AVG(COALESCE(num_doctors,0)),1) AS avg_doctors
    FROM cleaned
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

        body = request.get_json(force=True)
        question = body.get("question", "")
        facility_context = body.get("facilityContext")

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

        # Call Databricks Foundation Model API
        resp = http_requests.post(
            f"https://{AI_HOST}/serving-endpoints/{AI_MODEL}/invocations",
            headers={
                "Authorization": f"Bearer {AI_TOKEN}",
                "Content-Type": "application/json",
            },
            json={
                "messages": [
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": user_msg},
                ],
                "max_tokens": 1024,
                "temperature": 0.3,
            },
            timeout=30,
        )
        resp.raise_for_status()
        result = resp.json()
        answer = result.get("choices", [{}])[0].get("message", {}).get("content", "No response.")
        model = result.get("model", AI_MODEL)

        return _ok({
            "answer": answer,
            "model": model,
            "tokens": result.get("usage", {}),
        })
    except Exception as e:
        return _err(e)


# SPA fallback — serve index.html for all non-API routes
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
