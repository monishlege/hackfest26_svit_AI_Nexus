export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:8000";

export interface Dataset {
  dataset_id: string;
  rows: number;
  columns: number;
  missing_values: number;
  missing_by_column: Record<string, number>;
  column_types: Record<string, string>;
  column_names: string[];
  preview: Record<string, string | number | boolean | null>[];
}

export interface QueryResult {
  answer: string;
  metrics: Record<string, unknown>;
  chart: null | { type: "bar" | "line" | "scatter"; data: Record<string, unknown>[]; xKey: string; yKey: string; label: string };
  table: Record<string, unknown>[];
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch (error) {
    if (error instanceof TypeError) {
      throw new Error(`Cannot reach the DataSynth API at ${API_URL}. Check that the backend is running and CORS_ORIGINS includes this app's address.`);
    }
    throw error;
  }
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.detail ?? `Request failed (${response.status})`);
  }
  return response.json() as Promise<T>;
}

export async function uploadDataset(file: File): Promise<Dataset> {
  const form = new FormData();
  form.append("file", file);
  return request<Dataset>(`${API_URL}/api/datasets/upload`, { method: "POST", body: form });
}

export function askQuestion(datasetId: string, question: string): Promise<QueryResult> {
  return request(`${API_URL}/api/query`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dataset_id: datasetId, question })
  });
}

export function augmentDataset(datasetId: string, columns: string[], rows: number, fillMissing: boolean): Promise<Dataset> {
  return request(`${API_URL}/api/datasets/${datasetId}/augment`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ columns, rows, fill_missing: fillMissing })
  });
}

export function getSummary(datasetId: string): Promise<{ markdown: string }> {
  return request(`${API_URL}/api/datasets/${datasetId}/summary`, { method: "POST" });
}
