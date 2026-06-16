# 🏥 ArogyaSetu AI — Facility Trust Desk

> **Databricks Apps & Agents for Good Hackathon 2026 | DAIS Summit**

## What It Does

ArogyaSetu AI helps **government health planners** and **citizens** make evidence-based decisions about 10,088 Indian healthcare facilities. Instead of blindly trusting facility claims, we **read the raw text**, **cross-reference claims against structural data**, and **show cited evidence** for every trust signal.

## Key Innovation: Evidence Triangulation

Most healthcare dashboards show a number and say *"trust this."* We don't.

- **🤥 Pinocchio Score™** — Overclaiming detection across 7 dimensions
- **🔍 4-Field Text Scanning** — Scans description, capability, procedure, and equipment text
- **🧠 Llama 3.3 70B AI Audit** — Multi-agent pipeline with grounded text citations
- **📊 Uncertainty Communication** — Data coverage percentages show confidence levels

## Tracks Covered

| Track | Feature |
|---|---|
| **Track 1: Facility Trust Desk** | Deep Dive with evidence triangulation, Pinocchio Score, AI Audit |
| **Track 2: Medical Desert Planner** | State-level gap analysis, Hidden Gems discovery |
| **Track 3: Referral Copilot** | Equipment-verified referral search with trust weighting |
| **Track 4: Data Readiness Desk** | Anomaly Lab with dirty types, truncated specialties, suspicious claims |

## For Two Audiences

### 🏛️ Government Officials
- Health Secretary → Identify ghost hospitals claiming ICU without doctors
- District Planner → Find verified referral hospitals with equipment confirmation
- Policy Maker → AI Advisor for cited intelligence briefs

### 👨‍👩‍👧 Citizens & NGOs
- Parents → Verify NICU claims backed by actual equipment data
- NGO Coordinators → Find "Hidden Gems" — high-capacity hospitals ignored by the internet
- Researchers → Export trust reports with full evidence chains

## Tech Stack

- **Frontend**: Vanilla HTML/CSS/JS with Inter + Plus Jakarta Sans typography
- **Backend**: Node.js Express server
- **Database**: Databricks SQL Warehouse via Unity Catalog
- **AI**: Databricks Foundation Model API (Llama 3.3 70B Instruct)
- **Deployment**: Databricks Apps

## Features

- ✅ Guided Demo Tour (auto-starts for judges)
- ✅ Voice Input in 12 Indian languages
- ✅ PDF Export & Clipboard Copy
- ✅ Planner with persistent notes (localStorage)
- ✅ Data Coverage Uncertainty Badges
- ✅ Real-time SQL queries against cleaned dataset

## Live App

🔗 [https://arogyasetu-ai-7474653108428974.aws.databricksapps.com](https://arogyasetu-ai-7474653108428974.aws.databricksapps.com)

## Team

- Drumil Joshi (@drumiltjoshi)

## Run Locally

```bash
cd app
npm install
npx @dotenvx/dotenvx run -- node server.js
# Open http://localhost:3001
```

## License

MIT
