import React, { useState } from 'react';
import { FlowPipeline } from '../types';
import {
  Layers,
  Database,
  Code2,
  BookOpen,
  HelpCircle,
  X,
  ExternalLink,
  Sparkles,
  ShieldCheck
} from 'lucide-react';

interface HeaderProps {
  pipeline: FlowPipeline;
}

export const Header: React.FC<HeaderProps> = ({ pipeline }) => {
  const [showCheatSheet, setShowCheatSheet] = useState(false);

  return (
    <>
      <header className="h-14 bg-white border-b border-slate-200 px-4 flex items-center justify-between shrink-0 select-none z-30 shadow-sm">
        {/* Left: Brand Identity with clean enterprise Flow Studio mark */}
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-[#e20074] text-white shadow-sm font-bold text-base">
            <Layers className="w-4 h-4" />
          </div>

          <div>
            <div className="flex items-center gap-2">
              <h1 className="font-bold text-sm text-slate-900 tracking-tight">
                SAP HANA <span className="text-[#e20074] font-extrabold">SQL Flow Studio</span>
              </h1>
              <span className="px-1.5 py-0.5 bg-[#fdf0f6] text-[#c70066] font-mono text-[10px] font-semibold rounded border border-[#f8b4d9]">
                ENTERPRISE WORKFLOW
              </span>
            </div>
            <p className="text-[11px] text-slate-500 hidden sm:block">
              Visual SQL Process Sequencing & SAP HANA Cloud Analytics
            </p>
          </div>
        </div>

        {/* Right: Quick Links & Help */}
        <div className="flex items-center gap-3">
          {/* Safe Mode Indicator Badge */}
          <div
            id="safe-mode-badge"
            className="flex items-center gap-1.5 px-2.5 py-1 bg-emerald-50 text-emerald-800 rounded-lg border border-emerald-200 text-xs font-semibold shadow-sm"
            title="Safe Mode is enforced: Only read-only SELECT statements are permitted. Table creation and deletion are blocked."
          >
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
            <span>Safe Mode: SELECT Only</span>
          </div>

          <button
            type="button"
            id="hana-cheatsheet-btn"
            onClick={() => setShowCheatSheet(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-white hover:bg-slate-50 text-slate-700 hover:text-[#e20074] rounded-lg text-xs font-medium transition-all border border-slate-200 hover:border-[#f8b4d9] shadow-sm"
          >
            <BookOpen className="w-3.5 h-3.5 text-[#e20074]" />
            <span>HANA SQL Cheat Sheet</span>
          </button>
        </div>
      </header>

      {/* Cheat Sheet Modal */}
      {showCheatSheet && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-3xl max-h-[85vh] flex flex-col shadow-2xl overflow-hidden animate-scaleUp">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
              <div className="flex items-center gap-2.5">
                <div className="p-1.5 bg-[#fdf0f6] rounded-lg border border-[#f8b4d9] text-[#e20074]">
                  <BookOpen className="w-4 h-4" />
                </div>
                <h3 className="font-semibold text-base text-slate-900">
                  SAP HANA SQL Syntax & Analytical Query Guide
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowCheatSheet(false)}
                className="p-1.5 hover:bg-slate-200 rounded-lg text-slate-400 hover:text-slate-700 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-4 text-xs font-sans">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200 hover:border-[#f8b4d9] transition-colors space-y-2">
                  <h4 className="font-semibold text-[#e20074] flex items-center gap-1.5">
                    <Database className="w-4 h-4" />
                    <span>Analytical Aggregation & Rollups</span>
                  </h4>
                  <pre className="p-2.5 bg-white border border-slate-200 rounded font-mono text-[11px] text-slate-800 overflow-x-auto">
{`SELECT 
  "REGION", 
  "CATEGORY", 
  SUM("NET_AMOUNT") AS "TOTAL_SALES",
  COUNT(DISTINCT "ORDER_ID") AS "ORDER_COUNT"
FROM "ANALYTICS"."FACT_SALES"
GROUP BY "REGION", "CATEGORY"
ORDER BY "TOTAL_SALES" DESC;`}
                  </pre>
                  <p className="text-slate-500 text-[11px]">
                    HANA columnar engine parallelizes group aggregations across multi-core CPUs.
                  </p>
                </div>

                <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200 hover:border-blue-300 transition-colors space-y-2">
                  <h4 className="font-semibold text-amber-700 flex items-center gap-1.5">
                    <Database className="w-4 h-4" />
                    <span>HANA Window Functions</span>
                  </h4>
                  <pre className="p-2.5 bg-white border border-slate-200 rounded font-mono text-[11px] text-slate-800 overflow-x-auto">
{`SELECT 
  "EMPLOYEE_ID",
  "DEPARTMENT",
  "SALARY",
  DENSE_RANK() OVER (PARTITION BY "DEPARTMENT" ORDER BY "SALARY" DESC) AS "DEPT_RANK",
  AVG("SALARY") OVER (PARTITION BY "DEPARTMENT") AS "DEPT_AVG"
FROM "HR"."EMPLOYEES";`}
                  </pre>
                  <p className="text-slate-500 text-[11px]">
                    Window partition partitions computed in-memory without secondary joins.
                  </p>
                </div>

                <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200 hover:border-blue-300 transition-colors space-y-2">
                  <h4 className="font-semibold text-emerald-700 flex items-center gap-1.5">
                    <Database className="w-4 h-4" />
                    <span>Multi-Table Join with Input Parameters</span>
                  </h4>
                  <pre className="p-2.5 bg-white border border-slate-200 rounded font-mono text-[11px] text-slate-800 overflow-x-auto">
{`SELECT 
  o."ORDER_ID",
  c."CUSTOMER_NAME",
  o."TOTAL_AMOUNT"
FROM "ERP"."V_ORDERS" AS o
INNER JOIN "ERP"."DIM_CUSTOMERS" AS c
  ON o."CUSTOMER_ID" = c."CUSTOMER_ID"
WHERE o."STATUS" = 'CONFIRMED';`}
                  </pre>
                  <p className="text-slate-500 text-[11px]">
                    Standard star-schema joins executed with in-memory bit-vector hash filters.
                  </p>
                </div>

                <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200 hover:border-blue-300 transition-colors space-y-2">
                  <h4 className="font-semibold text-indigo-700 flex items-center gap-1.5">
                    <Database className="w-4 h-4" />
                    <span>Common Table Expression (WITH CTE)</span>
                  </h4>
                  <pre className="p-2.5 bg-white border border-slate-200 rounded font-mono text-[11px] text-slate-800 overflow-x-auto">
{`WITH RankedSales AS (
  SELECT 
    "PRODUCT_ID", 
    "REVENUE",
    ROW_NUMBER() OVER (ORDER BY "REVENUE" DESC) AS "RANK"
  FROM "SALES"."PRODUCT_SUMMARY"
)
SELECT * FROM RankedSales WHERE "RANK" <= 10;`}
                  </pre>
                  <p className="text-slate-500 text-[11px]">
                    Optimized intermediate tabular pipelines inside calculation engine threads.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
