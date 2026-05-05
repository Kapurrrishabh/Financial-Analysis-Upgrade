# Fin-Intel

Fin-Intel is a full‑stack AI-driven financial intelligence platform that ingests market data and news, runs multiple machine‑learning analyses, fuses signals, and surfaces actionable stock recommendations and visualizations in a modern dashboard.

---

## Table of Contents
- [Project Overview](#project-overview)
- [Project Architecture](#project-architecture)
- [Data Flow / System Workflow](#data-flow--system-workflow)
- [Machine Learning Models Used](#machine-learning-models-used)
- [Detailed BERT Section](#detailed-bert-section)
- [GRU vs LSTM Justification](#gru-vs-lstm-justification)
- [Core Libraries Used](#core-libraries-used)
- [Backend & API Design](#backend--api-design)
- [Firebase Integration](#firebase-integration)
- [Caching System](#caching-system)
- [Frequently Asked Questions (FAQ)](#frequently-asked-questions-faq)
- [Development & Deployment Notes](#development--deployment-notes)
- [Contributing Tips for New Teammates](#contributing-tips-for-new-teammates)
- [Conclusion](#conclusion)

---

## Project Overview

- **What it does:** Fin-Intel provides fused, AI-driven stock recommendations and explanations by combining technical, sentiment, and fundamental analyses with pattern detection and risk adjustments. The platform exposes a REST API consumed by a Next.js dashboard and supports authenticated user features.
- **Key objectives:**
  - Deliver buy/hold/sell recommendations driven by multiple AI models.
  - Provide transparent, explainable signals (technical indicators, news sentiment, fundamentals, pattern analysis).
  - Optimize latency and cost through caching and sensible orchestration.

## Project Architecture

This project is modular, with clear separation between frontend, backend, ML pipelines, storage, and caching.

- **Frontend**
  - Built with Next.js (App Router) and React + TypeScript.
  - Renders dashboards, comparison pages, authentication workflows, and interactive charts.
  - Connects to backend API and Firebase for authentication/optional Firestore.

- **Backend**
  - FastAPI application (`backend/main.py`) that exposes REST endpoints for market snapshots, ticker analyses, news, pattern detection, and portfolio management.
  - Orchestration layer (`backend/orchestration/complete_pipeline.py`) coordinates parallel model execution and fuses results into a final score and recommendation.

- **ML Pipeline**
  - Technical branch: GRU-based time-series models and engineered indicators.
  - Sentiment branch: BERT/FinBERT models (HuggingFace) for news/article scoring.
  - Fundamental branch: scraped financial features and rule-based/fitted models.

- **Database & Storage**
  - PostgreSQL (or similar) for persistent user and portfolio data.
  - Optional Firestore for realtime user features.
  - Model artifacts and static assets stored under `backend/models/` or `exported_assets/`.

- **Caching**
  - In-process TTL caches used for market snapshots, news, and per-ticker results. For multi-process deployments, Redis is recommended.

- **Technologies**
  - Frontend: Next.js, React, TypeScript
  - Backend: Python, FastAPI, Uvicorn
  - ML: TensorFlow / Keras (GRU), PyTorch + HuggingFace Transformers (BERT/FinBERT)
  - DB: PostgreSQL
  - Auth / Realtime: Firebase (Auth + Firestore)
  - Caching: process-local TTLCache; Redis optional for scale

## Data Flow / System Workflow

High-level arrow-style flow:

User (browser) → Frontend → Backend API → Data Fetching → ML Models → Score Fusion → Recommendation → Dashboard

Step-by-step:
1. User opens a ticker page or dashboard on the frontend.
2. Frontend calls backend endpoints (e.g. `/stock/{ticker}`, `/market`).
3. Backend checks TTL caches; if stale, it fetches fresh price history, news, and fundamentals.
4. Backend dispatches parallel tasks: technical model (GRU), sentiment scoring (BERT), fundamental scoring, and pattern detection.
5. Each model returns normalized signals (scores, classes, predictions).
6. Orchestration fuses signals into a single numeric score, applies risk smoothing, and maps score to `BUY`/`HOLD`/`SELL`.
7. Backend returns a structured payload including explainers and chart data.
8. Frontend renders UI components and interactive charts.

## Machine Learning Models Used

For each model below: definition, how it works, tokenizer (if applicable), input shape, output shape, and approximate parameter count.

### 1) GRU (Gated Recurrent Unit) — Technical / Time-Series

- **Definition:** A recurrent neural network variant that uses gating to control information flow across timesteps.
- **Working:** Processes sliding-window time-series features (prices, returns, engineered indicators). Produces either classification logits (direction) or regression outputs (future return).
- **Tokenizer:** N/A
- **Input shape (example):**
```text
(batch_size, sequence_length, n_features)
e.g. (32, 60, 24)
```
- **Output shape (examples):**
  - Classification: `(batch_size, n_classes)` e.g. `(32, 3)` for buy/hold/sell logits
  - Regression: `(batch_size, 1)` predicted return
- **Approx. params:** depends on config; moderate GRU (2 layers, 128 units) ≈ 150k–400k params. Larger models can reach millions.

### 2) BERT / FinBERT — Sentiment Model

- **Definition:** Transformer-based encoder that produces bidirectional contextual token representations. FinBERT is BERT fine-tuned on financial corpora.
- **Working:** Encodes news text, pools contextualized token embeddings, and passes pooled output to a classification head that returns sentiment logits.
- **Tokenizer:** WordPiece tokenizer (HuggingFace `BertTokenizer` / `AutoTokenizer`) compatible with the BERT vocabulary.
- **Input shape (example):**
```text
input_ids: (batch_size, seq_length)
attention_mask: (batch_size, seq_length)
optional token_type_ids: (batch_size, seq_length)
e.g. (32, 128)
```
- **Output shape:**
  - `logits`: `(batch_size, n_classes)` e.g. `(32, 3)`
- **Approx. params:**
  - BERT-base ≈ 110M parameters (FinBERT ~110M + small head). Distil variants are smaller (~66M).

## Detailed BERT Section

### What is BERT (simple)

BERT (Bidirectional Encoder Representations from Transformers) is a pretrained transformer encoder that reads text bidirectionally to create contextualized token embeddings that work well for downstream NLP tasks (classification, NER, Q&A).

### What is BERT (technical)

- Architecture: stack of transformer encoder layers (self-attention + feed-forward). Each token attends to all tokens in the sequence, enabling bidirectional context.
- Pretraining tasks: Masked Language Modeling (MLM) and (in some variants) Next Sentence Prediction (NSP). Fine-tuning adds a small classification head.

### Tokenizer

- Uses WordPiece tokenization (HuggingFace `BertTokenizer` / `AutoTokenizer`).
- Steps: normalize text → split into subwords → map to vocabulary ids.

### Input format (fields)

- `input_ids` (integers): token ids for each token in the sequence.
- `attention_mask` (0/1): 1 for real tokens, 0 for padding.
- `token_type_ids` (optional): segment ids for sentence A / B separation.

### Input shape used in this project
```text
input_ids: (batch_size, seq_length)
attention_mask: (batch_size, seq_length)
e.g. (32, 128)
```

### Output type
- `last_hidden_state`: `(batch_size, seq_length, hidden_size)`
- `pooler_output` / pooled CLS: `(batch_size, hidden_size)` (used for classification)
- Task head `logits`: `(batch_size, n_classes)` (e.g., 3 sentiment classes)

## GRU vs LSTM Justification

- **Why GRU:**
  - Simpler architecture (fewer gates) → fewer parameters and lower memory footprint.
  - Faster per‑epoch training and often faster inference.
  - Comparable performance on many mid-length time-series tasks encountered in finance when using sliding windows.
- **Comparison (practical):**
  - Complexity: `GRU < LSTM` (fewer gates and matrices).
  - Training speed: `GRU > LSTM` (usually faster to converge per epoch).
  - Performance: often comparable; LSTM can help for very long dependencies but is heavier.
- **Project takeaway:**
  - Use GRU for sliding-window price prediction and classification where inference speed and iteration velocity matter. Keep LSTM for specialized experiments needing more capacity for long dependencies.

## Core Libraries Used

- `numpy` — numerical arrays and fast math.
- `pandas` — tabular data ingestion, transformation, and feature engineering.
- `tensorflow` / `keras` — GRU model implementation and training (project uses Keras models, but PyTorch equivalents exist).
- `torch` + `transformers` — HuggingFace models and tokenizers for BERT/FinBERT.
- `scikit-learn` — preprocessing, metrics, scalers, and baseline models.
- `fastapi` — backend API framework.
- `uvicorn` — ASGI server for running FastAPI.
- `httpx` / `requests` — external API calls and scraping.
- `psycopg2` / `asyncpg` — PostgreSQL adapters.
- `firebase-admin` (backend) / Firebase JS SDK (frontend) — authentication and Firestore access.
- `pydantic` — typed request/response schemas in FastAPI.
- `pandas-ta` / project `utils/indicators.py` — technical indicators.

## Backend & API Design

- **Overview:** FastAPI app orchestrates data fetch, model runs, caching, and response composition.
- **Key endpoints (examples):**
  - `GET /ping` — health check
  - `GET /market` — market snapshot (indices, movers)
  - `GET /news/market` — market-level news
  - `GET /news/{ticker}` — news for a specific ticker
  - `GET /stock/{ticker}` — the primary, fused endpoint returning signals, predictions, and recommendation
  - `POST /pattern-analysis` and `GET /pattern-analysis/{ticker}` — pattern detection
  - `POST /portfolio/*` — CRUD operations for user portfolios (authenticated)
- **Design principles:**
  - Use `pydantic` models for validation and typed responses.
  - Keep endpoints idempotent and cache-friendly where appropriate.
  - Return structured payloads with `metadata`, `signals`, `predictions`, `explainers`, and `cache_ttl`.

## Firebase Integration

- **Role:**
  - Authentication (Firebase Auth) for user sign-in flows (email, OAuth providers).
  - Optional Firestore for persistent user data (watchlists, saved screens, preferences).
- **Frontend connection:**
  - Frontend initializes Firebase with `NEXT_PUBLIC_FIREBASE_*` env vars and uses the client SDK for sign-in.
  - After sign-in, frontend sends ID tokens to backend; backend verifies tokens with Firebase Admin SDK.
- **Security model:**
  - Protected backend routes verify Firebase ID tokens; Firestore rules protect user documents.

## Caching System

- **What is TTLCache:** an in-memory cache storing values with an expiration time (time-to-live).
- **Why use it:**
  - Market data and news change on a schedule — caching avoids redundant external API calls and speeds responses.
  - Reduces cost and rate-limit pressure with 3rd-party APIs.
- **Benefits:**
  - Lower latency for frontend users.
  - Predictable backend load.
  - Ability to tune freshness vs. cost.
- **Notes:**
  - Process-local TTL caches are simple and effective for single-process deployments.
  - For multiple workers / containers, use Redis or Memcached for a shared cache and proper invalidation.

## Frequently Asked Questions (FAQ)

- Q: What is BERT?
  - A: BERT is a bidirectional transformer encoder pretrained on large corpora. It provides contextual representations and is fine-tuned for downstream classification tasks like sentiment.

- Q: What is a tokenizer?
  - A: A tokenizer converts raw text to integer token IDs. BERT uses WordPiece tokenization which handles out-of-vocabulary words by splitting them into known subwords.

- Q: What are BERT's inputs and outputs?
  - A: Inputs: `input_ids`, `attention_mask`, optional `token_type_ids` with shape `(batch_size, seq_length)`. Output: `last_hidden_state` and pooled outputs; downstream head returns `logits` of shape `(batch_size, n_classes)`.

- Q: How does GRU work?
  - A: GRU uses update/reset gates to control flow of information across timesteps. It is a simpler, often faster alternative to LSTM for sequence modeling.

- Q: How does the system produce Buy/Hold/Sell?
  - A: Each branch returns normalized scores. Orchestration fuses scores (weighted average + rule-based adjustments) to a final numeric value. Thresholds map numeric score to discrete recommendation (e.g., `< -0.2 = SELL`, `-0.2..0.2 = HOLD`, `> 0.2 = BUY`). The response includes explainers describing dominant signals.

## Examples & Shapes

- GRU input example:
```python
# NumPy shape example
X.shape  # (batch_size, seq_len, n_features) e.g. (32, 60, 24)
```

- BERT input example (HuggingFace):
```python
{
    "input_ids": torch.LongTensor(batch_size, seq_length),
    "attention_mask": torch.LongTensor(batch_size, seq_length)
}
```

- Orchestration response skeleton:
```json
{
  "ticker": "AAPL",
  "timestamp": "2026-05-05T12:00:00Z",
  "signals": {
    "technical": {"score": 0.15, "explainers": [...]},
    "sentiment": {"score": 0.05, "explainers": [...]},
    "fundamental": {"score": 0.20, "explainers": [...]}
  },
  "final": {"score": 0.13, "recommendation": "BUY", "confidence": 0.78}
}
```

## Development & Deployment Notes

- **Local development**
```bash
# Backend
uvicorn backend.main:app --reload --host 127.0.0.1 --port 8000

# Frontend (from frontend/fin-intel)
cd frontend/fin-intel
npm install
npm run dev
```
- **Environment variables**
  - Backend: `NEWS_API_KEY`, `DATABASE_URL`, any provider credentials.
  - Frontend: `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_FIREBASE_*`.
- **Model artifacts**: store large artifacts under `backend/models/` or an artifact store. Avoid committing large binaries to the repo for production use.

## Contributing Tips for New Teammates

- Start files to read:
  - `backend/main.py` — FastAPI entrypoint and route registration.
  - `backend/orchestration/complete_pipeline.py` — fusion logic and pipeline orchestration.
  - `backend/scraper/news_scraper.py` and `backend/scraper/stock_scraper.py` — data collection.
  - `backend/preprocessing/stock_feature_scraper.py` — feature engineering for technical models.
- Quick local setup:
```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```
- Suggested first issues:
  - Add a minor frontend UI improvement.
  - Add an integration test for a cached endpoint.
  - Add a new technical indicator to `backend/utils/indicators.py`.

## Conclusion

Fin-Intel is a pragmatic, modular platform that blends technical time-series models, modern NLP sentiment analysis, and fundamental signal aggregation into a single, explainable recommendation engine. The architecture favors experimentation and fast iteration while providing production-ready primitives (caching, authentication, typed APIs) for reliable deployments.

---

If you want, I can also commit this README and run quick lint checks or open a PR template for contributors.
