"use client";

import {
  CartesianGrid, Line, LineChart, ResponsiveContainer, Scatter, ScatterChart,
  Tooltip, XAxis, YAxis, BarChart, Bar
} from "recharts";
import type { QueryResult } from "@/lib/api";

export default function InsightChart({ chart }: { chart: NonNullable<QueryResult["chart"]> }) {
  const common = (
    <>
      <CartesianGrid stroke="#202a3a" strokeDasharray="3 3" vertical={false} />
      <XAxis dataKey={chart.xKey} tick={{ fill: "#77849a", fontSize: 11 }} axisLine={false} tickLine={false} />
      <YAxis tick={{ fill: "#77849a", fontSize: 11 }} axisLine={false} tickLine={false} />
      <Tooltip contentStyle={{ background: "#111827", border: "1px solid #263244", borderRadius: 10, color: "#e5eaf2" }} />
    </>
  );
  return (
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        {chart.type === "line" ? (
          <LineChart data={chart.data}>{common}<Line type="monotone" dataKey={chart.yKey} stroke="#a78bfa" strokeWidth={2.5} dot={{ fill: "#a78bfa", r: 3 }} /></LineChart>
        ) : chart.type === "scatter" ? (
          <ScatterChart>{common}<Scatter data={chart.data} fill="#a78bfa" /></ScatterChart>
        ) : (
          <BarChart data={chart.data}>{common}<Bar dataKey={chart.yKey} fill="#8b75e8" radius={[5, 5, 0, 0]} /></BarChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}
