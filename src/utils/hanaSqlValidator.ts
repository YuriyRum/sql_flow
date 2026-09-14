import { SyntaxDiagnostic, ValidationResult, QueryParameter } from '../types';

// SAP HANA standard and reserved keywords
export const HANA_KEYWORDS = new Set([
  'SELECT', 'FROM', 'WHERE', 'GROUP', 'BY', 'HAVING', 'ORDER', 'LIMIT', 'OFFSET', 'TOP',
  'JOIN', 'INNER', 'LEFT', 'RIGHT', 'FULL', 'OUTER', 'CROSS', 'NATURAL', 'ON', 'AS', 'AND', 'OR', 'NOT',
  'IN', 'EXISTS', 'BETWEEN', 'LIKE', 'ILIKE', 'IS', 'NULL', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END',
  'UNION', 'ALL', 'DISTINCT', 'INTERSECT', 'MINUS', 'EXCEPT', 'TRUE', 'FALSE',
  'INSERT', 'INTO', 'VALUES', 'UPDATE', 'SET', 'DELETE', 'UPSERT', 'WITH', 'PRIMARY', 'KEY',
  'MERGE', 'USING', 'MATCHED',
  'CREATE', 'ALTER', 'DROP', 'TRUNCATE', 'TABLE', 'COLUMN', 'ROW', 'VIEW', 'GLOBAL', 'TEMPORARY',
  'INDEX', 'SEQUENCE', 'SYNONYM', 'SCHEMA', 'PROCEDURE', 'FUNCTION',
  'DO', 'BEGIN', 'DECLARE', 'DEFAULT', 'CALL', 'RETURN', 'IF', 'ELSEIF', 'WHILE', 'FOR', 'LOOP',
  'OVER', 'PARTITION', 'ROWS', 'RANGE', 'UNBOUNDED', 'PRECEDING', 'FOLLOWING', 'CURRENT', 'ROW',
  'ASC', 'DESC', 'NULLS', 'FIRST', 'LAST',
  'LOAD', 'UNLOAD', 'DELTA', 'RECORD', 'LOG'
]);

export const HANA_DATA_TYPES = new Set([
  'NVARCHAR', 'VARCHAR', 'CHAR', 'NCHAR', 'ALPHANUM', 'SHORTTEXT',
  'DECIMAL', 'DEC', 'NUMERIC', 'TINYINT', 'SMALLINT', 'INTEGER', 'INT', 'BIGINT', 'SMALLDECIMAL',
  'REAL', 'FLOAT', 'DOUBLE',
  'DATE', 'TIME', 'SECONDDATE', 'TIMESTAMP',
  'BOOLEAN',
  'CLOB', 'NCLOB', 'BLOB', 'TEXT', 'BINTERVAL',
  'VARBINARY', 'ST_GEOMETRY', 'ST_POINT'
]);

export const HANA_BUILTIN_FUNCTIONS = new Set([
  // Type conversion
  'TO_NVARCHAR', 'TO_VARCHAR', 'TO_CHAR', 'TO_DECIMAL', 'TO_INTEGER', 'TO_BIGINT',
  'TO_REAL', 'TO_DOUBLE', 'TO_DATE', 'TO_TIME', 'TO_SECONDDATE', 'TO_TIMESTAMP', 'TO_BOOLEAN',
  'CAST', 'CONVERT',
  // String functions
  'CONCAT', 'SUBSTRING', 'LEFT', 'RIGHT', 'LENGTH', 'LOWER', 'UPPER', 'TRIM', 'LTRIM', 'RTRIM',
  'LPAD', 'RPAD', 'REPLACE', 'LOCATE', 'INSTR', 'SOUNDEX', 'NCHAR', 'UNICODE',
  // Math functions
  'ABS', 'CEIL', 'FLOOR', 'ROUND', 'TRUNC', 'MOD', 'POWER', 'SQRT', 'EXP', 'LN', 'LOG', 'SIGN',
  'GREATEST', 'LEAST',
  // Date & Time
  'CURRENT_DATE', 'CURRENT_TIME', 'CURRENT_TIMESTAMP', 'CURRENT_UTCDATE', 'CURRENT_UTCTIME',
  'CURRENT_UTCTIMESTAMP', 'NOW', 'ADD_DAYS', 'ADD_MONTHS', 'ADD_YEARS', 'ADD_SECONDS',
  'DAYS_BETWEEN', 'MONTHS_BETWEEN', 'YEARS_BETWEEN', 'SECONDS_BETWEEN',
  'EXTRACT', 'WEEKDAY', 'QUARTER', 'ISOWEEK', 'LAST_DAY', 'NEXT_DAY',
  // Conditional & Null
  'IFNULL', 'COALESCE', 'NULLIF', 'MAP', 'CASE',
  // Aggregate & Window
  'COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'STDDEV', 'VAR', 'MEDIAN',
  'ROW_NUMBER', 'RANK', 'DENSE_RANK', 'PERCENT_RANK', 'CUME_DIST', 'NTILE',
  'LAG', 'LEAD', 'FIRST_VALUE', 'LAST_VALUE', 'NTH_VALUE',
  // HANA Specific
  'ARRAY_AGG', 'SERIES_GENERATE', 'SERIES_GENERATE_TIMESTAMP', 'JSON_VALUE', 'JSON_QUERY',
  'BINTOHEX', 'HEXTOBIN', 'HASH_SHA256', 'RECORD_COUNT'
]);

// Token structure for Lexical Analysis
export interface Token {
  type:
    | 'KEYWORD'
    | 'IDENTIFIER'
    | 'QUOTED_IDENTIFIER'
    | 'STRING_LITERAL'
    | 'NUMBER_LITERAL'
    | 'PARAMETER'
    | 'OPERATOR'
    | 'PUNCTUATION'
    | 'INVALID';
  value: string;
  raw: string;
  line: number;
  column: number;
}

/**
 * Tokenize SQL string into a structured token stream while capturing invalid characters & lexical errors.
 */
