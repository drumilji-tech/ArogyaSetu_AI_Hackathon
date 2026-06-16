# 🏆 Virtue Foundation Dataset — Deep Dive Analysis
## DAIS 2026 Hackathon | Databricks Delta Sharing Catalog

---

## 📦 Catalog Metadata

| Property | Value |
|---|---|
| **Catalog** | `databricks_virtue_foundation_dataset_dais_2026` |
| **Type** | Delta Sharing Catalog (`CATALOG_DELTASHARING`) |
| **Provider Share** | `virtuefoundationdataset` |
| **Owner** | `drumiltjoshi@gmail.com` |
| **Schema** | `virtue_foundation_dataset` |
| **Created** | Mon Jun 15 2026, 15:57:57 UTC |
| **Host** | `dbc-c9c363ba-dc41.cloud.databricks.com` |
| **Warehouse** | `/sql/1.0/warehouses/766cdda607384ddc` |

---

## 📊 Tables Overview

| Table | Rows | Columns | Purpose |
|---|---|---|---|
| `facilities` | **10,088** | 51 | Healthcare facility directory across India |
| `india_post_pincode_directory` | **165,627** | 11 | India postal pincode → district/state/geo mapping |
| `nfhs_5_district_health_indicators` | **706** | 109 | NFHS-5 district-level health & demographic indicators |

---

## 🏥 Table 1: `facilities`

**Full path:** `databricks_virtue_foundation_dataset_dais_2026.virtue_foundation_dataset.facilities`

**Purpose:** A rich directory of Indian healthcare facilities (hospitals, clinics, dentists, etc.) with contact info, social media presence, geolocation, specialties, equipment, and capabilities.

### Facility Type Distribution
| Type | Count |
|---|---|
| hospital | 5,637 |
| clinic | 3,782 |
| dentist | 490 |
| doctor | 21 |
| farmacy/pharmacy | 12 |
| nursing_home | 1 |

### State-wise Distribution (Top 10)
| State | Facilities |
|---|---|
| Maharashtra | 1,575 |
| Gujarat | 981 |
| Uttar Pradesh | 919 |
| Tamil Nadu | 780 |
| Karnataka | 529 |
| Kerala | 483 |
| West Bengal | 477 |
| Punjab | 469 |
| Haryana | 462 |
| Telangana | 421 |

### Full Schema (51 columns)

| # | Column | Type | Description |
|---|---|---|---|
| 0 | `unique_id` | STRING | Unique facility identifier (UUID) |
| 1 | `source_types` | STRING | JSON array of data source types (e.g., "overture") |
| 2 | `source_ids` | STRING | JSON array of source-specific IDs |
| 3 | `source_content_id` | STRING | Primary source content ID |
| 4 | `name` | STRING | Facility name |
| 5 | `organization_type` | STRING | Type tag (e.g., "facility") |
| 6 | `content_table_id` | STRING | Internal content reference |
| 7 | `phone_numbers` | STRING | JSON array of all phone numbers |
| 8 | `officialPhone` | STRING | Primary contact phone |
| 9 | `email` | STRING | Contact email |
| 10 | `websites` | STRING | JSON array of website URLs |
| 11 | `officialWebsite` | STRING | Primary website |
| 12 | `yearEstablished` | STRING | Year of establishment |
| 13 | `acceptsVolunteers` | STRING | Volunteer acceptance flag |
| 14 | `facebookLink` | STRING | Facebook page URL |
| 15 | `address_line1` | STRING | Street address line 1 |
| 16 | `address_line2` | STRING | Street address line 2 |
| 17 | `address_line3` | STRING | Street address line 3 |
| 18 | `address_city` | STRING | City |
| 19 | `address_stateOrRegion` | STRING | State / Region |
| 20 | `address_zipOrPostcode` | STRING | Pincode / ZIP |
| 21 | `address_country` | STRING | Country |
| 22 | `address_countryCode` | STRING | ISO country code (IN) |
| 23 | `countries` | STRING | Countries of operation |
| 24 | `facilityTypeId` | STRING | Facility type (hospital/clinic/dentist…) |
| 25 | `operatorTypeId` | STRING | Operator type (public/private) |
| 26 | `affiliationTypeIds` | STRING | Affiliations (NGO, trust, etc.) |
| 27 | `description` | STRING | Freetext facility description |
| 28 | `area` | STRING | Geographic area |
| 29 | `numberDoctors` | STRING | Number of doctors |
| 30 | `capacity` | STRING | Bed/patient capacity |
| 31 | `specialties` | STRING | JSON array of medical specialties |
| 32 | `procedure` | STRING | JSON array of procedures offered |
| 33 | `equipment` | STRING | JSON array of equipment available |
| 34 | `capability` | STRING | JSON array of facility capabilities |
| 35 | `recency_of_page_update` | STRING | How recently info was updated |
| 36 | `distinct_social_media_presence_count` | STRING | Count of unique social media platforms |
| 37 | `affiliated_staff_presence` | STRING | Staff profile data available flag |
| 38 | `custom_logo_presence` | STRING | Has custom logo flag |
| 39 | `number_of_facts_about_the_organization` | STRING | Count of known facts/attributes |
| 40 | `post_metrics_most_recent_social_media_post_date` | STRING | Last social media post date |
| 41 | `post_metrics_post_count` | STRING | Total social media posts |
| 42 | `engagement_metrics_n_followers` | STRING | Social follower count |
| 43 | `engagement_metrics_n_likes` | STRING | Social likes count |
| 44 | `engagement_metrics_n_engagements` | STRING | Social engagements count |
| 45 | `source` | STRING | Data source tag (e.g., "kie") |
| 46 | `coordinates` | STRING | GeoJSON Point `{coordinates:[lon,lat], type:"Point"}` |
| 47 | `latitude` | DOUBLE | Latitude (numeric) |
| 48 | `longitude` | DOUBLE | Longitude (numeric) |
| 49 | `cluster_id` | STRING | H3/geo cluster identifier |
| 50 | `source_urls` | STRING | JSON array of all source URLs |

