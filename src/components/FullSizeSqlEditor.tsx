import React, { useState, useEffect, useRef, useCallback } from 'react';
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
  Activity,
  CheckCheck,
  BookOpen,
  Undo2,
  Redo2,
  Save,
  Power,
  X,
  ExternalLink
} from 'lucide-react';

interface FullSizeSqlEditorProps {
  node: SQLNode;
  pipeline: FlowPipeline;
  onSaveNode: (updatedNode: SQLNode) => void;
  onClose?: () => void;
  onNavigateNode: (nodeId: string) => void;
  onOpenDocumentation?: (node: SQLNode) => void;
  onAddNode?: () => void;
  onDeleteNode?: (nodeId: string) => void;
}

export const FullSizeSqlEditor: React.FC<FullSizeSqlEditorProps> = ({
  node,
  pipeline,
  onSaveNode,
  onClose,
  onNavigateNode,
  onOpenDocumentation,
  onAddNode,
  onDeleteNode,
}) => {
  const [currentNode, setCurrentNode] = useState<SQLNode>(node);
  const [validation, setValidation] = useState<ValidationResult>(() => validateHanaSql(node.sqlContent));
  const [copied, setCopied] = useState(false);
  const [cursorPos, setCursorPos] = useState({ line: 1, col: 1 });
  const [diagFilter, setDiagFilter] = useState<'all' | 'errors' | 'warnings' | 'info'>('all');
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [mobileView, setMobileView] = useState<'editor' | 'diagnostics'>('editor');
  const [scrollToLineNum, setScrollToLineNum] = useState<number | null>(null);

  const handleJumpToDiagnosticLine = (line: number) => {
    setScrollToLineNum(line);
    setMobileView('editor');
    setTimeout(() => {
      setScrollToLineNum(null);
    }, 100);
  };

  // Reference for saved baseline to detect unsaved modifications
  const savedNodeRef = useRef<SQLNode>({ ...node });

  // Undo / Redo history stack
  const historyRef = useRef<string[]>([node.sqlContent]);
  const historyIndexRef = useRef<number>(0);
  const isUndoRedoActionRef = useRef<boolean>(false);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  // Unsaved changes warning modal state
  const [showUnsavedModal, setShowUnsavedModal] = useState(false);
  const [pendingAction, setPendingAction] = useState<
    null | { type: 'close' } | { type: 'navigate'; targetNodeId: string }
  >(null);

  // Check if current node has unsaved changes compared to saved baseline
  const isDirty =
    currentNode.name !== savedNodeRef.current.name ||
    (currentNode.description || '') !== (savedNodeRef.current.description || '') ||
    currentNode.enabled !== savedNodeRef.current.enabled ||
    currentNode.sqlContent !== savedNodeRef.current.sqlContent;

  const updateUndoRedoState = useCallback(() => {
    setCanUndo(historyIndexRef.current > 0);
    setCanRedo(historyIndexRef.current < historyRef.current.length - 1);
  }, []);

  // Sync state if incoming node changes
  useEffect(() => {
    setCurrentNode(node);
    savedNodeRef.current = { ...node };
    const res = validateHanaSql(node.sqlContent);
    setValidation(res);
    historyRef.current = [node.sqlContent];
    historyIndexRef.current = 0;
    updateUndoRedoState();
    setSaveSuccess(false);
  }, [node, updateUndoRedoState]);

  // Perform Save
  const handleSave = useCallback(() => {
    const res = validateHanaSql(currentNode.sqlContent);
    const updatedToSave: SQLNode = {
      ...currentNode,
      validationSummary: {
        isValid: res.isValid,
        errors: res.errorCount,
        warnings: res.warningCount,
      },
      inputTables: res.extractedTables.inputs,
    };

    if (res.extractedTables.outputs.length > 0) {
      const firstOut = res.extractedTables.outputs[0];
      if (firstOut.includes('.')) {
        const parts = firstOut.replace(/"/g, '').split('.');
        updatedToSave.targetSchema = parts[0];
        updatedToSave.targetTable = parts[1];
      } else {
        updatedToSave.targetTable = firstOut.replace(/"/g, '');
      }
    }

    setCurrentNode(updatedToSave);
    savedNodeRef.current = { ...updatedToSave };
    onSaveNode(updatedToSave);

    setSaveSuccess(true);
    setTimeout(() => {
      setSaveSuccess(false);
    }, 2500);
  }, [currentNode, onSaveNode]);

  // Revalidate on SQL change and record history
  const handleSqlChange = useCallback(
    (newSql: string, pushHistory = true) => {
      const res = validateHanaSql(newSql);
      setValidation(res);

      setCurrentNode((prev) => {
        const updated = { ...prev, sqlContent: newSql };
        updated.validationSummary = {
          isValid: res.isValid,
          errors: res.errorCount,
          warnings: res.warningCount,
        };
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
        return updated;
      });

      if (pushHistory && !isUndoRedoActionRef.current) {
        // Truncate redo history and push new state
        const currentIdx = historyIndexRef.current;
        const currentVal = historyRef.current[currentIdx];
        if (currentVal !== newSql) {
          const newHistory = historyRef.current.slice(0, currentIdx + 1);
          newHistory.push(newSql);
          // Cap history at 150 items
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

  // Format SQL
  const handleFormatSql = () => {
    const formatted = formatHanaSql(currentNode.sqlContent);
    handleSqlChange(formatted);
  };

  const handleCopySql = () => {
    navigator.clipboard.writeText(currentNode.sqlContent);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Safe navigation checks before leaving or switching queries
  const handleAttemptClose = () => {
    if (isDirty) {
      setPendingAction({ type: 'close' });
      setShowUnsavedModal(true);
    } else {
      onClose();
    }
  };

  const handleAttemptNavigate = (targetNodeId: string) => {
    if (isDirty) {
      setPendingAction({ type: 'navigate', targetNodeId });
      setShowUnsavedModal(true);
    } else {
      onNavigateNode(targetNodeId);
    }
  };

  // Resolve unsaved changes warning dialog
  const handleConfirmSaveAndProceed = () => {
    handleSave();
    setShowUnsavedModal(false);
    if (pendingAction?.type === 'close') {
      onClose();
    } else if (pendingAction?.type === 'navigate') {
      onNavigateNode(pendingAction.targetNodeId);
    }
    setPendingAction(null);
  };

  const handleConfirmDiscardAndProceed = () => {
    setCurrentNode(savedNodeRef.current);
    setShowUnsavedModal(false);
    if (pendingAction?.type === 'close') {
      onClose();
    } else if (pendingAction?.type === 'navigate') {
      onNavigateNode(pendingAction.targetNodeId);
    }
    setPendingAction(null);
  };

  const handleCancelUnsavedModal = () => {
    setShowUnsavedModal(false);
    setPendingAction(null);
  };

  // Keyboard shortcut listener for Ctrl+S, Ctrl+Z, Ctrl+Y, Escape
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
      const modifier = isMac ? e.metaKey : e.ctrlKey;

      if (modifier && e.key.toLowerCase() === 's') {
        e.preventDefault();
        handleSave();
        return;
      }

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

      if (e.key === 'Escape') {
        if (showUnsavedModal) {
          setShowUnsavedModal(false);
          setPendingAction(null);
        } else {
          handleAttemptClose();
        }
      }
    };

    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [handleSave, handleUndo, handleRedo, showUnsavedModal, isDirty]);

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
        {/* Left Section: Brand Logo & Node Selector */}
        <div className="flex items-center gap-3">
          {/* Brand Logo */}
          <div className="flex items-center gap-2 px-3 py-1.5 bg-[#fdf0f6] text-[#c70066] rounded-lg border border-[#f8b4d9] font-bold text-xs shadow-2xs">
            <FileCode className="w-4 h-4 text-[#e20074]" />
            <span className="hidden sm:inline">SAP HANA SQL SELECT Editor</span>
          </div>

          {onClose && (
            <button
              type="button"
              id="back-to-flow-button"
              onClick={handleAttemptClose}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-white hover:bg-slate-50 text-slate-700 hover:text-[#e20074] rounded-md text-xs font-medium transition-colors border border-slate-200 hover:border-[#f8b4d9] shadow-sm cursor-pointer"
              title="Return to visual flow diagram"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Back</span>
            </button>
          )}

          <div className="h-4 w-px bg-slate-200 mx-0.5" />

          {/* Statement Dropdown Switcher */}
          {pipeline && pipeline.nodes && pipeline.nodes.length > 1 && (
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] font-medium text-slate-400 hidden md:inline">Query:</span>
              <select
                value={currentNode.id}
                onChange={(e) => handleAttemptNavigate(e.target.value)}
                className="bg-slate-50 border border-slate-200 hover:border-[#f8b4d9] text-slate-800 text-xs font-semibold rounded-md px-2 py-1 outline-none transition-colors cursor-pointer max-w-[180px] sm:max-w-[240px]"
              >
                {pipeline.nodes.map((n) => (
                  <option key={n.id} value={n.id}>
                    Step #{n.executionOrder}: {n.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Node Step Badge & Title Input */}
          <div className="flex items-center gap-2">
            <span className="px-2.5 py-0.5 bg-slate-100 text-slate-700 font-mono text-xs font-bold rounded-md border border-slate-200 shadow-2xs">
              Step #{currentNode.executionOrder}
            </span>

            <input
              type="text"
              id="node-title-input"
              value={currentNode.name}
              onChange={(e) => {
                setCurrentNode((prev) => ({ ...prev, name: e.target.value }));
              }}
              className="bg-transparent font-semibold text-sm text-slate-900 focus:bg-slate-100 rounded px-2 py-1 outline-none border border-transparent focus:border-[#e20074] w-44 sm:w-56 md:w-64 transition-colors"
              placeholder="Query Name..."
            />
          </div>

          {/* Active / Deactivated Switch */}
          <button
            type="button"
            id="statement-status-switch"
            onClick={() => {
              const nextEnabled = !currentNode.enabled;
              const updated = { ...currentNode, enabled: nextEnabled };
              setCurrentNode(updated);
              onSaveNode(updated);
              savedNodeRef.current = { ...savedNodeRef.current, enabled: nextEnabled };
            }}
            className={`flex items-center gap-2 px-2.5 py-1 rounded-lg border text-xs font-medium transition-all cursor-pointer shadow-2xs select-none ${
              currentNode.enabled
                ? 'bg-emerald-50/80 border-emerald-300 text-emerald-900 hover:bg-emerald-100'
                : 'bg-slate-100 border-slate-300 text-slate-600 hover:bg-slate-200'
            }`}
            title={
              currentNode.enabled
                ? 'Statement is Active. Click to deactivate (skip in simulation & deployment)'
                : 'Statement is Deactivated. Click to activate'
            }
          >
            <span className="text-[11px] text-slate-500 font-medium">Status:</span>
            <div
              className={`w-7 h-4 flex items-center rounded-full p-0.5 transition-colors duration-200 ease-in-out ${
                currentNode.enabled ? 'bg-emerald-600' : 'bg-slate-400'
              }`}
            >
              <div
                className={`bg-white w-3 h-3 rounded-full shadow-xs transform transition-transform duration-200 ease-in-out ${
                  currentNode.enabled ? 'translate-x-3' : 'translate-x-0'
                }`}
              />
            </div>
            <span
              className={`font-semibold font-mono text-[11px] ${
                currentNode.enabled ? 'text-emerald-700' : 'text-slate-600'
              }`}
            >
              {currentNode.enabled ? 'ACTIVE' : 'DEACTIVATED'}
            </span>
          </button>

          {/* Unsaved vs Saved Status Badge */}
          {saveSuccess ? (
            <div
              id="save-status-success"
              className="hidden md:flex items-center gap-1 px-2.5 py-1 bg-emerald-50 text-emerald-800 border border-emerald-200 rounded text-xs font-medium animate-fadeIn"
            >
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
              <span>Saved</span>
            </div>
          ) : isDirty ? (
            <div
              id="save-status-unsaved"
              className="hidden md:flex items-center gap-1.5 px-2.5 py-1 bg-amber-50 text-amber-800 border border-amber-300 rounded text-xs font-medium"
            >
              <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse shrink-0" />
              <span>Unsaved changes</span>
            </div>
          ) : (
            <div
              id="save-status-clean"
              className="hidden md:flex items-center gap-1 px-2.5 py-1 text-slate-500 text-xs"
            >
              <Check className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              <span>All changes saved</span>
            </div>
          )}
        </div>

        {/* Right Section: Undo/Redo, Save Button, Syntax Status & Actions */}
        <div className="flex items-center gap-2">
          {/* Undo Button (Ctrl+Z) */}
          <button
            type="button"
            id="undo-btn"
            disabled={!canUndo}
            onClick={handleUndo}
            className="flex items-center gap-1 px-2.5 py-1 bg-white hover:bg-slate-50 text-slate-700 hover:text-[#e20074] disabled:opacity-35 disabled:pointer-events-none rounded text-xs font-medium transition-colors border border-slate-200 hover:border-[#f8b4d9] shadow-sm cursor-pointer"
            title="Undo last change (Ctrl+Z / Cmd+Z)"
          >
            <Undo2 className="w-3.5 h-3.5 text-[#e20074]" />
            <span className="hidden sm:inline">Undo</span>
          </button>

          {/* Redo Button (Ctrl+Y / Ctrl+Shift+Z) */}
          <button
            type="button"
            id="redo-btn"
            disabled={!canRedo}
            onClick={handleRedo}
            className="flex items-center gap-1 px-2.5 py-1 bg-white hover:bg-slate-50 text-slate-700 hover:text-[#e20074] disabled:opacity-35 disabled:pointer-events-none rounded text-xs font-medium transition-colors border border-slate-200 hover:border-[#f8b4d9] shadow-sm cursor-pointer"
            title="Redo change (Ctrl+Y / Cmd+Shift+Z)"
          >
            <Redo2 className="w-3.5 h-3.5 text-[#e20074]" />
            <span className="hidden sm:inline">Redo</span>
          </button>

          <div className="h-4 w-px bg-slate-200 mx-0.5" />

          {/* Explicit Save Button */}
          <button
            type="button"
            id="save-node-btn"
            onClick={handleSave}
            className={`flex items-center gap-1.5 px-3 py-1 rounded text-xs font-semibold transition-all shadow-sm cursor-pointer ${
              isDirty
                ? 'bg-[#e20074] hover:bg-[#c70066] text-white shadow-md animate-pulse'
                : 'bg-white hover:bg-slate-50 text-slate-800 border border-slate-200 hover:border-[#f8b4d9]'
            }`}
            title="Save changes to this query node (Ctrl+S / Cmd+S)"
          >
            <Save className={`w-3.5 h-3.5 ${isDirty ? 'text-white' : 'text-[#e20074]'}`} />
            <span>Save</span>
            <span className={`text-[10px] font-mono ml-0.5 px-1 py-0.2 rounded ${isDirty ? 'bg-[#c70066]/60 text-white' : 'bg-slate-100 text-slate-500'}`}>
              Ctrl+S
            </span>
          </button>

          <div className="h-4 w-px bg-slate-200 mx-0.5" />

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
                <span className="font-semibold">
                  {validation.errorCount} Syntax Error{validation.errorCount > 1 ? 's' : ''}
                </span>
              </>
            )}
          </div>

          <div className="h-4 w-px bg-slate-200" />

          {/* Quick Action Buttons */}
          <button
            type="button"
            id="format-sql-btn"
            onClick={handleFormatSql}
            className="flex items-center gap-1.5 px-2.5 py-1 bg-white hover:bg-slate-50 text-slate-700 hover:text-[#e20074] rounded text-xs font-medium transition-colors border border-slate-200 hover:border-[#f8b4d9] shadow-sm cursor-pointer"
            title="Format SAP HANA SQL"
          >
            <Code2 className="w-3.5 h-3.5 text-[#e20074]" />
            <span>Format</span>
          </button>

          {/* Copy SQL */}
          <button
            type="button"
            onClick={handleCopySql}
            className="p-1.5 bg-white hover:bg-slate-50 text-slate-700 hover:text-[#e20074] rounded text-xs transition-colors border border-slate-200 hover:border-[#f8b4d9] shadow-sm cursor-pointer"
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

      {/* Node Metadata Sub-Bar: Title & Description Editing + Save Button */}
      <div className="bg-white border-b border-slate-200 px-3 sm:px-4 py-2 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2 text-xs shrink-0 shadow-2xs">
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 sm:gap-3 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider shrink-0">Title:</span>
            <input
              type="text"
              id="node-title-edit-input"
              value={currentNode.name}
              onChange={(e) => {
                setCurrentNode((prev) => ({ ...prev, name: e.target.value }));
              }}
              className="bg-slate-50 hover:bg-white focus:bg-white border border-slate-200 focus:border-[#e20074] rounded-md px-2.5 py-1 text-xs font-semibold text-slate-900 w-full sm:w-48 md:w-64 outline-none transition-colors"
              placeholder="Query Node Name..."
            />
          </div>

          <div className="flex items-center gap-2 flex-1">
            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider shrink-0">Description:</span>
            <input
              type="text"
              id="node-desc-edit-input"
              value={currentNode.description || ''}
              onChange={(e) => {
                setCurrentNode((prev) => ({ ...prev, description: e.target.value }));
              }}
              className="bg-slate-50 hover:bg-white focus:bg-white border border-slate-200 focus:border-[#e20074] rounded-md px-2.5 py-1 text-xs text-slate-700 w-full outline-none transition-colors"
              placeholder="Describe this SQL query transformation step..."
            />
          </div>
        </div>

        {/* Save and documentation actions */}
        <div className="flex items-center gap-2 shrink-0 justify-end">
          <button
            type="button"
            onClick={handleSave}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-semibold transition-all shadow-xs cursor-pointer ${
              isDirty
                ? 'bg-[#e20074] hover:bg-[#c70066] text-white'
                : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
            }`}
          >
            <Save className="w-3.5 h-3.5" />
            <span>{isDirty ? 'Save Changes' : 'Saved'}</span>
          </button>

          {onOpenDocumentation && (
            <button
              type="button"
              id="node-open-doc-button"
              onClick={() => onOpenDocumentation(currentNode)}
              className="flex items-center gap-1.5 px-3 py-1 bg-[#fdf0f6] hover:bg-[#fce4f0] text-[#c70066] border border-[#f8b4d9] hover:border-[#e20074] rounded-md text-xs font-semibold transition-all shadow-xs cursor-pointer"
              title="Open full screen documentation for this node"
            >
              <BookOpen className="w-3.5 h-3.5 text-[#e20074]" />
              <span className="hidden sm:inline">Documentation</span>
            </button>
          )}
        </div>
      </div>

      {/* Mobile / Tablet Workspace View Switcher Tabs */}
      <div className="lg:hidden flex items-center justify-around bg-slate-100 border-b border-slate-200 p-1.5 shrink-0 gap-1 text-xs">
        <button
          type="button"
          onClick={() => setMobileView('editor')}
          className={`flex-1 py-1.5 px-2 rounded-lg font-semibold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
            mobileView === 'editor'
              ? 'bg-white text-slate-900 shadow-2xs border border-slate-200'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <Code2 className="w-3.5 h-3.5 text-[#e20074]" />
          <span>Editor</span>
        </button>

        <button
          type="button"
          onClick={() => {
            setMobileView('diagnostics');
          }}
          className={`flex-1 py-1.5 px-2 rounded-lg font-semibold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
            mobileView === 'diagnostics'
              ? 'bg-white text-slate-900 shadow-2xs border border-slate-200'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <Activity className="w-3.5 h-3.5 text-[#e20074]" />
          <span>Diagnostics ({validation.diagnostics.length})</span>
        </button>
      </div>

      {/* Main Workspace Layout (Editor on Left, Diagnostics on Right) */}
      <div className="flex-1 flex flex-col lg:flex-row overflow-hidden">
        {/* Left / Center: Full Size Code Editor */}
        <div className={`flex-1 flex-col h-full overflow-hidden p-2 sm:p-3 bg-slate-100 ${mobileView === 'editor' ? 'flex' : 'hidden lg:flex'}`}>
          <div className="flex-1 h-full min-h-[300px] border border-slate-200 rounded-xl overflow-hidden shadow-sm flex flex-col bg-white">
            <HanaCodeEditor
              value={currentNode.sqlContent}
              onChange={(newVal) => handleSqlChange(newVal, true)}
              diagnostics={validation.diagnostics}
              onCursorChange={(line, col) => setCursorPos({ line, col })}
              onUndo={handleUndo}
              onRedo={handleRedo}
              onSave={handleSave}
              targetLine={scrollToLineNum}
            />
          </div>
        </div>

        {/* Right: Dedicated Diagnostics Panel */}
        <aside className={`w-full lg:w-[460px] xl:w-[500px] bg-white border-t lg:border-t-0 lg:border-l border-slate-200 flex-col shrink-0 h-full lg:h-full overflow-hidden ${mobileView !== 'editor' ? 'flex' : 'hidden lg:flex'}`}>
          {/* Panel Header */}
          <div className="px-4 py-2.5 border-b border-slate-200 bg-slate-50 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-2">
              <Activity className="w-4 h-4 text-[#e20074]" />
              <span className="font-semibold text-slate-900 text-xs">Diagnostics</span>
              <span className="bg-[#fdf0f6] text-[#c70066] font-mono text-[10px] px-2 py-0.5 rounded font-bold border border-[#f8b4d9]">
                {validation.diagnostics.length}
              </span>
            </div>

            <span className="px-2 py-0.5 bg-[#fdf0f6] text-[#c70066] font-mono text-[11px] font-bold rounded-md border border-[#f8b4d9]">
              {validation.dialectScore}% Score
            </span>
          </div>

          {/* Diagnostic Filter Bar */}
          <div className="px-4 py-2 border-b border-slate-200 bg-white flex items-center justify-between gap-2 shrink-0">
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setDiagFilter('all')}
                className={`px-2.5 py-1 rounded text-xs font-medium transition-colors cursor-pointer ${
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
                className={`px-2.5 py-1 rounded text-xs font-medium transition-colors cursor-pointer ${
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
                className={`px-2.5 py-1 rounded text-xs font-medium transition-colors cursor-pointer ${
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
                  className={`px-2.5 py-1 rounded text-xs font-medium transition-colors cursor-pointer ${
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
                <p className="font-semibold text-slate-900 text-sm">HANA SQL Syntax Valid</p>
                <p className="text-slate-500 text-xs mt-1 max-w-xs leading-relaxed">
                  No syntax errors detected. Query conforms to SAP HANA Cloud analytical standards.
                </p>
              </div>
            ) : filteredDiagnostics.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-center text-slate-400">
                <p className="text-xs">No issues found matching the "{diagFilter}" filter.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {filteredDiagnostics.map((diag, idx) => (
                  <div
                    key={idx}
                    onClick={() => handleJumpToDiagnosticLine(diag.line)}
                    className={`p-3 rounded-xl border flex flex-col gap-1.5 transition-all shadow-2xs cursor-pointer hover:shadow-md hover:border-[#e20074] group/diag ${
                      diag.severity === 'error'
                        ? 'bg-rose-50/70 border-rose-200 text-rose-900 hover:bg-rose-100/60'
                        : diag.severity === 'warning'
                        ? 'bg-amber-50/70 border-amber-200 text-amber-900 hover:bg-amber-100/60'
                        : 'bg-sky-50/70 border-sky-200 text-sky-900 hover:bg-sky-100/60'
                    }`}
                    title="Click to jump to line in editor"
                  >
                    <div className="flex items-center justify-between font-semibold text-xs">
                      <div className="flex items-center gap-2">
                        {diag.severity === 'error' ? (
                          <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                        ) : diag.severity === 'warning' ? (
                          <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                        ) : (
                          <Info className="w-4 h-4 text-sky-600 shrink-0" />
                        )}
                        <span className="font-mono text-[11px] bg-white px-2 py-0.5 rounded border border-slate-200 text-slate-700 shadow-2xs font-bold group-hover/diag:border-[#e20074] group-hover/diag:text-[#e20074] transition-colors">
                          Line {diag.line}
                        </span>
                      </div>

                      <span className="text-[10px] text-slate-400 group-hover/diag:text-[#e20074] flex items-center gap-1 font-mono transition-colors">
                        <span>Jump to line</span>
                        <ExternalLink className="w-3 h-3" />
                      </span>
                    </div>

                    <p className="text-slate-800 text-xs leading-relaxed font-sans pl-6">
                      {diag.message}
                    </p>
                  </div>
                ))}
              </div>
            )}
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
            onClick={() => prevNode && handleAttemptNavigate(prevNode.id)}
            className="flex items-center gap-1 px-2.5 py-1 bg-white hover:bg-slate-50 text-slate-700 hover:text-[#e20074] disabled:opacity-30 disabled:pointer-events-none rounded text-xs transition-colors border border-slate-200 hover:border-[#f8b4d9] shadow-sm cursor-pointer"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
            <span>Prev Query ({prevNode ? `Step ${prevNode.executionOrder}` : 'Start'})</span>
          </button>

          <button
            type="button"
            id="next-node-step-btn"
            disabled={!nextNode}
            onClick={() => nextNode && handleAttemptNavigate(nextNode.id)}
            className="flex items-center gap-1 px-2.5 py-1 bg-white hover:bg-slate-50 text-slate-700 hover:text-[#e20074] disabled:opacity-30 disabled:pointer-events-none rounded text-xs transition-colors border border-slate-200 hover:border-[#f8b4d9] shadow-sm cursor-pointer"
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
        </div>
      </footer>

      {/* Unsaved Changes Confirmation Warning Modal */}
      {showUnsavedModal && (
        <div className="fixed inset-0 z-60 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 animate-fadeIn">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-md overflow-hidden animate-scaleIn">
            <div className="p-5 border-b border-slate-100 flex items-start justify-between bg-amber-50/60">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-amber-100 text-amber-700 rounded-xl border border-amber-200 shrink-0">
                  <AlertTriangle className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-slate-900 text-sm">Unsaved Changes</h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Step #{currentNode.executionOrder}: {currentNode.name}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={handleCancelUnsavedModal}
                className="p-1 hover:bg-slate-200/60 rounded-md text-slate-400 hover:text-slate-700 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 text-xs text-slate-600 space-y-2 leading-relaxed">
              <p>
                You have unsaved changes in this SQL query node. If you leave without saving, your recent edits will be lost.
              </p>
              <p className="text-slate-500 italic">
                Would you like to save your changes before leaving, or discard them?
              </p>
            </div>

            <div className="p-4 bg-slate-50 border-t border-slate-100 flex items-center justify-end gap-2 text-xs">
              <button
                type="button"
                id="discard-unsaved-btn"
                onClick={handleConfirmDiscardAndProceed}
                className="px-3 py-1.5 bg-white hover:bg-rose-50 text-rose-700 hover:text-rose-800 border border-slate-200 hover:border-rose-300 rounded-lg font-medium transition-colors cursor-pointer"
              >
                Discard & Leave
              </button>

              <button
                type="button"
                id="cancel-unsaved-btn"
                onClick={handleCancelUnsavedModal}
                className="px-3 py-1.5 bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 rounded-lg font-medium transition-colors cursor-pointer"
              >
                Keep Editing
              </button>

              <button
                type="button"
                id="save-and-proceed-btn"
                onClick={handleConfirmSaveAndProceed}
                className="px-4 py-1.5 bg-[#e20074] hover:bg-[#c70066] text-white rounded-lg font-semibold shadow-sm transition-colors cursor-pointer flex items-center gap-1.5"
              >
                <Save className="w-3.5 h-3.5" />
                <span>Save & Continue</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