export function tokenizeHanaSql(sql: string, diagnostics: SyntaxDiagnostic[]): Token[] {
  const tokens: Token[] = [];
  const lines = sql.split('\n');

  let inBlockComment = false;
  let blockCommentStart = { line: 1, col: 1 };

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const rawLine = lines[lineIdx];
    const lineNum = lineIdx + 1;
    let col = 0;

    while (col < rawLine.length) {
      const colNum = col + 1;
      const char = rawLine[col];
      const nextChar = rawLine[col + 1] || '';

      // 1. In Block Comment
      if (inBlockComment) {
        if (char === '*' && nextChar === '/') {
          inBlockComment = false;
          col += 2;
        } else {
          col++;
        }
        continue;
      }

      // 2. Whitespace
      if (/\s/.test(char)) {
        col++;
        continue;
      }

      // 3. Single-line comments (-- or //)
      if ((char === '-' && nextChar === '-') || (char === '/' && nextChar === '/')) {
        break; // Rest of line is comment
      }

      // 4. Block comment start (/*)
      if (char === '/' && nextChar === '*') {
        inBlockComment = true;
        blockCommentStart = { line: lineNum, col: colNum };
        col += 2;
        continue;
      }

      // 5. String literal ('...')
      if (char === "'") {
        let strVal = '';
        let endCol = col + 1;
        let closed = false;

        while (endCol < rawLine.length) {
          if (rawLine[endCol] === "'") {
            if (rawLine[endCol + 1] === "'") {
              strVal += "'";
              endCol += 2;
            } else {
              closed = true;
              endCol++;
              break;
            }
          } else {
            strVal += rawLine[endCol];
            endCol++;
          }
        }

        if (!closed) {
          diagnostics.push({
            line: lineNum,
            column: colNum,
            message: "Unterminated string literal (missing closing single quote ').",
            severity: 'error',
            ruleId: 'HANA_UNTERMINATED_STRING',
          });
        }

        tokens.push({
          type: 'STRING_LITERAL',
          value: strVal,
          raw: rawLine.substring(col, endCol),
          line: lineNum,
          column: colNum,
        });

        col = endCol;
        continue;
      }

      // 6. Quoted identifier ("...")
      if (char === '"') {
        let idVal = '';
        let endCol = col + 1;
        let closed = false;

        while (endCol < rawLine.length) {
          if (rawLine[endCol] === '"') {
            if (rawLine[endCol + 1] === '"') {
              idVal += '"';
              endCol += 2;
            } else {
              closed = true;
              endCol++;
              break;
            }
          } else {
            idVal += rawLine[endCol];
            endCol++;
          }
        }

        if (!closed) {
          diagnostics.push({
            line: lineNum,
            column: colNum,
            message: 'Unterminated identifier literal (missing closing double quote ").',
            severity: 'error',
            ruleId: 'HANA_UNTERMINATED_IDENTIFIER',
          });
        }

        tokens.push({
          type: 'QUOTED_IDENTIFIER',
          value: idVal,
          raw: rawLine.substring(col, endCol),
          line: lineNum,
          column: colNum,
        });

        col = endCol;
        continue;
      }

      // 6b. Backticks (`...`) - Not valid in SAP HANA
      if (char === '`') {
        let endCol = col + 1;
        while (endCol < rawLine.length && rawLine[endCol] !== '`') {
          endCol++;
        }
        const hasClosing = endCol < rawLine.length && rawLine[endCol] === '`';
        diagnostics.push({
          line: lineNum,
          column: colNum,
          message: 'Syntax Error: Backticks (`) are not valid in SAP HANA. Use double quotes (") for identifiers.',
          severity: 'error',
          ruleId: 'HANA_INVALID_BACKTICK',
        });
        col = hasClosing ? endCol + 1 : endCol;
        continue;
      }

      // 7. Parameter variable (:PARAM_NAME)
      if (char === ':' && /[A-Za-z_]/.test(nextChar)) {
        let pEnd = col + 1;
        while (pEnd < rawLine.length && /[A-Za-z0-9_]/.test(rawLine[pEnd])) {
          pEnd++;
        }
        const paramName = rawLine.substring(col + 1, pEnd);
        tokens.push({
          type: 'PARAMETER',
          value: paramName,
          raw: rawLine.substring(col, pEnd),
          line: lineNum,
          column: colNum,
        });
        col = pEnd;
        continue;
      }

      // 8. Multi-character Operators (||, <=, >=, !=, <>, ==, ===, &&)
      const threeChars = char + nextChar + (rawLine[col + 2] || '');
      if (threeChars === '===') {
        diagnostics.push({
          line: lineNum,
          column: colNum,
          message: "Syntax Error: '===' is not valid in SQL. Use '=' for equality comparison.",
          severity: 'error',
          ruleId: 'HANA_TRIPLE_EQUALS',
        });
        tokens.push({ type: 'OPERATOR', value: '=', raw: '===', line: lineNum, column: colNum });
        col += 3;
        continue;
      }

      const twoChars = char + nextChar;
      if (['||', '<=', '>=', '!=', '<>'].includes(twoChars)) {
        tokens.push({
          type: 'OPERATOR',
          value: twoChars,
          raw: twoChars,
          line: lineNum,
          column: colNum,
        });
        col += 2;
        continue;
      }

      if (twoChars === '==') {
        diagnostics.push({
          line: lineNum,
          column: colNum,
          message: "Syntax Error: '==' is not a valid SQL comparison operator. Use '=' for equality.",
          severity: 'error',
          ruleId: 'HANA_DOUBLE_EQUALS',
        });
        tokens.push({
          type: 'OPERATOR',
          value: '=',
          raw: '==',
          line: lineNum,
          column: colNum,
        });
        col += 2;
        continue;
      }

      if (twoChars === '&&') {
        diagnostics.push({
          line: lineNum,
          column: colNum,
          message: "Syntax Error: '&&' is not valid in SQL. Use 'AND' for logical conjunction.",
          severity: 'error',
          ruleId: 'HANA_AMPERSAND_AND',
        });
        tokens.push({
          type: 'KEYWORD',
          value: 'AND',
          raw: '&&',
          line: lineNum,
          column: colNum,
        });
        col += 2;
        continue;
      }

      // 9. Single character punctuation and operators
      if (['(', ')', '[', ']', '{', '}', ',', ';', '.'].includes(char)) {
        tokens.push({
          type: 'PUNCTUATION',
          value: char,
          raw: char,
          line: lineNum,
          column: colNum,
        });
        col++;
        continue;
      }

      if (['=', '<', '>', '+', '-', '*', '/', '%'].includes(char)) {
        tokens.push({
          type: 'OPERATOR',
          value: char,
          raw: char,
          line: lineNum,
          column: colNum,
        });
        col++;
        continue;
      }

      // 10. Number literal (123, 123.45, .5)
      if (/[0-9]/.test(char) || (char === '.' && /[0-9]/.test(nextChar))) {
        let numEnd = col;
        let hasDot = char === '.';
        numEnd++;

        while (numEnd < rawLine.length) {
          const nc = rawLine[numEnd];
          if (/[0-9]/.test(nc)) {
            numEnd++;
          } else if (nc === '.' && !hasDot && /[0-9]/.test(rawLine[numEnd + 1] || '')) {
            hasDot = true;
            numEnd++;
          } else if (/[eE]/.test(nc) && /[0-9+-]/.test(rawLine[numEnd + 1] || '')) {
            numEnd += 2;
            while (numEnd < rawLine.length && /[0-9]/.test(rawLine[numEnd])) {
              numEnd++;
            }
            break;
          } else {
            break;
          }
        }

        tokens.push({
          type: 'NUMBER_LITERAL',
          value: rawLine.substring(col, numEnd),
          raw: rawLine.substring(col, numEnd),
          line: lineNum,
          column: colNum,
        });
        col = numEnd;
        continue;
      }

      // 11. Word / Identifier / Keyword ([A-Za-z_][A-Za-z0-9_]*)
      if (/[A-Za-z_]/.test(char)) {
        let wordEnd = col;
        while (wordEnd < rawLine.length && /[A-Za-z0-9_]/.test(rawLine[wordEnd])) {
          wordEnd++;
        }
        const wordVal = rawLine.substring(col, wordEnd);
        const upper = wordVal.toUpperCase();

        if (HANA_KEYWORDS.has(upper)) {
          tokens.push({
            type: 'KEYWORD',
            value: upper,
            raw: wordVal,
            line: lineNum,
            column: colNum,
          });
        } else {
          tokens.push({
            type: 'IDENTIFIER',
            value: wordVal,
            raw: wordVal,
            line: lineNum,
            column: colNum,
          });
        }

        col = wordEnd;
        continue;
      }

      // 12. Invalid / Unexpected Character (e.g. !, @, #, $, ^, &, ~, \, ?, etc.)
      const invalidSequenceStart = col;
      while (
        col < rawLine.length &&
        !/\s/.test(rawLine[col]) &&
        !/[A-Za-z0-9_'"(),;.]/.test(rawLine[col]) &&
        !['-', '/', '*', '+', '=', '<', '>', '%'].includes(rawLine[col])
      ) {
        col++;
      }
      const invalidStr = rawLine.substring(invalidSequenceStart, col || invalidSequenceStart + 1);
      if (invalidStr.length === 0) {
        col++;
      }

      diagnostics.push({
        line: lineNum,
        column: colNum,
        message: `Syntax Error: Unexpected character '${invalidStr}' is not valid in SQL.`,
        severity: 'error',
        ruleId: 'HANA_INVALID_CHARACTER',
        codeSnippet: rawLine.trim(),
      });

      tokens.push({
        type: 'INVALID',
        value: invalidStr,
        raw: invalidStr,
        line: lineNum,
        column: colNum,
      });

      if (col === invalidSequenceStart) {
        col++;
      }
    }
  }

  if (inBlockComment) {
    diagnostics.push({
      line: blockCommentStart.line,
      column: blockCommentStart.col,
      message: 'Unterminated block comment (missing */).',
      severity: 'error',
      ruleId: 'HANA_UNTERMINATED_BLOCK_COMMENT',
    });
  }

  return tokens;
}

/**
 * Main HANA SQL Validator entry point
 */
export function validateHanaSql(sql: string): ValidationResult {
  const diagnostics: SyntaxDiagnostic[] = [];
  const trimmed = sql.trim();

  if (!trimmed) {
    diagnostics.push({
      line: 1,
      column: 1,
      message: 'SQL query content cannot be empty.',
      severity: 'error',
      ruleId: 'HANA_EMPTY_QUERY',
    });
    return {
      isValid: false,
      errorCount: 1,
      warningCount: 0,
      diagnostics,
      extractedTables: { inputs: [], outputs: [] },
      extractedParams: [],
      dialectScore: 0,
    };
  }

  const lines = sql.split('\n');

  // 1. Tokenize & scan lexical stream
  const tokens = tokenizeHanaSql(sql, diagnostics);

  // 2. Bracket, Parentheses, CASE/END, and Quotes balancing
  checkDelimiters(sql, lines, diagnostics);

  // 3. Trailing, leading, and consecutive commas check
  checkCommasAndDots(lines, diagnostics);

  // 4. Detailed SELECT Clause Projection List Validation
  checkSelectProjections(tokens, lines, diagnostics);

  // 5. Grammar & Statement Syntax Validation (parses clauses, expressions, dangling operators, invalid words)
  checkStatementGrammar(tokens, lines, diagnostics);

  // 6. Clause Ordering & Grammar Structure Check
  checkClauseOrder(sql, lines, diagnostics);

  // 7. HANA Specific Syntax validations (UPSERT, MERGE, DDL, SQLScript)
  checkHanaSpecificSyntax(sql, lines, diagnostics);

  // 8. Check Unknown Function Calls & Common Dialect Typos
  checkFunctionsAndIdentifiers(tokens, sql, lines, diagnostics);

  // 9. Extract Table Lineage & Parameters
  const extractedTables = extractTableLineage(sql);
  const extractedParams = extractParameters(sql);

  // Deduplicate diagnostics by line, column, ruleId
  const uniqueDiagnostics: SyntaxDiagnostic[] = [];
  const seenKeys = new Set<string>();

  for (const d of diagnostics) {
    const key = `${d.line}:${d.column}:${d.message}`;
    if (!seenKeys.has(key)) {
      seenKeys.add(key);
      uniqueDiagnostics.push(d);
    }
  }

  // Compute Dialect Health Score
  const errors = uniqueDiagnostics.filter((d) => d.severity === 'error');
  const warnings = uniqueDiagnostics.filter((d) => d.severity === 'warning');

  let score = 100;
  score -= errors.length * 25;
  score -= warnings.length * 8;
  if (score < 10 && errors.length > 0) score = 10;
  if (errors.length === 0 && warnings.length === 0) score = 100;

  return {
    isValid: errors.length === 0,
    errorCount: errors.length,
    warningCount: warnings.length,
    diagnostics: uniqueDiagnostics,
    extractedTables,
    extractedParams,
    dialectScore: Math.max(0, Math.min(100, score)),
  };
}

/**
 * Detailed SELECT Clause Projection List Validation
 * Parses expressions, detects missing commas, invalid aliases, stray tokens, and consecutive columns.
 */
