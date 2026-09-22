import {
  HANA_KEYWORDS,
  HANA_DATA_TYPES,
  HANA_BUILTIN_FUNCTIONS,
} from './hanaSqlValidator';

// Comprehensive set of SQL and SAP HANA keywords, built-ins, and clauses
const ADDITIONAL_SQL_KEYWORDS = [
  'ALL', 'AND', 'ANY', 'AS', 'ASC', 'AUTHORIZATION', 'BACKUP', 'BEGIN', 'BETWEEN', 'BREAK',
  'BROWSE', 'BULK', 'BY', 'CASCADE', 'CASE', 'CHECK', 'CHECKPOINT', 'CLOSE', 'CLUSTERED',
  'COALESCE', 'COLLATE', 'COLUMN', 'COMMIT', 'COMPUTE', 'CONSTRAINT', 'CONTAINS', 'CONTINUE',
  'CONVERT', 'CREATE', 'CROSS', 'CURRENT', 'CURRENT_DATE', 'CURRENT_TIME', 'CURRENT_TIMESTAMP',
  'CURSOR', 'DATABASE', 'DBCC', 'DEALLOCATE', 'DECLARE', 'DEFAULT', 'DELETE', 'DENY',
  'DESC', 'DISK', 'DISTINCT', 'DISTRIBUTED', 'DOUBLE', 'DROP', 'DUMP', 'ELSE', 'ELSEIF', 'END',
  'ERRLVL', 'ESCAPE', 'EXCEPT', 'EXEC', 'EXECUTE', 'EXISTS', 'EXIT', 'EXTERNAL', 'FETCH',
  'FILE', 'FILLFACTOR', 'FOR', 'FOREIGN', 'FREETEXT', 'FROM', 'FULL', 'FUNCTION', 'GOTO',
  'GRANT', 'GROUP', 'HAVING', 'HOLDLOCK', 'IDENTITY', 'IF', 'IN', 'INDEX', 'INNER',
  'INSERT', 'INTERSECT', 'INTO', 'IS', 'JOIN', 'KEY', 'KILL', 'LATERAL', 'LEFT', 'LIKE',
  'ILIKE', 'LIMIT', 'LINENO', 'LOAD', 'MERGE', 'NATIONAL', 'NATURAL', 'NOCHECK', 'NONCLUSTERED',
  'NOT', 'NULL', 'NULLIF', 'OF', 'OFF', 'OFFSETS', 'ON', 'OPEN', 'OPENDATASOURCE', 'OPENQUERY',
  'OPENROWSET', 'OPENXML', 'OPTION', 'OR', 'ORDER', 'OUTER', 'OVER', 'PARTITION', 'PERCENT',
  'PIVOT', 'PLAN', 'PRECEDING', 'FOLLOWING', 'PRIMARY', 'PRINT', 'PROC', 'PROCEDURE',
  'PUBLIC', 'QUALIFY', 'RAISERROR', 'READ', 'READTEXT', 'RECONFIGURE', 'RECURSIVE',
  'REFERENCES', 'REPLICATION', 'RESTORE', 'RESTRICT', 'RETURN', 'REVERT', 'REVOKE',
  'RIGHT', 'ROLLBACK', 'ROW', 'ROWCOUNT', 'ROWGUIDCOL', 'ROWS', 'RULE', 'SAVE', 'SAVEPOINT',
  'SCHEMA', 'SECURITYAUDIT', 'SELECT', 'SET', 'SETUSER', 'SHUTDOWN', 'SOME', 'STATISTICS',
  'SYSTEM', 'TABLE', 'TABLESAMPLE', 'TEXTSIZE', 'THEN', 'TO', 'TOP', 'TRAN', 'TRANSACTION',
  'TRIGGER', 'TRUNCATE', 'TRY_CONVERT', 'UNION', 'UNIQUE', 'UNPIVOT', 'UPDATE', 'UPDATETEXT',
  'UPSERT', 'USE', 'USER', 'USING', 'VALUES', 'VARYING', 'VIEW', 'WAITFOR', 'WHEN',
  'WHERE', 'WHILE', 'WITH', 'WITHIN', 'WITHOUT', 'WRITETEXT'
];

