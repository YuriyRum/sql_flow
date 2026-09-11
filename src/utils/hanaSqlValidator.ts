import { SyntaxDiagnostic, ValidationResult, QueryParameter } from '../types';

// SAP HANA standard and reserved keywords
export const HANA_KEYWORDS = new Set([
  'SELECT', 'FROM', 'WHERE', 'GROUP', 'BY', 'HAVING', 'ORDER', 'LIMIT', 'OFFSET', 'TOP',
  'JOIN', 'INNER', 'LEFT', 'RIGHT', 'FULL', 'OUTER', 'CROSS', 'ON', 'AS', 'AND', 'OR', 'NOT',
  'IN', 'EXISTS', 'BETWEEN', 'LIKE', 'IS', 'NULL', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END',
  'UNION', 'ALL', 'DISTINCT', 'INTERSECT', 'MINUS', 'EXCEPT',
  'INSERT', 'INTO', 'VALUES', 'UPDATE', 'SET', 'DELETE', 'UPSERT', 'WITH', 'PRIMARY', 'KEY',
  'MERGE', 'USING', 'MATCHED',
  'CREATE', 'ALTER', 'DROP', 'TRUNCATE', 'TABLE', 'COLUMN', 'ROW', 'VIEW', 'GLOBAL', 'TEMPORARY',
  'INDEX', 'SEQUENCE', 'SYNONYM', 'SCHEMA', 'PROCEDURE', 'FUNCTION',
  'DO', 'BEGIN', 'DECLARE', 'DEFAULT', 'CALL', 'RETURN', 'IF', 'ELSEIF', 'WHILE', 'FOR', 'LOOP',
  'OVER', 'PARTITION', 'ROWS', 'RANGE', 'UNBOUNDED', 'PRECEDING', 'FOLLOWING', 'CURRENT', 'ROW',
  'LOAD', 'UNLOAD', 'MERGE', 'DELTA', 'RECORD', 'LOG'
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

  // 0. Safe Mode: Strictly allow only SELECT statements (no table creation, alteration, or deletion)
  checkSafeModeConstraints(sql, lines, diagnostics);

  // 1. Bracket, Parentheses, and String Quotes balancing with line tracking
  checkDelimiters(sql, lines, diagnostics);

  // 2. Trailing commas check
  checkTrailingCommas(lines, diagnostics);

  // 3. Clause Ordering & Grammar Structure Check
  checkClauseOrder(sql, lines, diagnostics);

  // 4. HANA Specific Syntax validations (UPSERT, MERGE, DDL, SQLScript)
  checkHanaSpecificSyntax(sql, lines, diagnostics);

  // 5. Check Unknown Function Calls & Missing Parameters
  checkFunctionsAndIdentifiers(sql, lines, diagnostics);

  // 6. Extract Table Lineage & Parameters
  const extractedTables = extractTableLineage(sql);
  const extractedParams = extractParameters(sql);

  // 7. Compute Dialect Health Score
  let score = 100;
  const errors = diagnostics.filter((d) => d.severity === 'error');
  const warnings = diagnostics.filter((d) => d.severity === 'warning');

  score -= errors.length * 25;
  score -= warnings.length * 8;
  if (score < 10 && errors.length > 0) score = 10;
  if (errors.length === 0 && warnings.length === 0) score = 100;

  return {
    isValid: errors.length === 0,
    errorCount: errors.length,
    warningCount: warnings.length,
    diagnostics,
    extractedTables,
    extractedParams,
    dialectScore: Math.max(0, Math.min(100, score)),
  };
}

export function checkSafeModeConstraints(
  _sql: string,
  lines: string[],
  diagnostics: SyntaxDiagnostic[]
) {
  const FORBIDDEN_WORDS = [
    { word: 'CREATE', label: 'Table/object creation (CREATE)' },
    { word: 'DROP', label: 'Table/object deletion (DROP)' },
    { word: 'TRUNCATE', label: 'Table truncation (TRUNCATE)' },
    { word: 'DELETE', label: 'Row/table deletion (DELETE)' },
    { word: 'INSERT', label: 'Data insertion (INSERT)' },
    { word: 'UPDATE', label: 'Data modification (UPDATE)' },
    { word: 'UPSERT', label: 'Data upsert (UPSERT)' },
    { word: 'MERGE', label: 'Data merge (MERGE)' },
    { word: 'ALTER', label: 'Table modification (ALTER)' },
  ];

  let inBlockComment = false;
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let hasSelectStatement = false;

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const rawLine = lines[lineIdx];
    const lineNum = lineIdx + 1;
    let col = 0;

    while (col < rawLine.length) {
      if (inBlockComment) {
        if (rawLine.startsWith('*/', col)) {
          inBlockComment = false;
          col += 2;
        } else {
          col++;
        }
        continue;
      }

      if (inSingleQuote) {
        if (rawLine[col] === "'") {
          if (rawLine[col + 1] === "'") {
            col += 2;
          } else {
            inSingleQuote = false;
            col++;
          }
        } else {
          col++;
        }
        continue;
      }

      if (inDoubleQuote) {
        if (rawLine[col] === '"') {
          inDoubleQuote = false;
          col++;
        } else {
          col++;
        }
        continue;
      }

      // Skip single-line comments
      if (rawLine.startsWith('--', col) || rawLine.startsWith('//', col)) {
        break;
      }

      // Enter block comment
      if (rawLine.startsWith('/*', col)) {
        inBlockComment = true;
        col += 2;
        continue;
      }

      // Enter string literals
      if (rawLine[col] === "'") {
        inSingleQuote = true;
        col++;
        continue;
      }
      if (rawLine[col] === '"') {
        inDoubleQuote = true;
        col++;
        continue;
      }

      // Inspect identifiers / keywords
      if (/[A-Za-z_]/.test(rawLine[col])) {
        const start = col;
        while (col < rawLine.length && /[A-Za-z0-9_]/.test(rawLine[col])) {
          col++;
        }
        const word = rawLine.substring(start, col).toUpperCase();

        if (word === 'SELECT') {
          hasSelectStatement = true;
        }

        // Check for forbidden keyword in Safe Mode
        for (const forbidden of FORBIDDEN_WORDS) {
          if (word === forbidden.word) {
            diagnostics.push({
              line: lineNum,
              column: start + 1,
              message: `Safe Mode Violation: Only SELECT statements are permitted. ${forbidden.label} is strictly blocked.`,
              severity: 'error',
              ruleId: 'HANA_SAFE_MODE_VIOLATION',
              suggestedFix: `Remove "${rawLine.substring(start, col)}" and use only read-only SELECT queries.`,
              codeSnippet: rawLine.trim(),
            });
          }
        }
        continue;
      }

      col++;
    }
  }

  if (!hasSelectStatement && diagnostics.filter((d) => d.ruleId === 'HANA_SAFE_MODE_VIOLATION').length === 0) {
    diagnostics.push({
      line: 1,
      column: 1,
      message: 'Safe Mode Violation: The query must contain a SELECT statement. Only read-only queries are permitted in Safe Mode.',
      severity: 'error',
      ruleId: 'HANA_SAFE_MODE_REQUIRE_SELECT',
      suggestedFix: 'Write a SELECT query to retrieve data.',
    });
  }
}

