import React, { useState, useEffect } from 'react';
import { SQLNode, ValidationResult, FlowPipeline } from '../types';
import { HanaCodeEditor } from './HanaCodeEditor';
import { validateHanaSql, formatHanaSql } from '../utils/hanaSqlValidator';
import {
  ArrowLeft,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  Copy,
  Check,
  Code2,
  FileCode,
  Zap,
  Info,
  ChevronRight,
  ChevronLeft,
  Terminal,
  Layers,
  ArrowRightLeft,
  ShieldCheck,
  Activity,
  Wrench,
  CheckCheck,
  BookOpen
} from 'lucide-react';

interface FullSizeSqlEditorProps {
  node: SQLNode;
  pipeline: FlowPipeline;
  onSaveNode: (updatedNode: SQLNode) => void;
  onClose: () => void;
  onNavigateNode: (nodeId: string) => void;
  onOpenDocumentation?: (node: SQLNode) => void;
}

export const FullSizeSqlEditor: React.FC<FullSizeSqlEditorProps> = ({
  node,
  pipeline,
  onSaveNode,
  onClose,
  onNavigateNode,
  onOpenDocumentation,
}) => {
  const [currentNode, setCurrentNode] = useState<SQLNode>(node);
  const [validation, setValidation] = useState<ValidationResult>(() => validateHanaSql(node.sqlContent));
  const [copied, setCopied] = useState(false);
  const [cursorPos, setCursorPos] = useState({ line: 1, col: 1 });
  const [diagFilter, setDiagFilter] = useState<'all' | 'errors' | 'warnings' | 'info'>('all');

  // Sync state if incoming node changes
  useEffect(() => {
    setCurrentNode(node);
    const res = validateHanaSql(node.sqlContent);
    setValidation(res);
  }, [node]);

  // Revalidate on SQL change
  const handleSqlChange = (newSql: string) => {
    const updated = { ...currentNode, sqlContent: newSql };
    const res = validateHanaSql(newSql);
    setValidation(res);
    updated.validationSummary = {
      isValid: res.isValid,
      errors: res.errorCount,
      warnings: res.warningCount,
    };
    // Sync extracted tables & params
    updated.inputTables = res.extractedTables.inputs;
    if (res.extractedTables.outputs.length > 0) {
      const firstOut = res.extractedTables.outputs[0];
      if (firstOut.includes('.')) {
        const parts = firstOut.replace(/"/g, '').split('.');
        updated.targetSchema = parts[0];
        updated.targetTable = parts[1];
      } else {
        updated.targetTable = firstOut.replace(/"/g, '');
      }
    }
    setCurrentNode(updated);
    onSaveNode(updated);
  };

  const handleFormatSql = () => {
    const formatted = formatHanaSql(currentNode.sqlContent);
    handleSqlChange(formatted);
  };

  const handleApplyQuickFix = (fix: string | undefined, lineNum: number) => {
    if (!fix) return;
    if (fix.includes("Change 'CREATE TABLE' to 'CREATE COLUMN TABLE'")) {
      const newSql = currentNode.sqlContent.replace(/CREATE\s+TABLE/i, 'CREATE COLUMN TABLE');
      handleSqlChange(newSql);
    } else if (fix.includes("WITH PRIMARY KEY")) {
      const newSql = currentNode.sqlContent.trim().replace(/;?$/, '\nWITH PRIMARY KEY;');
      handleSqlChange(newSql);
    } else if (fix.includes("END;")) {
      const newSql = currentNode.sqlContent.trim().replace(/;?$/, '\nEND;');
      handleSqlChange(newSql);
    } else if (fix.includes("Replace ISNULL with IFNULL")) {
      const newSql = currentNode.sqlContent.replace(/ISNULL\s*\(/gi, 'IFNULL(');
      handleSqlChange(newSql);
    } else if (fix.includes("Replace GETDATE() with CURRENT_TIMESTAMP")) {
      const newSql = currentNode.sqlContent.replace(/GETDATE\s*\(\s*\)/gi, 'CURRENT_TIMESTAMP');
      handleSqlChange(newSql);
    } else if (fix.includes("Add trailing semicolon")) {
      const newSql = currentNode.sqlContent.trim() + ';';
      handleSqlChange(newSql);
    } else if (fix.includes("Convert query to SELECT")) {
      const newSql = `SELECT * FROM (${currentNode.sqlContent.replace(/;?$/, '')});`;
      handleSqlChange(newSql);
    }
  };

  const handleInsertSnippet = (snippetType: string) => {
    let snippet = '';
    switch (snippetType) {
      case 'aggregation_kpi':
        snippet = `\nSELECT 
    "CATEGORY",
    COUNT(DISTINCT "DOCUMENT_ID") AS "TOTAL_COUNT",
    SUM("AMOUNT") AS "TOTAL_REVENUE",
    ROUND(AVG("AMOUNT"), 2) AS "AVG_REVENUE",
    MIN("AMOUNT") AS "MIN_AMOUNT",
    MAX("AMOUNT") AS "MAX_AMOUNT"
FROM "SCHEMA"."FACT_TABLE"
WHERE "STATUS" = 'POSTED'
GROUP BY "CATEGORY"
HAVING SUM("AMOUNT") > 0
ORDER BY "TOTAL_REVENUE" DESC;`;
        break;
      case 'master_join':
        snippet = `\nSELECT 
    head."DOC_ID",
    item."LINE_ID",
    cust."NAME" AS "CUSTOMER_NAME",
    cust."COUNTRY_CODE",
    item."MATERIAL",
    item."QUANTITY",
    item."AMOUNT"
FROM "SCHEMA"."HEADER_TABLE" AS head
INNER JOIN "SCHEMA"."ITEM_TABLE" AS item 
    ON head."DOC_ID" = item."DOC_ID"
LEFT OUTER JOIN "SCHEMA"."CUSTOMER_MASTER" AS cust 
    ON head."CUSTOMER_ID" = cust."CUSTOMER_ID"
WHERE head."DOC_DATE" >= :IP_START_DATE
ORDER BY item."AMOUNT" DESC;`;
        break;
      case 'cte_query':
        snippet = `\nWITH ranked_orders AS (
    SELECT 
        "CUSTOMER_ID",
        "SALES_AMOUNT",
        ROW_NUMBER() OVER (PARTITION BY "CUSTOMER_ID" ORDER BY "ORDER_DATE" DESC) AS "ORDER_SEQ"
    FROM "SCHEMA"."FACT_ORDERS"
)
SELECT 
    "CUSTOMER_ID",
    "SALES_AMOUNT"
FROM ranked_orders
WHERE "ORDER_SEQ" = 1;`;
        break;
      case 'window_ranking':
        snippet = `\nSELECT 
    "CATEGORY",
    "PRODUCT_ID",
    "REVENUE",
    DENSE_RANK() OVER (PARTITION BY "CATEGORY" ORDER BY "REVENUE" DESC) AS "CATEGORY_RANK"
FROM "SCHEMA"."FACT_SALES";`;
        break;
    }

    handleSqlChange(currentNode.sqlContent + snippet);
  };

  const handleCopySql = () => {
    navigator.clipboard.writeText(currentNode.sqlContent);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Sequence nodes sorted by execution order
  const sortedNodes = [...pipeline.nodes].sort((a, b) => a.executionOrder - b.executionOrder);
  const currentIndex = sortedNodes.findIndex((n) => n.id === currentNode.id);
  const prevNode = currentIndex > 0 ? sortedNodes[currentIndex - 1] : null;
  const nextNode = currentIndex < sortedNodes.length - 1 ? sortedNodes[currentIndex + 1] : null;

  // Filter diagnostics
  const errors = validation.diagnostics.filter((d) => d.severity === 'error');
  const warnings = validation.diagnostics.filter((d) => d.severity === 'warning');
  const infos = validation.diagnostics.filter((d) => d.severity === 'info');

  const filteredDiagnostics = validation.diagnostics.filter((d) => {
    if (diagFilter === 'errors') return d.severity === 'error';
    if (diagFilter === 'warnings') return d.severity === 'warning';
    if (diagFilter === 'info') return d.severity === 'info';
    return true;
  });

  return (
    <div className="fixed inset-0 z-50 bg-white text-slate-800 flex flex-col overflow-hidden animate-fadeIn">
      {/* Top Header Navigation Bar */}
      <header className="h-14 bg-white border-b border-slate-200 px-4 flex items-center justify-between shrink-0 select-none shadow-sm">
        {/* Left Section: Back to Flow & Node Identity */}
        <div className="flex items-center gap-3">
          <button
            type="button"
            id="back-to-flow-button"
            onClick={onClose}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-white hover:bg-slate-50 text-slate-700 hover:text-[#e20074] rounded-md text-xs font-medium transition-colors border border-slate-200 hover:border-[#f8b4d9] shadow-sm"
            title="Return to visual flow diagram"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Back to Flow</span>
          </button>

          <div className="h-4 w-px bg-slate-200 mx-1" />

          {/* Node Step Badge & Title */}
          <div className="flex items-center gap-2">
            <span className="px-2.5 py-0.5 bg-[#fdf0f6] text-[#c70066] font-mono text-xs font-semibold rounded-md border border-[#f8b4d9] shadow-sm">
              Step {currentNode.executionOrder}
            </span>

            <input
              type="text"
              id="node-title-input"
              value={currentNode.name}
              onChange={(e) => {
                const updated = { ...currentNode, name: e.target.value };
                setCurrentNode(updated);
                onSaveNode(updated);
              }}
              className="bg-transparent font-semibold text-sm text-slate-900 focus:bg-slate-100 rounded px-2 py-1 outline-none border border-transparent focus:border-[#e20074] w-64 md:w-80 transition-colors"
              placeholder="Query Node Name..."
            />
          </div>

          {/* Query Type Indicator (Enforced Safe Mode) */}
          <div
            id="query-type-badge"
            className="flex items-center gap-1.5 px-2.5 py-1 bg-[#fdf0f6] border border-[#f8b4d9] rounded text-xs font-semibold text-[#c70066]"
            title="Safe Mode: SELECT query only"
          >
            <span className="text-slate-500 font-normal">Type:</span>
            <span className="font-mono text-[#e20074] font-bold">SELECT</span>
          </div>

          {/* Safe Mode Enforced Badge */}
          <div
            id="editor-safe-mode-badge"
            className="hidden lg:flex items-center gap-1.5 px-2.5 py-1 bg-emerald-50 text-emerald-800 rounded-md border border-emerald-200 text-xs font-semibold"
            title="Safe Mode active: Read-only SELECT operations only. Table creation and deletion are blocked."
          >
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
            <span>Safe Mode Active</span>
          </div>
        </div>

        {/* Right Section: Syntax Status Badge & Actions */}
        <div className="flex items-center gap-2">
          {/* Real-time Syntax Health Indicator */}
          <div
            id="syntax-status-badge"
            className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium border ${
              validation.isValid
                ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                : 'bg-rose-50 text-rose-700 border-rose-200'
            }`}
          >
            {validation.isValid ? (
              <>
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                <span>HANA Syntax Valid</span>
                {validation.warningCount > 0 && (
                  <span className="text-amber-600 font-mono ml-1">({validation.warningCount} hints)</span>
                )}
              </>
            ) : (
              <>
                <AlertCircle className="w-3.5 h-3.5 text-rose-600 shrink-0" />
                <span className="font-semibold">{validation.errorCount} Syntax Error{validation.errorCount > 1 ? 's' : ''}</span>
              </>
            )}
          </div>

          <div className="h-4 w-px bg-slate-200" />

          {/* Quick Action Buttons */}
          <button
            type="button"
            id="format-sql-btn"
            onClick={handleFormatSql}
            className="flex items-center gap-1.5 px-2.5 py-1 bg-white hover:bg-slate-50 text-slate-700 hover:text-[#e20074] rounded text-xs font-medium transition-colors border border-slate-200 hover:border-[#f8b4d9] shadow-sm"
            title="Format SAP HANA SQL"
          >
            <Code2 className="w-3.5 h-3.5 text-[#e20074]" />
            <span>Format</span>
          </button>

          {/* Snippets Dropdown */}
          <div className="relative group">
            <button
              type="button"
              className="flex items-center gap-1 px-2.5 py-1 bg-white hover:bg-slate-50 text-slate-700 hover:text-[#e20074] rounded text-xs font-medium transition-colors border border-slate-200 hover:border-[#f8b4d9] shadow-sm"
            >
              <FileCode className="w-3.5 h-3.5 text-[#e20074]" />
              <span>Snippets</span>
            </button>
            <div className="absolute right-0 top-full mt-1 w-56 bg-white border border-slate-200 rounded-lg shadow-xl py-1 hidden group-hover:block z-30">
              <button
                type="button"
                onClick={() => handleInsertSnippet('aggregation_kpi')}
                className="w-full text-left px-3 py-1.5 text-xs text-slate-700 hover:bg-[#fdf0f6] hover:text-[#c70066] flex items-center gap-2"
              >
                <Layers className="w-3.5 h-3.5 text-[#e20074]" />
                <span>SELECT KPI Aggregation</span>
              </button>
              <button
                type="button"
                onClick={() => handleInsertSnippet('master_join')}
                className="w-full text-left px-3 py-1.5 text-xs text-slate-700 hover:bg-[#fdf0f6] hover:text-[#c70066] flex items-center gap-2"
              >
                <ArrowRightLeft className="w-3.5 h-3.5 text-amber-600" />
                <span>SELECT Dimension Joins</span>
              </button>
              <button
                type="button"
                onClick={() => handleInsertSnippet('window_ranking')}
                className="w-full text-left px-3 py-1.5 text-xs text-slate-700 hover:bg-[#fdf0f6] hover:text-[#c70066] flex items-center gap-2"
              >
                <Zap className="w-3.5 h-3.5 text-[#e20074]" />
                <span>SELECT Window DENSE_RANK()</span>
              </button>
              <button
                type="button"
                onClick={() => handleInsertSnippet('cte_query')}
                className="w-full text-left px-3 py-1.5 text-xs text-slate-700 hover:bg-[#fdf0f6] hover:text-[#c70066] flex items-center gap-2"
              >
                <Terminal className="w-3.5 h-3.5 text-indigo-600" />
                <span>WITH CTE Sequence SELECT</span>
              </button>
            </div>
          </div>

          {/* Copy SQL */}
          <button
            type="button"
            onClick={handleCopySql}
            className="p-1.5 bg-white hover:bg-slate-50 text-slate-700 hover:text-[#e20074] rounded text-xs transition-colors border border-slate-200 hover:border-[#f8b4d9] shadow-sm"
            title="Copy SQL Query"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
          </button>

          {/* Full Screen Documentation Button */}
          {onOpenDocumentation && (
            <button
              type="button"
              id="header-open-doc-btn"
              onClick={() => onOpenDocumentation(currentNode)}
              className="flex items-center gap-1.5 px-2.5 py-1 bg-[#fdf0f6] hover:bg-[#fce4f0] text-[#c70066] rounded text-xs font-semibold transition-colors border border-[#f8b4d9] shadow-sm cursor-pointer"
              title="Open Full Screen Technical Documentation for this node"
            >
              <BookOpen className="w-3.5 h-3.5 text-[#e20074]" />
              <span className="hidden sm:inline">Documentation</span>
            </button>
          )}
        </div>
      </header>

      {/* Node Metadata Sub-Bar: Title & Description Editing + Documentation Button */}
      <div className="bg-white border-b border-slate-200 px-4 py-2 flex flex-wrap items-center justify-between gap-3 text-xs shrink-0 shadow-2xs">
        <div className="flex items-center gap-3 flex-1 min-w-[320px]">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider shrink-0">Title:</span>
            <input
              type="text"
              id="node-title-edit-input"
              value={currentNode.name}
              onChange={(e) => {
                const updated = { ...currentNode, name: e.target.value };
                setCurrentNode(updated);
                onSaveNode(updated);
              }}
              className="bg-slate-50 hover:bg-white focus:bg-white border border-slate-200 focus:border-[#e20074] rounded-md px-2.5 py-1 text-xs font-semibold text-slate-900 w-52 md:w-64 outline-none transition-colors"
              placeholder="Query Node Name..."
            />
          </div>

          <div className="flex items-center gap-2 flex-1 min-w-[220px]">
            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider shrink-0">Description:</span>
            <input
              type="text"
              id="node-desc-edit-input"
              value={currentNode.description || ''}
              onChange={(e) => {
                const updated = { ...currentNode, description: e.target.value };
                setCurrentNode(updated);
                onSaveNode(updated);
              }}
              className="bg-slate-50 hover:bg-white focus:bg-white border border-slate-200 focus:border-[#e20074] rounded-md px-2.5 py-1 text-xs text-slate-700 flex-1 outline-none transition-colors"
              placeholder="Describe this SQL query transformation step..."
            />
          </div>
        </div>

        {/* Action: Open Full Screen Documentation & Save indicator */}
        <div className="flex items-center gap-2 shrink-0">
          {onOpenDocumentation && (
            <button
              type="button"
              id="node-open-doc-button"
              onClick={() => onOpenDocumentation(currentNode)}
              className="flex items-center gap-1.5 px-3 py-1 bg-[#fdf0f6] hover:bg-[#fce4f0] text-[#c70066] border border-[#f8b4d9] hover:border-[#e20074] rounded-md text-xs font-semibold transition-all shadow-xs cursor-pointer"
              title="Open full screen documentation for this node"
            >
              <BookOpen className="w-3.5 h-3.5 text-[#e20074]" />
              <span>Documentation (Full Screen)</span>
            </button>
          )}

          <div className="flex items-center gap-1 text-[11px] text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200 font-medium">
            <CheckCircle2 className="w-3 h-3 text-emerald-600" />
            <span>Saved</span>
          </div>
        </div>
      </div>

      {/* Main Workspace Layout (Editor on Left, Diagnostics exclusively on Right) */}
      <div className="flex-1 flex flex-col lg:flex-row overflow-hidden">
        {/* Left / Center: Full Size Code Editor */}
        <div className="flex-1 flex flex-col h-full overflow-hidden p-3 bg-slate-100">
          <div className="flex-1 h-full min-h-[300px] border border-slate-200 rounded-xl overflow-hidden shadow-sm">
            <HanaCodeEditor
              value={currentNode.sqlContent}
              onChange={handleSqlChange}
              diagnostics={validation.diagnostics}
              onCursorChange={(line, col) => setCursorPos({ line, col })}
            />
          </div>
        </div>

        {/* Right: Dedicated Diagnostics Panel */}
        <aside className="w-full lg:w-[460px] xl:w-[500px] bg-white border-t lg:border-t-0 lg:border-l border-slate-200 flex flex-col shrink-0 h-[45vh] lg:h-full overflow-hidden">
          {/* Diagnostics Panel Header */}
          <div className="px-4 py-3 border-b border-slate-200 bg-slate-50/70 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-2">
              <div className="p-1.5 bg-[#fdf0f6] text-[#e20074] rounded-md border border-[#f8b4d9]">
                <Activity className="w-4 h-4" />
              </div>
              <div>
                <h3 className="font-semibold text-xs text-slate-900 tracking-tight">HANA SQL Diagnostics</h3>
                <p className="text-[11px] text-slate-500">Live syntax inspection & dialect validation</p>
              </div>
            </div>

            <div className="flex items-center gap-1.5">
              <span className="px-2 py-0.5 bg-[#fdf0f6] text-[#c70066] font-mono text-[11px] font-bold rounded-md border border-[#f8b4d9]">
                {validation.dialectScore}% Score
              </span>
            </div>
          </div>

          {/* Safe Mode Enforced Notice Card */}
          <div className="p-3 bg-emerald-50/70 border-b border-emerald-100 flex items-start gap-2.5">
            <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
            <div className="text-xs space-y-0.5">
              <p className="font-semibold text-emerald-900">Safe Mode: SELECT Enforced</p>
              <p className="text-[11px] text-emerald-700 leading-snug">
                Read-only analytical queries are permitted. Table schema modifications (CREATE, DROP, ALTER) and mutations (INSERT, UPDATE, DELETE) are strictly blocked.
              </p>
            </div>
          </div>

          {/* Diagnostic Filter Bar */}
          <div className="px-4 py-2 border-b border-slate-200 bg-white flex items-center justify-between gap-2 shrink-0">
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setDiagFilter('all')}
                className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                  diagFilter === 'all'
                    ? 'bg-[#e20074] text-white font-semibold shadow-sm'
                    : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
                }`}
              >
                All ({validation.diagnostics.length})
              </button>

              <button
                type="button"
                onClick={() => setDiagFilter('errors')}
                className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                  diagFilter === 'errors'
                    ? 'bg-rose-600 text-white font-semibold shadow-sm'
                    : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
                }`}
              >
                Errors ({errors.length})
              </button>

              <button
                type="button"
                onClick={() => setDiagFilter('warnings')}
                className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                  diagFilter === 'warnings'
                    ? 'bg-amber-600 text-white font-semibold shadow-sm'
                    : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
                }`}
              >
                Warnings ({warnings.length})
              </button>

              {infos.length > 0 && (
                <button
                  type="button"
                  onClick={() => setDiagFilter('info')}
                  className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                    diagFilter === 'info'
                      ? 'bg-sky-600 text-white font-semibold shadow-sm'
                      : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
                  }`}
                >
                  Hints ({infos.length})
                </button>
              )}
            </div>

            <span className="text-[11px] text-slate-400 font-mono hidden sm:inline">
              {filteredDiagnostics.length} visible
            </span>
          </div>

          {/* Diagnostic Issues List */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3 text-xs">
            {validation.diagnostics.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center text-slate-500">
                <div className="w-12 h-12 rounded-full bg-emerald-50 border border-emerald-200 flex items-center justify-center text-emerald-600 mb-3 shadow-sm">
                  <CheckCheck className="w-6 h-6" />
                </div>
                <p className="font-semibold text-slate-900 text-sm">HANA SQL Syntax & Safe Mode Valid</p>
                <p className="text-slate-500 text-xs mt-1 max-w-xs leading-relaxed">
                  No syntax errors or unauthorized operations detected. Query conforms to SAP HANA Cloud SQL analytical standards.
                </p>
              </div>
            ) : filteredDiagnostics.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-center text-slate-400">
                <p className="text-xs">No issues found matching the "{diagFilter}" filter.</p>
              </div>
            ) : (
              <div className="space-y-2.5">
                {filteredDiagnostics.map((diag, idx) => (
                  <div
                    key={idx}
                    className={`p-3.5 rounded-xl border flex flex-col gap-2 transition-all shadow-sm ${
                      diag.severity === 'error'
                        ? 'bg-rose-50/60 border-rose-200 text-rose-900'
                        : diag.severity === 'warning'
                        ? 'bg-amber-50/60 border-amber-200 text-amber-900'
                        : 'bg-sky-50/60 border-sky-200 text-sky-900'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 font-semibold text-xs">
                        {diag.severity === 'error' ? (
                          <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                        ) : diag.severity === 'warning' ? (
                          <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                        ) : (
                          <Info className="w-4 h-4 text-sky-600 shrink-0" />
                        )}
                        <span className="font-mono text-[11px] bg-white px-2 py-0.5 rounded border border-slate-200 text-slate-700 shadow-2xs">
                          Line {diag.line}:{diag.column}
                        </span>
                        <span className="uppercase text-[10px] tracking-wider opacity-75 font-mono">
                          {diag.ruleId}
                        </span>
                      </div>

                      <span
                        className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ${
                          diag.severity === 'error'
                            ? 'bg-rose-100 text-rose-700 border border-rose-200'
                            : diag.severity === 'warning'
                            ? 'bg-amber-100 text-amber-700 border border-amber-200'
                            : 'bg-sky-100 text-sky-700 border border-sky-200'
                        }`}
                      >
                        {diag.severity}
                      </span>
                    </div>

                    <p className="text-slate-800 text-xs leading-relaxed font-sans">{diag.message}</p>

                    {diag.suggestedFix && (
                      <div className="flex items-center justify-between gap-2 mt-1 pt-2 border-t border-slate-200/60">
                        <span className="text-slate-600 text-[11px] italic font-sans truncate">
                          Suggested: {diag.suggestedFix}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleApplyQuickFix(diag.suggestedFix, diag.line)}
                          className="flex items-center gap-1 px-2.5 py-1 bg-[#fdf0f6] hover:bg-[#fce4f0] text-[#c70066] font-semibold rounded text-[11px] shrink-0 border border-[#f8b4d9] transition-colors shadow-2xs"
                        >
                          <Wrench className="w-3 h-3 text-[#e20074]" />
                          <span>Quick Fix</span>
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Diagnostics Rule Verification Summary Checklist */}
            <div className="mt-4 p-3.5 bg-slate-50 rounded-xl border border-slate-200 space-y-2">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-800">
                <ShieldCheck className="w-3.5 h-3.5 text-[#e20074]" />
                <span>Standard HANA Verification Engine</span>
              </div>
              <ul className="text-[11px] text-slate-600 space-y-1 pl-1">
                <li className="flex items-center gap-1.5">
                  <span className="text-emerald-600 font-bold">✓</span>
                  <span>Safe Mode: SELECT-only enforcement</span>
                </li>
                <li className="flex items-center gap-1.5">
                  <span className="text-emerald-600 font-bold">✓</span>
                  <span>Balanced brackets, parentheses & quotes</span>
                </li>
                <li className="flex items-center gap-1.5">
                  <span className="text-emerald-600 font-bold">✓</span>
                  <span>HANA reserved keyword & function dialect checks</span>
                </li>
                <li className="flex items-center gap-1.5">
                  <span className="text-emerald-600 font-bold">✓</span>
                  <span>Columnar aggregation and star-schema syntax validation</span>
                </li>
              </ul>
            </div>
          </div>
        </aside>
      </div>

      {/* Bottom Status & Sequence Stepper Footer */}
      <footer className="h-10 bg-white border-t border-slate-200 px-4 flex items-center justify-between shrink-0 text-xs text-slate-500 select-none">
        {/* Sequence Previous / Next Buttons */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            id="prev-node-step-btn"
            disabled={!prevNode}
            onClick={() => prevNode && onNavigateNode(prevNode.id)}
            className="flex items-center gap-1 px-2.5 py-1 bg-white hover:bg-slate-50 text-slate-700 hover:text-[#e20074] disabled:opacity-30 disabled:pointer-events-none rounded text-xs transition-colors border border-slate-200 hover:border-[#f8b4d9] shadow-sm"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
            <span>Prev Query ({prevNode ? `Step ${prevNode.executionOrder}` : 'Start'})</span>
          </button>

          <button
            type="button"
            id="next-node-step-btn"
            disabled={!nextNode}
            onClick={() => nextNode && onNavigateNode(nextNode.id)}
            className="flex items-center gap-1 px-2.5 py-1 bg-white hover:bg-slate-50 text-slate-700 hover:text-[#e20074] disabled:opacity-30 disabled:pointer-events-none rounded text-xs transition-colors border border-slate-200 hover:border-[#f8b4d9] shadow-sm"
          >
            <span>Next Query ({nextNode ? `Step ${nextNode.executionOrder}` : 'End'})</span>
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Live Cursor Information */}
        <div className="flex items-center gap-4 font-mono text-[11px] text-slate-500">
          <span>
            Line <strong className="text-slate-800">{cursorPos.line}</strong>, Column <strong className="text-slate-800">{cursorPos.col}</strong>
          </span>
          <span>{currentNode.sqlContent.length} chars</span>
          <span className="hidden sm:inline text-[#c70066] font-semibold">SAP HANA SQL 2.0 / Cloud</span>
        </div>
      </footer>
    </div>
  );
};