export const ALL_SQL_KEYWORDS_SET = new Set<string>();

// Populate set with uppercase keys
HANA_KEYWORDS.forEach((kw) => ALL_SQL_KEYWORDS_SET.add(kw.toUpperCase()));
HANA_DATA_TYPES.forEach((dt) => ALL_SQL_KEYWORDS_SET.add(dt.toUpperCase()));
HANA_BUILTIN_FUNCTIONS.forEach((fn) => ALL_SQL_KEYWORDS_SET.add(fn.toUpperCase()));
ADDITIONAL_SQL_KEYWORDS.forEach((kw) => ALL_SQL_KEYWORDS_SET.add(kw.toUpperCase()));

/**
 * Checks if a string matches any SQL keyword, function, or type (case-insensitive)
 */
export function isSqlKeyword(word: string): boolean {
  if (!word || word.length < 2) {
    // Only 'AS', 'ON', 'IN', 'IS', 'OR', 'IF', 'BY', 'DO', 'TO', 'OF' are valid 2-letter keywords
    // 'A' is not a keyword
    return false;
  }
  return ALL_SQL_KEYWORDS_SET.has(word.toUpperCase());
}

/**
 * Delimiter characters that complete a word token in SQL
 */
export function isSqlDelimiter(char: string): boolean {
  return /[\s,;()\[\]{}=<>+\-*\/%|&^~!:?]/.test(char);
}

/**
 * Inspects whether a character index in SQL code is located inside
 * a string literal ('...'), a quoted identifier ("...", `...`, [...]),
 * or a comment (-- ..., // ..., /* ... * /).
 */
export function getSqlContextAt(sql: string, targetIndex: number): {
  isString: boolean;
  isComment: boolean;
  isQuotedIdentifier: boolean;
} {
  let i = 0;
  const len = Math.min(sql.length, targetIndex + 1);
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inBacktick = false;
  let inBracket = false;
  let inLineComment = false;
  let inBlockComment = false;

  while (i < len) {
    const ch = sql[i];
    const next = sql[i + 1] || '';

    // In single quote string literal
    if (inSingleQuote) {
      if (ch === "'") {
        if (next === "'") {
          if (i === targetIndex || i + 1 === targetIndex) {
            return { isString: true, isComment: false, isQuotedIdentifier: false };
          }
          i += 2;
          continue;
        } else {
          inSingleQuote = false;
          if (i === targetIndex) {
            return { isString: true, isComment: false, isQuotedIdentifier: false };
          }
          i++;
          continue;
        }
      }
      if (i === targetIndex) {
        return { isString: true, isComment: false, isQuotedIdentifier: false };
      }
      i++;
      continue;
    }

    // In double quote identifier
    if (inDoubleQuote) {
      if (ch === '"') {
        if (next === '"') {
          i += 2;
          continue;
        }
        inDoubleQuote = false;
        if (i === targetIndex) {
          return { isString: false, isComment: false, isQuotedIdentifier: true };
        }
        i++;
        continue;
      }
      if (i === targetIndex) {
        return { isString: false, isComment: false, isQuotedIdentifier: true };
      }
      i++;
      continue;
    }

    // In backtick identifier
    if (inBacktick) {
      if (ch === '`') {
        inBacktick = false;
        if (i === targetIndex) {
          return { isString: false, isComment: false, isQuotedIdentifier: true };
        }
        i++;
        continue;
      }
      if (i === targetIndex) {
        return { isString: false, isComment: false, isQuotedIdentifier: true };
      }
      i++;
      continue;
    }

    // In bracket identifier
    if (inBracket) {
      if (ch === ']') {
        inBracket = false;
        if (i === targetIndex) {
          return { isString: false, isComment: false, isQuotedIdentifier: true };
        }
        i++;
        continue;
      }
      if (i === targetIndex) {
        return { isString: false, isComment: false, isQuotedIdentifier: true };
      }
      i++;
      continue;
    }

    // In single line comment
    if (inLineComment) {
      if (ch === '\n') {
        inLineComment = false;
      } else {
        if (i === targetIndex) {
          return { isString: false, isComment: true, isQuotedIdentifier: false };
        }
        i++;
        continue;
      }
    }

    // In block comment
    if (inBlockComment) {
      if (ch === '*' && next === '/') {
        inBlockComment = false;
        if (i === targetIndex || i + 1 === targetIndex) {
          return { isString: false, isComment: true, isQuotedIdentifier: false };
        }
        i += 2;
        continue;
      }
      if (i === targetIndex) {
        return { isString: false, isComment: true, isQuotedIdentifier: false };
      }
      i++;
      continue;
    }

    // Check opening tokens
    if (ch === "'") {
      inSingleQuote = true;
      if (i === targetIndex) {
        return { isString: true, isComment: false, isQuotedIdentifier: false };
      }
      i++;
      continue;
    }

    if (ch === '"') {
      inDoubleQuote = true;
      if (i === targetIndex) {
        return { isString: false, isComment: false, isQuotedIdentifier: true };
      }
      i++;
      continue;
    }

    if (ch === '`') {
      inBacktick = true;
      if (i === targetIndex) {
        return { isString: false, isComment: false, isQuotedIdentifier: true };
      }
      i++;
      continue;
    }

    if (ch === '[') {
      inBracket = true;
      if (i === targetIndex) {
        return { isString: false, isComment: false, isQuotedIdentifier: true };
      }
      i++;
      continue;
    }

    if ((ch === '-' && next === '-') || (ch === '/' && next === '/')) {
      inLineComment = true;
      if (i === targetIndex || i + 1 === targetIndex) {
        return { isString: false, isComment: true, isQuotedIdentifier: false };
      }
      i += 2;
      continue;
    }

    if (ch === '/' && next === '*') {
      inBlockComment = true;
      if (i === targetIndex || i + 1 === targetIndex) {
        return { isString: false, isComment: true, isQuotedIdentifier: false };
      }
      i += 2;
      continue;
    }

    if (i === targetIndex) {
      return { isString: false, isComment: false, isQuotedIdentifier: false };
    }

    i++;
  }

  return {
    isString: inSingleQuote,
    isComment: inLineComment || inBlockComment,
    isQuotedIdentifier: inDoubleQuote || inBacktick || inBracket,
  };
}