function checkSelectProjections(
  tokens: Token[],
  _lines: string[],
  diagnostics: SyntaxDiagnostic[]
) {
  let i = 0;
  while (i < tokens.length) {
    if (tokens[i].type === 'KEYWORD' && tokens[i].value === 'SELECT') {
      const selectToken = tokens[i];
      i++;

      // Skip DISTINCT or ALL if present
      if (i < tokens.length && tokens[i].type === 'KEYWORD' && ['DISTINCT', 'ALL'].includes(tokens[i].value)) {
        i++;
      }

      const selectItemsTokens: Token[][] = [];
      let currentItem: Token[] = [];
      let parenDepth = 0;
      let fromToken: Token | null = null;

      while (i < tokens.length) {
        const tok = tokens[i];

        if (tok.type === 'PUNCTUATION' && tok.value === '(') {
          parenDepth++;
          currentItem.push(tok);
          i++;
          continue;
        }

        if (tok.type === 'PUNCTUATION' && tok.value === ')') {
          parenDepth = Math.max(0, parenDepth - 1);
          currentItem.push(tok);
          i++;
          continue;
        }

        if (parenDepth === 0) {
          if (
            tok.type === 'KEYWORD' &&
            ['FROM', 'WHERE', 'GROUP', 'HAVING', 'ORDER', 'LIMIT', 'UNION', 'EXCEPT', 'INTERSECT'].includes(tok.value)
          ) {
            if (tok.value === 'FROM') {
              fromToken = tok;
            }
            break;
          }

          if (tok.type === 'PUNCTUATION' && tok.value === ';') {
            break;
          }

          if (tok.type === 'PUNCTUATION' && tok.value === ',') {
            selectItemsTokens.push(currentItem);
            currentItem = [];
            i++;
            continue;
          }
        }

        currentItem.push(tok);
        i++;
      }

      if (currentItem.length > 0) {
        selectItemsTokens.push(currentItem);
      }

      // Check if SELECT is empty
      if (selectItemsTokens.length === 0) {
        diagnostics.push({
          line: selectToken.line,
          column: selectToken.column,
          message: 'Syntax Error: Empty projection list in SELECT. Expected columns or expressions.',
          severity: 'error',
          ruleId: 'HANA_EMPTY_SELECT_PROJECTION',
        });
        continue;
      }

      // Check if FROM is missing
      if (!fromToken) {
        diagnostics.push({
          line: selectToken.line,
          column: selectToken.column,
          message: "Syntax Error: Missing 'FROM' clause. SAP HANA queries require 'FROM <table_or_view>' or 'FROM DUMMY'.",
          severity: 'error',
          ruleId: 'HANA_MISSING_FROM_CLAUSE',
        });
      }

      // Validate each item
      for (const item of selectItemsTokens) {
        if (item.length === 0) {
          diagnostics.push({
            line: selectToken.line,
            column: selectToken.column,
            message: 'Syntax Error: Empty projection expression between commas.',
            severity: 'error',
            ruleId: 'HANA_EMPTY_PROJECTION_ITEM',
          });
          continue;
        }

        validateSingleProjectionItem(item, diagnostics);
      }
    } else {
      i++;
    }
  }
}

function validateSingleProjectionItem(item: Token[], diagnostics: SyntaxDiagnostic[]) {
  // Check if item contains AS at parenDepth 0
  let asIdx = -1;
  let parenDepth = 0;
  for (let k = 0; k < item.length; k++) {
    if (item[k].type === 'PUNCTUATION' && item[k].value === '(') parenDepth++;
    else if (item[k].type === 'PUNCTUATION' && item[k].value === ')') parenDepth = Math.max(0, parenDepth - 1);
    else if (parenDepth === 0 && item[k].type === 'KEYWORD' && item[k].value === 'AS') {
      asIdx = k;
      break;
    }
  }

  if (asIdx !== -1) {
    const beforeAs = item.slice(0, asIdx);
    const afterAs = item.slice(asIdx + 1);

    if (beforeAs.length === 0) {
      diagnostics.push({
        line: item[asIdx].line,
        column: item[asIdx].column,
        message: "Syntax Error: Missing expression before 'AS'.",
        severity: 'error',
        ruleId: 'HANA_MISSING_EXPR_BEFORE_AS',
      });
    }

    if (afterAs.length === 0) {
      diagnostics.push({
        line: item[asIdx].line,
        column: item[asIdx].column,
        message: "Syntax Error: Missing alias identifier after 'AS'.",
        severity: 'error',
        ruleId: 'HANA_MISSING_ALIAS_AFTER_AS',
      });
    } else {
      // Alias must be a single identifier or quoted identifier
      const firstAlias = afterAs[0];
      if (firstAlias.type !== 'IDENTIFIER' && firstAlias.type !== 'QUOTED_IDENTIFIER') {
        diagnostics.push({
          line: firstAlias.line,
          column: firstAlias.column,
          message: `Syntax Error: Invalid alias '${firstAlias.raw}' after 'AS'. Expected an identifier.`,
          severity: 'error',
          ruleId: 'HANA_INVALID_ALIAS_NAME',
        });
      }

      // Any token after the alias is an unexpected token / missing comma
      if (afterAs.length > 1) {
        const extraTok = afterAs[1];
        diagnostics.push({
          line: extraTok.line,
          column: extraTok.column,
          message: `Syntax Error: Unexpected token '${extraTok.raw}' after alias '${firstAlias.raw}'. Missing comma before next expression.`,
          severity: 'error',
          ruleId: 'HANA_UNEXPECTED_TOKEN_AFTER_ALIAS',
        });
      }
    }
    return;
  }

  // If NO 'AS' keyword in item:
  // Check for unexpected tokens / missing commas within the item
  for (let idx = 0; idx < item.length; idx++) {
    const tok = item[idx];
    const nextTok = idx < item.length - 1 ? item[idx + 1] : null;
    const thirdTok = idx < item.length - 2 ? item[idx + 2] : null;

    // If an identifier is followed by another identifier which is followed by a dot (e.g. `dsdsfsdf v."COL"`)
    if (
      (tok.type === 'IDENTIFIER' || tok.type === 'QUOTED_IDENTIFIER') &&
      nextTok &&
      (nextTok.type === 'IDENTIFIER' || nextTok.type === 'QUOTED_IDENTIFIER') &&
      thirdTok &&
      thirdTok.value === '.'
    ) {
      diagnostics.push({
        line: nextTok.line,
        column: nextTok.column,
        message: `Syntax Error: Unexpected expression '${nextTok.raw}'. Missing comma after '${tok.raw}'.`,
        severity: 'error',
        ruleId: 'HANA_MISSING_COMMA_BETWEEN_COLUMNS',
      });
    }

    // If an identifier is followed by a function call (e.g. `dsdsfsdf TO_DATE(...)`)
    if (
      (tok.type === 'IDENTIFIER' || tok.type === 'QUOTED_IDENTIFIER') &&
      nextTok &&
      nextTok.type === 'IDENTIFIER' &&
      thirdTok &&
      thirdTok.value === '('
    ) {
      diagnostics.push({
        line: nextTok.line,
        column: nextTok.column,
        message: `Syntax Error: Unexpected function '${nextTok.raw}'. Missing comma after '${tok.raw}'.`,
        severity: 'error',
        ruleId: 'HANA_MISSING_COMMA_BEFORE_FUNC',
      });
    }

    // If an identifier is followed by a keyword that starts an expression (CASE, CAST, CURRENT_*, NULL)
    if (
      (tok.type === 'IDENTIFIER' || tok.type === 'QUOTED_IDENTIFIER') &&
      nextTok &&
      nextTok.type === 'KEYWORD' &&
      ['CASE', 'CAST', 'CURRENT_TIMESTAMP', 'CURRENT_DATE', 'CURRENT_TIME', 'CURRENT_UTCTIMESTAMP', 'NULL', 'TRUE', 'FALSE'].includes(nextTok.value)
    ) {
      diagnostics.push({
        line: nextTok.line,
        column: nextTok.column,
        message: `Syntax Error: Unexpected '${nextTok.raw}'. Missing comma after '${tok.raw}'.`,
        severity: 'error',
        ruleId: 'HANA_MISSING_COMMA_BEFORE_KEYWORD',
      });
    }

    // Check for random gibberish / invalid identifiers (e.g. `dsdsfsdf`)
  }

  // If item has 3 or more identifiers/literals in a row without operators or dots (e.g. `col1 col2 col3` or `"A" "B" "C"`)
  const topTokens = item.filter((t) => t.type !== 'PUNCTUATION' || (t.value !== '(' && t.value !== ')'));
  if (topTokens.length >= 3) {
    let consecutiveCount = 0;
    for (let m = 0; m < topTokens.length; m++) {
      const t = topTokens[m];
      if (t.type === 'IDENTIFIER' || t.type === 'QUOTED_IDENTIFIER' || t.type === 'NUMBER_LITERAL' || t.type === 'STRING_LITERAL') {
        consecutiveCount++;
        if (consecutiveCount >= 3) {
          diagnostics.push({
            line: t.line,
            column: t.column,
            message: `Syntax Error: Unexpected token '${t.raw}'. Missing comma between projection expressions.`,
            severity: 'error',
            ruleId: 'HANA_CONSECUTIVE_PROJECTION_TOKENS',
          });
          break;
        }
      } else if (t.value !== '.') {
        consecutiveCount = 0;
      }
    }
  }
}

/**
 * Grammar & Syntax Analyzer that verifies statement structure, expressions, dangling operators,
 * clause context, and stray / random tokens anywhere in the query.
 */
