from __future__ import annotations

import io
import json
import logging
import os
import re
import secrets
from datetime import date, datetime
from typing import Any, Literal

import httpx
import numpy as np
import pandas as pd
from dotenv import load_dotenv
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

load_dotenv()
MAX_UPLOAD_BYTES = int(os.getenv("MAX_UPLOAD_MB", "25")) * 1024 * 1024
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-4o-mini")
ALLOWED_EXTENSIONS = {".csv", ".xlsx", ".json"}
datasets: dict[str, pd.DataFrame] = {}

app = FastAPI(title="DataSynth & Query AI API", version="1.0.0")
logger = logging.getLogger(__name__)
origins = [
    origin.strip()
    for origin in os.getenv("CORS_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000").split(",")
    if origin.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)


class QueryRequest(BaseModel):
    dataset_id: str
    question: str = Field(min_length=2, max_length=1000)


class AugmentRequest(BaseModel):
    columns: list[str] = Field(min_length=1, max_length=100)
    rows: int = Field(default=0, ge=0, le=10000)
    fill_missing: bool = False


def get_dataset(dataset_id: str) -> pd.DataFrame:
    frame = datasets.get(dataset_id)
    if frame is None:
        raise HTTPException(status_code=404, detail="Dataset not found. Please upload it again.")
    return frame


def json_value(value: Any) -> Any:
    if value is None or value is pd.NA or pd.isna(value):
        return None
    if isinstance(value, (np.integer,)):
        return int(value)
    if isinstance(value, (np.floating,)):
        return float(value) if np.isfinite(value) else None
    if isinstance(value, (np.bool_,)):
        return bool(value)
    if isinstance(value, (pd.Timestamp, datetime, date)):
        return value.isoformat()
    return value.item() if isinstance(value, np.generic) else value


def dataset_metadata(frame: pd.DataFrame) -> dict[str, Any]:
    missing = {str(column): int(count) for column, count in frame.isna().sum().items()}
    return {
        "rows": int(frame.shape[0]),
        "columns": int(frame.shape[1]),
        "missing_values": int(frame.isna().sum().sum()),
        "missing_by_column": missing,
        "column_types": {str(column): str(dtype) for column, dtype in frame.dtypes.items()},
        "preview": [
            {str(key): json_value(value) for key, value in row.items()}
            for row in frame.head(10).to_dict(orient="records")
        ],
        "column_names": [str(column) for column in frame.columns],
    }


def read_upload(filename: str, content: bytes) -> pd.DataFrame:
    extension = os.path.splitext(filename.lower())[1]
    if extension not in ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=415, detail="Upload a CSV, XLSX, or JSON file.")
    try:
        if extension == ".csv":
            frame = pd.read_csv(io.BytesIO(content))
        elif extension == ".xlsx":
            frame = pd.read_excel(io.BytesIO(content), engine="openpyxl")
        else:
            raw = json.loads(content.decode("utf-8-sig"))
            if isinstance(raw, dict) and isinstance(raw.get("data"), list):
                raw = raw["data"]
            if not isinstance(raw, (list, dict)):
                raise ValueError("JSON must contain an array of records or an object with a data array.")
            frame = pd.DataFrame(raw)
    except HTTPException:
        raise
    except (ValueError, UnicodeDecodeError, pd.errors.ParserError, json.JSONDecodeError) as exc:
        raise HTTPException(status_code=400, detail=f"Could not read dataset: {exc}") from exc
    if frame.empty and len(frame.columns) == 0:
        raise HTTPException(status_code=400, detail="The uploaded file has no tabular data.")
    if frame.shape[1] > 500 or frame.shape[0] > 1_000_000:
        raise HTTPException(status_code=413, detail="Dataset exceeds the limit of 500 columns or 1,000,000 rows.")
    frame.columns = [str(column) for column in frame.columns]
    return frame


def resolve_column(frame: pd.DataFrame, mention: str | None) -> str | None:
    if not mention:
        return None
    lowered = mention.casefold().strip()
    exact = next((str(col) for col in frame.columns if str(col).casefold() == lowered), None)
    if exact:
        return exact
    return next((str(col) for col in frame.columns if str(col).casefold() in lowered or lowered in str(col).casefold()), None)