> [!NOTE]
> `facilityTypeId` has some data quality issues — a small number of rows (< 10) have coordinate values or URL arrays stored in this field instead of a type. These are outlier noise rows.

---

## 📮 Table 2: `india_post_pincode_directory`

**Full path:** `databricks_virtue_foundation_dataset_dais_2026.virtue_foundation_dataset.india_post_pincode_directory`

**Purpose:** Complete India Post directory mapping every post office to its pincode, district, state, and geographic coordinates. **165,627 rows** covering all of India.

### Full Schema (11 columns)

| # | Column | Type | Description |
|---|---|---|---|
| 0 | `circlename` | STRING | Postal circle (e.g., "Telangana Circle") |
| 1 | `regionname` | STRING | Postal region (e.g., "Hyderabad Region") |
| 2 | `divisionname` | STRING | Postal division (e.g., "Adilabad Division") |
| 3 | `officename` | STRING | Post office name |
| 4 | `pincode` | BIGINT | 6-digit postal pincode |
| 5 | `officetype` | STRING | Office type: "BO" (Branch Office), "SO", "HO" |
| 6 | `delivery` | STRING | Delivery status ("Delivery" / "Non-Delivery") |
| 7 | `district` | STRING | District name |
| 8 | `statename` | STRING | State name |
| 9 | `latitude` | STRING | Latitude (string, may contain "NA") |
| 10 | `longitude` | STRING | Longitude (string, may contain "NA") |

### Sample Data
| officename | pincode | district | statename |
|---|---|---|---|
| Kothimir B.O | 504273 | KUMURAM BHEEM ASIFABAD | TELANGANA |
| Papanpet B.O | 504299 | KUMURAM BHEEM ASIFABAD | TELANGANA |

> [!IMPORTANT]
> This is the **JOIN KEY** table. `facilities.address_zipOrPostcode` can be joined to `pincode` to enrich facility data with official district/state info (useful when facility address fields have inconsistencies).

---

## 📈 Table 3: `nfhs_5_district_health_indicators`

**Full path:** `databricks_virtue_foundation_dataset_dais_2026.virtue_foundation_dataset.nfhs_5_district_health_indicators`

**Purpose:** India's **National Family Health Survey 5 (2019–2021)** district-level indicators. **706 districts** × **109 columns** of health, demographic, nutrition, and disease metrics.

### Key Identifier Columns

| Column | Type | Sample Value |
|---|---|---|
| `district_name` | STRING | "Nicobars" |
| `state_ut` | STRING | "Andaman & Nicobar Islands" |
| `households_surveyed` | DOUBLE | 882.0 |
| `women_15_49_interviewed` | DOUBLE | 764.0 |
| `men_15_54_interviewed` | DOUBLE | 125.0 |

### Thematic Column Groups

#### 🏘️ Demographics & Infrastructure (cols 6–17)
- `female_population_age_6_years_and_above_ever_schooled_pct`
- `population_below_age_15_years_pct`
- `sex_ratio_total_f_per_1000_m`
- `hh_electricity_pct`, `hh_improved_water_pct`, `hh_use_improved_sanitation_pct`
- `households_using_clean_fuel_for_cooking_pct`
- `hh_member_covered_health_insurance_pct`

