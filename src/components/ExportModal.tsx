import React, { useState, useMemo } from 'react';
import { FlowPipeline } from '../types';
import { Download, Copy, Check, X, FileCode, Terminal, Database, RefreshCw, Repeat } from 'lucide-react';
import { analyzeGraphCycles } from '../utils/pipelineTopology';

interface ExportModalProps {
  pipeline: FlowPipeline;
  isOpen: boolean;
  onClose: () => void;
}

export const ExportModal: React.FC<ExportModalProps> = ({ pipeline, isOpen, onClose }) => {
  const [exportType, setExportType] = useState<'sql_script' | 'stored_proc' | 'json'>('sql_script');
  const [copied, setCopied] = useState(false);

  const cycleAnalysis = useMemo(
    () => analyzeGraphCycles(pipeline.nodes, pipeline.edges),
    [pipeline.nodes, pipeline.edges]
  );

  if (!isOpen) return null;

  const sortedNodes = [...pipeline.nodes].sort((a, b) => a.executionOrder - b.executionOrder);

  // Generate unified SQL deployment script with SAP HANA transaction boundaries
  const generateSqlScript = () => {
    let script = `-- =========================================================================\n`;
    script += `-- SAP HANA SQL Flow Pipeline Deployment Script\n`;
    script += `-- Pipeline Name: ${pipeline.name}\n`;
    script += `-- Target Engine: ${pipeline.targetHanaVersion || 'SAP HANA Cloud'}\n`;
    script += `-- Generated on: ${new Date().toISOString()}\n`;
    script += `-- Total Query Steps: ${sortedNodes.length}\n`;
    if (cycleAnalysis.hasCycle) {
      script += `-- Graph Structure: CIRCULAR DEPENDENCY DETECTED\n`;
      script += `-- Cycle Path: ${cycleAnalysis.cyclePaths[0]?.summary}\n`;
      script += `-- Note: Iterative execution or recursive CTEs required for cyclic loops.\n`;
    }
    script += `-- =========================================================================\n\n`;
    script += `SET SCHEMA "PUBLIC";\n\n`;

    sortedNodes.forEach((node) => {
      const isCyclic = cycleAnalysis.cycleNodeIds.includes(node.id);
      const isDeactivated = !node.enabled;
      script += `-- -------------------------------------------------------------------------\n`;
      script += `-- Step ${node.executionOrder}: ${node.name} [Type: ${node.queryType}]${isCyclic ? ' [IN CYCLE LOOP]' : ''}${isDeactivated ? ' [STATUS: DEACTIVATED - BYPASSED]' : ''}\n`;
      script += `-- Description: ${node.description}\n`;
      if (isCyclic) {
        script += `-- Loop Participant: Executes iteratively in circular feedback path\n`;
      }
      if (isDeactivated) {
        script += `-- Status: Statement is turned off in the pipeline flow\n`;
        script += `-- -------------------------------------------------------------------------\n`;
        script += `/* [DEACTIVATED STATEMENT - REMOVE COMMENTS TO ACTIVATE]\n`;
        script += `${node.sqlContent.trim().endsWith(';') ? node.sqlContent.trim() : node.sqlContent.trim() + ';'}\n`;
        script += `*/\n\n`;
      } else {
        script += `-- -------------------------------------------------------------------------\n`;
        script += `${node.sqlContent.trim().endsWith(';') ? node.sqlContent.trim() : node.sqlContent.trim() + ';'}\n\n`;
      }
    });

    script += `-- =========================================================================\n`;
    script += `-- End of SAP HANA Pipeline Script\n`;
    script += `-- =========================================================================\n`;
    return script;
  };

  // Generate SAP HANA SQLScript Stored Procedure wrapper
  const generateStoredProc = () => {
    const procName = pipeline.name.replace(/[^A-Za-z0-9_]/g, '_').toUpperCase();
    let proc = `CREATE OR REPLACE PROCEDURE "ANALYTICS"."SP_${procName}" (\n`;
    proc += `    -- Inbound Flow Parameters\n`;
    proc += `    IN IP_EXECUTION_DATE DATE DEFAULT CURRENT_DATE,\n`;
    if (cycleAnalysis.hasCycle) {
      proc += `    IN IP_MAX_LOOP_ITERATIONS INTEGER DEFAULT 3,\n`;
    }
    proc += `    OUT OP_PROCESSED_STEPS INTEGER\n`;
    proc += `)\n`;
    proc += `LANGUAGE SQLSCRIPT\n`;
    proc += `SQL SECURITY INVOKER\n`;
    proc += `AS\n`;
    proc += `BEGIN\n`;
    if (cycleAnalysis.hasCycle) {
      proc += `    DECLARE LV_LOOP_INDEX INTEGER := 1;\n`;
    }
    proc += `    DECLARE EXIT HANDLER FOR SQLEXCEPTION\n`;
    proc += `    BEGIN\n`;
    proc += `        -- Catch SAP HANA SQL exceptions\n`;
    proc += `        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Pipeline execution error in SP_${procName}';\n`;
    proc += `    END;\n\n`;

    const formatNodeForProc = (node: typeof sortedNodes[0], indent = '    ') => {
      let out = `${indent}-- Step ${node.executionOrder}: ${node.name}${!node.enabled ? ' [DEACTIVATED]' : ''}\n`;
      if (!node.enabled) {
        out += `${indent}/* [DEACTIVATED STEP IN FLOW]\n`;
        out += node.sqlContent
          .split('\n')
          .map((line) => `${indent}${line}`)
          .join('\n');
        out += `\n${indent}*/\n\n`;
      } else {
        out += node.sqlContent
          .split('\n')
          .map((line) => `${indent}${line}`)
          .join('\n');
        out += `\n\n`;
      }
      return out;
    };

    if (!cycleAnalysis.hasCycle) {
      sortedNodes.forEach((node) => {
        proc += formatNodeForProc(node, '    ');
      });
    } else {
      // Split into pre-cycle, in-cycle, post-cycle
      const cycleNodeIdSet = new Set(cycleAnalysis.cycleNodeIds);
      const preCycleNodes = sortedNodes.filter(
        (n) => !cycleNodeIdSet.has(n.id) && n.executionOrder < (sortedNodes.find((cn) => cycleNodeIdSet.has(cn.id))?.executionOrder || 999)
      );
      const inCycleNodes = sortedNodes.filter((n) => cycleNodeIdSet.has(n.id));
      const postCycleNodes = sortedNodes.filter(
        (n) => !cycleNodeIdSet.has(n.id) && !preCycleNodes.some((pn) => pn.id === n.id)
      );

      // Pre-cycle
      preCycleNodes.forEach((node) => {
        proc += formatNodeForProc(node, '    ');
      });

      // While loop for cycle nodes
      proc += `    -- =====================================================================\n`;
      proc += `    -- ITERATIVE CYCLE EXECUTION LOOP (${cycleAnalysis.cyclePaths[0]?.summary})\n`;
      proc += `    -- =====================================================================\n`;
      proc += `    WHILE LV_LOOP_INDEX <= IP_MAX_LOOP_ITERATIONS DO\n`;
      inCycleNodes.forEach((node) => {
        proc += formatNodeForProc(node, '        ');
      });
      proc += `        LV_LOOP_INDEX := LV_LOOP_INDEX + 1;\n`;
      proc += `    END WHILE;\n\n`;

      // Post-cycle
      postCycleNodes.forEach((node) => {
        proc += formatNodeForProc(node, '    ');
      });
    }

    proc += `    OP_PROCESSED_STEPS := ${sortedNodes.length};\n`;
    proc += `END;\n`;
    return proc;
  };

  const generateJson = () => {
    return JSON.stringify(pipeline, null, 2);
  };

  const getExportContent = () => {
    if (exportType === 'sql_script') return generateSqlScript();
    if (exportType === 'stored_proc') return generateStoredProc();
    return generateJson();
  };

  const content = getExportContent();

  const handleCopy = () => {
    navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    const ext = exportType === 'json' ? 'json' : 'sql';
    link.download = `${pipeline.name.toLowerCase().replace(/[^a-z0-9]/g, '_')}_hana_flow.${ext}`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-3xl max-h-[85vh] flex flex-col shadow-2xl overflow-hidden animate-scaleUp">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-white">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-[#fdf0f6] text-[#e20074] rounded-lg border border-[#f8b4d9]">
              <Download className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-semibold text-base text-slate-900">Export SAP HANA Pipeline</h3>
              <p className="text-xs text-slate-500">Download executable SQL scripts or SQLScript procedures</p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-400 hover:text-slate-600 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Cyclic Warning Banner if present */}
        {cycleAnalysis.hasCycle && (
          <div className="bg-amber-50 border-b border-amber-200 px-6 py-2 flex items-center gap-2 text-xs text-amber-900">
            <RefreshCw className="w-3.5 h-3.5 text-amber-600 animate-spin" style={{ animationDuration: '8s' }} />
            <span>
              <strong>Cyclic Dependencies Handled:</strong> Exported procedure automatically generates SAP HANA SQLScript <code className="font-mono bg-amber-200/70 px-1 py-0.5 rounded">WHILE</code> loops for cyclic steps.
            </span>
          </div>
        )}

        {/* Format Selectors */}
        <div className="px-6 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setExportType('sql_script')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                exportType === 'sql_script'
                  ? 'bg-[#e20074] text-white shadow-sm'
                  : 'bg-white text-slate-600 hover:text-[#e20074] border border-slate-200 hover:border-[#f8b4d9]'
              }`}
            >
              <FileCode className="w-3.5 h-3.5" />
              <span>Full SQL Script (.sql)</span>
            </button>

            <button
              type="button"
              onClick={() => setExportType('stored_proc')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                exportType === 'stored_proc'
                  ? 'bg-[#e20074] text-white shadow-sm'
                  : 'bg-white text-slate-600 hover:text-[#e20074] border border-slate-200 hover:border-[#f8b4d9]'
              }`}
            >
              <Terminal className="w-3.5 h-3.5" />
              <span>HANA Procedure (.hdbprocedure)</span>
            </button>

            <button
              type="button"
              onClick={() => setExportType('json')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                exportType === 'json'
                  ? 'bg-[#e20074] text-white shadow-sm'
                  : 'bg-white text-slate-600 hover:text-[#e20074] border border-slate-200 hover:border-[#f8b4d9]'
              }`}
            >
              <Database className="w-3.5 h-3.5" />
              <span>Pipeline JSON</span>
            </button>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleCopy}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-white hover:bg-slate-100 text-slate-700 rounded-lg text-xs font-medium transition-colors border border-slate-200 shadow-sm cursor-pointer"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copied ? 'Copied' : 'Copy'}</span>
            </button>

            <button
              type="button"
              onClick={handleDownload}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-[#e20074] hover:bg-[#c70066] text-white rounded-lg text-xs font-semibold shadow-sm transition-all cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Download</span>
            </button>
          </div>
        </div>

        {/* Preview Code Box */}
        <div className="flex-1 p-6 overflow-hidden flex flex-col bg-slate-50">
          <div className="flex-1 bg-white border border-slate-200 rounded-xl p-4 overflow-auto font-mono text-xs text-slate-800 shadow-sm">
            <pre className="whitespace-pre">{content}</pre>
          </div>
        </div>
      </div>
    </div>
  );
};