/**
 * Checks if the word preceding a given cursor index is an SQL keyword in lowercase,
 * and if so, replaces it with UPPERCASE while maintaining exact cursor position.
 * Triggered automatically as the user types delimiters (spaces, tabs, newlines, parens, etc.).
 */
export function autoUppercaseKeywordAtPosition(
  text: string,
  cursorIndex: number
): { newSql: string; newCursor: number } | null {
  if (cursorIndex <= 0 || cursorIndex > text.length) {
    return null;
  }

  const prevChar = text[cursorIndex - 1];

  // 1. Identify where the word ends
  let wordEnd = cursorIndex;
  if (isSqlDelimiter(prevChar)) {
    // Delimiter just typed! Word ended right before this delimiter
    wordEnd = cursorIndex - 1;
  }

  // 2. Scan backwards to find where the word starts
  let wordStart = wordEnd - 1;
  while (wordStart >= 0 && /[A-Za-z0-9_]/.test(text[wordStart])) {
    wordStart--;
  }
  wordStart++; // Move to first character of the word

  if (wordEnd <= wordStart) {
    return null;
  }

  const word = text.substring(wordStart, wordEnd);

  // Must start with an alphabet letter (not numbers or underscores)
  if (!/^[A-Za-z]/.test(word)) {
    return null;
  }

  // Must contain at least one lowercase letter to need conversion
  if (!/[a-z]/.test(word)) {
    return null;
  }

  const upperWord = word.toUpperCase();
  if (!ALL_SQL_KEYWORDS_SET.has(upperWord)) {
    return null;
  }

  // Check if preceded by dot (.) like table.column or schema.table
  let dotCheckIndex = wordStart - 1;
  while (dotCheckIndex >= 0 && /\s/.test(text[dotCheckIndex])) {
    dotCheckIndex--;
  }
  if (dotCheckIndex >= 0 && text[dotCheckIndex] === '.') {
    // It's a field or column identifier, not a standalone keyword
    return null;
  }

  // Check if inside strings or comments
  const context = getSqlContextAt(text, wordStart);
  if (context.isString || context.isComment || context.isQuotedIdentifier) {
    return null;
  }

  // Perform replacement: length is identical, cursor offset remains same!
  const newSql = text.substring(0, wordStart) + upperWord + text.substring(wordEnd);
  return {
    newSql,
    newCursor: cursorIndex,
  };
}

