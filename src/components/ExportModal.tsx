import React, { useState } from 'react';
import { FlowPipeline } from '../types';
import { Download, Copy, Check, X, FileCode, Terminal, Database } from 'lucide-react';

interface ExportModalProps {
  pipeline: FlowPipeline;
  isOpen: boolean;
  onClose: () => void;
}

export const ExportModal: React.FC<ExportModalProps> = ({ pipeline, isOpen, onClose }) => {
  const [exportType, setExportType] = useState<'sql_script' | 'stored_proc' | 'json'>('sql_script');
  const [copied, setCopied] = useState(false);

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
    script += `-- =========================================================================\n\n`;
    script += `SET SCHEMA "PUBLIC";\n\n`;

    sortedNodes.forEach((node) => {
      script += `-- -------------------------------------------------------------------------\n`;
      script += `-- Step ${node.executionOrder}: ${node.name} [Type: ${node.queryType}]\n`;
      script += `-- Description: ${node.description}\n`;
      script += `-- -------------------------------------------------------------------------\n`;
      script += `${node.sqlContent.trim().endsWith(';') ? node.sqlContent.trim() : node.sqlContent.trim() + ';'}\n\n`;
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
    proc += `    OUT OP_PROCESSED_STEPS INTEGER\n`;
    proc += `)\n`;
    proc += `LANGUAGE SQLSCRIPT\n`;
    proc += `SQL SECURITY INVOKER\n`;
    proc += `AS\n`;
    proc += `BEGIN\n`;
    proc += `    DECLARE EXIT HANDLER FOR SQLEXCEPTION\n`;
    proc += `    BEGIN\n`;
    proc += `        -- Catch SAP HANA SQL exceptions\n`;
    proc += `        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Pipeline execution error in SP_${procName}';\n`;
    proc += `    END;\n\n`;

    sortedNodes.forEach((node) => {
      proc += `    -- Step ${node.executionOrder}: ${node.name}\n`;
      const indentedSql = node.sqlContent
        .split('\n')
        .map((line) => `    ${line}`)
        .join('\n');
      proc += `${indentedSql}\n\n`;
    });

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

        {/* Format Selectors */}
        <div className="px-6 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setExportType('sql_script')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
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
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
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
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
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
              className="flex items-center gap-1.5 px-3 py-1.5 bg-white hover:bg-slate-100 text-slate-700 rounded-lg text-xs font-medium transition-colors border border-slate-200 shadow-sm"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copied ? 'Copied' : 'Copy'}</span>
            </button>

            <button
              type="button"
              onClick={handleDownload}
              className="flex items-center gap-1.5 px-3.5 py-1.5 bg-[#e20074] hover:bg-[#c70066] text-white rounded-lg text-xs font-semibold shadow-sm transition-all"
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
