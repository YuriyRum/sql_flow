import React, { useState, useRef, useEffect, useMemo } from 'react';
import { SyntaxDiagnostic } from '../types';
import {
  HANA_KEYWORDS,
  HANA_DATA_TYPES,
  HANA_BUILTIN_FUNCTIONS,
} from '../utils/hanaSqlValidator';
import {
  AlertCircle,
  AlertTriangle,
  Search,
  X,
} from 'lucide-react';

interface HanaCodeEditorProps {
  value: string;
  onChange: (value: string) => void;
  diagnostics: SyntaxDiagnostic[];
  placeholder?: string;
  readOnly?: boolean;
  onCursorChange?: (line: number, col: number) => void;
  onUndo?: () => void;
  onRedo?: () => void;
  onSave?: () => void;
  targetLine?: number | null;
  onTargetLineHandled?: () => void;
}

export const HanaCodeEditor: React.FC<HanaCodeEditorProps> = ({
  value,
  onChange,
  diagnostics,
  placeholder,
  readOnly = false,
  onCursorChange,
  onUndo,
  onRedo,
  onSave,
  targetLine = null,
  onTargetLineHandled,
}) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const lineNumbersRef = useRef<HTMLDivElement>(null);
  const highlightRef = useRef<HTMLDivElement>(null);

  const [cursorPos, setCursorPos] = useState({ line: 1, col: 1 });
  const [showSearch, setShowSearch] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [replaceTerm, setReplaceTerm] = useState('');
  const [highlightedLine, setHighlightedLine] = useState<number | null>(null);

  const onCursorChangeRef = useRef(onCursorChange);
  useEffect(() => {
    onCursorChangeRef.current = onCursorChange;
  });

  const onTargetLineHandledRef = useRef(onTargetLineHandled);
  useEffect(() => {
    onTargetLineHandledRef.current = onTargetLineHandled;
  });

  const valueRef = useRef(value);
  useEffect(() => {
    valueRef.current = value;
  });

  const lines = value.split('\n');

  // Effect to scroll to target line when clicked from diagnostics
  useEffect(() => {
    if (targetLine && targetLine > 0 && textareaRef.current) {
      const linesArr = valueRef.current.split('\n');
      const lineIndex = Math.min(targetLine - 1, Math.max(0, linesArr.length - 1));

      // Calculate character index offset for beginning of targetLine
      let charPos = 0;
      for (let i = 0; i < lineIndex; i++) {
        charPos += linesArr[i].length + 1; // +1 for newline
      }

      const lineHeightPx = 24; // 1.5rem = 24px
      const scrollTop = Math.max(0, lineIndex * lineHeightPx - 80);

      if (textareaRef.current) {
        textareaRef.current.scrollTop = scrollTop;
        textareaRef.current.scrollLeft = 0;
        textareaRef.current.selectionStart = charPos;
        textareaRef.current.selectionEnd = charPos + (linesArr[lineIndex]?.length || 0);
        textareaRef.current.focus();
      }

      if (lineNumbersRef.current) {
        lineNumbersRef.current.scrollTop = scrollTop;
      }
      if (highlightRef.current) {
        highlightRef.current.scrollTop = scrollTop;
        highlightRef.current.scrollLeft = 0;
      }

      setHighlightedLine(targetLine);
      setCursorPos((prev) => (prev.line === targetLine && prev.col === 1 ? prev : { line: targetLine, col: 1 }));
      onCursorChangeRef.current?.(targetLine, 1);
      onTargetLineHandledRef.current?.();

      const timer = setTimeout(() => {
        setHighlightedLine(null);
      }, 2500);
      return () => clearTimeout(timer);
    }
  }, [targetLine]);

  // Diagnostics indexed by line number
  const diagnosticsByLine = useMemo(() => {
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

  const updateCursorPos = () => {
    if (!textareaRef.current) return;
    const text = textareaRef.current.value;
    const selStart = textareaRef.current.selectionStart;

    const sub = text.substring(0, selStart);
    const lineArr = sub.split('\n');
    const line = lineArr.length;
    const col = lineArr[lineArr.length - 1].length + 1;

    setCursorPos((prev) => (prev.line === line && prev.col === col ? prev : { line, col }));
    onCursorChangeRef.current?.(line, col);
  };

  // Handle Shortcuts & Tab in editor (No autocomplete)
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
    const modifier = isMac ? e.metaKey : e.ctrlKey;

    if (modifier && e.key.toLowerCase() === 'f') {
      e.preventDefault();
      setShowSearch((prev) => !prev);
      return;
    }

    if (modifier && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) {
        onRedo?.();
      } else {
        onUndo?.();
      }
      return;
    }

    if (modifier && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      onRedo?.();
      return;
    }

    if (modifier && e.key.toLowerCase() === 's') {
      e.preventDefault();
      onSave?.();
      return;
    }

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
    }
  };

  // Search & Replace helper
  const handleExecuteReplace = () => {
    if (!searchTerm) return;
    const regex = new RegExp(searchTerm, 'g');
    const replaced = value.replace(regex, replaceTerm);
    onChange(replaced);
  };

  // Tokenizer with Distinct Colors for Tables & Columns
  const renderHighlightedLine = (line: string, lineIdx: number) => {
    const lineNum = lineIdx + 1;
    const isHighlighted = highlightedLine === lineNum;
    const lineDiags = diagnosticsByLine.get(lineNum) || [];
    const hasError = lineDiags.some((d) => d.severity === 'error');
    const hasWarning = lineDiags.some((d) => d.severity === 'warning');

    if (line.length === 0) {
      return (
        <div
          key={lineIdx}
          className={`h-6 leading-6 transition-colors ${
            isHighlighted
              ? 'bg-[#e20074]/15 border-l-2 border-[#e20074]'
              : hasError
              ? 'bg-rose-50/70 border-l-2 border-rose-500'
              : hasWarning
              ? 'bg-amber-50/70 border-l-2 border-amber-500'
              : ''
          }`}
        >
          {'\u00A0'}
        </div>
      );
    }

    const tokens: React.ReactNode[] = [];
    let i = 0;

    while (i < line.length) {
      // Single line comments
      if (line.startsWith('--', i) || line.startsWith('//', i)) {
        tokens.push(
          <span key={i} className="text-slate-400 italic font-mono bg-slate-50/60 px-1 rounded-xs">
            {line.substring(i)}
          </span>
        );
        break;
      }

      // Block comments /* ... */
      if (line.startsWith('/*', i)) {
        let blockEnd = line.indexOf('*/', i + 2);
        if (blockEnd === -1) blockEnd = line.length;
        else blockEnd += 2;
        tokens.push(
          <span key={i} className="text-slate-400 italic font-mono bg-slate-50/60 px-1 rounded-xs">
            {line.substring(i, blockEnd)}
          </span>
        );
        i = blockEnd;
        continue;
      }

      // Single quote string literals
      if (line[i] === "'") {
        let strEnd = i + 1;
        while (strEnd < line.length) {
          if (line[strEnd] === "'") {
            if (line[strEnd + 1] === "'") {
              strEnd += 2;
            } else {
              strEnd += 1;
              break;
            }
          } else {
            strEnd++;
          }
        }
        tokens.push(
          <span key={i} className="text-[#047857] font-semibold font-mono bg-emerald-50/60 px-0.5 rounded-xs border border-emerald-200/40">
            {line.substring(i, strEnd)}
          </span>
        );
        i = strEnd;
        continue;
      }

      // Double quote identifiers "SCHEMA"."TABLE" or "COLUMN_NAME" (Tables & Columns in Quotes)
      if (line[i] === '"') {
        let idEnd = i + 1;
        while (idEnd < line.length && line[idEnd] !== '"') {
          idEnd++;
        }
        if (idEnd < line.length) {
          idEnd++;
        }
        tokens.push(
          <span key={i} className="text-[#0284c7] font-bold font-mono bg-sky-50 border border-sky-200/70 rounded-xs px-1 shadow-2xs">
            {line.substring(i, idEnd)}
          </span>
        );
        i = idEnd;
        continue;
      }

      // Parameters :PARAM or ?
      if (line[i] === ':' && /[A-Za-z_]/.test(line[i + 1] || '')) {
        let pEnd = i + 1;
        while (pEnd < line.length && /[A-Za-z0-9_]/.test(line[pEnd])) {
          pEnd++;
        }
        tokens.push(
          <span key={i} className="text-amber-800 font-bold font-mono bg-amber-100 px-1 rounded-xs border border-amber-300">
            {line.substring(i, pEnd)}
          </span>
        );
        i = pEnd;
        continue;
      }

      // Numbers
      if (/[0-9]/.test(line[i])) {
        let numEnd = i;
        while (numEnd < line.length && /[0-9\.]/.test(line[numEnd])) {
          numEnd++;
        }
        tokens.push(
          <span key={i} className="text-[#7c3aed] font-semibold font-mono">
            {line.substring(i, numEnd)}
          </span>
        );
        i = numEnd;
        continue;
      }

      // Words (Keywords, Functions, Types, Tables & Columns)
      if (/[A-Za-z_]/.test(line[i])) {
        let wordEnd = i;
        while (wordEnd < line.length && /[A-Za-z0-9_]/.test(line[wordEnd])) {
          wordEnd++;
        }
        const word = line.substring(i, wordEnd);
        const upper = word.toUpperCase();

        if (HANA_KEYWORDS.has(upper)) {
          tokens.push(
            <span key={i} className="text-[#e20074] font-bold font-mono tracking-tight">
              {word}
            </span>
          );
        } else if (HANA_BUILTIN_FUNCTIONS.has(upper)) {
          tokens.push(
            <span key={i} className="text-[#b45309] font-bold font-mono">
              {word}
            </span>
          );
        } else if (HANA_DATA_TYPES.has(upper)) {
          tokens.push(
            <span key={i} className="text-[#0f766e] font-semibold font-mono">
              {word}
            </span>
          );
        } else {
          // Table or Column names (unquoted identifiers) - Vibrant Royal Blue
          tokens.push(
            <span key={i} className="text-[#1d4ed8] font-bold font-mono">
              {word}
            </span>
          );
        }

        i = wordEnd;
        continue;
      }

      // Punctuation & whitespace
      tokens.push(<span key={i}>{line[i]}</span>);
      i++;
    }

    return (
      <div
        key={lineIdx}
        className={`h-6 leading-6 whitespace-pre min-w-full w-max block transition-colors ${
          isHighlighted
            ? 'bg-[#e20074]/15 border-l-2 border-[#e20074]'
            : hasError
            ? 'bg-rose-50/60 border-l-2 border-rose-500'
            : hasWarning
            ? 'bg-amber-50/60 border-l-2 border-amber-500'
            : ''
        }`}
      >
        {tokens.length === 0 ? '\u00A0' : tokens}
      </div>
    );
  };

  return (
    <div className="relative flex flex-col h-full w-full bg-white text-slate-800 font-mono overflow-hidden transition-colors">
      {/* Quick Search & Replace Bar */}
      {showSearch && (
        <div className="flex items-center gap-2 p-2 bg-slate-50 border-b border-slate-200 text-xs text-slate-700 z-20">
          <Search className="w-3.5 h-3.5 text-slate-400 shrink-0" />
          <input
            type="text"
            placeholder="Search..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="px-2 py-1 bg-white border border-slate-300 rounded text-xs outline-none focus:border-[#e20074] w-36 sm:w-48"
          />
          <input
            type="text"
            placeholder="Replace..."
            value={replaceTerm}
            onChange={(e) => setReplaceTerm(e.target.value)}
            className="px-2 py-1 bg-white border border-slate-300 rounded text-xs outline-none focus:border-[#e20074] w-36 sm:w-48"
          />
          <button
            type="button"
            onClick={handleExecuteReplace}
            className="px-2.5 py-1 bg-white hover:bg-slate-100 text-slate-700 rounded border border-slate-300 text-xs font-semibold cursor-pointer"
          >
            Replace All
          </button>
          <button
            type="button"
            onClick={() => setShowSearch(false)}
            className="p-1 hover:bg-slate-200 rounded text-slate-400 hover:text-slate-600 transition-colors ml-auto cursor-pointer"
            title="Close search"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Editor Main Canvas */}
      <div className="relative flex-1 flex overflow-hidden w-full h-full bg-white">
        {/* Line Numbers Gutter */}
        <div
          ref={lineNumbersRef}
          aria-hidden="true"
          className="w-12 sm:w-14 py-3 bg-slate-50/80 border-r border-slate-200 text-right select-none text-xs font-mono overflow-hidden shrink-0"
          style={{ lineHeight: '1.5rem' }}
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
            className="absolute inset-0 py-3 px-4 text-xs font-mono overflow-hidden pointer-events-none z-0 whitespace-pre"
            style={{ tabSize: 4, lineHeight: '1.5rem', whiteSpace: 'pre' }}
          >
            {value.length === 0 && placeholder ? (
              <span className="text-slate-300 select-none italic font-mono">
                {placeholder}
              </span>
            ) : (
              lines.map((line, idx) => renderHighlightedLine(line, idx))
            )}
          </div>

          {/* Transparent Input Textarea with Horizontal Scrolling */}
          <textarea
            ref={textareaRef}
            id="hana-sql-textarea"
            value={value}
            onChange={(e) => {
              onChange(e.target.value);
              updateCursorPos();
            }}
            onKeyUp={updateCursorPos}
            onClick={updateCursorPos}
            onScroll={handleScroll}
            onKeyDown={handleKeyDown}
            readOnly={readOnly}
            spellCheck={false}
            wrap="off"
            autoCapitalize="off"
            autoComplete="off"
            autoCorrect="off"
            className="absolute inset-0 w-full h-full py-3 px-4 text-xs font-mono bg-transparent text-transparent caret-[#e20074] resize-none outline-none overflow-auto z-10 selection:bg-[#e20074]/20 selection:text-transparent"
            style={{
              tabSize: 4,
              lineHeight: '1.5rem',
              whiteSpace: 'pre',
              wordBreak: 'normal',
              overflowWrap: 'normal',
              overflowX: 'auto',
              overflowY: 'auto',
            }}
          />
        </div>
      </div>
    </div>
  );
};