function checkDelimiters(
  sql: string,
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
          colIdx++; // skip '/'
        }
        continue;
      }

      // Handle single quote string literal
      if (inSingleQuote) {
        if (char === "'") {
          // Check for escaped single quote ''
          if (nextChar === "'") {
            colIdx++; // skip escaped quote
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
            colIdx++; // skip escaped double quote
          } else {
            inDoubleQuote = false;
          }
        }
        continue;
      }

      // Check comments start
      if (char === '-' && nextChar === '-') {
        // Rest of line is single-line comment
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
            message: `Unmatched closing delimiter '${char}' without corresponding opening delimiter.`,
            severity: 'error',
            ruleId: 'HANA_UNMATCHED_CLOSE_BRACKET',
            suggestedFix: `Remove extra '${char}' or add missing opening delimiter.`,
          });
        } else {
          const top = parenStack.pop()!;
          const matchMap: Record<string, string> = { ')': '(', ']': '[', '}': '{' };
          if (matchMap[char] !== top.char) {
            diagnostics.push({
              line: lineNum,
              column: colNum,
              message: `Mismatched closing delimiter '${char}' for '${top.char}' opened at line ${top.line}, col ${top.col}.`,
              severity: 'error',
              ruleId: 'HANA_MISMATCHED_BRACKETS',
              suggestedFix: `Replace '${char}' with '${top.char === '(' ? ')' : top.char === '[' ? ']' : '}'}'.`,
            });
          }
        }
      }
    }
  }

  if (inSingleQuote) {
    diagnostics.push({
      line: singleQuoteStart.line,
      column: singleQuoteStart.col,
      message: 'Unterminated string literal (missing closing single quote \').',
      severity: 'error',
      ruleId: 'HANA_UNTERMINATED_STRING',
      suggestedFix: "Add a closing single quote ' at the end of the literal.",
    });
  }

  if (inDoubleQuote) {
    diagnostics.push({
      line: doubleQuoteStart.line,
      column: doubleQuoteStart.col,
      message: 'Unterminated identifier literal (missing closing double quote ").',
      severity: 'error',
      ruleId: 'HANA_UNTERMINATED_IDENTIFIER',
      suggestedFix: 'Add a closing double quote " to close the schema or table identifier.',
    });
  }

  if (inBlockComment) {
    diagnostics.push({
      line: blockCommentStart.line,
      column: blockCommentStart.col,
      message: 'Unterminated block comment (missing */).',
      severity: 'error',
      ruleId: 'HANA_UNTERMINATED_BLOCK_COMMENT',
      suggestedFix: 'Close block comment with */.',
    });
  }

  while (parenStack.length > 0) {
    const unclosed = parenStack.pop()!;
    diagnostics.push({
      line: unclosed.line,
      column: unclosed.col,
      message: `Unclosed delimiter '${unclosed.char}'. Missing matching '${unclosed.char === '(' ? ')' : unclosed.char === '[' ? ']' : '}'}'.`,
      severity: 'error',
      ruleId: 'HANA_UNCLOSED_BRACKET',
      suggestedFix: `Add closing '${unclosed.char === '(' ? ')' : unclosed.char === '[' ? ']' : '}'}' at the appropriate location.`,
    });
  }
}

