# 🕉️ Bhagavad Gita AI Navigator

An intelligent, domain-specific Retrieval-Augmented Generation (RAG) research assistant built to navigate, search, and synthesize insights across **128 complete podcast episodes** of Swami Anish Chaitanya's Bhagavad Gita series.

[![Streamlit App](https://static.streamlit.io/badges/streamlit_badge_black_white.svg)](https://bhagvadgitaqna.streamlit.app/)
---

## 📌 Overview

Exploring long-form philosophical audio discourses can be challenging when searching for specific verses, Sanskrit terminology, or conceptual breakdowns. 

**Bhagavad Gita AI Navigator** solves this by combining high-speed full-text search indexing with Google's Gemini LLM function calling. It allows users to ask open-ended conceptual or verse-specific questions in natural language and receive grounded, synthesized answers backed by clickable, timestamped YouTube citations.

---

## ✨ Key Features

* **Sub-Second Transcript Retrieval:** Uses SQLite FTS5 (Full-Text Search) to query across 50,000+ lines of dialogue in milliseconds without heavy in-memory compute overhead.
* **Grounded LLM Synthesis:** Integrates Google Gemini 2.5 (`gemini-flash-lite-latest`) via tool/function calling to prevent hallucinations and strictly ground answers in the source transcripts.
* **Direct Video Deep-Linking:** Automatically generates verifiable source citations linked to the exact minute and second of each YouTube episode.
* **Interactive UI:** Built with Streamlit, featuring quick-start topic exploration chips, corpus metadata metrics, and dynamic chat history management.
* **Zero-Cold-Start Startup:** Lightweight database architecture ensures instant application launch and minimal resource consumption.

---

## 🏗️ Architecture

```text
User Question
      │
      ▼
Streamlit Interface (app.py)
      │
      ▼
Google Gemini LLM Agent ──(Function Call)──► SQLite FTS5 Database (gita_search.db)
      │                                                │
      │◄────────── Top Relevant Segments ──────────────┘
      │
      ▼
Synthesized Answer + Timestamped YouTube Citations