def normalized_name(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", value.casefold()).strip()


def infer_intent(frame: pd.DataFrame, question: str) -> dict[str, Any]:
    lowered = normalized_name(question)
    numeric = [str(column) for column in frame.select_dtypes(include="number").columns]
    date_columns = [
        str(column) for column in frame.columns
        if pd.api.types.is_datetime64_any_dtype(frame[column])
        or any(word in normalized_name(str(column)).split() for word in ("date", "time", "day", "month", "year"))
    ]
    excluded = {"id", "index", "row", "row number"}
    useful_numeric = [
        column for column in numeric
        if normalized_name(column) not in excluded
        and not normalized_name(column).endswith(" id")
    ]

    value = next(
        (column for column in sorted(numeric, key=len, reverse=True) if normalized_name(column) in lowered),
        None,
    )
    asks_sales = any(term in lowered.split() for term in ("sales", "revenue", "turnover"))
    if asks_sales:
        sales_columns = [
            column for column in numeric
            if any(term in normalized_name(column).split() for term in ("sales", "revenue", "turnover"))
        ]
        if sales_columns:
            value = sales_columns[0]
        else:
            quantity = next(
                (column for column in frame.columns if any(term in normalized_name(str(column)).split() for term in ("units", "quantity", "qty"))),
                None,
            )
            price = next(
                (column for column in frame.columns if "price" in normalized_name(str(column)).split()),
                None,
            )
            value = "__sales__" if quantity is not None and price is not None else None
    if value is None and not asks_sales:
        value = next((column for column in useful_numeric if column.casefold() in lowered), None)
    if value is None and not asks_sales:
        value = useful_numeric[0] if useful_numeric else (numeric[0] if numeric else None)

    group = next(
        (
            str(column)
            for column in sorted(frame.columns, key=lambda col: len(normalized_name(str(col))), reverse=True)
            if str(column) != value and any(
                f"{marker} {normalized_name(str(column))}" in lowered
                for marker in ("by", "per", "across")
            )
        ),
        None,
    )
    if group is None and any(word in lowered.split() for word in ("trend", "trends", "over")):
        group = next((column for column in date_columns if column != value), None)

    if any(word in lowered for word in ("outlier", "anomal", "unusual")):
        operation = "outliers"
    elif any(word in lowered.split() for word in ("trend", "trends")) or "over time" in lowered:
        operation = "trend"
    elif any(word in lowered for word in ("distribution", "histogram", "spread")):
        operation = "distribution"
    elif group and any(word in lowered.split() for word in ("by", "per", "across", "compare")):
        operation = "group"
    else:
        operation = "overview"

    aggregation = (
        "sum" if asks_sales or any(word in lowered.split() for word in ("total", "sum"))
        else "count" if "count" in lowered.split()
        else "median" if "median" in lowered.split()
        else "mean"
    )
    return {"operation": operation, "value_column": value, "group_column": group, "aggregation": aggregation}


def resolve_metric(frame: pd.DataFrame, requested: str | None) -> tuple[str | None, pd.Series | None]:
    if requested == "__sales__":
        quantity = next(
            (column for column in frame.columns if any(term in normalized_name(str(column)).split() for term in ("units", "quantity", "qty"))),
            None,
        )
        price = next(
            (column for column in frame.columns if "price" in normalized_name(str(column)).split()),
            None,
        )
        if quantity is not None and price is not None:
            sales = pd.to_numeric(frame[quantity], errors="coerce") * pd.to_numeric(frame[price], errors="coerce")
            return "Sales", sales
        return None, None
    column = resolve_column(frame, requested)
    if column is None or not pd.api.types.is_numeric_dtype(frame[column]):
        return None, None
    return column, pd.to_numeric(frame[column], errors="coerce")


async def llm_intent(question: str, columns: list[str]) -> dict[str, Any] | None:
    if not OPENAI_API_KEY:
        return None
    schema = {
        "type": "object",
        "properties": {
            "operation": {"type": "string", "enum": ["trend", "group", "distribution", "outliers", "overview"]},
            "value_column": {"type": ["string", "null"], "enum": columns + [None]},
            "group_column": {"type": ["string", "null"], "enum": columns + [None]},
            "aggregation": {"type": "string", "enum": ["mean", "sum", "count", "median"]},
        },
        "required": ["operation", "value_column", "group_column", "aggregation"],
        "additionalProperties": False,
    }
    body = {
        "model": OPENAI_MODEL,
        "temperature": 0,
        "messages": [
            {"role": "system", "content": "Map an analytics question to one allowed operation and exact dataset columns. Never return code. Use overview if unclear."},
            {"role": "user", "content": question},
        ],
        "response_format": {"type": "json_schema", "json_schema": {"name": "analytics_intent", "strict": True, "schema": schema}},
    }
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            response = await client.post(
                "https://api.openai.com/v1/chat/completions",
                headers={"Authorization": f"Bearer {OPENAI_API_KEY}"},
                json=body,
            )
            response.raise_for_status()
            content = response.json()["choices"][0]["message"]["content"]
            result = json.loads(content)
            if result.get("operation") not in {"trend", "group", "distribution", "outliers", "overview"}:
                return None
            if result.get("value_column") not in columns + [None] or result.get("group_column") not in columns + [None]:
                return None
            return result
    except (httpx.HTTPError, KeyError, ValueError, TypeError) as exc:
        logger.warning("LLM intent parsing failed; using deterministic query rules: %s", exc)
        return None


async def llm_report(aggregate: dict[str, Any]) -> str | None:
    if not OPENAI_API_KEY:
        return None
    body = {
        "model": OPENAI_MODEL,
        "temperature": 0.2,
        "messages": [
            {
                "role": "system",
                "content": "Write a concise executive data report in Markdown from the supplied aggregate statistics. Highlight only supported trends and anomalies; clearly label recommendations as suggestions. Do not invent facts.",
            },
            {
                "role": "user",
                "content": json.dumps(aggregate, ensure_ascii=False, allow_nan=False),
            },
        ],
    }
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            response = await client.post(
                "https://api.openai.com/v1/chat/completions",
                headers={"Authorization": f"Bearer {OPENAI_API_KEY}"},
                json=body,
            )
            response.raise_for_status()
            content = response.json()["choices"][0]["message"]["content"]
            return content.strip() if isinstance(content, str) and content.strip() else None
    except (httpx.HTTPError, KeyError, ValueError, TypeError) as exc:
        logger.warning("LLM report generation failed; using statistical report: %s", exc)
        return None


def build_chart(data: list[dict[str, Any]], kind: str, x_key: str, y_key: str, label: str) -> dict[str, Any]:
    return {"type": kind, "data": data, "xKey": x_key, "yKey": y_key, "label": label}


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/api/datasets/upload")
async def upload_dataset(file: UploadFile = File(...)) -> dict[str, Any]:
    content = await file.read(MAX_UPLOAD_BYTES + 1)
    if len(content) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail=f"File exceeds the {MAX_UPLOAD_BYTES // (1024 * 1024)} MB upload limit.")
    frame = read_upload(file.filename or "", content)
    dataset_id = secrets.token_urlsafe(18)
    datasets[dataset_id] = frame
    return {"dataset_id": dataset_id, **dataset_metadata(frame)}


