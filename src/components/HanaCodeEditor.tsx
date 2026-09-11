import React, { useState, useRef, useEffect } from 'react';
import { SyntaxDiagnostic } from '../types';
import {
  HANA_KEYWORDS,
  HANA_DATA_TYPES,
  HANA_BUILTIN_FUNCTIONS,
} from '../utils/hanaSqlValidator';
import { AlertCircle, AlertTriangle, Info, Search, X } from 'lucide-react';

interface HanaCodeEditorProps {
  value: string;
  onChange: (value: string) => void;
  diagnostics: SyntaxDiagnostic[];
  onFormat?: () => void;
  readOnly?: boolean;
  onCursorChange?: (line: number, col: number) => void;
}

export const HanaCodeEditor: React.FC<HanaCodeEditorProps> = ({
  value,
  onChange,
  diagnostics,
  readOnly = false,
  onCursorChange,
}) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const lineNumbersRef = useRef<HTMLDivElement>(null);
  const highlightRef = useRef<HTMLDivElement>(null);

  const [cursorPos, setCursorPos] = useState({ line: 1, col: 1 });
  const [showSearch, setShowSearch] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [replaceTerm, setReplaceTerm] = useState('');

  const lines = value.split('\n');

  // Diagnostics indexed by line number
  const diagnosticsByLine = React.useMemo(() => {
    const map = new Map<number, SyntaxDiagnostic[]>();
    diagnostics.forEach((d) => {
      const arr = map.get(d.line) || [];
      arr.push(d);
      map.set(d.line, arr);
    });
    return map;
  }, [diagnostics]);

  // Synchronize scroll between textarea, line numbers, and syntax highlight backdrop
  const handleScroll = (e: React.UIEvent<HTMLTextAreaElement>) => {
    const target = e.currentTarget;
    if (lineNumbersRef.current) {
      lineNumbersRef.current.scrollTop = target.scrollTop;
    }
    if (highlightRef.current) {
      highlightRef.current.scrollTop = target.scrollTop;
      highlightRef.current.scrollLeft = target.scrollLeft;
    }
  };

  const updateCursorPosition = () => {
    if (!textareaRef.current) return;
    const text = textareaRef.current.value;
    const selStart = textareaRef.current.selectionStart;

    const sub = text.substring(0, selStart);
    const lineArr = sub.split('\n');
    const line = lineArr.length;
    const col = lineArr[lineArr.length - 1].length + 1;

    setCursorPos({ line, col });
    if (onCursorChange) {
      onCursorChange(line, col);
    }
  };

  // Handle Tab key and auto-indent in editor
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const start = e.currentTarget.selectionStart;
      const end = e.currentTarget.selectionEnd;
      const newValue = value.substring(0, start) + '    ' + value.substring(end);
      onChange(newValue);

      setTimeout(() => {
        if (textareaRef.current) {
          textareaRef.current.selectionStart = textareaRef.current.selectionEnd = start + 4;
        }
      }, 0);
    } else if (e.key === 'f' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      setShowSearch((prev) => !prev);
    }
  };

  const handleSearchReplace = (replaceAll = false) => {
    if (!searchTerm) return;
    if (replaceAll) {
      const regex = new RegExp(escapeRegex(searchTerm), 'g');
      onChange(value.replace(regex, replaceTerm));
    } else {
      const idx = value.indexOf(searchTerm);
      if (idx !== -1) {
        const newValue = value.substring(0, idx) + replaceTerm + value.substring(idx + searchTerm.length);
        onChange(newValue);
      }
    }
  };

  function escapeRegex(string: string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  // Tokenize line for color highlights
  const renderHighlightedLine = (line: string, lineIndex: number) => {
    const lineNum = lineIndex + 1;
    const lineDiagnostics = diagnosticsByLine.get(lineNum) || [];
    const hasError = lineDiagnostics.some((d) => d.severity === 'error');
    const hasWarning = lineDiagnostics.some((d) => d.severity === 'warning');

    if (line === '') {
      return (
        <div key={lineIndex} className="h-6 leading-6">
          &nbsp;
        </div>
      );
    }

    // Tokenize line into comments, strings, identifiers, keywords, numbers, punctuation
    const tokens: React.ReactNode[] = [];
    let i = 0;

    while (i < line.length) {
      // Single line comments
      if (line.startsWith('--', i) || line.startsWith('//', i)) {
        tokens.push(
          <span key={i} className="text-slate-400 italic font-mono">
            {line.substring(i)}
          </span>
        );
        break;
      }

      // Single quote string literals
      if (line[i] === "'") {
        let strEnd = i + 1;
        while (strEnd < line.length) {
          if (line[strEnd] === "'") {
            if (line[strEnd + 1] === "'") {
              strEnd += 2;
            } else {
              strEnd++;
              break;
            }
          } else {
            strEnd++;
          }
        }
        tokens.push(
          <span key={i} className="text-emerald-700 font-mono">
            {line.substring(i, strEnd)}
          </span>
        );
        i = strEnd;
        continue;
      }

      // Double quote identifiers "SCHEMA"."TABLE"
      if (line[i] === '"') {
        let idEnd = i + 1;
        while (idEnd < line.length && line[idEnd] !== '"') {
          idEnd++;
        }
        if (idEnd < line.length && line[idEnd] === '"') {
          idEnd++;
        }
        tokens.push(
          <span key={i} className="text-sky-800 font-semibold font-mono">
            {line.substring(i, idEnd)}
          </span>
        );
        i = idEnd;
        continue;
      }

      // Parameters like :IP_START_DATE
      if (line[i] === ':' && /[A-Za-z_]/.test(line[i + 1] || '')) {
        let pEnd = i + 1;
        while (pEnd < line.length && /[A-Za-z0-9_]/.test(line[pEnd])) {
          pEnd++;
        }
        tokens.push(
          <span key={i} className="text-amber-700 font-bold font-mono bg-amber-50 px-0.5 rounded border border-amber-200">
            {line.substring(i, pEnd)}
          </span>
        );
        i = pEnd;
        continue;
      }

      // Numbers
      if (/[0-9]/.test(line[i])) {
        let numEnd = i;
        while (numEnd < line.length && /[0-9.]/.test(line[numEnd])) {
          numEnd++;
        }
        tokens.push(
          <span key={i} className="text-indigo-600 font-mono">
            {line.substring(i, numEnd)}
          </span>
        );
        i = numEnd;
        continue;
      }

      // Words (Keywords, Functions, Types, Identifiers)
      if (/[A-Za-z_]/.test(line[i])) {
        let wordEnd = i;
        while (wordEnd < line.length && /[A-Za-z0-9_]/.test(line[wordEnd])) {
          wordEnd++;
        }
        const word = line.substring(i, wordEnd);
        const upper = word.toUpperCase();

        if (HANA_KEYWORDS.has(upper)) {
          tokens.push(
            <span key={i} className="text-[#e20074] font-bold font-mono">
              {word}
            </span>
          );
        } else if (HANA_BUILTIN_FUNCTIONS.has(upper)) {
          tokens.push(
            <span key={i} className="text-indigo-700 font-semibold font-mono">
              {word}
            </span>
          );
        } else if (HANA_DATA_TYPES.has(upper)) {
          tokens.push(
            <span key={i} className="text-teal-700 font-medium font-mono">
              {word}
            </span>
          );
        } else {
          tokens.push(
            <span key={i} className="text-slate-800 font-mono">
              {word}
            </span>
          );
        }

        i = wordEnd;
        continue;
      }

      // Other punctuation / whitespace
      tokens.push(
        <span key={i} className="text-slate-600 font-mono">
          {line[i]}
        </span>
      );
      i++;
    }

    return (
      <div
        key={lineIndex}
        className={`h-6 leading-6 whitespace-pre font-mono relative ${
          hasError
            ? 'bg-rose-50'
            : hasWarning
            ? 'bg-amber-50'
            : lineNum === cursorPos.line
            ? 'bg-blue-50/70 border-l-2 border-blue-500'
            : ''
        }`}
      >
        {tokens}
        {hasError && (
          <div className="absolute bottom-0 left-0 right-0 h-0.5 border-b border-dashed border-rose-500 pointer-events-none" />
        )}
        {hasWarning && !hasError && (
          <div className="absolute bottom-0 left-0 right-0 h-0.5 border-b border-dashed border-amber-500 pointer-events-none" />
        )}
      </div>
    );
  };

  return (
    <div className="relative flex flex-col h-full w-full bg-white text-slate-800 font-mono rounded-lg border border-slate-200 hover:border-slate-300 overflow-hidden shadow-sm transition-colors">
      {/* Quick Search & Replace Bar */}
      {showSearch && (
        <div className="flex items-center gap-2 p-2 bg-slate-50 border-b border-slate-200 text-xs text-slate-700 z-20">
          <Search className="w-3.5 h-3.5 text-[#e20074] shrink-0" />
          <input
            type="text"
            placeholder="Find in SQL..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="bg-white border border-slate-200 focus:border-[#e20074] rounded px-2 py-1 text-xs text-slate-800 focus:outline-none w-44 shadow-sm"
          />
          <input
            type="text"
            placeholder="Replace with..."
            value={replaceTerm}
            onChange={(e) => setReplaceTerm(e.target.value)}
            className="bg-white border border-slate-200 focus:border-[#e20074] rounded px-2 py-1 text-xs text-slate-800 focus:outline-none w-44 shadow-sm"
          />
          <button
            type="button"
            onClick={() => handleSearchReplace(false)}
            className="px-2.5 py-1 bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 hover:border-[#f8b4d9] rounded font-medium transition-colors shadow-sm"
          >
            Replace
          </button>
          <button
            type="button"
            onClick={() => handleSearchReplace(true)}
            className="px-2.5 py-1 bg-[#e20074] hover:bg-[#c70066] text-white rounded font-medium transition-colors shadow-sm"
          >
            Replace All
          </button>
          <button
            type="button"
            onClick={() => setShowSearch(false)}
            className="p-1 hover:bg-slate-200 rounded text-slate-500 hover:text-slate-700 ml-auto"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Editor Body */}
      <div className="relative flex-1 flex overflow-hidden">
        {/* Line Numbers Gutter */}
        <div
          ref={lineNumbersRef}
          className="w-14 shrink-0 bg-slate-50 border-r border-slate-200 py-3 select-none text-right font-mono text-xs overflow-hidden z-10"
        >
          {lines.map((_, idx) => {
            const lineNum = idx + 1;
            const lineDiags = diagnosticsByLine.get(lineNum) || [];
            const hasError = lineDiags.some((d) => d.severity === 'error');
            const hasWarning = lineDiags.some((d) => d.severity === 'warning');
            const isCurrent = lineNum === cursorPos.line;

            return (
              <div
                key={idx}
                className={`h-6 leading-6 pr-2.5 flex items-center justify-end gap-1 ${
                  isCurrent ? 'text-[#e20074] font-bold bg-[#fdf0f6] border-r-2 border-[#e20074]' : 'text-slate-400'
                }`}
              >
                {hasError ? (
                  <span title={lineDiags.map((d) => d.message).join('\n')} className="inline-flex">
                    <AlertCircle className="w-3 h-3 text-rose-600 shrink-0 inline" />
                  </span>
                ) : hasWarning ? (
                  <span title={lineDiags.map((d) => d.message).join('\n')} className="inline-flex">
                    <AlertTriangle className="w-3 h-3 text-amber-600 shrink-0 inline" />
                  </span>
                ) : null}
                <span>{lineNum}</span>
              </div>
            );
          })}
        </div>

        {/* Code Content Container */}
        <div className="relative flex-1 h-full overflow-hidden bg-white">
          {/* Syntax Highlight Backdrop */}
          <div
            ref={highlightRef}
            aria-hidden="true"
            className="absolute inset-0 py-3 px-4 text-xs font-mono overflow-hidden pointer-events-none z-0"
            style={{ tabSize: 4 }}
          >
            {lines.map((line, idx) => renderHighlightedLine(line, idx))}
          </div>

          {/* Transparent Input Textarea */}
          <textarea
            ref={textareaRef}
            id="hana-sql-textarea"
            value={value}
            onChange={(e) => {
              onChange(e.target.value);
              updateCursorPosition();
            }}
            onKeyUp={updateCursorPosition}
            onClick={updateCursorPosition}
            onScroll={handleScroll}
            onKeyDown={handleKeyDown}
            readOnly={readOnly}
            spellCheck={false}
            autoCapitalize="off"
            autoComplete="off"
            autoCorrect="off"
            className="absolute inset-0 w-full h-full py-3 px-4 text-xs font-mono bg-transparent text-transparent caret-[#e20074] resize-none outline-none overflow-auto z-10 selection:bg-[#fce4f0] selection:text-transparent"
            style={{ tabSize: 4, lineHeight: '1.5rem' }}
          />
        </div>
      </div>
    </div>
  );
};