function checkStatementGrammar(
  tokens: Token[],
  _lines: string[],
  diagnostics: SyntaxDiagnostic[]
) {
  if (tokens.length === 0) return;

  // 1. Check if query starts with a valid statement keyword (SELECT, WITH, DO, CREATE, etc.)
  const firstToken = tokens[0];
  const validStartKeywords = ['SELECT', 'WITH', 'DO', 'CREATE', 'ALTER', 'DROP', 'INSERT', 'UPDATE', 'UPSERT', 'DELETE', 'MERGE', 'CALL', 'DECLARE'];

  if (firstToken.type !== 'KEYWORD' || !validStartKeywords.includes(firstToken.value)) {
    diagnostics.push({
      line: firstToken.line,
      column: firstToken.column,
      message: `Syntax Error: Unexpected '${firstToken.raw}'. Expected a valid SQL statement starting with SELECT.`,
      severity: 'error',
      ruleId: 'HANA_INVALID_STATEMENT_START',
    });
  }

  // 2. Track Clause State across the token stream
  type ClauseType = 'START' | 'WITH' | 'SELECT' | 'FROM' | 'JOIN' | 'ON' | 'WHERE' | 'GROUP_BY' | 'HAVING' | 'ORDER_BY' | 'LIMIT' | 'OFFSET' | 'AFTER_SEMICOLON';
  let currentClause: ClauseType = 'START';
  let parenDepth = 0;

  // Operator and Expression Syntax Inspection
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    const prev = i > 0 ? tokens[i - 1] : null;
    const next = i < tokens.length - 1 ? tokens[i + 1] : null;

    if (t.type === 'PUNCTUATION') {
      if (t.value === '(') parenDepth++;
      else if (t.value === ')') parenDepth = Math.max(0, parenDepth - 1);
    }

    // Update top-level clause tracking
    if (parenDepth === 0 && t.type === 'KEYWORD') {
      if (t.value === 'WITH') currentClause = 'WITH';
      else if (t.value === 'SELECT') currentClause = 'SELECT';
      else if (t.value === 'FROM') currentClause = 'FROM';
      else if (t.value === 'JOIN' || (prev?.value === 'LEFT' || prev?.value === 'RIGHT' || prev?.value === 'FULL' || prev?.value === 'INNER' || prev?.value === 'CROSS')) currentClause = 'JOIN';
      else if (t.value === 'ON') currentClause = 'ON';
      else if (t.value === 'WHERE') currentClause = 'WHERE';
      else if (t.value === 'GROUP' && next?.value === 'BY') currentClause = 'GROUP_BY';
      else if (t.value === 'HAVING') currentClause = 'HAVING';
      else if (t.value === 'ORDER' && next?.value === 'BY') currentClause = 'ORDER_BY';
      else if (t.value === 'LIMIT') currentClause = 'LIMIT';
      else if (t.value === 'OFFSET') currentClause = 'OFFSET';
    }

    // Misspelled clause keyword checks
    if (t.type === 'KEYWORD') {
      if (t.value === 'GROUP' && (!next || next.value !== 'BY')) {
        diagnostics.push({
          line: t.line,
          column: t.column,
          message: "Syntax Error: Expected 'BY' after 'GROUP'.",
          severity: 'error',
          ruleId: 'HANA_MISSING_BY_AFTER_GROUP',
        });
      }

      if (t.value === 'ORDER' && (!next || next.value !== 'BY')) {
        diagnostics.push({
          line: t.line,
          column: t.column,
          message: "Syntax Error: Expected 'BY' after 'ORDER'.",
          severity: 'error',
          ruleId: 'HANA_MISSING_BY_AFTER_ORDER',
        });
      }

      if (['LEFT', 'RIGHT', 'FULL', 'INNER', 'CROSS'].includes(t.value)) {
        if (!next || (next.value !== 'JOIN' && next.value !== 'OUTER')) {
          diagnostics.push({
            line: t.line,
            column: t.column,
            message: `Syntax Error: Expected 'JOIN' after '${t.value}'.`,
            severity: 'error',
            ruleId: 'HANA_MISSING_JOIN_KEYWORD',
          });
        }
      }

      if (t.value === 'IN' && parenDepth === 0) {
        if (!next || next.value !== '(') {
          diagnostics.push({
            line: t.line,
            column: t.column,
            message: "Syntax Error: Expected '(' after 'IN' predicate.",
            severity: 'error',
            ruleId: 'HANA_IN_MISSING_PAREN',
          });
        }
      }

      if (t.value === 'IS') {
        if (!next || !['NULL', 'NOT', 'TRUE', 'FALSE'].includes(next.value)) {
          diagnostics.push({
            line: t.line,
            column: t.column,
            message: "Syntax Error: Incomplete 'IS' expression. Expected 'NULL', 'NOT NULL', 'TRUE', or 'FALSE'.",
            severity: 'error',
            ruleId: 'HANA_INCOMPLETE_IS',
          });
        }
      }

      if (t.value === 'LIKE') {
        if (!next || (next.type !== 'STRING_LITERAL' && next.type !== 'PARAMETER' && next.type !== 'IDENTIFIER' && next.value !== '(')) {
          diagnostics.push({
            line: t.line,
            column: t.column,
            message: "Syntax Error: 'LIKE' predicate missing pattern operand.",
            severity: 'error',
            ruleId: 'HANA_LIKE_MISSING_PATTERN',
          });
        }
      }
    }

    // Check for dangling binary operators (=, +, -, *, /, %, <, >, <=, >=, !=, <>, AND, OR, LIKE)
    const binaryOps = ['=', '<', '>', '<=', '>=', '!=', '<>', '||', '+', '-', '*', '/', '%'];
    if (t.type === 'OPERATOR' && binaryOps.includes(t.value)) {
      // Must have a valid operand before (unless unary + / - or * in COUNT(*) or SELECT *)
      const isWildcardAsterisk = t.value === '*' && (
        (prev?.value === 'SELECT' || (prev?.type === 'PUNCTUATION' && prev.value === ',')) ||
        (prev?.type === 'PUNCTUATION' && prev.value === '(') ||
        (prev?.type === 'PUNCTUATION' && prev.value === '.')
      );

      if (!isWildcardAsterisk) {
        if (!prev || (prev.type === 'PUNCTUATION' && ['(', ','].includes(prev.value)) || prev.type === 'OPERATOR' || (prev.type === 'KEYWORD' && ['WHERE', 'ON', 'HAVING', 'AND', 'OR', 'SELECT'].includes(prev.value))) {
          if (!['+', '-'].includes(t.value)) {
            diagnostics.push({
              line: t.line,
              column: t.column,
              message: `Syntax Error: Unexpected operator '${t.raw}' without preceding operand or expression.`,
              severity: 'error',
              ruleId: 'HANA_DANGLING_OPERATOR_PREFIX',
            });
          }
        }
      }

      // Must have a valid operand after
      const isAsteriskBeforeFrom = t.value === '*' && next?.value === 'FROM';
      if (!isAsteriskBeforeFrom) {
        if (!next || (next.type === 'PUNCTUATION' && [')', ',', ';'].includes(next.value)) || (next.type === 'KEYWORD' && ['FROM', 'WHERE', 'GROUP', 'HAVING', 'ORDER', 'LIMIT', 'UNION', 'AND', 'OR'].includes(next.value))) {
          diagnostics.push({
            line: t.line,
            column: t.column,
            message: `Syntax Error: Incomplete expression. Operator '${t.raw}' is missing a right-hand operand.`,
            severity: 'error',
            ruleId: 'HANA_DANGLING_OPERATOR_SUFFIX',
          });
        }
      }
    }

    // Check for logical operators AND / OR without operands
    if (t.type === 'KEYWORD' && (t.value === 'AND' || t.value === 'OR')) {
      if (!prev || (prev.type === 'KEYWORD' && ['WHERE', 'HAVING', 'ON', 'AND', 'OR'].includes(prev.value)) || (prev.type === 'PUNCTUATION' && prev.value === '(')) {
        diagnostics.push({
          line: t.line,
          column: t.column,
          message: `Syntax Error: Misplaced logical operator '${t.value}'.`,
          severity: 'error',
          ruleId: 'HANA_MISPLACED_LOGICAL_OP',
        });
      }

      if (!next || (next.type === 'KEYWORD' && ['AND', 'OR', 'GROUP', 'ORDER', 'HAVING', 'LIMIT', 'FROM'].includes(next.value)) || (next.type === 'PUNCTUATION' && [')', ';'].includes(next.value))) {
        diagnostics.push({
          line: t.line,
          column: t.column,
          message: `Syntax Error: Dangling '${t.value}' operator. Missing subsequent search condition.`,
          severity: 'error',
          ruleId: 'HANA_DANGLING_LOGICAL_OP',
        });
      }
    }

    // Check for consecutive keywords that make no grammatical sense
    if (t.type === 'KEYWORD') {
      if (t.value === 'SELECT' && next && next.type === 'KEYWORD' && ['FROM', 'WHERE', 'GROUP', 'ORDER'].includes(next.value)) {
        diagnostics.push({
          line: t.line,
          column: t.column,
          message: `Syntax Error: Empty projection list in SELECT. Expected columns or expressions before '${next.value}'.`,
          severity: 'error',
          ruleId: 'HANA_EMPTY_SELECT_PROJECTION',
        });
      }

      if (t.value === 'FROM' && (!next || (next.type === 'KEYWORD' && ['WHERE', 'GROUP', 'ORDER', 'HAVING', 'LIMIT', 'UNION'].includes(next.value)) || next.value === ';')) {
        diagnostics.push({
          line: t.line,
          column: t.column,
          message: "Syntax Error: Missing table name or subquery after 'FROM'.",
          severity: 'error',
          ruleId: 'HANA_MISSING_FROM_TABLE',
        });
      }

      if (t.value === 'WHERE' && (!next || (next.type === 'KEYWORD' && ['GROUP', 'ORDER', 'HAVING', 'LIMIT', 'UNION'].includes(next.value)) || next.value === ';')) {
        diagnostics.push({
          line: t.line,
          column: t.column,
          message: "Syntax Error: Missing filter predicate in 'WHERE' clause.",
          severity: 'error',
          ruleId: 'HANA_EMPTY_WHERE_CLAUSE',
        });
      }

      if (t.value === 'HAVING' && (!next || (next.type === 'KEYWORD' && ['ORDER', 'LIMIT', 'UNION'].includes(next.value)) || next.value === ';')) {
        diagnostics.push({
          line: t.line,
          column: t.column,
          message: "Syntax Error: Missing condition in 'HAVING' clause.",
          severity: 'error',
          ruleId: 'HANA_EMPTY_HAVING_CLAUSE',
        });
      }

      if (t.value === 'JOIN') {
        if (!next || (next.type === 'KEYWORD' && next.value === 'ON') || (next.type === 'KEYWORD' && ['WHERE', 'GROUP', 'ORDER'].includes(next.value))) {
          diagnostics.push({
            line: t.line,
            column: t.column,
            message: "Syntax Error: Missing table name after 'JOIN'.",
            severity: 'error',
            ruleId: 'HANA_JOIN_MISSING_TABLE',
          });
        }
      }

      if (t.value === 'ON') {
        if (!next || (next.type === 'KEYWORD' && ['JOIN', 'LEFT', 'RIGHT', 'INNER', 'WHERE', 'GROUP', 'ORDER'].includes(next.value)) || next.value === ';') {
          diagnostics.push({
            line: t.line,
            column: t.column,
            message: "Syntax Error: Missing join predicate after 'ON'.",
            severity: 'error',
            ruleId: 'HANA_ON_MISSING_PREDICATE',
          });
        }
      }
    }

    // Check for random tokens after terminating semicolon
    if (t.type === 'PUNCTUATION' && t.value === ';') {
      currentClause = 'AFTER_SEMICOLON';
      if (next && !(next.type === 'KEYWORD' && ['SELECT', 'WITH', 'DO', 'CREATE', 'INSERT', 'UPDATE', 'DELETE'].includes(next.value))) {
        diagnostics.push({
          line: next.line,
          column: next.column,
          message: `Syntax Error: Unexpected content '${next.raw}' after terminating semicolon.`,
          severity: 'error',
          ruleId: 'HANA_UNEXPECTED_AFTER_SEMICOLON',
        });
      }
    }

    // Specific Clause Token Validation: Detect stray identifiers and random words
    if (t.type === 'IDENTIFIER') {
      const isRecognizedTypeOrFunc = HANA_DATA_TYPES.has(t.value.toUpperCase()) || HANA_BUILTIN_FUNCTIONS.has(t.value.toUpperCase());

      // In WHERE, HAVING, ON: An identifier must be part of an expression
      if ((currentClause === 'WHERE' || currentClause === 'HAVING' || currentClause === 'ON') && parenDepth === 0) {
        const isFollowedByComparison = next && (
          next.type === 'OPERATOR' ||
          (next.type === 'KEYWORD' && ['IS', 'IN', 'BETWEEN', 'LIKE', 'ILIKE', 'NOT', 'AND', 'OR', 'ASC', 'DESC'].includes(next.value)) ||
          (next.type === 'PUNCTUATION' && [')', ',', ';', '.'].includes(next.value))
        );
        const isPrecededByOperatorOrKeyword = prev && (
          prev.type === 'OPERATOR' ||
          (prev.type === 'KEYWORD' && ['WHERE', 'HAVING', 'ON', 'AND', 'OR', 'NOT', 'BETWEEN', 'IN', 'LIKE', 'ILIKE', 'IS', 'CASE', 'WHEN', 'THEN', 'ELSE'].includes(prev.value)) ||
          (prev.type === 'PUNCTUATION' && ['(', ',', '.'].includes(prev.value))
        );

        if (!isFollowedByComparison && !isPrecededByOperatorOrKeyword && !isRecognizedTypeOrFunc) {
          diagnostics.push({
            line: t.line,
            column: t.column,
            message: `Syntax Error: Unexpected token '${t.raw}' in ${currentClause} clause. Missing comparison operator (=, >, <, etc.) or logical operator (AND, OR).`,
            severity: 'error',
            ruleId: 'HANA_UNEXPECTED_IDENTIFIER_IN_PREDICATE',
          });
        }

        // Catch stray identifier after AND/OR without comparison (e.g. `WHERE x = 1 AND y` without `= 2`)
        if (prev && prev.type === 'KEYWORD' && (prev.value === 'AND' || prev.value === 'OR')) {
          if (!isFollowedByComparison && !isRecognizedTypeOrFunc) {
            diagnostics.push({
              line: t.line,
              column: t.column,
              message: `Syntax Error: Incomplete predicate '${t.raw}' after '${prev.value}'. Missing comparison operator (=, >, <, IN, IS, LIKE, etc.).`,
              severity: 'error',
              ruleId: 'HANA_INCOMPLETE_PREDICATE_AFTER_LOGICAL',
            });
          }
        }
      }

      // In GROUP BY: Items cannot have aliases, only comma-separated expressions
      if (currentClause === 'GROUP_BY' && parenDepth === 0) {
        if (prev && (prev.type === 'IDENTIFIER' || prev.type === 'QUOTED_IDENTIFIER' || prev.type === 'NUMBER_LITERAL')) {
          diagnostics.push({
            line: t.line,
            column: t.column,
            message: `Syntax Error: Unexpected token '${t.raw}' in GROUP BY. GROUP BY expressions must be separated by commas; aliases are not allowed.`,
            severity: 'error',
            ruleId: 'HANA_UNEXPECTED_GROUP_BY_ALIAS',
          });
        }
      }

      // In ORDER BY: Check for stray words after ASC / DESC
      if (currentClause === 'ORDER_BY' && parenDepth === 0) {
        if (prev && prev.type === 'KEYWORD' && (prev.value === 'ASC' || prev.value === 'DESC')) {
          if (!['NULLS', 'LIMIT', 'OFFSET'].includes(t.value.toUpperCase()) && next?.value !== 'BY') {
            diagnostics.push({
              line: t.line,
              column: t.column,
              message: `Syntax Error: Unexpected token '${t.raw}' in ORDER BY clause. Expected comma or next clause.`,
              severity: 'error',
              ruleId: 'HANA_UNEXPECTED_ORDER_BY_TOKEN',
            });
          }
        }
      }

      // In LIMIT: Must be number or parameter, not arbitrary identifier
      if (currentClause === 'LIMIT' && parenDepth === 0) {
        if (prev?.value === 'LIMIT' && t.type === 'IDENTIFIER' && !t.raw.startsWith(':')) {
          diagnostics.push({
            line: t.line,
            column: t.column,
            message: `Syntax Error: Invalid LIMIT value '${t.raw}'. LIMIT requires an integer constant or parameter variable.`,
            severity: 'error',
            ruleId: 'HANA_INVALID_LIMIT_VALUE',
          });
        }
      }
    }

    // Check for two consecutive identifiers / literals that are not connected by AS, comma, or dot
    if (
      (t.type === 'IDENTIFIER' || t.type === 'QUOTED_IDENTIFIER' || t.type === 'NUMBER_LITERAL' || t.type === 'STRING_LITERAL') &&
      next &&
      (next.type === 'IDENTIFIER' || next.type === 'QUOTED_IDENTIFIER' || next.type === 'NUMBER_LITERAL' || next.type === 'STRING_LITERAL')
    ) {
      // In SELECT projection, `col alias` is allowed once, but a third identifier or an identifier followed by another identifier without comma is invalid
      const third = i < tokens.length - 2 ? tokens[i + 2] : null;
      if (third && (third.type === 'IDENTIFIER' || third.type === 'QUOTED_IDENTIFIER' || third.type === 'NUMBER_LITERAL' || third.type === 'STRING_LITERAL')) {
        diagnostics.push({
          line: third.line,
          column: third.column,
          message: `Syntax Error: Unexpected token '${third.raw}'. Missing comma, operator, or keyword between expressions.`,
          severity: 'error',
          ruleId: 'HANA_CONSECUTIVE_IDENTIFIERS',
        });
      }

      // In FROM clause: `FROM tbl1 alias1 tbl2` -> third identifier `tbl2` is an error
      if (currentClause === 'FROM' && parenDepth === 0) {
        if (next.type === 'IDENTIFIER' && prev && (prev.type === 'IDENTIFIER' || prev.type === 'QUOTED_IDENTIFIER')) {
          diagnostics.push({
            line: next.line,
            column: next.column,
            message: `Syntax Error: Unexpected table identifier '${next.raw}' in FROM clause. Expected 'JOIN' or comma.`,
            severity: 'error',
            ruleId: 'HANA_FROM_MISSING_JOIN_OR_COMMA',
          });
        }
      }

      // If next is a number/string following an identifier without operator (e.g. `col 123` or `col 'abc'`)
      if (next.type === 'NUMBER_LITERAL' || next.type === 'STRING_LITERAL') {
        diagnostics.push({
          line: next.line,
          column: next.column,
          message: `Syntax Error: Unexpected literal '${next.raw}' after identifier '${t.raw}'. Missing operator or comma.`,
          severity: 'error',
          ruleId: 'HANA_LITERAL_AFTER_IDENTIFIER',
        });
      }
    }
  }
}

