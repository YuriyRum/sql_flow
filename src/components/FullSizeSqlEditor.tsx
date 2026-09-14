import React, { useState, useEffect, useRef, useCallback } from 'react';
import { SQLNode, ValidationResult, FlowPipeline } from '../types';
import { HanaCodeEditor } from './HanaCodeEditor';
import { validateHanaSql, formatHanaSql } from '../utils/hanaSqlValidator';
import {
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  Info,
  Code2,
  Undo2,
  Redo2,
  Save,
  ArrowUpRight,
  PanelRightClose,
  PanelRightOpen,
} from 'lucide-react';

export interface FullSizeSqlEditorProps {
  initialSql?: string;
  onSaveSql?: (sql: string) => void;
  // Optional backward compatibility props
  node?: SQLNode;
  pipeline?: FlowPipeline;
  onSaveNode?: (updatedNode: SQLNode) => void;
  onClose?: () => void;
  onNavigateNode?: (nodeId: string) => void;
  onOpenDocumentation?: (node: SQLNode) => void;
  onAddNode?: () => void;
  onDeleteNode?: (nodeId: string) => void;
}

const FALLBACK_SQL = `-- SAP HANA SQL SELECT Query
SELECT 
    v."SALES_DOCUMENT",
    v."COMPANY_CODE",
    v."CUSTOMER_ID",
    v."ORDER_DATE",
    COUNT(*) AS "TOTAL_ITEMS",
    SUM(p."NET_AMOUNT") AS "TOTAL_NET_AMOUNT"
FROM "SAP_S4HANA"."VBAK" AS v
INNER JOIN "SAP_S4HANA"."VBAP" AS p
    ON v."SALES_DOCUMENT" = p."SALES_DOCUMENT"
WHERE v."ORDER_DATE" >= ADD_MONTHS(CURRENT_DATE, -12)
    AND v."STATUS" = 'A'
GROUP BY 
    v."SALES_DOCUMENT",
    v."COMPANY_CODE",
    v."CUSTOMER_ID",
    v."ORDER_DATE"
ORDER BY "TOTAL_NET_AMOUNT" DESC;
`;