/**
 * Transforms all SQL keywords written in lowercase/mixedcase in the entire text
 * into UPPERCASE, strictly preserving:
 * - String literals ('...')
 * - Quoted identifiers ("...", `...`, [...])
 * - Comments (-- ..., // ..., /* ... * /)
 * - Object properties / columns preceded by a dot (e.g. t1.date)
 */
export function autoUppercaseSqlKeywords(sql: string): string {
  if (!sql) return sql;

  let result = '';
  let i = 0;
  const len = sql.length;

  while (i < len) {
    const ch = sql[i];
    const next = sql[i + 1] || '';

    // 1. Single-line comment (-- or //)
    if ((ch === '-' && next === '-') || (ch === '/' && next === '/')) {
      let endIdx = sql.indexOf('\n', i + 2);
      if (endIdx === -1) endIdx = len;
      result += sql.substring(i, endIdx);
      i = endIdx;
      continue;
    }

    // 2. Multi-line comment (/* ... */)
    if (ch === '/' && next === '*') {
      let endIdx = sql.indexOf('*/', i + 2);
      if (endIdx === -1) endIdx = len;
      else endIdx += 2;
      result += sql.substring(i, endIdx);
      i = endIdx;
      continue;
    }

    // 3. String literal ('...')
    if (ch === "'") {
      let strEnd = i + 1;
      while (strEnd < len) {
        if (sql[strEnd] === "'") {
          if (sql[strEnd + 1] === "'") {
            strEnd += 2;
          } else {
            strEnd++;
            break;
          }
        } else {
          strEnd++;
        }
      }
      result += sql.substring(i, strEnd);
      i = strEnd;
      continue;
    }

    // 4. Double-quoted identifier ("...")
    if (ch === '"') {
      let idEnd = i + 1;
      while (idEnd < len && sql[idEnd] !== '"') {
        idEnd++;
      }
      if (idEnd < len) idEnd++;
      result += sql.substring(i, idEnd);
      i = idEnd;
      continue;
    }

    // 5. Backtick identifier (`...`)
    if (ch === '`') {
      let idEnd = i + 1;
      while (idEnd < len && sql[idEnd] !== '`') {
        idEnd++;
      }
      if (idEnd < len) idEnd++;
      result += sql.substring(i, idEnd);
      i = idEnd;
      continue;
    }

    // 6. Bracket identifier ([...])
    if (ch === '[') {
      let idEnd = i + 1;
      while (idEnd < len && sql[idEnd] !== ']') {
        idEnd++;
      }
      if (idEnd < len) idEnd++;
      result += sql.substring(i, idEnd);
      i = idEnd;
      continue;
    }

    // 7. Word tokens (A-Za-z_)
    if (/[A-Za-z_]/.test(ch)) {
      let wordEnd = i;
      while (wordEnd < len && /[A-Za-z0-9_]/.test(sql[wordEnd])) {
        wordEnd++;
      }
      const word = sql.substring(i, wordEnd);

      // Check if preceded by dot
      let dotCheck = i - 1;
      while (dotCheck >= 0 && /\s/.test(sql[dotCheck])) {
        dotCheck--;
      }
      const precededByDot = dotCheck >= 0 && sql[dotCheck] === '.';

      // If starts with letter, not preceded by dot, and is a keyword
      if (!precededByDot && /^[A-Za-z]/.test(word) && /[a-z]/.test(word)) {
        const upper = word.toUpperCase();
        if (ALL_SQL_KEYWORDS_SET.has(upper)) {
          result += upper;
          i = wordEnd;
          continue;
        }
      }

      result += word;
      i = wordEnd;
      continue;
    }

    // 8. Other characters (whitespace, symbols, punctuation, numbers)
    result += ch;
    i++;
  }

  return result;
}
