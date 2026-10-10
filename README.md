# DataSynth & Query AI

A dark-mode data exploration workbench with a Next.js App Router frontend and a FastAPI data service. Upload CSV, Excel, or JSON files, inspect their shape, ask analytical questions, augment or fill data, and generate an executive summary.

## Project layout

```text
.
├── backend/
│   ├── main.py
│   ├── requirements.txt
│   └── .env.example
├── sample_data.csv
├── sample_data.xlsx
├── sample_data.json
├── frontend/
│   ├── app/
│   │   ├── globals.css
│   │   ├── layout.tsx
│   │   └── page.tsx
│   ├── components/
│   │   ├── dashboard.tsx
│   │   └── insight-chart.tsx
│   ├── lib/
│   │   └── api.ts
│   ├── .env.local.example
│   ├── next.config.mjs
│   ├── package.json
│   ├── postcss.config.mjs
│   ├── tailwind.config.ts
│   └── tsconfig.json
└── README.md
```

## Requirements

- Node.js 18.18+ and npm
- Python 3.10+
- Optional: an OpenAI API key for LLM-backed question parsing and report wording. All analysis continues to work without it using safe, deterministic rules.

## Run locally

### 1. Start the FastAPI backend

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
Copy-Item .env.example .env
# Optionally add OPENAI_API_KEY and OPENAI_MODEL to .env
uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

The interactive API documentation is available at <http://127.0.0.1:8000/docs>.

### 2. Start the Next.js frontend

In another terminal:

```powershell
cd frontend
npm install
Copy-Item .env.local.example .env.local
npm run dev
```

Open <http://localhost:3000>. Set `NEXT_PUBLIC_API_URL` in `frontend/.env.local` if the backend is not at `http://127.0.0.1:8000`.

## Try the sample files

Choose any of the included files in the upload panel to try the application:

- [`sample_data.csv`](./sample_data.csv)
- [`sample_data.xlsx`](./sample_data.xlsx)
- [`sample_data.json`](./sample_data.json)

The samples contain the same small product-sales dataset in three formats. They are examples only: the uploader reads the selected file contents, not a hard-coded sample path, so you can select your own CSV, Excel `.xlsx`, or JSON tabular dataset. CSV files should have a header row; Excel workbooks use their first worksheet; JSON can be an array of records, an object containing a `data` array, or a column-oriented object.

## Features and API

- `POST /api/datasets/upload`: accepts a multipart `file`; returns dataset ID, shape, missing-value counts, inferred types, and a 10-row preview.
- `POST /api/query`: takes `dataset_id` and a natural-language `question`; returns a concise answer, metrics, and chart-ready data. LLM output is constrained to a small set of validated operation fields; query execution never uses `eval` or executes generated Python.
- `POST /api/datasets/augment`: generate rows or fill nulls in selected columns. Numeric columns use fitted normal distributions; categorical columns use observed frequencies. This is statistical augmentation, not a guarantee of privacy or exact preservation of distributions.
- `GET /api/datasets/{dataset_id}/export?format=csv|json`: downloads the current dataset.
- `POST /api/datasets/{dataset_id}/summary`: produces a Markdown report with shape, missingness, notable numeric variation, and recommendations.

The backend keeps uploaded data in process memory. Use a shared persistent store, authentication, tenant isolation, rate limiting, and private networking before deploying multi-worker or multi-user production instances. Configure `MAX_UPLOAD_MB` and `CORS_ORIGINS` in the backend environment for your deployment. Uploads are capped and filenames are not used as server paths. When an OpenAI key is configured, questions and column names are sent to OpenAI for intent parsing; executive-report generation sends aggregate statistics only. Raw dataset rows are not sent to the provider.

## Configuration

Backend settings can be supplied in `backend/.env`:

```dotenv
OPENAI_API_KEY=
OPENAI_MODEL=gpt-4o-mini
MAX_UPLOAD_MB=25
CORS_ORIGINS=http://localhost:3000,http://127.0.0.1:3000
```

Do not expose provider keys in frontend variables. `NEXT_PUBLIC_API_URL` is only the backend URL and is safe to expose.

## Checks

```powershell
# Frontend
cd frontend
npm run lint
npm run build

# Backend
cd ..\backend
python -m compileall main.py
```
