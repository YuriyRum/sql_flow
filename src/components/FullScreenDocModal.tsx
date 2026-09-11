import React, { useState, useEffect, useRef } from 'react';
import { SQLNode } from '../types';
import { getDefaultDocumentation } from '../utils/nodeDocumentation';
import {
  X,
  BookOpen,
  Copy,
  Check,
  Download,
  RotateCcw,
  Save,
  CheckCircle2,
  ArrowLeft,
  FileText
} from 'lucide-react';

interface FullScreenDocModalProps {
  node: SQLNode;
  isOpen: boolean;
  onClose: () => void;
  onSaveNode: (updatedNode: SQLNode) => void;
}

export const FullScreenDocModal: React.FC<FullScreenDocModalProps> = ({
  node,
  isOpen,
  onClose,
  onSaveNode,
}) => {
  const [docContent, setDocContent] = useState<string>(() => {
    return getDefaultDocumentation(node);
  });
  const [copied, setCopied] = useState(false);
  const [savedFeedback, setSavedFeedback] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Sync when node changes
  useEffect(() => {
    setDocContent(getDefaultDocumentation(node));
  }, [node]);

  // Focus textarea when opened
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => {
        textareaRef.current?.focus();
      }, 100);
    }
  }, [isOpen]);

  // Keyboard shortcut: ESC to close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setDocContent(val);
    const updated: SQLNode = {
      ...node,
      documentation: val,
    };
    onSaveNode(updated);
  };

  const handleManualSave = () => {
    const updated: SQLNode = {
      ...node,
      documentation: docContent,
    };
    onSaveNode(updated);
    setSavedFeedback(true);
    setTimeout(() => setSavedFeedback(false), 2000);
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(docContent);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    const filename = `${node.name.toLowerCase().replace(/[^a-z0-9]+/g, '_')}_documentation.txt`;
    const blob = new Blob([docContent], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleResetToDefault = () => {
    if (window.confirm('Reset this documentation text to the standard specification template?')) {
      const resetText = getDefaultDocumentation({ ...node, documentation: undefined });
      setDocContent(resetText);
      const updated: SQLNode = {
        ...node,
        documentation: resetText,
      };
      onSaveNode(updated);
    }
  };

  const lineCount = docContent.split('\n').length;
  const wordCount = docContent.trim().length > 0 ? docContent.trim().split(/\s+/).length : 0;

  return (
    <div className="fixed inset-0 z-[100] bg-white text-slate-800 flex flex-col overflow-hidden animate-fadeIn">
      {/* Top Header Bar */}
      <header className="h-14 bg-white border-b border-slate-200 px-4 sm:px-6 flex items-center justify-between shrink-0 select-none shadow-sm">
        {/* Left Section: Back button and Node identification */}
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={onClose}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-white hover:bg-slate-50 text-slate-700 hover:text-[#e20074] rounded-md text-xs font-medium border border-slate-200 hover:border-[#f8b4d9] transition-colors shadow-2xs cursor-pointer"
            title="Return to pipeline (Esc)"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Back</span>
          </button>

          <div className="h-4 w-px bg-slate-200 mx-1 hidden sm:block" />

          <div className="flex items-center gap-2 min-w-0">
            <span className="px-2 py-0.5 bg-[#fdf0f6] text-[#c70066] font-mono text-xs font-bold rounded border border-[#f8b4d9] shrink-0">
              Step #{node.executionOrder}
            </span>
            <h2 className="font-bold text-sm text-slate-900 truncate max-w-[200px] sm:max-w-md">
              {node.name}
            </h2>
            <span className="hidden md:inline-block text-xs text-slate-400 font-normal">
              — Node Documentation
            </span>
          </div>
        </div>

        {/* Right Section: Actions & Close */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={handleCopy}
            className="flex items-center gap-1 px-2.5 py-1.5 bg-white hover:bg-slate-50 text-slate-700 hover:text-[#e20074] rounded-lg text-xs font-medium border border-slate-200 hover:border-[#f8b4d9] transition-colors shadow-2xs cursor-pointer"
            title="Copy documentation text"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
            <span className="hidden sm:inline">{copied ? 'Copied' : 'Copy'}</span>
          </button>

          <button
            type="button"
            onClick={handleDownload}
            className="flex items-center gap-1 px-2.5 py-1.5 bg-white hover:bg-slate-50 text-slate-700 hover:text-[#e20074] rounded-lg text-xs font-medium border border-slate-200 hover:border-[#f8b4d9] transition-colors shadow-2xs cursor-pointer"
            title="Download documentation as text file"
          >
            <Download className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Export .txt</span>
          </button>

          <button
            type="button"
            onClick={handleResetToDefault}
            className="hidden lg:flex items-center gap-1 px-2.5 py-1.5 bg-white hover:bg-slate-50 text-slate-700 hover:text-[#e20074] rounded-lg text-xs font-medium border border-slate-200 hover:border-[#f8b4d9] transition-colors shadow-2xs cursor-pointer"
            title="Reset to default template"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Reset</span>
          </button>

          <button
            type="button"
            onClick={handleManualSave}
            className="flex items-center gap-1.5 px-3.5 py-1.5 bg-[#e20074] hover:bg-[#c70066] text-white rounded-lg text-xs font-semibold shadow-xs transition-colors cursor-pointer"
          >
            {savedFeedback ? <CheckCircle2 className="w-3.5 h-3.5" /> : <Save className="w-3.5 h-3.5" />}
            <span>{savedFeedback ? 'Saved' : 'Save'}</span>
          </button>

          <div className="h-4 w-px bg-slate-200 mx-1" />

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 hover:bg-slate-100 text-slate-500 hover:text-slate-800 rounded-lg transition-colors cursor-pointer"
            title="Close (Esc)"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </header>

      {/* Instructional Bar */}
      <div className="px-6 py-2 bg-slate-50 border-b border-slate-200 flex items-center justify-between text-xs text-slate-500 shrink-0">
        <div className="flex items-center gap-2">
          <FileText className="w-3.5 h-3.5 text-[#e20074]" />
          <span>Edit node documentation below in plain text. Changes are saved automatically.</span>
        </div>
        <div className="flex items-center gap-3 font-mono text-[11px] text-slate-400">
          <span>{lineCount} lines</span>
          <span>•</span>
          <span>{wordCount} words</span>
          <span>•</span>
          <span>{docContent.length} characters</span>
        </div>
      </div>

      {/* Main Plain Text Area */}
      <div className="flex-1 flex flex-col overflow-hidden bg-white p-4 sm:p-6">
        <textarea
          ref={textareaRef}
          id="node-documentation-textarea"
          value={docContent}
          onChange={handleTextChange}
          placeholder="Enter documentation for this SQL query step..."
          spellCheck={false}
          className="w-full h-full p-4 sm:p-6 font-mono text-xs sm:text-sm leading-relaxed text-slate-800 bg-slate-50/60 focus:bg-white border border-slate-200 focus:border-[#e20074] rounded-xl outline-none resize-none transition-colors selection:bg-[#fce4f0] selection:text-[#99004f] shadow-inner"
          style={{ tabSize: 2 }}
        />
      </div>

      {/* Bottom Status Bar */}
      <footer className="h-9 bg-white border-t border-slate-200 px-6 flex items-center justify-between shrink-0 text-[11px] text-slate-500 select-none">
        <div className="flex items-center gap-2">
          <span className="inline-block w-2 h-2 rounded-full bg-emerald-500" />
          <span>Documentation linked to query step: <strong>{node.name}</strong></span>
        </div>
        <div className="flex items-center gap-3">
          <span>Auto-saving enabled</span>
          <span>•</span>
          <span>Press <kbd className="px-1.5 py-0.5 bg-slate-100 border border-slate-300 rounded text-[10px] font-mono">Esc</kbd> to return</span>
        </div>
      </footer>
    </div>
  );
};