function checkDelimiters(
  _sql: string,
  lines: string[],
  diagnostics: SyntaxDiagnostic[]
) {
  const parenStack: { line: number; col: number; char: string }[] = [];
  let inSingleQuote = false;
  let singleQuoteStart = { line: 1, col: 1 };
  let inDoubleQuote = false;
  let doubleQuoteStart = { line: 1, col: 1 };
  let inBlockComment = false;
  let blockCommentStart = { line: 1, col: 1 };

  // Case / End tracking stack
  let caseStack: { line: number; col: number }[] = [];

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx];
    const lineNum = lineIdx + 1;

    for (let colIdx = 0; colIdx < line.length; colIdx++) {
      const char = line[colIdx];
      const nextChar = line[colIdx + 1] || '';
      const colNum = colIdx + 1;

      // Handle block comment
      if (inBlockComment) {
        if (char === '*' && nextChar === '/') {
          inBlockComment = false;
          colIdx++;
        }
        continue;
      }

      // Handle single quote string literal
      if (inSingleQuote) {
        if (char === "'") {
          if (nextChar === "'") {
            colIdx++;
          } else {
            inSingleQuote = false;
          }
        }
        continue;
      }

      // Handle double quote identifier literal
      if (inDoubleQuote) {
        if (char === '"') {
          if (nextChar === '"') {
            colIdx++;
          } else {
            inDoubleQuote = false;
          }
        }
        continue;
      }

      // Check comments start
      if (char === '-' && nextChar === '-') {
        break;
      }
      if (char === '/' && nextChar === '/') {
        break;
      }
      if (char === '/' && nextChar === '*') {
        inBlockComment = true;
        blockCommentStart = { line: lineNum, col: colNum };
        colIdx++;
        continue;
      }

      // Check quotes start
      if (char === "'") {
        inSingleQuote = true;
        singleQuoteStart = { line: lineNum, col: colNum };
        continue;
      }
      if (char === '"') {
        inDoubleQuote = true;
        doubleQuoteStart = { line: lineNum, col: colNum };
        continue;
      }

      // Parentheses & Brackets
      if (char === '(' || char === '[' || char === '{') {
        parenStack.push({ line: lineNum, col: colNum, char });
      } else if (char === ')' || char === ']' || char === '}') {
        if (parenStack.length === 0) {
          diagnostics.push({
            line: lineNum,
            column: colNum,
            message: `Syntax Error: Unmatched closing delimiter '${char}' without corresponding opening delimiter.`,
            severity: 'error',
            ruleId: 'HANA_UNMATCHED_CLOSE_BRACKET',
          });
        } else {
          const top = parenStack.pop()!;
          const matchMap: Record<string, string> = { ')': '(', ']': '[', '}': '{' };
          if (matchMap[char] !== top.char) {
            diagnostics.push({
              line: lineNum,
              column: colNum,
              message: `Syntax Error: Mismatched closing delimiter '${char}' for '${top.char}' opened at line ${top.line}, col ${top.col}.`,
              severity: 'error',
              ruleId: 'HANA_MISMATCHED_BRACKETS',
            });
          }
        }
      }
    }

    // Word scan for CASE / END balancing on this line (excluding comments and strings)
    const cleanLine = line.replace(/--.*$/, '').replace(/\/\/.*$/, '').replace(/'[^']*'/g, '').replace(/"[^"]*"/g, '');
    const words = cleanLine.match(/\b(?:CASE|END)\b/gi) || [];
    for (const w of words) {
      if (w.toUpperCase() === 'CASE') {
        caseStack.push({ line: lineNum, col: line.toUpperCase().indexOf('CASE') + 1 });
      } else if (w.toUpperCase() === 'END') {
        if (caseStack.length > 0) {
          caseStack.pop();
        }
      }
    }
  }

  if (inSingleQuote) {
    diagnostics.push({
      line: singleQuoteStart.line,
      column: singleQuoteStart.col,
      message: "Syntax Error: Unterminated string literal (missing closing single quote ').",
      severity: 'error',
      ruleId: 'HANA_UNTERMINATED_STRING',
    });
  }

  if (inDoubleQuote) {
    diagnostics.push({
      line: doubleQuoteStart.line,
      column: doubleQuoteStart.col,
      message: 'Syntax Error: Unterminated identifier literal (missing closing double quote ").',
      severity: 'error',
      ruleId: 'HANA_UNTERMINATED_IDENTIFIER',
    });
  }

  if (inBlockComment) {
    diagnostics.push({
      line: blockCommentStart.line,
      column: blockCommentStart.col,
      message: 'Syntax Error: Unterminated block comment (missing */).',
      severity: 'error',
      ruleId: 'HANA_UNTERMINATED_BLOCK_COMMENT',
    });
  }

  while (parenStack.length > 0) {
    const unclosed = parenStack.pop()!;
    diagnostics.push({
      line: unclosed.line,
      column: unclosed.col,
      message: `Syntax Error: Unclosed delimiter '${unclosed.char}'. Missing matching '${unclosed.char === '(' ? ')' : unclosed.char === '[' ? ']' : '}'}'.`,
      severity: 'error',
      ruleId: 'HANA_UNCLOSED_BRACKET',
    });
  }

  while (caseStack.length > 0) {
    const unclosedCase = caseStack.pop()!;
    diagnostics.push({
      line: unclosedCase.line,
      column: unclosedCase.col,
      message: "Syntax Error: Unclosed 'CASE' expression (missing terminating 'END').",
      severity: 'error',
      ruleId: 'HANA_UNCLOSED_CASE',
    });
  }
}