export const FullSizeSqlEditor: React.FC<FullSizeSqlEditorProps> = ({
  initialSql,
  onSaveSql,
  node,
  onSaveNode,
}) => {
  const startingSql = initialSql ?? node?.sqlContent ?? FALLBACK_SQL;
  const [sqlContent, setSqlContent] = useState<string>(startingSql);
  const [validation, setValidation] = useState<ValidationResult>(() => validateHanaSql(startingSql));
  const [cursorPos, setCursorPos] = useState({ line: 1, col: 1 });
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [targetLine, setTargetLine] = useState<number | null>(null);

  // Diagnostics panel state - open by default as requested ("diagnostics must be here")
  const [showDiagnostics, setShowDiagnostics] = useState(true);
  const [diagnosticFilter, setDiagnosticFilter] = useState<'all' | 'error' | 'warning'>('all');

  // Baseline reference for detecting dirty/unsaved state
  const savedSqlRef = useRef<string>(startingSql);
  const isDirty = sqlContent !== savedSqlRef.current;

  // Undo / Redo history stack
  const historyRef = useRef<string[]>([startingSql]);
  const historyIndexRef = useRef<number>(0);
  const isUndoRedoActionRef = useRef<boolean>(false);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  const updateUndoRedoState = useCallback(() => {
    setCanUndo(historyIndexRef.current > 0);
    setCanRedo(historyIndexRef.current < historyRef.current.length - 1);
  }, []);

  // Update when initialSql changes externally
  useEffect(() => {
    if (initialSql !== undefined && initialSql !== savedSqlRef.current) {
      setSqlContent(initialSql);
      savedSqlRef.current = initialSql;
      setValidation(validateHanaSql(initialSql));
      historyRef.current = [initialSql];
      historyIndexRef.current = 0;
      updateUndoRedoState();
      setSaveSuccess(false);
    }
  }, [initialSql, updateUndoRedoState]);

  // Save handler
  const handleSave = useCallback(() => {
    savedSqlRef.current = sqlContent;
    onSaveSql?.(sqlContent);

    if (node && onSaveNode) {
      const res = validateHanaSql(sqlContent);
      onSaveNode({
        ...node,
        sqlContent,
        validationSummary: {
          isValid: res.isValid,
          errors: res.errorCount,
          warnings: res.warningCount,
        },
      });
    }

    setSaveSuccess(true);
    setTimeout(() => {
      setSaveSuccess(false);
    }, 2000);
  }, [sqlContent, onSaveSql, node, onSaveNode]);

  // SQL Change handler
  const handleSqlChange = useCallback(
    (newSql: string, pushHistory = true) => {
      const res = validateHanaSql(newSql);
      setValidation(res);
      setSqlContent(newSql);

      if (pushHistory && !isUndoRedoActionRef.current) {
        const currentIdx = historyIndexRef.current;
        const currentVal = historyRef.current[currentIdx];
        if (currentVal !== newSql) {
          const newHistory = historyRef.current.slice(0, currentIdx + 1);
          newHistory.push(newSql);
          if (newHistory.length > 150) {
            newHistory.shift();
          }
          historyRef.current = newHistory;
          historyIndexRef.current = newHistory.length - 1;
          updateUndoRedoState();
        }
      }
    },
    [updateUndoRedoState]
  );

  // Undo Action
  const handleUndo = useCallback(() => {
    if (historyIndexRef.current > 0) {
      isUndoRedoActionRef.current = true;
      historyIndexRef.current -= 1;
      const previousSql = historyRef.current[historyIndexRef.current];
      handleSqlChange(previousSql, false);
      updateUndoRedoState();
      setTimeout(() => {
        isUndoRedoActionRef.current = false;
      }, 50);
    }
  }, [handleSqlChange, updateUndoRedoState]);

  // Redo Action
  const handleRedo = useCallback(() => {
    if (historyIndexRef.current < historyRef.current.length - 1) {
      isUndoRedoActionRef.current = true;
      historyIndexRef.current += 1;
      const nextSql = historyRef.current[historyIndexRef.current];
      handleSqlChange(nextSql, false);
      updateUndoRedoState();
      setTimeout(() => {
        isUndoRedoActionRef.current = false;
      }, 50);
    }
  }, [handleSqlChange, updateUndoRedoState]);

  // Format SQL Action
  const handleFormatSql = useCallback(() => {
    const formatted = formatHanaSql(sqlContent);
    handleSqlChange(formatted);
  }, [sqlContent, handleSqlChange]);

  // Jump to specific line from diagnostics
  const handleJumpToLine = useCallback((line: number) => {
    setTargetLine(null);
    setTimeout(() => {
      setTargetLine(line);
    }, 10);
  }, []);

  // Keyboard shortcuts (Ctrl+S, Ctrl+Z, Ctrl+Y, Shift+Alt+F)
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
      const modifier = isMac ? e.metaKey : e.ctrlKey;

      // Save
      if (modifier && e.key.toLowerCase() === 's') {
        e.preventDefault();
        handleSave();
        return;
      }

      // Undo / Redo
      if (modifier && e.key.toLowerCase() === 'z') {
        if (e.shiftKey) {
          e.preventDefault();
          handleRedo();
        } else {
          e.preventDefault();
          handleUndo();
        }
        return;
      }

      if (modifier && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        handleRedo();
        return;
      }

      // Format SQL (Shift+Alt+F or Ctrl+Shift+F)
      if (e.shiftKey && (e.altKey || modifier) && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        handleFormatSql();
        return;
      }
    };

    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [handleSave, handleUndo, handleRedo, handleFormatSql]);

  // Filter diagnostics list
  const filteredDiagnostics = validation.diagnostics.filter((diag) => {
    if (diagnosticFilter === 'error') return diag.severity === 'error';
    if (diagnosticFilter === 'warning') return diag.severity === 'warning';
    return true;
  });

  return (
    <div className="fixed inset-0 z-50 bg-white text-slate-800 flex flex-col overflow-hidden animate-fadeIn">
      {/* Top Toolbar: ONLY Save, Undo, Redo, Format + Diagnostics Toggle */}
      <header className="h-11 bg-white border-b border-slate-200 px-3 flex items-center justify-between shrink-0 select-none shadow-2xs z-30">
        <div className="flex items-center gap-1.5">
          {/* Save */}
          <button
            type="button"
            id="save-btn"
            onClick={handleSave}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-all cursor-pointer ${
              isDirty
                ? 'bg-[#e20074] hover:bg-[#c70066] text-white shadow-xs'
                : 'bg-slate-100 hover:bg-slate-200 text-slate-800 border border-slate-200'
            }`}
            title="Save (Ctrl+S / Cmd+S)"
          >
            <Save className="w-3.5 h-3.5" />
            <span>{saveSuccess ? 'Saved' : 'Save'}</span>
          </button>

          <div className="h-4 w-px bg-slate-200 mx-1" />

          {/* Undo */}
          <button
            type="button"
            id="undo-btn"
            disabled={!canUndo}
            onClick={handleUndo}
            className="flex items-center gap-1.5 px-2.5 py-1.5 bg-white hover:bg-slate-100 text-slate-700 disabled:opacity-35 disabled:pointer-events-none rounded-md text-xs font-medium transition-colors border border-slate-200 cursor-pointer"
            title="Undo (Ctrl+Z / Cmd+Z)"
          >
            <Undo2 className="w-3.5 h-3.5 text-[#e20074]" />
            <span>Undo</span>
          </button>

          {/* Redo */}
          <button
            type="button"
            id="redo-btn"
            disabled={!canRedo}
            onClick={handleRedo}
            className="flex items-center gap-1.5 px-2.5 py-1.5 bg-white hover:bg-slate-100 text-slate-700 disabled:opacity-35 disabled:pointer-events-none rounded-md text-xs font-medium transition-colors border border-slate-200 cursor-pointer"
            title="Redo (Ctrl+Y / Cmd+Shift+Z)"
          >
            <Redo2 className="w-3.5 h-3.5 text-[#e20074]" />
            <span>Redo</span>
          </button>

          <div className="h-4 w-px bg-slate-200 mx-1" />

          {/* Format */}
          <button
            type="button"
            id="format-btn"
            onClick={handleFormatSql}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-white hover:bg-slate-100 text-slate-700 hover:text-[#e20074] rounded-md text-xs font-semibold transition-colors border border-slate-200 cursor-pointer"
            title="Format SQL (Shift+Alt+F)"
          >
            <Code2 className="w-3.5 h-3.5 text-[#e20074]" />
            <span>Format</span>
          </button>
        </div>

        {/* Right side: Diagnostics button toggle */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            id="diagnostics-toggle-btn"
            onClick={() => setShowDiagnostics((prev) => !prev)}
            className={`flex items-center gap-2 px-2.5 py-1.5 rounded-md text-xs font-semibold transition-colors border cursor-pointer ${
              showDiagnostics
                ? 'bg-slate-100 text-slate-900 border-slate-300'
                : 'bg-white hover:bg-slate-50 text-slate-600 border-slate-200'
            }`}
            title="Toggle Diagnostics Panel"
          >
            {validation.errorCount > 0 ? (
              <AlertCircle className="w-3.5 h-3.5 text-rose-600 shrink-0" />
            ) : validation.warningCount > 0 ? (
              <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
            ) : (
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
            )}
            <span>Diagnostics</span>
            <span
              className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono ${
                validation.errorCount > 0
                  ? 'bg-rose-100 text-rose-700 font-bold'
                  : validation.warningCount > 0
                  ? 'bg-amber-100 text-amber-700 font-bold'
                  : 'bg-emerald-100 text-emerald-700 font-medium'
              }`}
            >
              {validation.diagnostics.length}
            </span>
            {showDiagnostics ? (
              <PanelRightClose className="w-3.5 h-3.5 text-slate-400" />
            ) : (
              <PanelRightOpen className="w-3.5 h-3.5 text-slate-400" />
            )}
          </button>
        </div>
      </header>

      {/* Main Workspace: Full-Size SQL Editor + Diagnostics Panel */}
      <div className="flex-1 flex overflow-hidden w-full h-full bg-white">
        {/* Left: SQL Editor Area */}
        <div className="flex-1 flex flex-col overflow-hidden h-full">
          <HanaCodeEditor
            value={sqlContent}
            onChange={(newVal) => handleSqlChange(newVal, true)}
            diagnostics={validation.diagnostics}
            onCursorChange={(line, col) => setCursorPos({ line, col })}
            onUndo={handleUndo}
            onRedo={handleRedo}
            onSave={handleSave}
            targetLine={targetLine}
          />
        </div>

        {/* Right: Diagnostics Panel */}
        {showDiagnostics && (
          <aside
            id="diagnostics-panel"
            className="w-80 sm:w-96 lg:w-[400px] xl:w-[440px] bg-slate-50/60 border-l border-slate-200 flex flex-col shrink-0 h-full overflow-hidden shadow-2xs z-20"
          >
            {/* Diagnostics Header */}
            <div className="p-3 bg-white border-b border-slate-200 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2">
                <div
                  className={`w-2.5 h-2.5 rounded-full ${
                    validation.errorCount > 0
                      ? 'bg-rose-500 animate-pulse'
                      : validation.warningCount > 0
                      ? 'bg-amber-500'
                      : 'bg-emerald-500'
                  }`}
                />
                <h2 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                  Diagnostics
                </h2>
                <span className="text-[11px] font-mono text-slate-400">
                  ({validation.diagnostics.length})
                </span>
              </div>

              {/* Status Score Badge */}
              <span
                className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded-full border ${
                  validation.isValid
                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                    : 'bg-rose-50 text-rose-700 border-rose-200'
                }`}
              >
                {validation.isValid ? 'SAP HANA Valid' : `${validation.errorCount} Issues`}
              </span>
            </div>

            {/* Filter Tabs */}
            <div className="px-3 py-2 bg-white border-b border-slate-200 flex items-center gap-1.5 text-xs shrink-0">
              <button
                type="button"
                onClick={() => setDiagnosticFilter('all')}
                className={`px-2.5 py-1 rounded text-[11px] font-semibold transition-colors cursor-pointer ${
                  diagnosticFilter === 'all'
                    ? 'bg-slate-800 text-white shadow-2xs'
                    : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                All ({validation.diagnostics.length})
              </button>
              <button
                type="button"
                onClick={() => setDiagnosticFilter('error')}
                className={`px-2.5 py-1 rounded text-[11px] font-semibold transition-colors cursor-pointer ${
                  diagnosticFilter === 'error'
                    ? 'bg-rose-600 text-white shadow-2xs'
                    : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                Errors ({validation.errorCount})
              </button>
              <button
                type="button"
                onClick={() => setDiagnosticFilter('warning')}
                className={`px-2.5 py-1 rounded text-[11px] font-semibold transition-colors cursor-pointer ${
                  diagnosticFilter === 'warning'
                    ? 'bg-amber-600 text-white shadow-2xs'
                    : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                Warnings ({validation.warningCount})
              </button>
            </div>

            {/* Diagnostics List */}
            <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
              {filteredDiagnostics.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center p-6 text-slate-500">
                  <div className="w-12 h-12 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center mb-3">
                    <CheckCircle2 className="w-6 h-6" />
                  </div>
                  <h3 className="text-xs font-bold text-slate-800 mb-1">
                    No Diagnostics Detected
                  </h3>
                  <p className="text-[11px] text-slate-500 max-w-[240px] leading-relaxed">
                    {diagnosticFilter === 'all'
                      ? 'Your SQL statement conforms with SAP HANA syntax rules and standards.'
                      : `No ${diagnosticFilter}s found for this SQL statement.`}
                  </p>
                </div>
              ) : (
                filteredDiagnostics.map((diag, index) => {
                  const isError = diag.severity === 'error';
                  const isWarning = diag.severity === 'warning';

                  return (
                    <div
                      key={index}
                      className={`p-3 rounded-lg border transition-all text-xs flex flex-col gap-2 ${
                        isError
                          ? 'bg-white border-rose-200 hover:border-rose-400 shadow-2xs'
                          : isWarning
                          ? 'bg-white border-amber-200 hover:border-amber-400 shadow-2xs'
                          : 'bg-white border-slate-200 hover:border-slate-300 shadow-2xs'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-start gap-2 min-w-0">
                          {isError ? (
                            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                          ) : isWarning ? (
                            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                          ) : (
                            <Info className="w-4 h-4 text-sky-600 shrink-0 mt-0.5" />
                          )}
                          <div>
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span
                                className={`text-[10px] font-mono font-bold uppercase px-1.5 py-0.2 rounded ${
                                  isError
                                    ? 'bg-rose-100 text-rose-700'
                                    : isWarning
                                    ? 'bg-amber-100 text-amber-700'
                                    : 'bg-sky-100 text-sky-700'
                                }`}
                              >
                                {diag.severity}
                              </span>
                              <span className="text-[11px] font-mono text-slate-500">
                                Line {diag.line}, Col {diag.column}
                              </span>
                            </div>
                            <p className="font-medium text-slate-800 mt-1 leading-snug">
                              {diag.message}
                            </p>
                          </div>
                        </div>

                        {/* Jump to Line Button */}
                        <button
                          type="button"
                          onClick={() => handleJumpToLine(diag.line)}
                          className="flex items-center gap-1 px-2 py-1 bg-slate-50 hover:bg-slate-100 text-slate-700 hover:text-[#e20074] rounded border border-slate-200 text-[10px] font-semibold shrink-0 cursor-pointer transition-colors"
                          title={`Go to Line ${diag.line}`}
                        >
                          <span>Line {diag.line}</span>
                          <ArrowUpRight className="w-3 h-3" />
                        </button>
                      </div>

                      {/* Rule ID and Suggested Fix if available */}
                      <div className="pt-1 border-t border-slate-100 flex items-center justify-between text-[10px] font-mono text-slate-400">
                        <span>Rule: {diag.ruleId}</span>
                        {diag.suggestedFix && (
                          <span className="text-indigo-600 font-sans font-medium">
                            Suggestion available
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </aside>
        )}
      </div>

      {/* Bottom Status Bar */}
      <footer className="h-7 bg-white border-t border-slate-200 px-3 flex items-center justify-between shrink-0 select-none text-[11px] text-slate-500 font-mono">
        <div className="flex items-center gap-2">
          {validation.isValid ? (
            <button
              type="button"
              onClick={() => setShowDiagnostics(true)}
              className="text-emerald-700 font-medium flex items-center gap-1 hover:underline cursor-pointer"
            >
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
              <span>SAP HANA SQL Valid</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setShowDiagnostics(true)}
              className="text-rose-700 font-medium flex items-center gap-1 hover:underline cursor-pointer"
            >
              <AlertCircle className="w-3.5 h-3.5 text-rose-600" />
              <span>{validation.errorCount} syntax error{validation.errorCount > 1 ? 's' : ''}</span>
            </button>
          )}
        </div>

        <div className="flex items-center gap-4">
          <span>
            Line {cursorPos.line}, Column {cursorPos.col}
          </span>
          <span>{sqlContent.length} chars</span>
        </div>
      </footer>
    </div>
  );
};