#### 👩‍🎓 Women's Education & Early Marriage (cols 18–22)
- `women_age_15_49_who_are_literate_pct`
- `women_age_15_49_with_10_or_more_years_of_schooling_pct`
- `w20_24_married_before_age_18_years_pct`
- `w15_19_who_were_already_mothers_or_pregnant_at_the_time_of_pct`

#### 💊 Family Planning (cols 23–35)
- `fp_cm_w15_49_any_method_pct`, `fp_cm_w15_49_modern_method_pct`
- Female/male sterilization, IUD, pill, condom, injectable rates
- `fp_unmet_total_cm_w15_49_7_pct` (unmet family planning need)

#### 🤱 Maternal & Antenatal Care (cols 36–53)
- ANC first trimester visits, 4+ ANC visits
- IFA supplement consumption (100 days / 180 days)
- Institutional birth rate, C-section rates (public vs. private)
- PNC (post-natal care) coverage

#### 💉 Child Vaccination (cols 53–65)
- BCG, Polio (3 doses), Penta/DPT, MCV, Rotavirus, Hepatitis B
- Vitamin A supplementation
- Public vs. private vaccination venue

#### 🍼 Child Health & Nutrition (cols 65–82)
- Diarrhoea prevalence, ORS/zinc treatment
- ARI (Acute Respiratory Infection) prevalence
- Breastfeeding within 1 hour, exclusive breastfeeding (u6m)
- Stunting, Wasting, Severe Wasting, Underweight, Overweight in children U5

#### ⚖️ Women's Nutrition & Anaemia (cols 82–90)
- BMI underweight/overweight in women 15–49
- Anaemia in non-pregnant women, pregnant women, all women
- Anaemia in adolescent girls (15–19)

#### 🩸 NCDs — Blood Sugar (cols 90–96)
- High/very high blood sugar in women and men 15+

#### 💓 NCDs — Blood Pressure (cols 96–102)
- Mildly high / moderately-severely high BP in women and men 15+

#### 🔬 Cancer Screening (cols 102–105)
- Cervical, breast, oral cancer screening in women 30–49

#### 🚬 Tobacco & Alcohol (cols 105–108)
- Tobacco use — women and men 15+
- Alcohol consumption — women and men 15+

> [!NOTE]
> Many STRING-typed columns contain values like `"*"` (data suppressed for small samples) or `"(XX.X)"` (values in parentheses indicating unreliable estimates based on 25–49 unweighted cases). Cast carefully when doing numeric analysis.

---

## 🔗 Data Relationships & Join Keys

```
facilities.address_zipOrPostcode
    ↕  JOIN on pincode
india_post_pincode_directory.pincode
    → provides: official district, state, lat/lon

facilities.address_stateOrRegion
    ↕  JOIN on state_ut (fuzzy/normalized)
nfhs_5_district_health_indicators.state_ut + district_name
    → provides: 109 health indicators for the district
```

---

## 🚀 Hackathon Opportunity Angles

### 1. 🗺️ Healthcare Desert Finder
Join `facilities` (where are hospitals?) with `nfhs_5_district_health_indicators` (which districts have poor health outcomes?) to **identify underserved districts** — high disease burden but low facility density.

### 2. 📍 Pincode-to-Health-Score Lookup
Use `india_post_pincode_directory` as a bridge: pincode → district → NFHS health score → nearest facilities.

### 3. 🤖 AI-Powered Facility Recommender
Use `specialties`, `equipment`, `capability` fields + health indicators to recommend the right type of facility based on district-level disease burden.

### 4. 📊 Maternal Health Dashboard
Cross `institutional_birth_5y_pct`, `mothers_who_had_at_least_4_anc_visits_lb5y_pct`, `all_w15_49_who_are_anaemic_pct` with facility proximity — find districts where maternal outcomes are bad AND facilities are sparse.

### 5. 🏋️ NCD (Diabetes/Hypertension) Risk Atlas
Use blood sugar + blood pressure columns mapped to facility availability of relevant specialties to build a risk → resource gap map.

### 6. 🧒 Child Vaccination Coverage Gap
Map districts with low full-vaccination coverage against number of clinics/hospitals nearby.

---

## ⚠️ Data Quality Notes

| Issue | Table | Column | Fix |
|---|---|---|---|
| `*` values (suppressed) | NFHS | Multiple STRING cols | Cast to NULL when numeric |
| `(X.X)` unreliable estimates | NFHS | Multiple STRING cols | Strip parens or flag as unreliable |
| `latitude`/`longitude` = "NA" | Pincode | lat/lon | Filter or use district centroid |
| `facilityTypeId` data corruption | Facilities | `facilityTypeId` | Filter WHERE IN ('hospital','clinic','dentist','doctor','pharmacy') |
| JSON arrays stored as strings | Facilities | specialties, equipment, etc. | Use `from_json()` or `explode()` in Spark |
