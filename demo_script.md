# 🎬 ArogyaSetu AI — Team Demo Script (3 Minutes)

> **Tone:** Conversational. Like you're explaining it to a friend, not reading a teleprompter.  
> **Rule:** Each person speaks for ~45 seconds. No one reads — just hit the key points naturally.

---

## 🎙️ DRUMIL JOSHI — The Story + AI Agent (0:00 – 0:50)

**[Screen: App loading, dashboard visible]**

> *"Hey everyone, I'm Drumil. So — quick personal story. During COVID, a family member of mine in a small town in Gujarat got severe pneumonia. We found a hospital online — it said ICU, pulmonology, 24/7 emergency. When we got there... no doctor for that. No ventilator. Nothing. Just a name on Google."*

**[Pause — let it land]**

> *"That moment stuck with me. Because this isn't just our story — this is the reality for 1.5 billion people in India. You search for a hospital, you trust what's listed, and sometimes that trust can cost you everything."*

> *"So we built ArogyaSetu AI. It doesn't just list hospitals — it verifies if they can actually do what they claim. Let me hand it off to Andrew to explain the big picture."*

---

## 🎙️ ANDREW RILEY — The Vision + Business Case (0:50 – 1:25)

**[Screen: Dashboard KPIs visible]**

> *"Thanks Drumil. I'm Andrew. So here's the scale of the problem — we analyzed over 10,000 healthcare facilities across India using the Virtue Foundation dataset on Databricks."*

> *"What we found is alarming. 847 facilities claim 24/7 emergency but have fewer than 3 doctors. 168 claim ICU with less than 2 doctors on record. These aren't edge cases — these are the hospitals in referral networks that real people get sent to."*

> *"Everything you see here is a live SQL query against Databricks SQL Warehouse through Unity Catalog. No mock data, no cache. Ishtiza, walk us through how we made the data trustworthy."*

---

## 🎙️ ISHTIZA AZAD — Data Pipeline + Uncertainty (1:25 – 2:05)

**[Screen: Click a facility → Deep Dive loads. Scroll to Data Confidence panel]**

> *"I'm Ishtiza. So the raw data is messy — really messy. We found facility type fields containing latitude coordinates and MD5 hashes instead of actual types. Specialty lists cut off at exactly 50 because of a scraping bug. We had to clean all of that."*

> *"But here's what we're most proud of — we're honest about what we don't know. This panel right here shows field-by-field coverage. Only 36.4% of facilities even report their doctor count. Only 25% report bed capacity."*

**[Point to the amber uncertainty warning]**

> *"When data is missing, we don't hide it — we show this warning. 'Claims involving staffing cannot be fully verified.' Because presenting weak evidence as fact is exactly how my teammate Drumil's family ended up at the wrong hospital. Terhemba, show them the evidence."*

---

## 🎙️ TERHEMBA — Visualizations + Evidence (2:05 – 2:40)

**[Screen: Scroll to Pinocchio Score Breakdown → then Evidence Triangulation]**

> *"I'm Terhemba. So this is the Pinocchio Score — it's our overclaiming detector. This facility scores 45 out of 100. And right here you can see exactly why — plus 25 because it claims ICU but only has 1 doctor. Plus 15 for claiming 24/7 emergency. Every single point traces back to actual data."*

**[Scroll to Evidence Triangulation — show highlighted text]**

> *"And this is the evidence triangulation. For every claim — ICU, NICU, cardiology — we scan 4 raw text fields. See this yellow highlight? That's the exact word from the description field. And these gray badges? That's us saying 'we looked in the equipment field and found nothing.' Strong evidence, partial evidence, or weak — all cited, all transparent."*

---

## 🎙️ DRUMIL — The AI Agent + Close (2:40 – 3:00)

**[Screen: AI Policy Advisor page — type a mission or click preset]**

> *"One last thing — the AI Policy Advisor. Type a question like 'Find ghost hospitals in Bihar' and our agent runs a 3-step pipeline: SQL query to Unity Catalog, analysis with Llama 3.3 70B through Databricks Foundation Model API, and out comes a structured policy brief with real citations."*

> *"Built 100% on Databricks. Built because no family should have to drive to a hospital that can't help them."*

> *"Thank you."*

---

## 📋 Who Says What — Quick Reference

| Person | Role | Covers | Time |
|--------|------|--------|------|
| **Drumil** | Personal Story + AI Agent | Opening hook, emotional story, AI demo, closing | 0:00–0:50 + 2:40–3:00 |
| **Andrew** | Manager/Director | Big picture, stats (847/168), business case | 0:50–1:25 |
| **Ishtiza** | Operations Data Manager | Data cleaning, uncertainty, coverage panels | 1:25–2:05 |
| **Terhemba** | Data Visualization Engineer | Pinocchio Breakdown, Evidence Triangulation | 2:05–2:40 |

---

## 🎯 Recording Tips

- **Format:** All 4 on screen (Zoom/Teams gallery view) OR one person screen-shares while others narrate
- **Simpler option:** Record screen + one person narrates the whole thing, mention teammates by name
- **Handoffs:** Keep transitions natural — *"Ishtiza, walk us through..."* / *"Terhemba, show them..."*
- **Length:** Aim for 2:50. You have 10 seconds buffer.
- **Don't read** — just hit the bold points. Sound like you're talking to a friend.

## 🔑 Databricks Keywords to Hit Naturally

Each person should mention at least one:
- Drumil: *"Foundation Model API"* + *"Databricks Apps"*
- Andrew: *"SQL Warehouse"* + *"Unity Catalog"*  
- Ishtiza: *"the raw dataset"* + *"data coverage"*
- Terhemba: *"evidence triangulation"* + *"every point traces back to data"*
