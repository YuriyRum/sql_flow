import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { SyntaxDiagnostic } from '../types';
import {
  HANA_KEYWORDS,
  HANA_DATA_TYPES,
  HANA_BUILTIN_FUNCTIONS,
} from '../utils/hanaSqlValidator';
import {
  SQL_SNIPPETS,
  SAP_COMMON_TABLES,
  SAP_COMMON_COLUMNS,
  KEYWORDS_LIST,
  SqlSnippet,
  AutocompleteItem,
} from '../utils/sqlSnippets';
import {
  AlertCircle,
  AlertTriangle,
  Info,
  Search,
  X,
  Code2,
  Zap,
  Sparkles,
  Check,
  ChevronDown,
  Table as TableIcon,
  Terminal,
  FileCode,
} from 'lucide-react';

interface HanaCodeEditorProps {
  value: string;
  onChange: (value: string) => void;
  diagnostics: SyntaxDiagnostic[];
  onFormat?: () => void;
  readOnly?: boolean;
  onCursorChange?: (line: number, col: number) => void;
  onUndo?: () => void;
  onRedo?: () => void;
  onSave?: () => void;
}

export const HanaCodeEditor: React.FC<HanaCodeEditorProps> = ({
  value,
  onChange,
  diagnostics,
  readOnly = false,
  onCursorChange,
  onUndo,
  onRedo,
  onSave,
}) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const lineNumbersRef = useRef<HTMLDivElement>(null);
  const highlightRef = useRef<HTMLDivElement>(null);

  const [cursorPos, setCursorPos] = useState({ line: 1, col: 1 });
  const [showSearch, setShowSearch] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [replaceTerm, setReplaceTerm] = useState('');

  // Autocomplete state
  const [showAutocomplete, setShowAutocomplete] = useState(false);
  const [autocompleteFilter, setAutocompleteFilter] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [wordRange, setWordRange] = useState<{ start: number; end: number }>({ start: 0, end: 0 });

  // Snippets modal state
  const [showSnippetsModal, setShowSnippetsModal] = useState(false);
  const [snippetCategory, setSnippetCategory] = useState<string>('All');
  const [snippetSearch, setSnippetSearch] = useState('');

  const lines = value.split('\n');

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

  // Build autocomplete suggestions based on current word prefix
  const suggestions: AutocompleteItem[] = useMemo(() => {
    if (!showAutocomplete) return [];
    const query = autocompleteFilter.trim().toLowerCase();

    const items: AutocompleteItem[] = [];

    // 1. Snippets matching query
    SQL_SNIPPETS.forEach((s) => {
      if (
        !query ||
        s.trigger.toLowerCase().includes(query) ||
        s.label.toLowerCase().includes(query) ||
        s.category.toLowerCase().includes(query)
      ) {
        items.push({
          label: s.label,
          type: 'snippet',
          detail: `[${s.category}] ${s.description}`,
          insertText: s.snippet,
          snippetObj: s,
        });
      }
    });

    // 2. SAP Tables matching query
    SAP_COMMON_TABLES.forEach((t) => {
      if (!query || t.label.toLowerCase().includes(query) || t.detail.toLowerCase().includes(query)) {
        items.push({
          label: t.label,
          type: 'table',
          detail: t.detail,
          insertText: t.label,
        });
      }
    });

    // 3. SAP Columns matching query
    SAP_COMMON_COLUMNS.forEach((c) => {
      if (!query || c.label.toLowerCase().includes(query) || c.detail.toLowerCase().includes(query)) {
        items.push({
          label: c.label,
          type: 'column',
          detail: c.detail,
          insertText: c.label,
        });
      }
    });

    // 4. HANA Built-in functions matching query
    Array.from(HANA_BUILTIN_FUNCTIONS).forEach((f) => {
      if (!query || f.toLowerCase().includes(query)) {
        items.push({
          label: f,
          type: 'function',
          detail: 'HANA Built-in Function',
          insertText: `${f}()`,
        });
      }
    });

    // 5. Standard SQL Keywords matching query
    KEYWORDS_LIST.forEach((kw) => {
      if (!query || kw.toLowerCase().includes(query)) {
        items.push({
          label: kw,
          type: 'keyword',
          detail: 'SQL Keyword',
          insertText: kw,
        });
      }
    });

    // Limit suggestions list for performance
    return items.slice(0, 15);
  }, [showAutocomplete, autocompleteFilter]);

  // Handle inserting an autocomplete suggestion
  const insertSuggestion = useCallback(
    (item: AutocompleteItem) => {
      if (!textareaRef.current) return;
      const currentVal = value;
      const { start, end } = wordRange;

      const before = currentVal.substring(0, start);
      const after = currentVal.substring(end);
      const inserted = item.insertText;

      const updatedVal = before + inserted + after;
      onChange(updatedVal);

      setShowAutocomplete(false);

      // Reset cursor position after insert
      setTimeout(() => {
        if (textareaRef.current) {
          const newPos = start + inserted.length;
          textareaRef.current.selectionStart = textareaRef.current.selectionEnd = newPos;
          textareaRef.current.focus();
        }
      }, 0);
    },
    [value, wordRange, onChange]
  );

  // Insert snippet from Modal or Toolbar
  const insertSnippetDirectly = (snippetText: string) => {
    if (!textareaRef.current) {
      onChange(value + '\n\n' + snippetText);
      return;
    }

    const selStart = textareaRef.current.selectionStart;
    const selEnd = textareaRef.current.selectionEnd;
    const before = value.substring(0, selStart);
    const after = value.substring(selEnd);

    const spacing = before.trim().length > 0 && !before.endsWith('\n\n') ? '\n\n' : '';
    const updated = before + spacing + snippetText + after;

    onChange(updated);
    setShowSnippetsModal(false);

    setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.focus();
      }
    }, 0);
  };

  const updateCursorAndCheckAutocomplete = () => {
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

    // Determine current word prefix for autocomplete
    const currentLineText = lineArr[lineArr.length - 1];
    const match = currentLineText.match(/[a-zA-Z0-9_"\.]*$/);
    if (match && match[0].length >= 1) {
      const word = match[0];
      const wordStart = selStart - word.length;
      setWordRange({ start: wordStart, end: selStart });
      setAutocompleteFilter(word);
      setShowAutocomplete(true);
      setSelectedIndex(0);
    } else {
      setShowAutocomplete(false);
    }
  };

  // Handle Tab, Autocomplete Navigation, Shortcuts in editor
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
    const modifier = isMac ? e.metaKey : e.ctrlKey;

    // Ctrl+Space trigger autocomplete explicitly
    if (e.ctrlKey && e.code === 'Space') {
      e.preventDefault();
      if (!textareaRef.current) return;
      const selStart = textareaRef.current.selectionStart;
      const sub = value.substring(0, selStart);
      const lineArr = sub.split('\n');
      const currentLineText = lineArr[lineArr.length - 1];
      const match = currentLineText.match(/[a-zA-Z0-9_"\.]*$/);
      const word = match ? match[0] : '';
      const wordStart = selStart - word.length;

      setWordRange({ start: wordStart, end: selStart });
      setAutocompleteFilter(word);
      setShowAutocomplete(true);
      setSelectedIndex(0);
      return;
    }

    // Keyboard navigation inside Autocomplete dropdown
    if (showAutocomplete && suggestions.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((prev) => (prev + 1) % suggestions.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((prev) => (prev - 1 + suggestions.length) % suggestions.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        if (suggestions[selectedIndex]) {
          insertSuggestion(suggestions[selectedIndex]);
        }
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setShowAutocomplete(false);
        return;
      }
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
    } else if (e.key === 'f' && modifier) {
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

  const filteredSnippets = useMemo(() => {
    return SQL_SNIPPETS.filter((s) => {
      const matchCat = snippetCategory === 'All' || s.category === snippetCategory;
      const matchSearch =
        !snippetSearch ||
        s.label.toLowerCase().includes(snippetSearch.toLowerCase()) ||
        s.description.toLowerCase().includes(snippetSearch.toLowerCase()) ||
        s.snippet.toLowerCase().includes(snippetSearch.toLowerCase());
      return matchCat && matchSearch;
    });
  }, [snippetCategory, snippetSearch]);

  const snippetCategories = ['All', 'Basic', 'Aggregation', 'Window & Analytics', 'Joins & Star Schema', 'CTE & Subqueries', 'SAP ERP Tables', 'Date & Time'];

  return (
    <div className="relative flex flex-col h-full w-full bg-white text-slate-800 font-mono rounded-lg border border-slate-200 hover:border-slate-300 overflow-hidden shadow-sm transition-colors">
      {/* Top Code Editor Control & Snippets Toolbar */}
      <div className="bg-slate-800 text-slate-200 border-b border-slate-700 px-3 py-1.5 flex flex-wrap items-center justify-between gap-2 text-xs shrink-0 select-none z-20">
        <div className="flex flex-wrap items-center gap-2">
          {/* Snippets Modal Button */}
          <button
            type="button"
            onClick={() => setShowSnippetsModal(true)}
            className="flex items-center gap-1.5 px-2.5 py-1 bg-[#e20074] hover:bg-[#c70066] text-white rounded-md font-bold text-[11px] transition-all shadow-xs cursor-pointer"
            title="Open SQL SELECT Snippets Library & Template Gallery"
          >
            <Code2 className="w-3.5 h-3.5" />
            <span>SQL Snippets Library</span>
          </button>

          {/* Quick Insert Snippet Dropdown */}
          <div className="relative group">
            <button
              type="button"
              className="flex items-center gap-1 px-2 py-1 bg-slate-700 hover:bg-slate-650 text-slate-200 rounded-md font-medium text-[11px] transition-colors border border-slate-600 cursor-pointer"
            >
              <Zap className="w-3 h-3 text-amber-400" />
              <span>Quick Template</span>
              <ChevronDown className="w-3 h-3 text-slate-400" />
            </button>
            <div className="absolute top-full left-0 mt-1 w-64 bg-slate-800 border border-slate-700 rounded-lg shadow-xl p-1 hidden group-hover:block z-30 space-y-0.5">
              {SQL_SNIPPETS.slice(0, 6).map((snip) => (
                <button
                  key={snip.id}
                  type="button"
                  onClick={() => insertSnippetDirectly(snip.snippet)}
                  className="w-full text-left px-2.5 py-1.5 rounded text-[11px] hover:bg-slate-700 text-slate-200 hover:text-white flex flex-col transition-colors cursor-pointer"
                >
                  <span className="font-bold text-indigo-300 flex items-center justify-between">
                    <span>{snip.label}</span>
                    <span className="text-[9px] uppercase px-1 py-0.2 bg-slate-900 rounded text-slate-400">{snip.category}</span>
                  </span>
                  <span className="text-[10px] text-slate-400 line-clamp-1">{snip.description}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Autocomplete Trigger Info */}
          <button
            type="button"
            onClick={() => {
              setShowAutocomplete(true);
              textareaRef.current?.focus();
            }}
            className="flex items-center gap-1 px-2 py-1 bg-slate-900 hover:bg-slate-950 text-indigo-300 rounded-md text-[10px] font-mono border border-indigo-500/30 cursor-pointer"
            title="Press Ctrl+Space anytime while typing for SQL autocomplete"
          >
            <Sparkles className="w-3 h-3 text-indigo-400" />
            <span>Autocomplete (Ctrl+Space)</span>
          </button>
        </div>

        <div className="flex items-center gap-3">
          {/* Search Toggle */}
          <button
            type="button"
            onClick={() => setShowSearch((prev) => !prev)}
            className={`p-1 rounded text-[11px] font-medium transition-colors cursor-pointer ${
              showSearch ? 'bg-[#e20074] text-white' : 'text-slate-300 hover:bg-slate-700 hover:text-white'
            }`}
            title="Search & Replace (Ctrl+F)"
          >
            <Search className="w-3.5 h-3.5" />
          </button>

          {/* Line & Column Indicator */}
          <span className="text-[11px] font-mono text-slate-400">
            Ln {cursorPos.line}, Col {cursorPos.col}
          </span>
        </div>
      </div>

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
            className="px-2.5 py-1 bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 hover:border-[#f8b4d9] rounded font-medium transition-colors shadow-sm cursor-pointer"
          >
            Replace
          </button>
          <button
            type="button"
            onClick={() => handleSearchReplace(true)}
            className="px-2.5 py-1 bg-[#e20074] hover:bg-[#c70066] text-white rounded font-medium transition-colors shadow-sm cursor-pointer"
          >
            Replace All
          </button>
          <button
            type="button"
            onClick={() => setShowSearch(false)}
            className="p-1 hover:bg-slate-200 rounded text-slate-500 hover:text-slate-700 ml-auto cursor-pointer"
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
              updateCursorAndCheckAutocomplete();
            }}
            onKeyUp={updateCursorAndCheckAutocomplete}
            onClick={updateCursorAndCheckAutocomplete}
            onScroll={handleScroll}
            onKeyDown={handleKeyDown}
            readOnly={readOnly}
            spellCheck={false}
            autoCapitalize="off"
            autoComplete="off"
            autoCorrect="off"
            className="absolute inset-0 w-full h-full py-3 px-4 text-xs font-mono bg-transparent text-transparent caret-[#e20074] resize-none outline-none overflow-auto z-10 selection:bg-[#e20074]/20 selection:text-transparent"
            style={{ tabSize: 4, lineHeight: '1.5rem' }}
          />

          {/* Floating Autocomplete Popover Overlay */}
          {showAutocomplete && suggestions.length > 0 && (
            <div
              className="absolute left-6 bottom-4 z-30 w-80 max-h-64 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl overflow-hidden flex flex-col font-sans"
              style={{
                boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.5), 0 10px 10px -5px rgba(0, 0, 0, 0.3)',
              }}
            >
              <div className="px-3 py-1.5 bg-slate-800 border-b border-slate-700 flex items-center justify-between text-[11px] text-slate-300 font-bold">
                <span className="flex items-center gap-1.5 text-indigo-300">
                  <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
                  <span>SQL Suggestions ({suggestions.length})</span>
                </span>
                <span className="text-[10px] text-slate-400 font-mono">Use ↑↓ & Enter/Tab</span>
              </div>

              <div className="flex-1 overflow-y-auto p-1 space-y-0.5 custom-scrollbar">
                {suggestions.map((item, idx) => {
                  const isSelected = idx === selectedIndex;
                  return (
                    <div
                      key={idx}
                      onClick={() => insertSuggestion(item)}
                      onMouseEnter={() => setSelectedIndex(idx)}
                      className={`p-2 rounded-lg flex items-start justify-between gap-2 transition-colors cursor-pointer ${
                        isSelected
                          ? 'bg-indigo-600 text-white shadow-sm'
                          : 'hover:bg-slate-800 text-slate-200'
                      }`}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono font-bold text-xs truncate">
                            {item.label}
                          </span>
                        </div>
                        {item.detail && (
                          <div className={`text-[10px] truncate ${isSelected ? 'text-indigo-100' : 'text-slate-400'}`}>
                            {item.detail}
                          </div>
                        )}
                      </div>

                      {/* Item Type Badge */}
                      <span
                        className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded shrink-0 ${
                          item.type === 'snippet'
                            ? 'bg-pink-500/30 text-pink-200 border border-pink-400/30'
                            : item.type === 'keyword'
                            ? 'bg-indigo-500/30 text-indigo-200 border border-indigo-400/30'
                            : item.type === 'function'
                            ? 'bg-emerald-500/30 text-emerald-200 border border-emerald-400/30'
                            : 'bg-slate-700 text-slate-300'
                        }`}
                      >
                        {item.type}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* SQL Snippets Library Modal */}
      {showSnippetsModal && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-xs flex items-center justify-center p-4 z-50 overflow-y-auto font-sans">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-4xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden text-slate-100">
            {/* Modal Header */}
            <div className="p-4 bg-slate-800 border-b border-slate-700 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-[#e20074]/20 text-[#f8b4d9] rounded-xl border border-[#e20074]/30">
                  <Code2 className="w-5 h-5 text-[#e20074]" />
                </div>
                <div>
                  <h2 className="font-bold text-base text-white">
                    SQL SELECT Statement Snippets & Template Library
                  </h2>
                  <p className="text-xs text-slate-400">
                    Pre-engineered, optimized SAP HANA SELECT templates for complex analytics & ETLs
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setShowSnippetsModal(false)}
                className="p-1.5 hover:bg-slate-700 text-slate-400 hover:text-white rounded-xl transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Filter & Search Bar */}
            <div className="p-4 bg-slate-850 border-b border-slate-700/80 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 shrink-0">
              {/* Search */}
              <div className="relative flex-1">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Search SELECT templates by keywords, tables, or category..."
                  value={snippetSearch}
                  onChange={(e) => setSnippetSearch(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl pl-9 pr-3 py-2 text-xs text-white placeholder-slate-500 outline-none focus:border-[#e20074]"
                />
              </div>

              {/* Category Filter Pills */}
              <div className="flex flex-wrap items-center gap-1.5">
                {snippetCategories.map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setSnippetCategory(cat)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                      snippetCategory === cat
                        ? 'bg-[#e20074] text-white shadow-xs'
                        : 'bg-slate-800 text-slate-400 hover:text-slate-200 border border-slate-700'
                    }`}
                  >
                    {cat}
                  </button>
                ))}
              </div>
            </div>

            {/* Snippets List Grid */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar">
              {filteredSnippets.length === 0 ? (
                <div className="py-12 text-center text-slate-400 text-xs">
                  No SQL snippets found matching "{snippetSearch}"
                </div>
              ) : (
                filteredSnippets.map((snip) => (
                  <div
                    key={snip.id}
                    className="p-4 bg-slate-800/80 border border-slate-700 rounded-2xl hover:border-slate-600 transition-all flex flex-col gap-3 group"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <h3 className="font-bold text-sm text-white">{snip.label}</h3>
                          <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                            {snip.category}
                          </span>
                        </div>
                        <p className="text-xs text-slate-400">{snip.description}</p>
                      </div>

                      <button
                        type="button"
                        onClick={() => insertSnippetDirectly(snip.snippet)}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold transition-all shadow-md cursor-pointer shrink-0"
                      >
                        <Zap className="w-3.5 h-3.5" />
                        <span>Insert Snippet</span>
                      </button>
                    </div>

                    {/* Code Snippet Box */}
                    <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 overflow-x-auto font-mono text-[11px] text-emerald-400 leading-relaxed max-h-48 custom-scrollbar">
                      <pre>{snip.snippet}</pre>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