@app.post("/api/query")
async def query_dataset(request: QueryRequest) -> dict[str, Any]:
    frame = get_dataset(request.dataset_id)
    intent = infer_intent(frame, request.question)
    if intent["operation"] == "overview" or intent["value_column"] is None:
        llm_result = await llm_intent(request.question, [str(column) for column in frame.columns])
        if llm_result is not None and llm_result.get("value_column") is not None:
            intent = llm_result
    operation = intent["operation"]
    value, values = resolve_metric(frame, intent.get("value_column"))
    group = resolve_column(frame, intent.get("group_column"))
    if values is None:
        numeric = [str(column) for column in frame.select_dtypes(include="number").columns]
        value, values = resolve_metric(frame, numeric[0] if numeric else None)
    if operation == "outliers" and value and values is not None:
        series = values.dropna()
        q1, q3 = series.quantile([0.25, 0.75])
        lower, upper = q1 - 1.5 * (q3 - q1), q3 + 1.5 * (q3 - q1)
        outlier_mask = values.lt(lower) | values.gt(upper)
        outliers = frame.loc[outlier_mask].head(100)
        rows = [{str(k): json_value(v) for k, v in record.items()} for record in outliers.to_dict(orient="records")]
        chart_data = [{"row": int(index), value: json_value(values.loc[index])} for index in outliers.index]
        return {
            "answer": f"Found {int((series.lt(lower) | series.gt(upper)).sum())} potential outliers in {value} using the 1.5× IQR rule.",
            "metrics": {"column": value, "lower_bound": json_value(lower), "upper_bound": json_value(upper), "outlier_count": len(series[(series < lower) | (series > upper)])},
            "chart": build_chart(chart_data, "scatter", "row", value, value) if chart_data else None,
            "table": rows[:10],
        }
    if operation == "group" and group and value and values is not None and group != value:
        aggregation = intent.get("aggregation", "mean")
        grouped = pd.DataFrame({"__group": frame[group], "__value": values}).groupby("__group", dropna=False)["__value"]
        result = grouped.size() if aggregation == "count" else getattr(grouped, aggregation)()
        records = [{"category": str(json_value(key) if key is not None else "(missing)"), "value": json_value(val)} for key, val in result.sort_values(ascending=False).head(30).items()]
        return {
            "answer": f"{value} by {group} ({aggregation}); showing {len(records)} groups.",
            "metrics": {"group_count": int(len(result)), "aggregation": aggregation, "column": value},
            "chart": build_chart(records, "bar", "category", "value", value),
            "table": records[:10],
        }
    if operation == "trend" and group and value and values is not None:
        is_date = pd.api.types.is_datetime64_any_dtype(frame[group]) or any(
            token in group.casefold() for token in ("date", "time", "day", "month", "year")
        )
        if is_date:
            x = pd.to_datetime(frame[group], errors="coerce")
            working = pd.DataFrame({"period": x, "value": values}).dropna()
            if not working.empty:
                aggregation = intent.get("aggregation", "mean")
                records = getattr(working.groupby(working["period"].dt.to_period("M"))["value"], aggregation)().sort_index()
                points = [{"period": str(key), "value": json_value(val)} for key, val in records.items()]
                return {
                    "answer": f"Monthly {aggregation} {value} across {len(points)} periods.",
                    "metrics": {"periods": len(points), "column": value, "aggregation": aggregation},
                    "chart": build_chart(points, "line", "period", "value", value),
                    "table": points[:10],
                }
        aggregation = intent.get("aggregation", "mean")
        grouped = pd.DataFrame({"__group": frame[group], "__value": values}).groupby("__group", dropna=False)["__value"]
        grouped = getattr(grouped, aggregation)().sort_values(ascending=False).head(30)
        points = [{"category": str(json_value(key) if key is not None else "(missing)"), "value": json_value(val)} for key, val in grouped.items()]
        if points:
            return {
                "answer": f"{aggregation.capitalize()} {value} by {group}; showing {len(points)} groups.",
                "metrics": {"group_count": len(points), "column": value, "aggregation": aggregation},
                "chart": build_chart(points, "bar", "category", "value", value),
                "table": points[:10],
            }
    if operation == "distribution" and value and values is not None:
        observed = values.dropna()
        counts, edges = np.histogram(observed, bins=min(12, max(1, int(np.sqrt(max(len(observed), 1))))))
        points = [{"range": f"{edges[i]:.3g}–{edges[i + 1]:.3g}", "count": int(counts[i])} for i in range(len(counts))]
        return {
            "answer": f"Distribution of {value} across {len(observed)} non-missing values.",
            "metrics": {"mean": json_value(observed.mean()), "median": json_value(observed.median()), "std": json_value(observed.std())},
            "chart": build_chart(points, "bar", "range", "count", "Records"),
            "table": points,
        }
    numeric = frame.select_dtypes(include="number")
    summary = {
        str(column): {
            "mean": json_value(frame[column].mean()),
            "median": json_value(frame[column].median()),
            "min": json_value(frame[column].min()),
            "max": json_value(frame[column].max()),
        }
        for column in numeric.columns[:12]
    }
    return {
        "answer": f"Your dataset contains {len(frame):,} rows and {len(frame.columns)} columns, with {int(frame.isna().sum().sum()):,} missing values.",
        "metrics": {"rows": len(frame), "columns": len(frame.columns), "missing_values": int(frame.isna().sum().sum()), "numeric_summary": summary},
        "chart": None,
        "table": [],
    }