function checkCommasAndDots(lines: string[], diagnostics: SyntaxDiagnostic[]) {
  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const cleanLine = rawLine.replace(/--.*$/, '').replace(/\/\/.*$/, '').trim();
    if (!cleanLine) continue;

    // 1. Consecutive commas (,,)
    if (/,,/.test(cleanLine)) {
      diagnostics.push({
        line: i + 1,
        column: rawLine.indexOf(',,') + 1,
        message: 'Syntax Error: Unexpected duplicate comma (,,).',
        severity: 'error',
        ruleId: 'HANA_CONSECUTIVE_COMMAS',
      });
    }

    // 2. Leading comma in clause
    if (/^\s*,\s*/.test(cleanLine)) {
      diagnostics.push({
        line: i + 1,
        column: rawLine.indexOf(',') + 1,
        message: 'Syntax Error: Unexpected leading comma at the start of expression.',
        severity: 'error',
        ruleId: 'HANA_LEADING_COMMA',
      });
    }

    // 3. Double dot (..)
    if (/\.\./.test(cleanLine)) {
      diagnostics.push({
        line: i + 1,
        column: rawLine.indexOf('..') + 1,
        message: "Syntax Error: Invalid double dot '..' notation.",
        severity: 'error',
        ruleId: 'HANA_DOUBLE_DOT',
      });
    }

    // 4. Trailing dot without identifier
    if (/\.\s*$/.test(cleanLine)) {
      diagnostics.push({
        line: i + 1,
        column: rawLine.lastIndexOf('.') + 1,
        message: "Syntax Error: Incomplete dot notation. Expected column or identifier after '.'.",
        severity: 'error',
        ruleId: 'HANA_TRAILING_DOT',
      });
    }

    // 5. Trailing comma before clause keywords or closing paren
    if (cleanLine.endsWith(',')) {
      for (let j = i + 1; j < lines.length; j++) {
        const nextClean = lines[j].replace(/--.*$/, '').replace(/\/\/.*$/, '').trim();
        if (!nextClean) continue;
        const firstWord = nextClean.split(/\s+/)[0].toUpperCase();
        if (
          ['FROM', 'WHERE', 'GROUP', 'HAVING', 'ORDER', 'LIMIT', 'UNION'].includes(firstWord) ||
          nextClean.startsWith(')')
        ) {
          diagnostics.push({
            line: i + 1,
            column: rawLine.lastIndexOf(',') + 1,
            message: `Syntax Error: Trailing comma before '${firstWord || ')'}'.`,
            severity: 'error',
            ruleId: 'HANA_TRAILING_COMMA',
          });
        }
        break;
      }
    }
  }
}

function checkClauseOrder(
  sql: string,
  lines: string[],
  diagnostics: SyntaxDiagnostic[]
) {
  const normalized = sql.replace(/\/\*[\s\S]*?\*\/|--.*$/gm, ' ');
  const tokens = normalized.match(/[A-Za-z_][A-Za-z0-9_]*|"[^"]*"|'[^']*'|[,;()]/g) || [];
  const upperTokens = tokens.map((t) => t.toUpperCase());

  const selectIdx = upperTokens.indexOf('SELECT');
  if (selectIdx !== -1) {
    const fromIdx = findTopLevelKeyword(upperTokens, 'FROM', selectIdx);
    const whereIdx = findTopLevelKeyword(upperTokens, 'WHERE', selectIdx);
    const groupIdx = findTopLevelKeywordSequence(upperTokens, ['GROUP', 'BY'], selectIdx);
    const havingIdx = findTopLevelKeyword(upperTokens, 'HAVING', selectIdx);
    const orderIdx = findTopLevelKeywordSequence(upperTokens, ['ORDER', 'BY'], selectIdx);
    const limitIdx = findTopLevelKeyword(upperTokens, 'LIMIT', selectIdx);

    // WHERE before FROM
    if (whereIdx !== -1 && fromIdx !== -1 && whereIdx < fromIdx) {
      const line = findLineForToken(lines, 'WHERE');
      diagnostics.push({
        line,
        column: 1,
        message: "Invalid clause order: 'WHERE' cannot appear before 'FROM'.",
        severity: 'error',
        ruleId: 'HANA_CLAUSE_ORDER_WHERE_FROM',
      });
    }

    // WHERE after GROUP BY
    if (whereIdx !== -1 && groupIdx !== -1 && whereIdx > groupIdx) {
      const line = findLineForToken(lines, 'WHERE');
      diagnostics.push({
        line,
        column: 1,
        message: "Invalid clause order: 'WHERE' must appear before 'GROUP BY'. Use 'HAVING' for post-aggregation filters.",
        severity: 'error',
        ruleId: 'HANA_CLAUSE_ORDER_WHERE_GROUP',
      });
    }

    // HAVING without GROUP BY
    if (havingIdx !== -1 && groupIdx === -1) {
      const line = findLineForToken(lines, 'HAVING');
      diagnostics.push({
        line,
        column: 1,
        message: "'HAVING' clause specified without a 'GROUP BY' clause.",
        severity: 'warning',
        ruleId: 'HANA_HAVING_WITHOUT_GROUP_BY',
      });
    }

    // GROUP BY after ORDER BY
    if (groupIdx !== -1 && orderIdx !== -1 && groupIdx > orderIdx) {
      const line = findLineForToken(lines, 'GROUP');
      diagnostics.push({
        line,
        column: 1,
        message: "Invalid clause order: 'GROUP BY' must appear before 'ORDER BY'.",
        severity: 'error',
        ruleId: 'HANA_CLAUSE_ORDER_GROUP_ORDER',
      });
    }

    // LIMIT before ORDER BY
    if (limitIdx !== -1 && orderIdx !== -1 && limitIdx < orderIdx) {
      const line = findLineForToken(lines, 'LIMIT');
      diagnostics.push({
        line,
        column: 1,
        message: "Invalid clause order: 'LIMIT' must appear after 'ORDER BY'.",
        severity: 'error',
        ruleId: 'HANA_CLAUSE_ORDER_LIMIT_ORDER',
      });
    }
  }
}

function findTopLevelKeyword(tokens: string[], keyword: string, startIndex: number): number {
  let parenDepth = 0;
  for (let i = startIndex; i < tokens.length; i++) {
    const t = tokens[i];
    if (t === '(') parenDepth++;
    else if (t === ')') parenDepth = Math.max(0, parenDepth - 1);
    else if (parenDepth === 0 && t === keyword) {
      return i;
    }
  }
  return -1;
}

function findTopLevelKeywordSequence(tokens: string[], sequence: string[], startIndex: number): number {
  let parenDepth = 0;
  for (let i = startIndex; i < tokens.length - sequence.length + 1; i++) {
    const t = tokens[i];
    if (t === '(') parenDepth++;
    else if (t === ')') parenDepth = Math.max(0, parenDepth - 1);
    else if (parenDepth === 0) {
      let match = true;
      for (let s = 0; s < sequence.length; s++) {
        if (tokens[i + s] !== sequence[s]) {
          match = false;
          break;
        }
      }
      if (match) return i;
    }
  }
  return -1;
}