function checkTrailingCommas(lines: string[], diagnostics: SyntaxDiagnostic[]) {
  // Check for trailing comma immediately before FROM, WHERE, GROUP, ORDER, or closing parenthesis
  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    // Remove comments and trim
    const cleanLine = rawLine.replace(/--.*$/, '').replace(/\/\/.*$/, '').trim();
    if (!cleanLine) continue;

    if (cleanLine.endsWith(',')) {
      // Look at next non-empty line
      for (let j = i + 1; j < lines.length; j++) {
        const nextClean = lines[j].replace(/--.*$/, '').replace(/\/\/.*$/, '').trim();
        if (!nextClean) continue;
        const firstWord = nextClean.split(/\s+/)[0].toUpperCase();
        if (
          ['FROM', 'WHERE', 'GROUP', 'HAVING', 'ORDER', 'LIMIT', 'UNION'].includes(
            firstWord
          ) ||
          nextClean.startsWith(')')
        ) {
          diagnostics.push({
            line: i + 1,
            column: rawLine.lastIndexOf(',') + 1,
            message: `Syntax error: Trailing comma before '${firstWord || ')'}'.`,
            severity: 'error',
            ruleId: 'HANA_TRAILING_COMMA',
            suggestedFix: 'Remove the comma at the end of this line.',
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

  // Check for SELECT statements
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
        suggestedFix: 'Move the WHERE clause after the FROM and JOIN clauses.',
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
        suggestedFix: 'Move WHERE before GROUP BY or change to HAVING.',
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
        suggestedFix: 'Add a GROUP BY clause or change HAVING to WHERE.',
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
        suggestedFix: 'Move GROUP BY clause before ORDER BY.',
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
        suggestedFix: 'Move LIMIT to the end of the query.',
      });
    }

    // Select * warning in analytics
    if (normalized.match(/SELECT\s+\*\s+FROM/i)) {
      diagnostics.push({
        line: findLineForToken(lines, 'SELECT'),
        column: 1,
        message: "SAP HANA Best Practice: Avoid 'SELECT *' in production analytical queries. Specify explicit columns for optimal columnar memory scan.",
        severity: 'info',
        ruleId: 'HANA_BP_SELECT_STAR',
        suggestedFix: 'Replace * with specific column projections.',
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
        suggestedFix: "Use 'UPSERT INTO <target_table> ...'",
      });
    }
    if (!upperSql.includes('WITH PRIMARY KEY') && !upperSql.includes('SELECT') && !upperSql.includes('VALUES')) {
      diagnostics.push({
        line: findLineForToken(lines, 'UPSERT'),
        column: 1,
        message: "SAP HANA UPSERT requires VALUES or query expression with 'WITH PRIMARY KEY' for record matching.",
        severity: 'warning',
        ruleId: 'HANA_UPSERT_WITH_PRIMARY_KEY',
        suggestedFix: "Append 'WITH PRIMARY KEY' at the end of the UPSERT statement.",
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
        suggestedFix: "Add 'USING (<source_query_or_table>) ON (<join_condition>)'",
      });
    }
    if (!upperSql.includes(' ON ') && !upperSql.includes(' ON(')) {
      diagnostics.push({
        line: findLineForToken(lines, 'MERGE'),
        column: 1,
        message: "SAP HANA MERGE statement missing 'ON' join predicate clause.",
        severity: 'error',
        ruleId: 'HANA_MERGE_MISSING_ON',
        suggestedFix: "Add 'ON (target.id = source.id)'",
      });
    }
    if (!upperSql.includes('MATCHED')) {
      diagnostics.push({
        line: findLineForToken(lines, 'MERGE'),
        column: 1,
        message: "SAP HANA MERGE statement must specify at least one 'WHEN MATCHED THEN' or 'WHEN NOT MATCHED THEN' branch.",
        severity: 'error',
        ruleId: 'HANA_MERGE_MISSING_MATCHED',
        suggestedFix: "Add 'WHEN MATCHED THEN UPDATE SET ...' or 'WHEN NOT MATCHED THEN INSERT ...'",
      });
    }
  }

  // 3. CREATE COLUMN TABLE Validation
  if (upperSql.includes('CREATE') && upperSql.includes('TABLE')) {
    if (!upperSql.includes('COLUMN TABLE') && !upperSql.includes('ROW TABLE') && !upperSql.includes('TEMPORARY')) {
      diagnostics.push({
        line: findLineForToken(lines, 'CREATE'),
        column: 1,
        message: "SAP HANA Architecture Hint: It is strongly recommended to explicitly specify 'CREATE COLUMN TABLE' for in-memory analytics workloads.",
        severity: 'info',
        ruleId: 'HANA_EXPLICIT_COLUMN_TABLE',
        suggestedFix: "Change 'CREATE TABLE' to 'CREATE COLUMN TABLE'",
      });
    }
  }

  // 4. SQLScript DO BEGIN ... END; Validation
  if (upperSql.includes('DO BEGIN') || upperSql.includes('DO\nBEGIN')) {
    if (!upperSql.includes('END;') && !upperSql.includes('END ;') && !upperSql.endsWith('END')) {
      diagnostics.push({
        line: findLineForToken(lines, 'DO'),
        column: 1,
        message: "SAP HANA Anonymous SQLScript block 'DO BEGIN' is missing terminating 'END;'.",
        severity: 'error',
        ruleId: 'HANA_SQLSCRIPT_MISSING_END',
        suggestedFix: "Add 'END;' at the conclusion of the SQLScript block.",
      });
    }
  }

  // 5. Check Data types in CREATE statements
  const createMatch = sql.match(/CREATE\s+(?:COLUMN\s+|ROW\s+|GLOBAL\s+TEMPORARY\s+)?TABLE\s+([^\(]+)\s*\(([\s\S]+)\)/i);
  if (createMatch) {
    const colDefs = createMatch[2];
    const colLines = colDefs.split(',');
    for (const colLine of colLines) {
      const colTrimmed = colLine.trim();
      if (!colTrimmed || colTrimmed.toUpperCase().startsWith('PRIMARY KEY') || colTrimmed.toUpperCase().startsWith('CONSTRAINT')) {
        continue;
      }
      const parts = colTrimmed.split(/\s+/);
      if (parts.length >= 2) {
        const typeToken = parts[1].replace(/\([^\)]*\)/, '').toUpperCase();
        if (!HANA_DATA_TYPES.has(typeToken) && !['INT', 'DEC', 'NUMERIC'].includes(typeToken)) {
          const line = findLineContaining(lines, parts[0]);
          diagnostics.push({
            line,
            column: 1,
            message: `Unrecognized or non-standard SAP HANA data type '${typeToken}' for column '${parts[0]}'. Expected HANA types (e.g., NVARCHAR, DECIMAL, INTEGER, SECONDDATE, BIGINT).`,
            severity: 'warning',
            ruleId: 'HANA_UNKNOWN_DATATYPE',
            suggestedFix: `Use a standard HANA type like NVARCHAR(100), DECIMAL(15,2), or INTEGER.`,
          });
        }
      }
    }
  }
}

function checkFunctionsAndIdentifiers(
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
      suggestedFix: 'Replace ISNULL with IFNULL or COALESCE.',
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
      suggestedFix: 'Replace NVL with IFNULL.',
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
      suggestedFix: 'Replace GETDATE() with CURRENT_TIMESTAMP or CURRENT_UTCTIMESTAMP.',
    });
  }
}

