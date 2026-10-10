"use client";

import { ChangeEvent, DragEvent, FormEvent, useRef, useState } from "react";
import {
  ArrowDownToLine, ArrowUpRight, BarChart3, Bot, Check, ChevronDown, CircleHelp,
  Database, FileSpreadsheet, FileText, LoaderCircle, MessageSquare, Plus, Send,
  Sparkles, WandSparkles, X
} from "lucide-react";
import { API_URL, Dataset, QueryResult, askQuestion, augmentDataset, getSummary, uploadDataset } from "@/lib/api";
import InsightChart from "@/components/insight-chart";

const suggestions = ["Show me sales trends by region", "Find outliers in the data", "Summarize this dataset"];
type Message = { role: "user" | "assistant"; text: string; result?: QueryResult };

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}

export default function Dashboard() {
  const [dataset, setDataset] = useState<Dataset | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [question, setQuestion] = useState("");
  const [fileError, setFileError] = useState("");
  const [queryError, setQueryError] = useState("");
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [rowsToGenerate, setRowsToGenerate] = useState(25);
  const [generateRows, setGenerateRows] = useState(true);
  const [fillMissing, setFillMissing] = useState(true);
  const [augmenting, setAugmenting] = useState(false);
  const [summary, setSummary] = useState("");
  const [summaryOpen, setSummaryOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function handleFile(file?: File) {
    if (!file) return;
    setFileError("");
    setDataset(null);
    setMessages([]);
    const ext = file.name.split(".").pop()?.toLowerCase();
    if (!["csv", "xlsx", "json"].includes(ext ?? "")) {
      setFileError("Choose a CSV, XLSX, or JSON file.");
      return;
    }
    setBusy(true);
    try {
      const uploaded = await uploadDataset(file);
      setDataset(uploaded);
      setSelected(uploaded.column_names);
    } catch (error) {
      setFileError(error instanceof Error ? error.message : "Upload failed.");
    } finally {
      setBusy(false);
    }
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    void handleFile(event.dataTransfer.files[0]);
  }

  async function submitQuestion(event?: FormEvent, value = question) {
    event?.preventDefault();
    if (!dataset || !value.trim() || busy) return;
    const prompt = value.trim();
    setQuestion("");
    setQueryError("");
    setMessages((previous) => [...previous, { role: "user", text: prompt }]);
    setBusy(true);
    try {
      const result = await askQuestion(dataset.dataset_id, prompt);
      setMessages((previous) => [...previous, { role: "assistant", text: result.answer, result }]);
    } catch (error) {
      setQueryError(error instanceof Error ? error.message : "Could not analyze this question.");
    } finally {
      setBusy(false);
    }
  }

  async function runAugmentation() {
    if (!dataset || selected.length === 0) return;
    setAugmenting(true);
    setFileError("");
    try {
      const updated = await augmentDataset(dataset.dataset_id, selected, generateRows ? rowsToGenerate : 0, fillMissing);
      setDataset(updated);
    } catch (error) {
      setFileError(error instanceof Error ? error.message : "Augmentation failed.");
    } finally {
      setAugmenting(false);
    }
  }

  async function createSummary() {
    if (!dataset) return;
    setBusy(true);
    setFileError("");
    try {
      const result = await getSummary(dataset.dataset_id);
      setSummary(result.markdown);
      setSummaryOpen(true);
    } catch (error) {
      setFileError(error instanceof Error ? error.message : "Could not generate report.");
    } finally {
      setBusy(false);
    }
  }

  function download(format: "csv" | "json") {
    if (!dataset) return;
    window.open(`${API_URL}/api/datasets/${dataset.dataset_id}/export?format=${format}`, "_blank", "noopener,noreferrer");
  }

  return (
    <main className="min-h-screen bg-[#090d14] text-slate-100">
      <header className="sticky top-0 z-20 border-b border-white/[0.07] bg-[#090d14]/90 backdrop-blur-xl">
        <div className="mx-auto flex h-[70px] max-w-[1500px] items-center justify-between px-5 lg:px-9">
          <a className="flex items-center gap-3" href="#">
            <span className="brand-icon"><Sparkles size={18} /></span>
            <span className="text-[15px] font-semibold tracking-tight">DataSynth <span className="text-violet-300">&</span> Query AI</span>
            <span className="hidden rounded-md border border-white/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-[.14em] text-slate-500 sm:inline">Studio</span>
          </a>
          <div className="flex items-center gap-3">
            <span className="hidden items-center gap-2 text-xs text-slate-500 sm:flex"><span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> Private workspace</span>
            <button aria-label="Help" className="icon-button"><CircleHelp size={17} /></button>
            <div className="avatar">DS</div>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-[1500px] px-5 pb-16 pt-8 lg:px-9">
        <section className="mb-8 flex flex-col justify-between gap-5 md:flex-row md:items-end">
          <div>
            <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[.18em] text-violet-300"><span className="h-px w-5 bg-violet-400" /> Data intelligence workspace</div>
            <h1 className="text-3xl font-semibold tracking-[-.04em] md:text-[38px]">Make your data <span className="text-gradient">speak.</span></h1>
            <p className="mt-2 max-w-xl text-sm leading-6 text-slate-400">Explore patterns, ask better questions, and create production-ready synthetic data.</p>
          </div>
          <div className="flex gap-2">
            <button className="button-secondary" onClick={() => fileRef.current?.click()}><Plus size={15} /> New dataset</button>
            <button className="button-primary" disabled={!dataset || busy} onClick={() => void createSummary()}><FileText size={15} /> Executive report <ArrowUpRight size={14} /></button>
          </div>
        </section>

        {fileError && <div className="mb-5 flex items-center justify-between rounded-xl border border-rose-400/20 bg-rose-400/[.06] px-4 py-3 text-sm text-rose-200"><span>{fileError}</span><button onClick={() => setFileError("")} aria-label="Dismiss"><X size={15} /></button></div>}

        {!dataset ? (
          <section className="panel mx-auto mt-14 max-w-3xl p-8 md:p-12">
            <div className="mx-auto max-w-xl text-center">
              <div className="mx-auto mb-5 grid h-14 w-14 place-items-center rounded-2xl border border-violet-300/15 bg-violet-300/[.08] text-violet-300"><Database size={25} /></div>
              <h2 className="text-xl font-semibold">Start with your data</h2>
              <p className="mt-2 text-sm leading-6 text-slate-400">Drop in a dataset to unlock an interactive preview, AI analysis, and synthetic data tools.</p>
              <div onDrop={onDrop} onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onClick={() => fileRef.current?.click()} className={`upload-zone mt-7 cursor-pointer rounded-2xl border border-dashed p-10 transition ${dragging ? "border-violet-300 bg-violet-300/[.06]" : "border-slate-700 hover:border-violet-400/60 hover:bg-white/[.015]"}`}>
                {busy ? <LoaderCircle className="mx-auto animate-spin text-violet-300" size={25} /> : <FileSpreadsheet className="mx-auto text-slate-400" size={26} />}
                <p className="mt-4 text-sm font-medium">{busy ? "Reading your dataset..." : "Drop your file here, or browse"}</p>
                <p className="mt-2 text-xs text-slate-500">CSV, XLSX, or JSON · Max 25 MB</p>
              </div>
              {fileError && <p className="mt-3 text-left text-sm text-rose-300">{fileError}</p>}
              <div className="mt-6 flex justify-center gap-5 text-[11px] text-slate-500"><span>Secure processing</span><span>•</span><span>Files stay in your session</span><span>•</span><span>No setup needed</span></div>
            </div>
            <input ref={fileRef} type="file" accept=".csv,.xlsx,.json" className="hidden" onChange={(event: ChangeEvent<HTMLInputElement>) => void handleFile(event.target.files?.[0])} />
          </section>
        ) : (
          <>
            <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <MetricCard label="Total records" value={formatNumber(dataset.rows)} detail="Rows in dataset" icon={<Database size={17} />} />
              <MetricCard label="Data fields" value={formatNumber(dataset.columns)} detail="Columns detected" icon={<BarChart3 size={17} />} />
              <MetricCard label="Missing values" value={formatNumber(dataset.missing_values)} detail={dataset.rows ? `${((dataset.missing_values / (dataset.rows * dataset.columns)) * 100).toFixed(1)}% of all cells` : "No data rows"} icon={<CircleHelp size={17} />} />
              <MetricCard label="Data quality" value={dataset.missing_values === 0 ? "Excellent" : dataset.missing_values / Math.max(dataset.rows * dataset.columns, 1) < 0.05 ? "Healthy" : "Needs review"} detail="Completeness check" icon={<Check size={17} />} />
            </section>

            <section className="mt-5 grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_370px]">
              <div className="space-y-5">
                <div className="panel overflow-hidden">
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[.06] px-5 py-4">
                    <div className="flex items-center gap-3"><div className="section-icon"><Database size={16} /></div><div><h2 className="text-sm font-semibold">Dataset preview</h2><p className="mt-0.5 text-xs text-slate-500">First 10 records · {dataset.column_names.length} columns</p></div></div>
                    <div className="flex items-center gap-2"><button onClick={() => download("csv")} className="button-small"><ArrowDownToLine size={13} /> Export CSV</button><button onClick={() => download("json")} className="button-small">JSON <ChevronDown size={12} /></button></div>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="data-table">
                      <thead><tr>{dataset.column_names.map((column) => <th key={column}><span>{column}</span><small>{dataset.column_types[column]}</small></th>)}</tr></thead>
                      <tbody>{dataset.preview.map((record, index) => <tr key={index}>{dataset.column_names.map((column) => <td key={column}>{record[column] === null ? <span className="text-slate-600">null</span> : String(record[column] ?? "")}</td>)}</tr>)}</tbody>
                    </table>
                  </div>
                </div>

                <div className="panel flex min-h-[440px] flex-col">
                  <div className="flex items-center justify-between border-b border-white/[.06] px-5 py-4"><div className="flex items-center gap-3"><div className="section-icon purple"><MessageSquare size={16} /></div><div><h2 className="text-sm font-semibold">Ask your data</h2><p className="mt-0.5 text-xs text-slate-500">Natural language, actionable insights</p></div></div><span className="rounded-full border border-emerald-400/15 bg-emerald-400/[.06] px-2.5 py-1 text-[10px] font-medium text-emerald-300">AI ready</span></div>
                  <div className="flex-1 space-y-5 overflow-y-auto p-5">
                    {messages.length === 0 ? <div className="flex h-full min-h-[230px] flex-col items-center justify-center text-center"><div className="mb-4 grid h-12 w-12 place-items-center rounded-2xl border border-violet-300/15 bg-violet-300/[.07] text-violet-300"><Bot size={23} /></div><p className="text-sm font-medium">Your data analyst is ready</p><p className="mt-1 max-w-sm text-xs leading-5 text-slate-500">Ask a question about your data. Get clear answers, metrics, and visualizations.</p><div className="mt-5 flex flex-wrap justify-center gap-2">{suggestions.map((item) => <button key={item} onClick={() => void submitQuestion(undefined, item)} className="suggestion-chip">{item}</button>)}</div></div> : messages.map((message, index) => <div key={index} className={`flex gap-3 ${message.role === "user" ? "justify-end" : ""}`}><div className={`max-w-[90%] ${message.role === "user" ? "order-1 rounded-2xl rounded-tr-sm bg-violet-500/15 px-4 py-3 text-sm text-violet-50" : "flex-1"}`}>{message.role === "assistant" && <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold text-violet-300"><Sparkles size={13} /> DataSynth AI</div>}<p className="text-sm leading-6 text-slate-300">{message.text}</p>{message.result?.chart && <div className="mt-4 rounded-xl border border-white/[.06] bg-[#0b111b] p-3"><InsightChart chart={message.result.chart} /></div>}{message.result?.table && message.result.table.length > 0 && !message.result.chart && <pre className="mt-3 overflow-x-auto rounded-lg bg-black/20 p-3 text-[11px] text-slate-400">{JSON.stringify(message.result.table.slice(0, 5), null, 2)}</pre>}</div></div>)}
                    {busy && <div className="flex items-center gap-2 text-xs text-slate-500"><LoaderCircle size={14} className="animate-spin" /> Analyzing your data...</div>}
                    {queryError && <p className="text-sm text-rose-300">{queryError}</p>}
                  </div>
                  <form onSubmit={(event) => void submitQuestion(event)} className="border-t border-white/[.06] p-4"><div className="flex items-center gap-2 rounded-xl border border-white/[.08] bg-[#0b111b] p-1.5 pl-4 focus-within:border-violet-400/40"><input value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="Ask anything about your dataset..." className="min-w-0 flex-1 bg-transparent py-2 text-sm outline-none placeholder:text-slate-600" /><button aria-label="Send question" disabled={!question.trim() || busy} className="grid h-9 w-9 place-items-center rounded-lg bg-violet-500 text-white transition hover:bg-violet-400 disabled:opacity-40"><Send size={15} /></button></div></form>
                </div>
              </div>

              <aside className="panel p-5">
                <div className="flex items-center gap-3"><div className="section-icon amber"><WandSparkles size={16} /></div><div><h2 className="text-sm font-semibold">Synthetic data</h2><p className="mt-0.5 text-xs text-slate-500">Augment your dataset</p></div></div>
                <p className="mt-4 text-xs leading-5 text-slate-400">Generate statistically representative records or fill gaps in selected columns.</p>
                <label className="mt-5 block text-xs font-medium text-slate-300">Columns to synthesize</label>
                <div className="mt-2 max-h-44 space-y-1 overflow-y-auto rounded-xl border border-white/[.06] bg-[#0b111b] p-2">
                  {dataset.column_names.map((column) => <label key={column} className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-2 text-xs text-slate-300 hover:bg-white/[.04]"><input type="checkbox" checked={selected.includes(column)} onChange={(event) => setSelected(event.target.checked ? [...selected, column] : selected.filter((item) => item !== column))} className="accent-violet-400" /><span className="min-w-0 flex-1 truncate">{column}</span><span className="text-[10px] text-slate-600">{dataset.column_types[column]}</span></label>)}
                </div>
                <label className="mt-5 flex cursor-pointer items-start gap-3 rounded-xl border border-white/[.06] bg-white/[.015] p-3"><input type="checkbox" checked={generateRows} onChange={(event) => setGenerateRows(event.target.checked)} className="mt-0.5 accent-violet-400" /><span><span className="block text-xs font-medium text-slate-300">Generate synthetic rows</span><span className="mt-1 block text-[11px] leading-4 text-slate-500">Sample realistic records from your data</span></span></label>
                <label className={`mt-5 flex items-center justify-between text-xs font-medium ${generateRows ? "text-slate-300" : "text-slate-600"}`}><span>New rows to generate</span><span className="text-violet-300">{rowsToGenerate}</span></label>
                <input type="range" min="1" max="500" value={rowsToGenerate} disabled={!generateRows} onChange={(event) => setRowsToGenerate(Number(event.target.value))} className="mt-3 w-full accent-violet-400 disabled:opacity-30" />
                <label className="mt-5 flex cursor-pointer items-start gap-3 rounded-xl border border-white/[.06] bg-white/[.015] p-3"><input type="checkbox" checked={fillMissing} onChange={(event) => setFillMissing(event.target.checked)} className="mt-0.5 accent-violet-400" /><span><span className="block text-xs font-medium text-slate-300">Fill missing values</span><span className="mt-1 block text-[11px] leading-4 text-slate-500">Estimate gaps from each column&apos;s observed distribution</span></span></label>
                <button disabled={augmenting || selected.length === 0 || (!generateRows && !fillMissing)} onClick={() => void runAugmentation()} className="button-primary mt-5 w-full justify-center disabled:cursor-not-allowed disabled:opacity-50">{augmenting ? <LoaderCircle className="animate-spin" size={15} /> : <Sparkles size={15} />}{augmenting ? "Generating..." : "Apply data augmentation"}</button>
                <div className="mt-4 flex gap-2"><button onClick={() => download("csv")} className="button-small flex-1 justify-center"><ArrowDownToLine size={13} /> Download CSV</button><button onClick={() => download("json")} className="button-small flex-1 justify-center"><ArrowDownToLine size={13} /> JSON</button></div>
                <p className="mt-3 text-[10px] leading-4 text-slate-600">Synthetic values approximate observed distributions; validate them before use.</p>
              </aside>
            </section>
          </>
        )}
      </div>

      {dataset && <input ref={fileRef} type="file" accept=".csv,.xlsx,.json" className="hidden" onChange={(event: ChangeEvent<HTMLInputElement>) => void handleFile(event.target.files?.[0])} />}
      {summaryOpen && <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-4" onClick={() => setSummaryOpen(false)}><section className="panel max-h-[85vh] w-full max-w-2xl overflow-auto p-6" onClick={(event) => event.stopPropagation()}><div className="mb-5 flex items-center justify-between"><div><p className="text-[10px] font-semibold uppercase tracking-[.16em] text-violet-300">DataSynth report</p><h2 className="mt-1 text-lg font-semibold">Executive summary</h2></div><button className="icon-button" onClick={() => setSummaryOpen(false)} aria-label="Close report"><X size={17} /></button></div><pre className="whitespace-pre-wrap font-sans text-sm leading-7 text-slate-300">{summary}</pre></section></div>}
    </main>
  );
}

function MetricCard({ label, value, detail, icon }: { label: string; value: string; detail: string; icon: React.ReactNode }) {
  return <div className="panel metric-card p-4"><div className="flex items-start justify-between"><div><p className="text-xs text-slate-500">{label}</p><p className="mt-2 text-2xl font-semibold tracking-tight">{value}</p><p className="mt-1 text-[11px] text-slate-500">{detail}</p></div><div className="section-icon">{icon}</div></div></div>;
}