function checkHanaSpecificSyntax(
  sql: string,
  lines: string[],
  diagnostics: SyntaxDiagnostic[]
) {
  const upperSql = sql.toUpperCase();

  // 1. UPSERT Syntax Validation
  if (upperSql.includes('UPSERT')) {
    if (!upperSql.includes('INTO')) {
      diagnostics.push({
        line: findLineForToken(lines, 'UPSERT'),
        column: 1,
        message: "SAP HANA UPSERT requires 'INTO': Expected 'UPSERT INTO <target_table>'.",
        severity: 'error',
        ruleId: 'HANA_UPSERT_MISSING_INTO',
      });
    }
  }

  // 2. MERGE INTO Validation
  if (upperSql.includes('MERGE') && upperSql.includes('INTO')) {
    if (!upperSql.includes('USING')) {
      diagnostics.push({
        line: findLineForToken(lines, 'MERGE'),
        column: 1,
        message: "SAP HANA MERGE statement missing 'USING' source table or subquery clause.",
        severity: 'error',
        ruleId: 'HANA_MERGE_MISSING_USING',
      });
    }
    if (!upperSql.includes(' ON ') && !upperSql.includes(' ON(')) {
      diagnostics.push({
        line: findLineForToken(lines, 'MERGE'),
        column: 1,
        message: "SAP HANA MERGE statement missing 'ON' join predicate clause.",
        severity: 'error',
        ruleId: 'HANA_MERGE_MISSING_ON',
      });
    }
  }

  // 3. SQLScript DO BEGIN ... END; Validation
  if (upperSql.includes('DO BEGIN') || upperSql.includes('DO\nBEGIN')) {
    if (!upperSql.includes('END;') && !upperSql.includes('END ;') && !upperSql.endsWith('END')) {
      diagnostics.push({
        line: findLineForToken(lines, 'DO'),
        column: 1,
        message: "SAP HANA Anonymous SQLScript block 'DO BEGIN' is missing terminating 'END;'.",
        severity: 'error',
        ruleId: 'HANA_SQLSCRIPT_MISSING_END',
      });
    }
  }
}