export function extractTableLineage(sql: string): { inputs: string[]; outputs: string[] } {
  const inputs = new Set<string>();
  const outputs = new Set<string>();

  // Extract FROM & JOIN tables
  const fromRegex = /\b(?:FROM|JOIN)\s+([A-Za-z0-9_".]+)/gi;
  let match: RegExpExecArray | null;
  while ((match = fromRegex.exec(sql)) !== null) {
    const table = match[1].trim();
    if (!['(', 'SELECT', 'LATERAL', 'UNNEST'].includes(table.toUpperCase())) {
      inputs.add(cleanTableName(table));
    }
  }

  // Extract Output targets (INTO, UPDATE, CREATE TABLE, MERGE INTO, UPSERT INTO)
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
  // Match :PARAM_NAME or :IP_DATE or :P1
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

function findLineContaining(lines: string[], substring: string): number {
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes(substring)) {
      return i + 1;
    }
  }
  return 1;
}

/**
 * SAP HANA SQL Formatter
 * Beautifies queries with standard indentation, uppercase keywords, and clean clause breaks.
 */
export function formatHanaSql(sql: string): string {
  if (!sql.trim()) return sql;

  // Major clauses that start on a new line with 0 indent
  const majorKeywords = [
    'SELECT', 'FROM', 'WHERE', 'GROUP BY', 'HAVING', 'ORDER BY',
    'LIMIT', 'OFFSET', 'UNION ALL', 'UNION', 'EXCEPT', 'INTERSECT',
    'INSERT INTO', 'UPSERT INTO', 'UPDATE', 'DELETE FROM', 'MERGE INTO',
    'USING', 'WHEN MATCHED', 'WHEN NOT MATCHED',
    'CREATE COLUMN TABLE', 'CREATE ROW TABLE', 'CREATE TABLE', 'CREATE VIEW',
    'DO BEGIN', 'END;', 'DECLARE'
  ];

  let formatted = sql;

  // Replace multiple spaces with single space
  formatted = formatted.replace(/[ \t]+/g, ' ');

  // Normalize keywords to UPPERCASE
  HANA_KEYWORDS.forEach((kw) => {
    const regex = new RegExp(`\\b${kw}\\b`, 'gi');
    formatted = formatted.replace(regex, kw);
  });

  // Put major clauses on new lines
  majorKeywords.forEach((kw) => {
    const regex = new RegExp(`\\s*\\b${kw.replace(/\s+/g, '\\s+')}\\b\\s*`, 'gi');
    formatted = formatted.replace(regex, `\n${kw} `);
  });

  // Handle JOIN clauses with 2 space indent
  const joinTypes = ['INNER JOIN', 'LEFT JOIN', 'LEFT OUTER JOIN', 'RIGHT JOIN', 'RIGHT OUTER JOIN', 'FULL JOIN', 'FULL OUTER JOIN', 'CROSS JOIN', 'JOIN'];
  joinTypes.forEach((join) => {
    const regex = new RegExp(`\\s*\\b${join.replace(/\s+/g, '\\s+')}\\b\\s*`, 'gi');
    formatted = formatted.replace(regex, `\n  ${join} `);
  });

  // Handle AND / OR inside WHERE
  formatted = formatted.replace(/\nWHERE\s+([\s\S]+?)(?=\n(?:GROUP BY|HAVING|ORDER BY|LIMIT|$))/gi, (match) => {
    return match
      .replace(/\s+AND\s+/gi, '\n  AND ')
      .replace(/\s+OR\s+/gi, '\n  OR ');
  });

  // Clean extra blank lines
  const finalLines = formatted
    .split('\n')
    .map((l) => l.trimEnd())
    .filter((l, idx, arr) => !(l === '' && arr[idx - 1] === ''));

  return finalLines.join('\n').trim();
}
