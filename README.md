# 🏥 ArogyaSetu AI — Facility Trust Desk

> **Databricks Apps & Agents for Good Hackathon 2026 | DAIS Summit**

## 🎯 The Problem

India has **10,088+ listed healthcare facilities** — but how many are real? Hospitals claim ICU capabilities with zero doctors. Clinics list 50 specialties with no equipment to back them up. Ghost facilities that haven't updated in years still appear in referral directories. **When a mother searches for the nearest NICU, a wrong referral can cost a life.**

## 💡 Our Solution

ArogyaSetu AI is an **AI-powered healthcare facility trust verification platform** built entirely on the Databricks stack. Instead of blindly trusting facility claims, we **read the raw text**, **cross-reference claims against structural data**, and **show cited evidence** for every trust signal.

### Key Innovation: The Pinocchio Score™

An 8-factor additive penalty score (0-100) measuring how much a facility overclaims:

| Factor | Penalty |
|--------|---------|
| Claims 24/7 emergency but <3 doctors | +15 |
| Claims ICU but <2 doctors | +25 |
| Claims multispecialty but <3 doctors | +20 |
| Claims cardiology but no cardiac equipment | +10 |
| Claims oncology but no oncology equipment | +10 |
| Claims NICU but no ventilator | +15 |
| Specialty list truncated at exactly 50 | +5 |
| Dirty facilityTypeId field | +5 |

**Trust Bands:** ≤10 High Trust · ≤30 Moderate Trust · ≤60 Low Trust · >60 Unreliable

## 🧠 AI Agent Architecture

```
User Query → Databricks SQL (Unity Catalog) → Evidence Retrieval
                    ↓
            Llama 3.3 70B (Foundation Model API)
                    ↓
         Structured Policy Brief with Citations
```

### Three AI Agents:
1. **Trust Desk Chat** — Multi-turn conversational AI with facility context awareness
2. **Trust Audit Agent** — Multi-step pipeline: data retrieval → peer comparison → structured audit report
3. **Policy Advisor Agent** — Autonomous mission execution producing intelligence briefs for health planners

## ✨ Features

| Feature | Description |
|---------|-------------|
| 📊 **Dashboard** | KPI cards, trust distribution donut, archetype breakdown with live SQL |
| 🏥 **Facility Explorer** | Filterable table with search, archetype/state filters, pagination |
| 🔬 **Deep Dive** | Evidence triangulation across 4 text fields with AI trust audit |
| 🗺️ **Interactive Map** | Geo-located facilities with trust-band colored markers |
| 🎯 **AI Policy Advisor** | 4 preset missions + custom natural language queries with dual-mode (chat + briefs) |
| 🔎 **Anomaly Lab** | Dirty data archaeology: truncated lists, suspicious claims, ghost patterns |
| 💎 **Hidden Gems** | Operationally excellent facilities with zero online presence |
| 👶 **Referral Finder** | Equipment-verified referral search with trust weighting |
| 🎤 **Voice Input** | Speech recognition in 6 Indian languages |
| 📋 **Planner** | Bookmark facilities, add notes, export CSV |
| 🎬 **Guided Tour** | 8-step interactive demo aligned to hackathon judging criteria |

## 🛠️ Tech Stack (100% Databricks)

| Component | Technology |
|-----------|------------|
| **Compute** | Databricks SQL Warehouse |
| **Data** | Unity Catalog (Virtue Foundation Dataset) |
| **AI Model** | Databricks Foundation Model API — Llama 3.3 70B Instruct |
| **Backend** | Python Flask (Gunicorn) |
| **Frontend** | Vanilla HTML/CSS/JS (Single Page Application) |
| **Deployment** | Databricks Apps |
| **Auth** | Databricks Personal Access Token |

## 🔗 Live App

**[https://arogyasetu-ai-7474653108428974.aws.databricksapps.com](https://arogyasetu-ai-7474653108428974.aws.databricksapps.com)**

## 📂 Project Structure

```
├── databricks_app/          # Deployed to Databricks Apps
│   ├── app.py               # Flask backend (all API routes + AI agents)
│   ├── app.yaml             # Databricks App config (gitignored — see app.yaml.example)
│   ├── requirements.txt     # Python dependencies
│   └── static/
│       └── index.html       # Full SPA frontend
├── live_queries/             # Evidence generation scripts
│   ├── live_evidence.js      # Runs 12 validation queries against live data
│   └── live_evidence_report.md
├── LICENSE                   # MIT License
└── README.md
```

## 🏃 Run Locally

```bash
# Set environment variables
export DATABRICKS_SERVER_HOSTNAME="your-host.cloud.databricks.com"
export DATABRICKS_HTTP_PATH="/sql/1.0/warehouses/your-warehouse-id"
export DATABRICKS_TOKEN="your-token"
export DATABRICKS_CATALOG="databricks_virtue_foundation_dataset_dais_2026"
export DATABRICKS_SCHEMA="virtue_foundation_dataset"

# Run
cd databricks_app
pip install -r requirements.txt
gunicorn app:app --bind 0.0.0.0:8000
```

## 👤 Team

- **Drumil Joshi** — Solo entry

## 📜 License

MIT — see [LICENSE](./LICENSE)