function checkFunctionsAndIdentifiers(
  _tokens: Token[],
  sql: string,
  lines: string[],
  diagnostics: SyntaxDiagnostic[]
) {
  // Check for common typo functions like ISNULL (SQL Server) instead of IFNULL (HANA)
  const isnullMatch = sql.match(/\bISNULL\s*\(/i);
  if (isnullMatch) {
    diagnostics.push({
      line: findLineForToken(lines, 'ISNULL'),
      column: 1,
      message: "SAP HANA uses 'IFNULL(val, default)' or 'COALESCE(val, default)' instead of 'ISNULL'.",
      severity: 'error',
      ruleId: 'HANA_USE_IFNULL',
    });
  }

  // Check for NVL (Oracle) instead of IFNULL / COALESCE
  const nvlMatch = sql.match(/\bNVL\s*\(/i);
  if (nvlMatch) {
    diagnostics.push({
      line: findLineForToken(lines, 'NVL'),
      column: 1,
      message: "SAP HANA standard syntax is 'IFNULL(val, default)' or 'COALESCE(val, default)' rather than 'NVL'.",
      severity: 'warning',
      ruleId: 'HANA_USE_IFNULL_FOR_NVL',
    });
  }

  // Check for GETDATE() instead of CURRENT_TIMESTAMP / CURRENT_UTCTIMESTAMP
  const getdateMatch = sql.match(/\bGETDATE\s*\(\s*\)/i);
  if (getdateMatch) {
    diagnostics.push({
      line: findLineForToken(lines, 'GETDATE'),
      column: 1,
      message: "SAP HANA uses 'CURRENT_TIMESTAMP' or 'CURRENT_UTCTIMESTAMP' instead of 'GETDATE()'.",
      severity: 'warning',
      ruleId: 'HANA_USE_CURRENT_TIMESTAMP',
    });
  }
}

export function extractTableLineage(sql: string): { inputs: string[]; outputs: string[] } {
  const inputs = new Set<string>();
  const outputs = new Set<string>();

  const fromRegex = /\b(?:FROM|JOIN)\s+([A-Za-z0-9_".]+)/gi;
  let match: RegExpExecArray | null;
  while ((match = fromRegex.exec(sql)) !== null) {
    const table = match[1].trim();
    if (!['(', 'SELECT', 'LATERAL', 'UNNEST'].includes(table.toUpperCase())) {
      inputs.add(cleanTableName(table));
    }
  }

  const targetRegex = /\b(?:INTO|UPDATE|CREATE\s+(?:COLUMN\s+|ROW\s+|GLOBAL\s+TEMPORARY\s+)?TABLE|CREATE\s+VIEW|MERGE\s+INTO|UPSERT\s+INTO)\s+([A-Za-z0-9_".]+)/gi;
  while ((match = targetRegex.exec(sql)) !== null) {
    const table = match[1].trim();
    if (!['(', 'SELECT'].includes(table.toUpperCase())) {
      outputs.add(cleanTableName(table));
    }
  }

  return {
    inputs: Array.from(inputs),
    outputs: Array.from(outputs),
  };
}

export function extractParameters(sql: string): QueryParameter[] {
  const paramMap = new Map<string, QueryParameter>();
  const paramRegex = /:([A-Za-z_][A-Za-z0-9_]*)/g;
  let match: RegExpExecArray | null;

  while ((match = paramRegex.exec(sql)) !== null) {
    const paramName = match[1];
    if (!paramMap.has(paramName)) {
      let inferredType = 'NVARCHAR(100)';
      let defaultVal = "''";
      const upperName = paramName.toUpperCase();

      if (upperName.includes('DATE') || upperName.includes('PERIOD') || upperName.includes('FISCPER')) {
        inferredType = 'DATE';
        defaultVal = "'2026-09-01'";
      } else if (upperName.includes('ID') || upperName.includes('NUM') || upperName.includes('COUNT') || upperName.includes('LIMIT')) {
        inferredType = 'INTEGER';
        defaultVal = '1000';
      } else if (upperName.includes('AMOUNT') || upperName.includes('PRICE') || upperName.includes('RATE')) {
        inferredType = 'DECIMAL(15,2)';
        defaultVal = '0.00';
      } else if (upperName.includes('FLAG') || upperName.includes('ACTIVE') || upperName.includes('IS_')) {
        inferredType = 'BOOLEAN';
        defaultVal = 'TRUE';
      }

      paramMap.set(paramName, {
        name: paramName,
        type: inferredType,
        defaultValue: defaultVal,
        description: `SAP HANA dynamic parameter variable :${paramName}`,
      });
    }
  }

  return Array.from(paramMap.values());
}

function cleanTableName(name: string): string {
  return name.replace(/[;,\(\)]/g, '').trim();
}

function findLineForToken(lines: string[], token: string): number {
  const upperToken = token.toUpperCase();
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].toUpperCase().includes(upperToken)) {
      return i + 1;
    }
  }
  return 1;
}

interface FormatToken {
  type: 'KEYWORD' | 'FUNCTION' | 'IDENTIFIER' | 'STRING' | 'QUOTED_ID' | 'NUMBER' | 'SYMBOL' | 'COMMENT_LINE' | 'COMMENT_BLOCK' | 'NEWLINE';
  value: string;
  upper: string;
}

function tokenizeForFormatting(sql: string): FormatToken[] {
  const tokens: FormatToken[] = [];
  let pos = 0;
  const len = sql.length;

  while (pos < len) {
    const char = sql[pos];
    const nextChar = pos + 1 < len ? sql[pos + 1] : '';

    if (char === '\n') {
      tokens.push({ type: 'NEWLINE', value: '\n', upper: '\n' });
      pos++;
      continue;
    }
    if (/\s/.test(char)) {
      pos++;
      continue;
    }

    // Single line comments (-- or //)
    if ((char === '-' && nextChar === '-') || (char === '/' && nextChar === '/')) {
      let end = pos;
      while (end < len && sql[end] !== '\n') {
        end++;
      }
      const commentVal = sql.substring(pos, end);
      tokens.push({ type: 'COMMENT_LINE', value: commentVal, upper: commentVal });
      pos = end;
      continue;
    }

    // Block comments (/* ... */)
    if (char === '/' && nextChar === '*') {
      let end = pos + 2;
      while (end < len - 1 && !(sql[end] === '*' && sql[end + 1] === '/')) {
        end++;
      }
      end = Math.min(len, end + 2);
      const commentVal = sql.substring(pos, end);
      tokens.push({ type: 'COMMENT_BLOCK', value: commentVal, upper: commentVal });
      pos = end;
      continue;
    }

    // String literals ('...')
    if (char === "'") {
      let end = pos + 1;
      while (end < len) {
        if (sql[end] === "'") {
          if (end + 1 < len && sql[end + 1] === "'") {
            end += 2;
          } else {
            end++;
            break;
          }
        } else {
          end++;
        }
      }
      const strVal = sql.substring(pos, end);
      tokens.push({ type: 'STRING', value: strVal, upper: strVal });
      pos = end;
      continue;
    }

    // Quoted identifiers ("...")
    if (char === '"') {
      let end = pos + 1;
      while (end < len) {
        if (sql[end] === '"') {
          if (end + 1 < len && sql[end + 1] === '"') {
            end += 2;
          } else {
            end++;
            break;
          }
        } else {
          end++;
        }
      }
      const idVal = sql.substring(pos, end);
      tokens.push({ type: 'QUOTED_ID', value: idVal, upper: idVal });
      pos = end;
      continue;
    }

    // Parameters (:PARAM)
    if (char === ':' && /[A-Za-z_]/.test(nextChar)) {
      let end = pos + 1;
      while (end < len && /[A-Za-z0-9_]/.test(sql[end])) {
        end++;
      }
      const paramVal = sql.substring(pos, end);
      tokens.push({ type: 'IDENTIFIER', value: paramVal, upper: paramVal.toUpperCase() });
      pos = end;
      continue;
    }

    // Multi-char operators
    const twoChars = sql.substring(pos, pos + 2);
    if (['||', '<=', '>=', '!=', '<>'].includes(twoChars)) {
      tokens.push({ type: 'SYMBOL', value: twoChars, upper: twoChars });
      pos += 2;
      continue;
    }

    // Numbers
    if (/[0-9]/.test(char) || (char === '.' && /[0-9]/.test(nextChar))) {
      let end = pos + 1;
      let hasDot = char === '.';
      while (end < len) {
        if (/[0-9]/.test(sql[end])) {
          end++;
        } else if (sql[end] === '.' && !hasDot) {
          hasDot = true;
          end++;
        } else {
          break;
        }
      }
      const numVal = sql.substring(pos, end);
      tokens.push({ type: 'NUMBER', value: numVal, upper: numVal });
      pos = end;
      continue;
    }

    // Words (keywords, identifiers, functions)
    if (/[A-Za-z_]/.test(char)) {
      let end = pos;
      while (end < len && /[A-Za-z0-9_]/.test(sql[end])) {
        end++;
      }
      const wordVal = sql.substring(pos, end);
      const upperWord = wordVal.toUpperCase();

      let lookAhead = end;
      while (lookAhead < len && /\s/.test(sql[lookAhead])) {
        lookAhead++;
      }
      const isFunctionCall = lookAhead < len && sql[lookAhead] === '(';

      if (HANA_KEYWORDS.has(upperWord)) {
        tokens.push({ type: 'KEYWORD', value: upperWord, upper: upperWord });
      } else if (HANA_BUILTIN_FUNCTIONS.has(upperWord) || isFunctionCall) {
        const fnName = HANA_BUILTIN_FUNCTIONS.has(upperWord) ? upperWord : wordVal;
        tokens.push({ type: 'FUNCTION', value: fnName, upper: upperWord });
      } else if (HANA_DATA_TYPES.has(upperWord)) {
        tokens.push({ type: 'KEYWORD', value: upperWord, upper: upperWord });
      } else {
        tokens.push({ type: 'IDENTIFIER', value: wordVal, upper: upperWord });
      }

      pos = end;
      continue;
    }

    // Single-char symbols
    tokens.push({ type: 'SYMBOL', value: char, upper: char });
    pos++;
  }

  return tokens;
}

/**
 * SAP HANA Best-Practices SQL Formatter
 */
export function formatHanaSql(sql: string): string {
  if (!sql || !sql.trim()) return sql;

  const rawTokens = tokenizeForFormatting(sql);
  if (rawTokens.length === 0) return sql;

  // Combine multi-word keywords
  const tokens: FormatToken[] = [];
  let i = 0;

  while (i < rawTokens.length) {
    const cur = rawTokens[i];
    const next = i + 1 < rawTokens.length ? rawTokens[i + 1] : null;
    const third = i + 2 < rawTokens.length ? rawTokens[i + 2] : null;

    if (cur.type === 'KEYWORD' && next && next.type === 'KEYWORD' && third && third.type === 'KEYWORD') {
      const triple = `${cur.upper} ${next.upper} ${third.upper}`;
      if (
        [
          'LEFT OUTER JOIN',
          'RIGHT OUTER JOIN',
          'FULL OUTER JOIN',
          'CREATE COLUMN TABLE',
          'CREATE ROW TABLE',
        ].includes(triple)
      ) {
        tokens.push({ type: 'KEYWORD', value: triple, upper: triple });
        i += 3;
        continue;
      }
    }

    if (cur.type === 'KEYWORD' && next && next.type === 'KEYWORD') {
      const double = `${cur.upper} ${next.upper}`;
      if (
        [
          'GROUP BY',
          'ORDER BY',
          'INNER JOIN',
          'LEFT JOIN',
          'RIGHT JOIN',
          'FULL JOIN',
          'CROSS JOIN',
          'INSERT INTO',
          'UPSERT INTO',
          'DELETE FROM',
          'MERGE INTO',
          'WHEN MATCHED',
          'WHEN NOT MATCHED',
          'UNION ALL',
          'CREATE TABLE',
          'CREATE VIEW',
          'DO BEGIN',
          'PARTITION BY',
          'NULLS FIRST',
          'NULLS LAST',
          'UNBOUNDED PRECEDING',
          'CURRENT ROW',
        ].includes(double)
      ) {
        tokens.push({ type: 'KEYWORD', value: double, upper: double });
        i += 2;
        continue;
      }
    }

    tokens.push(cur);
    i++;
  }

  const lines: string[] = [];
  let currentLine = '';
  let indentLevel = 0;
  let inSelectProjection = false;
  let parenDepth = 0;
  let inCase = false;

  const indentStr = () => '  '.repeat(Math.max(0, indentLevel));

  const flushLine = () => {
    const trimmed = currentLine.trim();
    if (trimmed.length > 0) {
      lines.push(indentStr() + trimmed);
    }
    currentLine = '';
  };

  const isMajorClause = (tok: FormatToken) => {
    if (tok.type !== 'KEYWORD') return false;
    return [
      'WITH',
      'SELECT',
      'FROM',
      'JOIN',
      'LEFT JOIN',
      'RIGHT JOIN',
      'INNER JOIN',
      'FULL JOIN',
      'CROSS JOIN',
      'LEFT OUTER JOIN',
      'RIGHT OUTER JOIN',
      'FULL OUTER JOIN',
      'WHERE',
      'GROUP BY',
      'HAVING',
      'ORDER BY',
      'LIMIT',
      'OFFSET',
      'UNION',
      'UNION ALL',
      'EXCEPT',
      'INTERSECT',
      'INSERT INTO',
      'UPSERT INTO',
      'UPDATE',
      'SET',
      'DELETE FROM',
      'MERGE INTO',
      'USING',
      'WHEN MATCHED',
      'WHEN NOT MATCHED',
      'CREATE TABLE',
      'CREATE COLUMN TABLE',
      'CREATE ROW TABLE',
      'CREATE VIEW',
      'DO BEGIN',
    ].includes(tok.upper);
  };

  for (let idx = 0; idx < tokens.length; idx++) {
    const tok = tokens[idx];
    const prev = idx > 0 ? tokens[idx - 1] : null;
    const next = idx + 1 < tokens.length ? tokens[idx + 1] : null;

    if (tok.type === 'COMMENT_LINE' || tok.type === 'COMMENT_BLOCK') {
      flushLine();
      lines.push(indentStr() + tok.value);
      continue;
    }

    if (tok.type === 'NEWLINE') {
      continue;
    }

    // Major clauses
    if (isMajorClause(tok) && (parenDepth === 0 || inSelectProjection)) {
      flushLine();

      if (tok.upper === 'SELECT') {
        inSelectProjection = true;
        currentLine = tok.upper;
        flushLine();
        indentLevel++;
      } else if (tok.upper === 'FROM') {
        if (inSelectProjection) {
          indentLevel = Math.max(0, indentLevel - 1);
          inSelectProjection = false;
        }
        currentLine = tok.upper;
      } else if (tok.upper.includes('JOIN')) {
        currentLine = tok.upper;
      } else if (tok.upper === 'WHERE' || tok.upper === 'HAVING') {
        currentLine = tok.upper;
        flushLine();
        indentLevel++;
      } else if (tok.upper === 'GROUP BY' || tok.upper === 'ORDER BY' || tok.upper === 'SET') {
        currentLine = tok.upper;
        flushLine();
        indentLevel++;
      } else {
        currentLine = tok.upper;
      }

      continue;
    }

    // Logical AND / OR in clauses
    if (
      tok.type === 'KEYWORD' &&
      (tok.upper === 'AND' || tok.upper === 'OR') &&
      parenDepth === 0
    ) {
      flushLine();
      currentLine = tok.upper + ' ';
      continue;
    }

    // SELECT projection top-level commas
    if (
      tok.type === 'SYMBOL' &&
      tok.value === ',' &&
      inSelectProjection &&
      parenDepth === 0
    ) {
      currentLine += ',';
      flushLine();
      continue;
    }

    // Other top-level commas
    if (tok.type === 'SYMBOL' && tok.value === ',' && parenDepth === 0) {
      currentLine += ',';
      if (currentLine.length > 40) {
        flushLine();
      } else {
        currentLine += ' ';
      }
      continue;
    }

    // CASE WHEN THEN ELSE END
    if (tok.type === 'KEYWORD' && tok.upper === 'CASE') {
      if (currentLine.trim().length > 0) {
        currentLine += ' ';
      }
      currentLine += 'CASE';
      flushLine();
      indentLevel++;
      inCase = true;
      continue;
    }

    if (tok.type === 'KEYWORD' && tok.upper === 'WHEN' && inCase) {
      flushLine();
      currentLine = 'WHEN ';
      continue;
    }

    if (tok.type === 'KEYWORD' && tok.upper === 'THEN' && inCase) {
      currentLine += ' THEN ';
      continue;
    }

    if (tok.type === 'KEYWORD' && tok.upper === 'ELSE' && inCase) {
      flushLine();
      currentLine = 'ELSE ';
      continue;
    }

    if (tok.type === 'KEYWORD' && tok.upper === 'END') {
      if (inCase) {
        indentLevel = Math.max(0, indentLevel - 1);
        inCase = false;
      }
      flushLine();
      currentLine = 'END';
      if (next && next.type === 'KEYWORD' && next.upper === 'AS') {
        // Keep alias on same line
      } else {
        flushLine();
      }
      continue;
    }

    // Parentheses
    if (tok.type === 'SYMBOL' && tok.value === '(') {
      parenDepth++;
      if (next && next.type === 'KEYWORD' && next.upper === 'SELECT') {
        currentLine += ' (';
        flushLine();
        indentLevel++;
      } else {
        currentLine += '(';
      }
      continue;
    }

    if (tok.type === 'SYMBOL' && tok.value === ')') {
      if (parenDepth > 0) parenDepth--;
      if (prev && prev.type === 'KEYWORD' && isMajorClause(prev)) {
        indentLevel = Math.max(0, indentLevel - 1);
        flushLine();
        currentLine = ')';
      } else {
        currentLine += ')';
      }
      continue;
    }

    // Semicolon
    if (tok.type === 'SYMBOL' && tok.value === ';') {
      currentLine += ';';
      flushLine();
      if (inSelectProjection) {
        indentLevel = Math.max(0, indentLevel - 1);
        inSelectProjection = false;
      }
      continue;
    }

    // Dot notation
    if (tok.type === 'SYMBOL' && tok.value === '.') {
      currentLine = currentLine.trimEnd() + '.';
      continue;
    }

    if (prev && prev.type === 'SYMBOL' && prev.value === '.') {
      currentLine += tok.value;
      continue;
    }

    // Function call formatting
    if (tok.type === 'FUNCTION') {
      if (currentLine.length > 0 && !currentLine.endsWith(' ') && !currentLine.endsWith('(')) {
        currentLine += ' ';
      }
      currentLine += tok.value;
      continue;
    }

    // Spacing
    if (currentLine.length > 0) {
      const lastChar = currentLine[currentLine.length - 1];
      if (lastChar !== '(' && lastChar !== '.' && tok.value !== ',') {
        currentLine += ' ';
      }
    }

    currentLine += tok.value;
  }

  flushLine();

  const finalResult = lines
    .filter((line, idx, arr) => !(line.trim() === '' && arr[idx - 1]?.trim() === ''))
    .join('\n')
    .trim();

  return finalResult;
}