def synthetic_series(series: pd.Series, size: int) -> pd.Series:
    observed = series.dropna()
    if pd.api.types.is_numeric_dtype(series):
        if observed.empty:
            return pd.Series(np.zeros(size))
        std = float(observed.std()) if len(observed) > 1 else 0.0
        values = np.random.normal(float(observed.mean()), std, size)
        if pd.api.types.is_integer_dtype(series):
            values = np.rint(values).astype(int)
        return pd.Series(values)
    if observed.empty:
        return pd.Series([""] * size)
    probabilities = observed.value_counts(normalize=True)
    return pd.Series(np.random.choice(probabilities.index.to_numpy(), size=size, p=probabilities.to_numpy()))


@app.post("/api/datasets/{dataset_id}/augment")
async def augment_dataset(dataset_id: str, request: AugmentRequest) -> dict[str, Any]:
    frame = get_dataset(dataset_id).copy()
    if not request.fill_missing and request.rows == 0:
        raise HTTPException(status_code=400, detail="Enable missing-value filling or generate at least one row.")
    unknown = set(request.columns) - set(map(str, frame.columns))
    if unknown:
        raise HTTPException(status_code=400, detail=f"Unknown columns: {', '.join(sorted(unknown))}")
    if request.fill_missing:
        for column in request.columns:
            missing = frame[column].isna()
            count = int(missing.sum())
            if count:
                frame.loc[missing, column] = synthetic_series(frame[column], count).to_numpy()
    if request.rows:
        if frame.empty:
            raise HTTPException(status_code=400, detail="Cannot generate rows from an empty dataset.")
        additions = frame.sample(n=request.rows, replace=True).reset_index(drop=True)
        for column in request.columns:
            additions[column] = synthetic_series(frame[column], request.rows).to_numpy()
        frame = pd.concat([frame, additions], ignore_index=True)
    datasets[dataset_id] = frame
    return {"message": "Dataset updated.", **dataset_metadata(frame)}


@app.get("/api/datasets/{dataset_id}/export")
async def export_dataset(dataset_id: str, format: Literal["csv", "json"] = "csv") -> StreamingResponse:
    frame = get_dataset(dataset_id)
    if format == "json":
        payload = frame.to_json(orient="records", date_format="iso", force_ascii=False)
        media_type, filename = "application/json", "augmented-dataset.json"
    else:
        payload = frame.to_csv(index=False)
        media_type, filename = "text/csv", "augmented-dataset.csv"
    return StreamingResponse(
        io.BytesIO(payload.encode("utf-8")),
        media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@app.post("/api/datasets/{dataset_id}/summary")
async def executive_summary(dataset_id: str) -> dict[str, str]:
    frame = get_dataset(dataset_id)
    missing = frame.isna().sum().sort_values(ascending=False)
    numeric = frame.select_dtypes(include="number")
    aggregate: dict[str, Any] = {
        "rows": len(frame),
        "columns": len(frame.columns),
        "missing_values": int(frame.isna().sum().sum()),
        "missing_by_column": {str(column): int(count) for column, count in missing.items() if count > 0},
        "numeric": {
            str(column): {
                "mean": json_value(numeric[column].mean()),
                "median": json_value(numeric[column].median()),
                "min": json_value(numeric[column].min()),
                "max": json_value(numeric[column].max()),
            }
            for column in numeric.columns[:20]
        },
    }
    generated_report = await llm_report(aggregate)
    if generated_report:
        return {"markdown": generated_report}
    report = [
        "# Executive summary",
        "",
        f"- **Dataset size:** {len(frame):,} rows × {len(frame.columns)} columns.",
        f"- **Completeness:** {int(frame.isna().sum().sum()):,} missing cells ({frame.isna().mean().mean() * 100:.1f}% of all cells).",
        f"- **Numeric fields:** {len(numeric.columns)}.",
    ]
    if len(numeric.columns):
        report.extend(["", "## Notable numeric patterns"])
        for column in numeric.columns[:8]:
            series = numeric[column].dropna()
            if series.empty:
                continue
            report.append(
                f"- **{column}:** mean {series.mean():,.3g}, median {series.median():,.3g}, "
                f"range {series.min():,.3g}–{series.max():,.3g}."
            )
    with_missing = [(str(column), int(count)) for column, count in missing.items() if count > 0]
    report.extend(["", "## Data quality"])
    if with_missing:
        report.extend([f"- `{column}` has {count:,} missing values." for column, count in with_missing[:8]])
    else:
        report.append("- No missing values detected.")
    report.extend(["", "## Recommendations", "- Validate unusual values and investigate the highest-missingness columns before downstream modeling.", "- Compare key numeric metrics across relevant categories or time periods to uncover actionable drivers."])
    return {"markdown": "\n".join(report)}
