/**
 * SQL Table Dependency & Condition Parser for SAP HANA
 * Extracts all table occurrences (including across multiple UNION / UNION ALL / INTERSECT / EXCEPT branches),
 * FROM (SELECT ...) derived subqueries (including inner/outer joins inside subqueries),
 * JOIN (SELECT ...) subqueries, WHERE IN/EXISTS/scalar subqueries, SELECT/ON/HAVING subqueries, CTEs,
 * parenthesized join groups, aliases, join relationships, ON conditions on edges, and WHERE conditions per node.
 */

export interface SubqueryGroupBox {
  id: string;
  label: string;
  alias: string;
  role: string;
  nodeIds: string[]; // IDs of inner nodes + derived subquery node
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TableNodeData {
  id: string; // unique identifier e.g. "TBL_B1_1_VBAK_v"
  tableName: string; // "VBAK"
  schemaName?: string; // "SAP_S4HANA"
  fullTableName: string; // '"SAP_S4HANA"."VBAK"' or 'VBAK'
  alias: string; // "v" or ""
  displayName: string; // '"SAP_S4HANA"."VBAK" (v)' or 'VBAK (Branch 1)'
  joinType:
    | 'FROM'
    | 'INNER JOIN'
    | 'LEFT JOIN'
    | 'RIGHT JOIN'
    | 'FULL JOIN'
    | 'CROSS JOIN'
    | 'CTE'
    | 'TARGET'
    | 'UNION'
    | 'UNION ALL'
    | 'EXCEPT'
    | 'INTERSECT'
    | 'FROM SUBQUERY'
    | 'JOIN SUBQUERY'
    | 'INNER JOIN SUBQUERY'
    | 'LEFT JOIN SUBQUERY'
    | 'RIGHT JOIN SUBQUERY'
    | 'FULL JOIN SUBQUERY'
    | 'WHERE SUBQUERY'
    | 'SELECT SUBQUERY';
  whereConditions: string[]; // WHERE conditions specific to this table/subquery occurrence
  columns: string[]; // Referenced or projected columns from this table/subquery
  isRoot: boolean;
  orderIndex: number;
  branchIndex?: number;
  branchName?: string; // e.g. "Branch 1", "Subquery in FROM (sub)"
  scopeGroupId?: string; // Links inner nodes of a subquery to their visual subquery group
  isOperator?: boolean; // true if this is a UNION / UNION ALL combiner node
  isSubqueryResult?: boolean; // true if this node represents the derived output of a FROM/JOIN subquery or CTE
  innerTableNames?: string[]; // For derived subquery nodes: list of tables inside the subquery
  innerJoinSummary?: string[]; // For derived subquery nodes: summary of inner/outer joins inside the subquery
  subquerySql?: string; // For derived subquery nodes: formatted SQL snippet of the subquery
  x?: number;
  y?: number;
}

export interface TableEdgeData {
  id: string;
  sourceId: string; // Source table node ID
  targetId: string; // Target table node ID
  sourceName: string;
  targetName: string;
  sourceAlias: string;
  targetAlias: string;
  joinType: string; // 'INNER JOIN', 'LEFT JOIN', 'SUBQUERY OUTPUT', 'UNION ALL', etc.
  onCondition: string; // e.g. 'v."SALES_DOCUMENT" = p."SALES_DOCUMENT"'
  detailedConditions: string[];
  isUnionEdge?: boolean;
  isSubqueryEdge?: boolean;
}

export interface ParsedTableGraph {
  nodes: TableNodeData[];
  edges: TableEdgeData[];
  subqueryGroups: SubqueryGroupBox[];
  globalWhereConditions: string[]; // WHERE conditions not tied to a single table
  statementType: 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE' | 'MERGE' | 'UNKNOWN';
  cteCount: number;
  subqueryCount: number;
  branchCount: number;
  hasErrors: boolean;
  rawSql: string;
}

// SQL keywords that must NEVER be mistaken for an unquoted table alias in FROM or JOIN clauses
const NON_ALIAS_SQL_KEYWORDS = new Set([
  'ON', 'USING', 'WHERE', 'GROUP', 'HAVING', 'ORDER', 'LIMIT', 'OFFSET',
  'INNER', 'LEFT', 'RIGHT', 'FULL', 'CROSS', 'NATURAL', 'OUTER', 'JOIN',
  'UNION', 'EXCEPT', 'INTERSECT', 'MINUS', 'WINDOW', 'QUALIFY', 'FOR',
  'INTO', 'VALUES', 'SET', 'WHEN', 'THEN', 'ELSE', 'END', 'AND', 'OR',
  'AS', 'SELECT', 'FROM', 'LATERAL', 'UNNEST', 'TABLESAMPLE', 'SAMPLE', 'WITH',
  'FETCH', 'LOCK', 'WAIT', 'NOWAIT', 'HINT'
]);

/**
 * Strips SQL comments and replaces single-quoted string literals with placeholders
 * while preserving double-quoted identifiers ("...") intact.
 */
function cleanSqlForAnalysis(sql: string): {
  cleanText: string;
  strings: string[];
} {
  const strings: string[] = [];
  let pos = 0;
  let result = '';
  const len = sql.length;

  while (pos < len) {
    const char = sql[pos];
    const nextChar = pos + 1 < len ? sql[pos + 1] : '';

    // Double-quoted identifier "..." — preserve intact so '//' or '--' or "'" inside quotes aren't misread
    if (char === '"') {
      result += char;
      pos++;
      while (pos < len) {
        result += sql[pos];
        if (sql[pos] === '"') {
          if (pos + 1 < len && sql[pos + 1] === '"') {
            result += sql[pos + 1];
            pos += 2;
          } else {
            pos++;
            break;
          }
        } else {
          pos++;
        }
      }
      continue;
    }

    // Single line comment
    if ((char === '-' && nextChar === '-') || (char === '/' && nextChar === '/')) {
      while (pos < len && sql[pos] !== '\n') {
        pos++;
      }
      result += ' ';
      continue;
    }

    // Block comment
    if (char === '/' && nextChar === '*') {
      pos += 2;
      while (pos < len - 1 && !(sql[pos] === '*' && sql[pos + 1] === '/')) {
        pos++;
      }
      pos = Math.min(len, pos + 2);
      result += ' ';
      continue;
    }

    // String literal '...'
    if (char === "'") {
      let str = "'";
      pos++;
      while (pos < len) {
        if (sql[pos] === "'") {
          str += "'";
          if (pos + 1 < len && sql[pos + 1] === "'") {
            str += "'";
            pos += 2;
          } else {
            pos++;
            break;
          }
        } else {
          str += sql[pos];
          pos++;
        }
      }
      const placeholder = `__STR_${strings.length}__`;
      strings.push(str);
      result += placeholder;
      continue;
    }

    result += char;
    pos++;
  }

  return { cleanText: result, strings };
}

/**
 * Restores string placeholders
 */
function restoreStrings(text: string, strings: string[]): string {
  let res = text;
  strings.forEach((s, idx) => {
    res = res.split(`__STR_${idx}__`).join(s);
  });
  return res;
}

/**
 * Clean identifier: removes quotes, brackets, backticks
 */
function stripQuotes(id: string): string {
  if (!id) return '';
  return id.replace(/^["'`\[\]]+|["'`\[\]]+$/g, '').trim();
}

/**
 * Splits a potentially quoted schema.table string by top-level dot '.' outside double quotes
 */
function splitIdentifierByDot(raw: string): string[] {
  const parts: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
      current += ch;
    } else if (ch === '.' && !inQuotes) {
      parts.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

/**
 * Parses full table name into schema and table (supports SAP HANA namespaces with ::, /, $, #)
 */
function parseSchemaAndTable(rawName: string): { schema?: string; table: string; fullName: string } {
  const clean = rawName.trim();
  const parts = splitIdentifierByDot(clean);
  if (parts.length >= 2) {
    const schema = stripQuotes(parts[0]);
    const table = stripQuotes(parts.slice(1).join('.'));
    return { schema, table, fullName: clean };
  }
  const table = stripQuotes(clean);
  return { schema: undefined, table, fullName: clean };
}

/**
 * Finds the matching closing parenthesis ')' for an opening '(' at `openIdx`,
 * respecting quotes. Returns -1 if not found.
 */
function findMatchingCloseParen(text: string, openIdx: number): number {
  let depth = 0;
  let inQuotes = false;
  let quoteChar = '';

  for (let i = openIdx; i < text.length; i++) {
    const ch = text[i];
    if (!inQuotes && (ch === "'" || ch === '"')) {
      inQuotes = true;
      quoteChar = ch;
    } else if (inQuotes && ch === quoteChar) {
      inQuotes = false;
    } else if (!inQuotes) {
      if (ch === '(') depth++;
      else if (ch === ')') {
        depth--;
        if (depth === 0) return i;
      }
    }
  }
  return -1;
}

/**
 * Unwraps outer parentheses if the entire SQL block is wrapped in `(...)`,
 * or if a leading `(SELECT ...)` is only followed by `ORDER BY` / `LIMIT` / `OFFSET`.
 */
function unwrapOuterParens(sql: string): string {
  let current = sql.trim();
  while (current.startsWith('(')) {
    const closeIdx = findMatchingCloseParen(current, 0);
    if (closeIdx === current.length - 1) {
      current = current.substring(1, current.length - 1).trim();
      continue;
    }
    if (closeIdx > 0) {
      const tail = current.substring(closeIdx + 1).trim();
      if (/^(?:ORDER\s+BY\b|LIMIT\b|OFFSET\b|FOR\s+UPDATE\b)/i.test(tail)) {
        const inner = current.substring(1, closeIdx).trim();
        if (/^(?:SELECT|WITH)\b/i.test(inner)) {
          current = `${inner} ${tail}`;
          continue;
        }
      }
    }
    break;
  }
  return current;
}

/**
 * Determines whether the content inside a `(...)` block is a SQL subquery
 * (`SELECT ...`, `WITH ...`, or compound `(SELECT ...) UNION ALL (SELECT ...)`),
 * as opposed to a parenthesized join group `( (SELECT ...) a INNER JOIN b ON ... )`
 * or a function/boolean expression `( (SELECT COUNT(*) FROM T) > 0 )`.
 */
function isSubqueryContent(innerContent: string): boolean {
  const unwrapped = unwrapOuterParens(innerContent);
  if (/^(?:SELECT|WITH)\b/i.test(unwrapped)) {
    return true;
  }
  if (unwrapped.startsWith('(')) {
    const firstClose = findMatchingCloseParen(unwrapped, 0);
    if (firstClose > 0) {
      const firstInner = unwrapped.substring(1, firstClose).trim();
      const afterFirst = unwrapped.substring(firstClose + 1).trim();
      if (
        isSubqueryContent(firstInner) &&
        /^(?:UNION\b|INTERSECT\b|EXCEPT\b|MINUS\b|ORDER\s+BY\b|LIMIT\b|OFFSET\b)/i.test(afterFirst)
      ) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Masks direct parenthesized subqueries `(SELECT ...)` or `(WITH ...)` in `sqlText`
 * with synthetic tokens ` __SQ_<scopeId>_<idx>__ ` so that outer FROM, JOIN, ON, and WHERE
 * parsing never leaks into inner subqueries or duplicates inner tables.
 */
function maskDirectSubqueries(
  sqlText: string,
  scopeId: string
): {
  maskedSql: string;
  subqueryMap: Map<string, string>;
} {
  const safeScopeId = scopeId.replace(/[^A-Za-z0-9_]/g, '_');
  const subqueryMap = new Map<string, string>();
  let maskedSql = '';
  let i = 0;
  const len = sqlText.length;
  let inQuotes = false;
  let quoteChar = '';
  let sqCounter = 0;

  while (i < len) {
    const ch = sqlText[i];

    if (!inQuotes && (ch === "'" || ch === '"')) {
      inQuotes = true;
      quoteChar = ch;
      maskedSql += ch;
      i++;
      continue;
    }

    if (inQuotes) {
      maskedSql += ch;
      if (ch === quoteChar) {
        inQuotes = false;
      }
      i++;
      continue;
    }

    if (ch === '(') {
      const closeIdx = findMatchingCloseParen(sqlText, i);
      if (closeIdx > i) {
        const rawInner = sqlText.substring(i + 1, closeIdx);
        if (isSubqueryContent(rawInner)) {
          const innerSql = unwrapOuterParens(rawInner);
          const placeholder = `__SQ_${safeScopeId}_${sqCounter++}__`;
          subqueryMap.set(placeholder, innerSql);
          maskedSql += ` ${placeholder} `;
          i = closeIdx + 1;
          continue;
        }
      }
    }

    maskedSql += ch;
    i++;
  }

  return { maskedSql, subqueryMap };
}

/**
 * Replaces any `__SQ_...__` placeholders inside a display string with `(Subquery)`
 */
function formatSubqueryPlaceholders(text: string): string {
  return text.replace(/__SQ_[A-Za-z0-9_]+__/g, '(Subquery)').replace(/\s+/g, ' ').trim();
}

/**
 * Extracts a single SQL token (quoted identifier, dotted identifier, or placeholder)
 * from the start of `str`, returning `[token, remainingStr]`.
 */
function consumeLeadingTableToken(str: string): { token: string; rest: string } | null {
  const s = str.trim();
  if (!s) return null;

  // Check for placeholder `__SQ_...__`
  const sqMatch = s.match(/^(__SQ_[A-Za-z0-9_]+__)([\s\S]*)$/);
  if (sqMatch) {
    return { token: sqMatch[1], rest: sqMatch[2].trim() };
  }

  // Consume identifier characters including quoted parts `"..."` and dots `.`
  let i = 0;
  let inQuotes = false;
  while (i < s.length) {
    const ch = s[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
      i++;
      continue;
    }
    if (inQuotes) {
      i++;
      continue;
    }
    if (/[A-Za-z0-9_.$#:\/`\[\]-]/.test(ch)) {
      i++;
      continue;
    }
    // Allow whitespace around '.' in `SCHEMA . TABLE`
    if (/\s/.test(ch)) {
      const afterSpace = s.substring(i).trimStart();
      if (afterSpace.startsWith('.')) {
        const dotIdx = s.indexOf('.', i);
        i = dotIdx + 1;
        while (i < s.length && /\s/.test(s[i])) i++;
        continue;
      }
    }
    break;
  }

  if (i === 0) return null;
  return {
    token: s.substring(0, i).trim(),
    rest: s.substring(i).trim(),
  };
}

/**
 * Extracts table/placeholder and optional alias from a FROM or JOIN target entry like:
 * `"SAP_S4HANA"."VBAK" AS v`, `TABLE_A a`, `LATERAL __SQ_0_0__ AS sub`,
 * `"_SYS_BIC"."pkg::CV" ('PLACEHOLDER' = ('$$P$$', '1')) AS cv`
 */
function parseTableEntryAndAlias(rawEntry: string): {
  rawTable: string;
  alias: string;
} | null {
  let cleaned = unwrapOuterParens(rawEntry.trim()).replace(/^LATERAL\s+/i, '').trim();
  if (!cleaned) return null;

  const consumed = consumeLeadingTableToken(cleaned);
  if (!consumed || !consumed.token) return null;

  const rawTable = consumed.token;
  let rest = consumed.rest;

  // Skip optional SAP HANA Calculation View parameters `('PLACEHOLDER' = ...)` or table hints
  while (rest.startsWith('(')) {
    const closeIdx = findMatchingCloseParen(rest, 0);
    if (closeIdx > 0) {
      rest = rest.substring(closeIdx + 1).trim();
    } else {
      break;
    }
  }

  if (!rest) {
    return { rawTable, alias: '' };
  }

  // Check for explicit `AS <alias>`
  const asMatch = rest.match(/^AS\s+("[^"]+"|[A-Za-z0-9_$`\[\]-]+)/i);
  if (asMatch) {
    return { rawTable, alias: stripQuotes(asMatch[1]) };
  }

  // Check for implicit `<alias>`
  const implicitMatch = rest.match(/^("[^"]+"|[A-Za-z0-9_$`\[\]-]+)/i);
  if (implicitMatch) {
    const candidate = stripQuotes(implicitMatch[1]);
    if (candidate && !NON_ALIAS_SQL_KEYWORDS.has(candidate.toUpperCase())) {
      return { rawTable, alias: candidate };
    }
  }

  return { rawTable, alias: '' };
}

interface QueryBranch {
  branchIndex: number;
  branchType:
    | 'SELECT'
    | 'UNION'
    | 'UNION ALL'
    | 'EXCEPT'
    | 'EXCEPT ALL'
    | 'INTERSECT'
    | 'INTERSECT ALL'
    | 'MINUS'
    | 'CTE';
  branchLabel: string;
  sql: string;
}

/**
 * Splits a SQL query block into top-level set operation branches (UNION / UNION ALL / INTERSECT / EXCEPT / MINUS)
 * while respecting parentheses and quotes.
 */
function splitIntoBranches(sqlBlock: string): QueryBranch[] {
  const unwrapped = unwrapOuterParens(sqlBlock);
  const branches: QueryBranch[] = [];

  let currentStart = 0;
  let parenDepth = 0;
  let inQuotes = false;
  let quoteChar = '';
  let currentBranchType: QueryBranch['branchType'] = 'SELECT';
  let branchCount = 1;

  for (let i = 0; i < unwrapped.length; i++) {
    const char = unwrapped[i];
    if (!inQuotes && (char === "'" || char === '"')) {
      inQuotes = true;
      quoteChar = char;
      continue;
    }
    if (inQuotes) {
      if (char === quoteChar) inQuotes = false;
      continue;
    }
    if (char === '(') {
      parenDepth++;
      continue;
    }
    if (char === ')') {
      parenDepth = Math.max(0, parenDepth - 1);
      continue;
    }

    if (parenDepth === 0) {
      const remaining = unwrapped.substring(i);
      const opMatch = remaining.match(
        /^(\b(?:UNION\s+ALL|UNION(?:\s+DISTINCT)?|EXCEPT\s+ALL|EXCEPT|INTERSECT\s+ALL|INTERSECT|MINUS)\b)/i
      );
      if (opMatch && (i === 0 || /[\s);]/.test(unwrapped[i - 1]))) {
        const opStr = opMatch[1].toUpperCase().replace(/\s+/g, ' ');
        const branchSql = unwrapOuterParens(unwrapped.substring(currentStart, i).trim());
        if (branchSql) {
          branches.push({
            branchIndex: branchCount,
            branchType: currentBranchType,
            branchLabel:
              branchCount === 1
                ? 'Branch 1 (Initial SELECT)'
                : `Branch ${branchCount} (${currentBranchType})`,
            sql: branchSql,
          });
          branchCount++;
        }

        if (opStr.includes('UNION ALL')) currentBranchType = 'UNION ALL';
        else if (opStr.includes('UNION')) currentBranchType = 'UNION';
        else if (opStr.includes('EXCEPT ALL')) currentBranchType = 'EXCEPT ALL';
        else if (opStr.includes('EXCEPT') || opStr.includes('MINUS')) currentBranchType = 'EXCEPT';
        else if (opStr.includes('INTERSECT ALL')) currentBranchType = 'INTERSECT ALL';
        else if (opStr.includes('INTERSECT')) currentBranchType = 'INTERSECT';
        else currentBranchType = 'UNION';

        i += opMatch[1].length - 1;
        currentStart = i + 1;
      }
    }
  }

  const lastBranchSql = unwrapOuterParens(unwrapped.substring(currentStart).trim());
  if (lastBranchSql) {
    branches.push({
      branchIndex: branchCount,
      branchType: currentBranchType,
      branchLabel:
        branchCount === 1
          ? 'Branch 1 (Initial SELECT)'
          : `Branch ${branchCount} (${currentBranchType})`,
      sql: lastBranchSql,
    });
  }

  return branches;
}

/**
 * Splits comma-separated items at parenDepth === 0 while respecting quotes
 */
function splitTopLevelCommas(text: string): string[] {
  const items: string[] = [];
  let current = '';
  let depth = 0;
  let inQuotes = false;
  let quoteChar = '';

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (!inQuotes && (ch === "'" || ch === '"')) {
      inQuotes = true;
      quoteChar = ch;
      current += ch;
      continue;
    }
    if (inQuotes) {
      current += ch;
      if (ch === quoteChar) inQuotes = false;
      continue;
    }
    if (ch === '(') {
      depth++;
      current += ch;
      continue;
    }
    if (ch === ')') {
      depth = Math.max(0, depth - 1);
      current += ch;
      continue;
    }
    if (ch === ',' && depth === 0) {
      if (current.trim()) items.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }

  if (current.trim()) items.push(current.trim());
  return items;
}

/**
 * Scans `maskedSql` at `parenDepth === 0` (outside quotes) to reliably locate
 * the `SELECT` list, the `FROM + JOIN` section, the `WHERE` section, and the `HAVING` section.
 * Never gets confused by `FROM` inside `TRIM(... FROM ...)` or `EXTRACT(YEAR FROM ...)` or `"Valid From"`.
 */
function extractTopLevelClauses(maskedSql: string): {
  selectClause: string;
  fromAndJoinsClause: string;
  whereClause: string;
  havingClause: string;
} {
  let parenDepth = 0;
  let inQuotes = false;
  let quoteChar = '';

  let selectStart = -1;
  let fromStart = -1;
  let fromBodyStart = -1;
  let whereStart = -1;
  let whereBodyStart = -1;
  let havingStart = -1;
  let havingBodyStart = -1;
  let postFromClauseStart = -1;
  let postWhereClauseStart = -1;
  let postHavingClauseStart = -1;

  const len = maskedSql.length;

  for (let i = 0; i < len; i++) {
    const ch = maskedSql[i];

    if (!inQuotes && (ch === "'" || ch === '"')) {
      inQuotes = true;
      quoteChar = ch;
      continue;
    }
    if (inQuotes) {
      if (ch === quoteChar) inQuotes = false;
      continue;
    }
    if (ch === '(') {
      parenDepth++;
      continue;
    }
    if (ch === ')') {
      parenDepth = Math.max(0, parenDepth - 1);
      continue;
    }

    if (parenDepth !== 0) continue;

    if (ch === ';') {
      if (fromStart !== -1 && postFromClauseStart === -1) postFromClauseStart = i;
      if (whereStart !== -1 && postWhereClauseStart === -1) postWhereClauseStart = i;
      if (havingStart !== -1 && postHavingClauseStart === -1) postHavingClauseStart = i;
      break;
    }

    // Check word boundary before index i
    const prevChar = i > 0 ? maskedSql[i - 1] : ' ';
    if (/[A-Za-z0-9_"]/.test(prevChar)) continue;

    const rem = maskedSql.substring(i);

    if (selectStart === -1) {
      const selMatch = rem.match(/^SELECT\b/i);
      if (selMatch) {
        selectStart = i + selMatch[0].length;
        i += selMatch[0].length - 1;
        continue;
      }
    }

    if (fromStart === -1) {
      const frmMatch = rem.match(/^FROM\b/i);
      if (frmMatch && !/[."]/.test(maskedSql[i + frmMatch[0].length] || '')) {
        fromStart = i;
        fromBodyStart = i + frmMatch[0].length;
        i += frmMatch[0].length - 1;
        continue;
      }
    } else {
      // Once after FROM, look for WHERE, GROUP BY, HAVING, QUALIFY, WINDOW, ORDER BY, LIMIT, OFFSET, FOR UPDATE
      if (whereStart === -1 && postFromClauseStart === -1) {
        const whMatch = rem.match(/^WHERE\b/i);
        if (whMatch && !/[."]/.test(maskedSql[i + whMatch[0].length] || '')) {
          whereStart = i;
          whereBodyStart = i + whMatch[0].length;
          postFromClauseStart = i;
          i += whMatch[0].length - 1;
          continue;
        }
      }

      if (havingStart === -1) {
        const havMatch = rem.match(/^HAVING\b/i);
        if (havMatch && !/[."]/.test(maskedSql[i + havMatch[0].length] || '')) {
          havingStart = i;
          havingBodyStart = i + havMatch[0].length;
          if (postFromClauseStart === -1) postFromClauseStart = i;
          if (whereStart !== -1 && postWhereClauseStart === -1) postWhereClauseStart = i;
          i += havMatch[0].length - 1;
          continue;
        }
      }

      const endClauseMatch = rem.match(
        /^(?:GROUP\s+BY|QUALIFY|WINDOW|ORDER\s+BY|LIMIT|OFFSET|FETCH\s+(?:FIRST|NEXT)|FOR\s+UPDATE)\b/i
      );
      if (endClauseMatch && !/[."]/.test(maskedSql[i + endClauseMatch[0].length] || '')) {
        if (postFromClauseStart === -1) postFromClauseStart = i;
        if (whereStart !== -1 && postWhereClauseStart === -1) postWhereClauseStart = i;
        if (havingStart !== -1 && postHavingClauseStart === -1) postHavingClauseStart = i;
        i += endClauseMatch[0].length - 1;
        continue;
      }
    }
  }

  const selectClause =
    selectStart !== -1 && fromStart !== -1 && fromStart > selectStart
      ? maskedSql.substring(selectStart, fromStart).trim()
      : '';

  const fromAndJoinsClause =
    fromBodyStart !== -1
      ? maskedSql
          .substring(fromBodyStart, postFromClauseStart !== -1 ? postFromClauseStart : len)
          .trim()
      : '';

  const whereClause =
    whereBodyStart !== -1
      ? maskedSql
          .substring(whereBodyStart, postWhereClauseStart !== -1 ? postWhereClauseStart : len)
          .trim()
      : '';

  const havingClause =
    havingBodyStart !== -1
      ? maskedSql
          .substring(havingBodyStart, postHavingClauseStart !== -1 ? postHavingClauseStart : len)
          .trim()
      : '';

  return { selectClause, fromAndJoinsClause, whereClause, havingClause };
}

/**
 * Unwraps parenthesized join groups inside `fromAndJoinsClause`, such as:
 * `FROM (A a INNER JOIN B b ON a.id = b.id) LEFT OUTER JOIN C c ON a.id = c.id`
 * while preserving `ON (...)`, `USING (...)`, and HANA Calculation View parameters `('PLACEHOLDER' = ...)`.
 */
function unwrapParenthesizedJoins(fromClause: string): string {
  let current = fromClause.trim();
  let changed = true;
  let guard = 0;

  while (changed && guard < 20) {
    changed = false;
    guard++;
    let res = '';
    let i = 0;
    let inQuotes = false;
    let quoteChar = '';

    while (i < current.length) {
      const ch = current[i];
      if (!inQuotes && (ch === "'" || ch === '"')) {
        inQuotes = true;
        quoteChar = ch;
        res += ch;
        i++;
        continue;
      }
      if (inQuotes) {
        res += ch;
        if (ch === quoteChar) inQuotes = false;
        i++;
        continue;
      }

      if (ch === '(') {
        const closeIdx = findMatchingCloseParen(current, i);
        if (closeIdx > i) {
          const before = current.substring(0, i).trimEnd();
          const isAfterJoinOrStartOrComma =
            before.length === 0 ||
            before.endsWith(',') ||
            /\b(?:JOIN|LATERAL)\s*$/i.test(before);

          const inner = current.substring(i + 1, closeIdx).trim();
          const containsJoinKeyword = /\bJOIN\b/i.test(inner);

          if (isAfterJoinOrStartOrComma && (containsJoinKeyword || /^__SQ_[A-Za-z0-9_]+__/i.test(inner))) {
            res += ` ${inner} `;
            i = closeIdx + 1;
            changed = true;
            continue;
          }
        }
      }

      res += ch;
      i++;
    }
    current = res.trim();
  }

  return current;
}

interface FromJoinSegment {
  role: 'FROM' | 'INNER JOIN' | 'LEFT JOIN' | 'RIGHT JOIN' | 'FULL JOIN' | 'CROSS JOIN';
  targetPart: string; // `<table_or_subquery> [AS alias]`
  onCondition: string; // `a.id = b.id` (empty for base FROM)
}

/**
 * Splits `fromAndJoinsClause` at `parenDepth === 0` into ordered `FromJoinSegment` items.
 * Handles comma joins, INNER JOIN, LEFT [OUTER] JOIN, RIGHT [OUTER] JOIN, FULL [OUTER] JOIN,
 * OUTER JOIN, CROSS JOIN, NATURAL JOIN, and JOIN.
 */
function parseFromAndJoinSegments(rawFromAndJoins: string): FromJoinSegment[] {
  const flattened = unwrapParenthesizedJoins(rawFromAndJoins);
  if (!flattened) return [];

  const rawChunks: Array<{
    role: FromJoinSegment['role'];
    body: string;
  }> = [];

  let currentRole: FromJoinSegment['role'] = 'FROM';
  let chunkStart = 0;
  let parenDepth = 0;
  let inQuotes = false;
  let quoteChar = '';
  const len = flattened.length;

  for (let i = 0; i < len; i++) {
    const ch = flattened[i];

    if (!inQuotes && (ch === "'" || ch === '"')) {
      inQuotes = true;
      quoteChar = ch;
      continue;
    }
    if (inQuotes) {
      if (ch === quoteChar) inQuotes = false;
      continue;
    }
    if (ch === '(') {
      parenDepth++;
      continue;
    }
    if (ch === ')') {
      parenDepth = Math.max(0, parenDepth - 1);
      continue;
    }

    if (parenDepth !== 0) continue;

    // Top-level comma in FROM clause
    if (ch === ',') {
      const body = flattened.substring(chunkStart, i).trim();
      if (body) {
        rawChunks.push({ role: currentRole, body });
      }
      currentRole = rawChunks.length === 0 ? 'FROM' : 'CROSS JOIN';
      chunkStart = i + 1;
      continue;
    }

    // Check word boundary before index i
    const prevChar = i > 0 ? flattened[i - 1] : ' ';
    if (/[A-Za-z0-9_."]/.test(prevChar)) continue;

    const rem = flattened.substring(i);
    const joinKwMatch = rem.match(
      /^(?:NATURAL\s+)?(INNER\s+JOIN|LEFT\s+(?:OUTER\s+)?JOIN|RIGHT\s+(?:OUTER\s+)?JOIN|FULL\s+(?:OUTER\s+)?JOIN|OUTER\s+JOIN|CROSS\s+JOIN|JOIN)\b/i
    );

    if (joinKwMatch && !/[."]/.test(flattened[i + joinKwMatch[0].length] || '')) {
      const body = flattened.substring(chunkStart, i).trim();
      if (body) {
        rawChunks.push({ role: currentRole, body });
      }

      const kwUpper = joinKwMatch[1].toUpperCase().replace(/\s+/g, ' ');
      if (kwUpper.includes('LEFT') || kwUpper === 'OUTER JOIN') currentRole = 'LEFT JOIN';
      else if (kwUpper.includes('RIGHT')) currentRole = 'RIGHT JOIN';
      else if (kwUpper.includes('FULL')) currentRole = 'FULL JOIN';
      else if (kwUpper.includes('CROSS')) currentRole = 'CROSS JOIN';
      else currentRole = 'INNER JOIN';

      i += joinKwMatch[0].length - 1;
      chunkStart = i + 1;
    }
  }

  const finalBody = flattened.substring(chunkStart).trim();
  if (finalBody) {
    rawChunks.push({ role: currentRole, body: finalBody });
  }

  // Now split each chunk's `body` into `targetPart` and `onCondition` at top-level `ON` or `USING`
  return rawChunks.map((chunk) => {
    const body = chunk.body;
    let depth = 0;
    let quotes = false;
    let qChar = '';
    let onSplitIdx = -1;
    let onExprStart = -1;
    let isUsing = false;

    for (let k = 0; k < body.length; k++) {
      const c = body[k];
      if (!quotes && (c === "'" || c === '"')) {
        quotes = true;
        qChar = c;
        continue;
      }
      if (quotes) {
        if (c === qChar) quotes = false;
        continue;
      }
      if (c === '(') {
        depth++;
        continue;
      }
      if (c === ')') {
        depth = Math.max(0, depth - 1);
        continue;
      }

      if (depth !== 0) continue;

      const prev = k > 0 ? body[k - 1] : ' ';
      if (/[A-Za-z0-9_."]/.test(prev)) continue;

      const sub = body.substring(k);
      const onMatch = sub.match(/^ON(?:\b|(?=\())/i);
      if (onMatch && !/[."]/.test(body[k + 2] || '')) {
        onSplitIdx = k;
        onExprStart = k + 2;
        break;
      }

      const usingMatch = sub.match(/^USING\s*(?=\()/i);
      if (usingMatch) {
        onSplitIdx = k;
        onExprStart = k + usingMatch[0].length;
        isUsing = true;
        break;
      }
    }

    if (onSplitIdx !== -1) {
      const targetPart = body.substring(0, onSplitIdx).trim();
      let onCond = body.substring(onExprStart).trim();
      if (isUsing) {
        onCond = `USING ${onCond}`;
      }
      return {
        role: chunk.role,
        targetPart,
        onCondition: onCond,
      };
    }

    return {
      role: chunk.role,
      targetPart: body,
      onCondition: '',
    };
  });
}

/**
 * Extracts all `[schema.]tableOrAlias.column` references from a SQL snippet.
 * Properly handles 3-part `SCHEMA.TABLE.COLUMN` as well as 2-part `ALIAS.COLUMN`.
 */
function extractQualifiedColumnRefs(sqlSnippet: string): Array<{
  qualifier: string;
  column: string;
}> {
  const results: Array<{ qualifier: string; column: string }> = [];

  // Match 2-part or 3-part dotted identifiers: e.g. "SAP"."VBAK"."VBELN" or v."VBELN" or v.VBELN
  const dotChainRegex =
    /(?:"[^"]+"|[A-Za-z0-9_$#:\/-]+)(?:\s*\.\s*(?:"[^"]+"|[A-Za-z0-9_$#:*\/-]+)){1,2}/g;

  let m: RegExpExecArray | null;
  while ((m = dotChainRegex.exec(sqlSnippet)) !== null) {
    const parts = splitIdentifierByDot(m[0]);
    if (parts.length === 3) {
      // SCHEMA.TABLE.COLUMN -> qualifier is TABLE (and also SCHEMA.TABLE)
      const tableQualifier = stripQuotes(parts[1]);
      const fullQualifier = `${stripQuotes(parts[0])}.${tableQualifier}`;
      const col = stripQuotes(parts[2]);
      if (tableQualifier && col) {
        results.push({ qualifier: tableQualifier, column: col });
        results.push({ qualifier: fullQualifier, column: col });
      }
    } else if (parts.length === 2) {
      const qualifier = stripQuotes(parts[0]);
      const col = stripQuotes(parts[1]);
      if (qualifier && col && !/^\d+$/.test(qualifier)) {
        results.push({ qualifier, column: col });
      }
    }
  }

  return results;
}

interface ScopeParseResult {
  scopeNodes: TableNodeData[];
  terminalNodes: TableNodeData[];
  aliasMap: Map<string, string>;
  tableNameMap: Map<string, string>;
  branchCount: number;
}

/**
 * Recursively parses a SQL query or subquery scope, extracting all FROM tables,
 * FROM (SELECT ...) derived subqueries, JOIN tables, JOIN (SELECT ...) subqueries,
 * WHERE conditions (including WHERE IN/EXISTS/scalar subqueries), SELECT/ON subqueries, and UNION branches.
 */
function parseQueryScope(
  rawScopeSql: string,
  scopeId: string,
  scopeLabel: string,
  nodes: TableNodeData[],
  edges: TableEdgeData[],
  subqueryGroups: SubqueryGroupBox[],
  globalWhereConditions: string[],
  strings: string[],
  cteNodeMap: Map<string, TableNodeData>,
  depth: number = 0,
  parentScopeGroupId?: string
): ScopeParseResult {
  if (depth > 14) {
    return {
      scopeNodes: [],
      terminalNodes: [],
      aliasMap: new Map(),
      tableNameMap: new Map(),
      branchCount: 0,
    };
  }

  let workingSql = unwrapOuterParens(rawScopeSql);

  // 1. Check for leading WITH clause (CTEs) at this scope level
  const preMask = maskDirectSubqueries(workingSql, `${scopeId}_with`);
  if (/^\s*WITH\b/i.test(preMask.maskedSql)) {
    const withoutWithKeyword = preMask.maskedSql.replace(/^\s*WITH\s+(?:RECURSIVE\s+)?/i, '');
    // Match CTE definitions: `cte_name [(col1, col2)] AS __SQ_...__`
    const cteDefRegex =
      /("[^"]+"|[A-Za-z0-9_$`\[\]-]+)(?:\s*\([^)]*\))?\s+AS\s+(__SQ_[A-Za-z0-9_]+__)/gi;
    let cteMatch: RegExpExecArray | null;
    let lastCteEnd = 0;

    while ((cteMatch = cteDefRegex.exec(withoutWithKeyword)) !== null) {
      // Verify that before this match (after previous CTE) there is only whitespace or comma
      const between = withoutWithKeyword.substring(lastCteEnd, cteMatch.index).trim();
      if (lastCteEnd > 0 && between !== ',') {
        break;
      }

      const cteName = stripQuotes(cteMatch[1]);
      const placeholder = cteMatch[2];
      lastCteEnd = cteMatch.index + cteMatch[0].length;

      const cteInnerSql = preMask.subqueryMap.get(placeholder);
      if (cteInnerSql) {
        const cteGroupId = `GROUP_CTE_${scopeId}_${cteName}_${subqueryGroups.length + 1}`;
        const cteRes = parseQueryScope(
          cteInnerSql,
          `${scopeId}_cte_${cteName.replace(/[^A-Za-z0-9]/g, '')}`,
          `CTE (${cteName})`,
          nodes,
          edges,
          subqueryGroups,
          globalWhereConditions,
          strings,
          cteNodeMap,
          depth + 1,
          cteGroupId
        );

        const cteNodeId = `CTE_${scopeId}_${cteName.toUpperCase()}_${nodes.length + 1}`;
        const innerTables = cteRes.scopeNodes
          .filter((n) => !n.isOperator)
          .map((n) => (n.alias ? `${n.tableName} (${n.alias})` : n.tableName));
        const innerJoins = cteRes.scopeNodes
          .filter((n) => n.joinType.includes('JOIN'))
          .map((n) => `${n.joinType} ${n.tableName}`);

        const cteNode: TableNodeData = {
          id: cteNodeId,
          tableName: cteName,
          fullTableName: `CTE: ${cteName}`,
          alias: cteName,
          displayName: `CTE: ${cteName}`,
          joinType: 'CTE',
          whereConditions: [],
          columns: [],
          isRoot: false,
          orderIndex: nodes.length,
          branchName: `CTE Definition (${cteName})`,
          scopeGroupId: cteGroupId,
          isSubqueryResult: true,
          innerTableNames: innerTables,
          innerJoinSummary: innerJoins,
          subquerySql: restoreStrings(cteInnerSql, strings).trim(),
        };
        nodes.push(cteNode);

        cteRes.terminalNodes.forEach((termNode) => {
          edges.push({
            id: `EDGE_CTE_${termNode.id}_TO_${cteNode.id}_${edges.length}`,
            sourceId: termNode.id,
            targetId: cteNode.id,
            sourceName: termNode.displayName,
            targetName: cteNode.displayName,
            sourceAlias: termNode.alias,
            targetAlias: cteNode.alias,
            joinType: 'CTE OUTPUT',
            onCondition: `Feeds into CTE ${cteName}`,
            detailedConditions: [`Subquery result materializes CTE ${cteName}`],
            isSubqueryEdge: true,
          });
        });

        subqueryGroups.push({
          id: cteGroupId,
          label: `CTE: ${cteName}`,
          alias: cteName,
          role: 'CTE',
          nodeIds: [...cteRes.scopeNodes.map((n) => n.id), cteNode.id],
          x: 0,
          y: 0,
          width: 0,
          height: 0,
        });

        cteNodeMap.set(cteName.toUpperCase(), cteNode);
      }
    }

    if (lastCteEnd > 0) {
      let remainder = withoutWithKeyword.substring(lastCteEnd).replace(/^\s*,\s*/, '').trim();
      preMask.subqueryMap.forEach((inner, ph) => {
        remainder = remainder.split(ph).join(`(${inner})`);
      });
      workingSql = unwrapOuterParens(remainder);
    }
  }

  // 2. Split workingSql into UNION / INTERSECT / EXCEPT branches
  const branches = splitIntoBranches(workingSql);
  const isMultiBranch = branches.length > 1;

  const allScopeNodes: TableNodeData[] = [];
  const branchTerminalNodes: TableNodeData[] = [];
  const combinedAliasMap = new Map<string, string>();
  const combinedTableNameMap = new Map<string, string>();

  branches.forEach((branch) => {
    const branchScopeId = `${scopeId}_B${branch.branchIndex}`;
    const cleanBranchSql = unwrapOuterParens(branch.sql);
    const { maskedSql, subqueryMap } = maskDirectSubqueries(cleanBranchSql, branchScopeId);
    const visitedPlaceholders = new Set<string>();

    const branchTableAliasMap = new Map<string, string>();
    const branchTableNameMap = new Map<string, string>();
    const branchNodes: TableNodeData[] = [];

    const effectiveBranchLabel = scopeLabel
      ? isMultiBranch
        ? `${scopeLabel} • Branch ${branch.branchIndex}`
        : scopeLabel
      : branch.branchLabel;

    /**
     * Helper to build a Subquery Result node (for FROM (SELECT ...) or JOIN (SELECT ...))
     * and wire all of its inner tables and inner/outer joins into it.
     */
    const buildDerivedSubqueryNode = (
      placeholder: string,
      subAlias: string,
      role: FromJoinSegment['role'],
      isFirstFromItem: boolean
    ): TableNodeData | null => {
      const innerSql = subqueryMap.get(placeholder);
      if (!innerSql) return null;
      visitedPlaceholders.add(placeholder);

      const subContextLabel =
        role === 'FROM'
          ? subAlias
            ? `Subquery in FROM (${subAlias})`
            : 'Subquery in FROM'
          : subAlias
          ? `Subquery in ${role} (${subAlias})`
          : `Subquery in ${role}`;

      const sqGroupId = `GROUP_SQ_${branchScopeId}_${subqueryGroups.length + 1}`;

      const subResult = parseQueryScope(
        innerSql,
        `${branchScopeId}_${placeholder.replace(/[^A-Za-z0-9]/g, '')}`,
        subContextLabel,
        nodes,
        edges,
        subqueryGroups,
        globalWhereConditions,
        strings,
        cteNodeMap,
        depth + 1,
        sqGroupId
      );

      // Extract projected column names/aliases from the subquery SELECT list
      const projectedCols: string[] = [];
      const innerMasked = maskDirectSubqueries(innerSql, 'proj');
      const innerClauses = extractTopLevelClauses(innerMasked.maskedSql);
      if (innerClauses.selectClause) {
        const cleanedSelect = innerClauses.selectClause.replace(
          /^(?:DISTINCT\s+|ALL\s+|TOP\s+\d+\s+)*/i,
          ''
        );
        const projItems = splitTopLevelCommas(cleanedSelect);
        projItems.forEach((item) => {
          const asMatch = item.match(/\bAS\s+("[^"]+"|[A-Za-z0-9_$`\[\]]+)\s*$/i);
          if (asMatch) {
            projectedCols.push(stripQuotes(asMatch[1]));
          } else {
            const parts = splitIdentifierByDot(item.trim());
            const lastPart = stripQuotes(parts[parts.length - 1] || '');
            if (lastPart && lastPart !== '*' && !/[()\s]/.test(lastPart)) {
              projectedCols.push(lastPart);
            }
          }
        });
      }

      const innerTables = subResult.scopeNodes
        .filter((n) => !n.isOperator)
        .map((n) => (n.alias ? `${n.tableName} (${n.alias})` : n.tableName));
      const innerJoins = subResult.scopeNodes
        .filter((n) => n.joinType.includes('JOIN') && !n.isSubqueryResult)
        .map((n) => `${n.joinType} ${n.tableName}`);

      const sqNodeId = `SQ_${branchScopeId}_${subAlias || 'DERIVED'}_${nodes.length + 1}`;
      const sqTableName = subAlias
        ? `${role === 'FROM' ? 'FROM' : role} Subquery (${subAlias})`
        : role === 'FROM'
        ? 'FROM Subquery (SELECT ...)'
        : `${role} Subquery (SELECT ...)`;
      const sqDisplayName = subAlias
        ? `Subquery (${subAlias})`
        : role === 'FROM'
        ? 'FROM Subquery'
        : `${role} Subquery`;

      let sqJoinBadge: TableNodeData['joinType'] = 'FROM SUBQUERY';
      if (role === 'INNER JOIN') sqJoinBadge = 'INNER JOIN SUBQUERY';
      else if (role === 'LEFT JOIN') sqJoinBadge = 'LEFT JOIN SUBQUERY';
      else if (role === 'RIGHT JOIN') sqJoinBadge = 'RIGHT JOIN SUBQUERY';
      else if (role === 'FULL JOIN') sqJoinBadge = 'FULL JOIN SUBQUERY';
      else if (role !== 'FROM') sqJoinBadge = 'JOIN SUBQUERY';

      const fullDesc =
        innerTables.length > 0
          ? `Subquery Tables: ${innerTables.join(', ')}`
          : 'Derived Table (SELECT ...)';

      const sqNode: TableNodeData = {
        id: sqNodeId,
        tableName: sqTableName,
        fullTableName: fullDesc,
        alias: subAlias,
        displayName: sqDisplayName,
        joinType: sqJoinBadge,
        whereConditions: [],
        columns: projectedCols,
        isRoot: isFirstFromItem && subResult.scopeNodes.length === 0,
        orderIndex: nodes.length,
        branchIndex: branch.branchIndex,
        branchName: effectiveBranchLabel || subContextLabel,
        scopeGroupId: sqGroupId,
        isSubqueryResult: true,
        innerTableNames: innerTables,
        innerJoinSummary: innerJoins,
        subquerySql: restoreStrings(innerSql, strings).trim(),
      };

      nodes.push(sqNode);
      branchNodes.push(sqNode);
      allScopeNodes.push(sqNode);

      // Connect all terminal/leaf nodes of the inner subquery into this Derived Subquery node
      subResult.terminalNodes.forEach((innerTerm) => {
        edges.push({
          id: `EDGE_SQ_OUT_${innerTerm.id}_TO_${sqNode.id}_${edges.length}`,
          sourceId: innerTerm.id,
          targetId: sqNode.id,
          sourceName: innerTerm.displayName,
          targetName: sqNode.displayName,
          sourceAlias: innerTerm.alias,
          targetAlias: sqNode.alias,
          joinType: 'SUBQUERY OUTPUT',
          onCondition: subAlias
            ? `Output of ${innerTerm.tableName} ➔ Subquery (${subAlias})`
            : `Output of ${innerTerm.tableName} ➔ ${sqDisplayName}`,
          detailedConditions: [
            subAlias
              ? `Inner subquery table "${innerTerm.displayName}" feeds derived table "${subAlias}"`
              : `Inner subquery table "${innerTerm.displayName}" feeds derived ${role} subquery`,
          ],
          isSubqueryEdge: true,
        });
      });

      // Record visual Subquery Group Box covering the subquery's inner nodes + derived result node
      subqueryGroups.push({
        id: sqGroupId,
        label: subContextLabel,
        alias: subAlias,
        role,
        nodeIds: [...subResult.scopeNodes.map((n) => n.id), sqNode.id],
        x: 0,
        y: 0,
        width: 0,
        height: 0,
      });

      // Register the subquery alias (and inner table aliases/names as fallback) to point to sqNode
      if (subAlias) {
        branchTableAliasMap.set(subAlias.toUpperCase(), sqNode.id);
        combinedAliasMap.set(subAlias.toUpperCase(), sqNode.id);
      }
      subResult.aliasMap.forEach((_innerId, innerAlias) => {
        if (!branchTableAliasMap.has(innerAlias)) {
          branchTableAliasMap.set(innerAlias, sqNode.id);
        }
      });
      subResult.tableNameMap.forEach((_innerId, innerTbl) => {
        if (!branchTableNameMap.has(innerTbl)) {
          branchTableNameMap.set(innerTbl, sqNode.id);
        }
      });

      return sqNode;
    };

    // 3. Extract top-level clauses (SELECT, FROM + JOINs, WHERE, HAVING)
    const { selectClause, fromAndJoinsClause, whereClause, havingClause } =
      extractTopLevelClauses(maskedSql);

    // 3a & 3b. Parse all FROM items and JOIN segments in order
    const segments = parseFromAndJoinSegments(fromAndJoinsClause);

    segments.forEach((seg, segIdx) => {
      const parsedTarget = parseTableEntryAndAlias(seg.targetPart);
      if (!parsedTarget) return;

      const { rawTable, alias } = parsedTarget;
      let currentNode: TableNodeData | null = null;

      // Check if target is a masked subquery `__SQ_...__`
      const sqPhMatch = rawTable.match(/(__SQ_[A-Za-z0-9_]+__)/);
      if (sqPhMatch) {
        currentNode = buildDerivedSubqueryNode(sqPhMatch[1], alias, seg.role, segIdx === 0);
      } else {
        const { schema, table, fullName } = parseSchemaAndTable(rawTable);
        if (!table || ['(', 'SELECT', 'LATERAL', 'UNNEST'].includes(table.toUpperCase())) {
          return;
        }

        const matchingCte = cteNodeMap.get(table.toUpperCase());
        const occurrenceNumber = nodes.length + 1;
        const nodeId = `TBL_${branchScopeId}_S${segIdx + 1}_${table
          .toUpperCase()
          .replace(/[^A-Z0-9_]/g, '')}${alias ? '_' + alias : ''}_${occurrenceNumber}`;
        const branchPrefix = isMultiBranch && depth === 0 ? `[Branch ${branch.branchIndex}] ` : '';
        const displayName = alias
          ? `${branchPrefix}${fullName} (${alias})`
          : `${branchPrefix}${fullName}`;

        currentNode = {
          id: nodeId,
          tableName: table,
          schemaName: schema,
          fullTableName: fullName,
          alias,
          displayName,
          joinType: seg.role,
          whereConditions: [],
          columns: [],
          isRoot: segIdx === 0 && depth === 0 && !matchingCte,
          orderIndex: nodes.length,
          branchIndex: branch.branchIndex,
          branchName: effectiveBranchLabel,
          scopeGroupId: parentScopeGroupId,
        };

        nodes.push(currentNode);
        branchNodes.push(currentNode);
        allScopeNodes.push(currentNode);

        if (matchingCte) {
          edges.push({
            id: `EDGE_CTE_REF_${matchingCte.id}_TO_${currentNode.id}_${edges.length}`,
            sourceId: matchingCte.id,
            targetId: currentNode.id,
            sourceName: matchingCte.displayName,
            targetName: currentNode.displayName,
            sourceAlias: matchingCte.alias,
            targetAlias: currentNode.alias,
            joinType: 'FROM CTE',
            onCondition: `Reads from CTE ${matchingCte.tableName}`,
            detailedConditions: [`References Common Table Expression ${matchingCte.tableName}`],
            isSubqueryEdge: true,
          });
        }

        if (alias) {
          branchTableAliasMap.set(alias.toUpperCase(), nodeId);
          combinedAliasMap.set(alias.toUpperCase(), nodeId);
        }
        branchTableNameMap.set(table.toUpperCase(), nodeId);
        branchTableNameMap.set(fullName.toUpperCase(), nodeId);
        if (schema) {
          branchTableNameMap.set(`${schema.toUpperCase()}.${table.toUpperCase()}`, nodeId);
        }
        combinedTableNameMap.set(table.toUpperCase(), nodeId);
        combinedTableNameMap.set(fullName.toUpperCase(), nodeId);
      }

      if (!currentNode) return;

      // If this segment is a JOIN (or comma CROSS JOIN after the first FROM item), connect its edge(s)
      if (segIdx > 0 || seg.role !== 'FROM') {
        const rawOn = seg.onCondition;

        if (rawOn) {
          // Check if the ON condition itself contains any subqueries (e.g. `ON a.id = b.id AND a.ver = (SELECT MAX(ver) FROM ...)`)
          const onSqMatches = Array.from(rawOn.matchAll(/(__SQ_[A-Za-z0-9_]+__)/g));
          for (const onSqMatch of onSqMatches) {
            const ph = onSqMatch[1];
            const sqInner = subqueryMap.get(ph);
            if (sqInner && !visitedPlaceholders.has(ph)) {
              visitedPlaceholders.add(ph);
              const onSqGroupId = `GROUP_ONSQ_${branchScopeId}_${subqueryGroups.length + 1}`;
              const onSqRes = parseQueryScope(
                sqInner,
                `${branchScopeId}_${ph.replace(/[^A-Za-z0-9]/g, '')}`,
                `Subquery in JOIN ON`,
                nodes,
                edges,
                subqueryGroups,
                globalWhereConditions,
                strings,
                cteNodeMap,
                depth + 1,
                onSqGroupId
              );
              onSqRes.terminalNodes.forEach((sqTerm) => {
                edges.push({
                  id: `EDGE_ON_SQ_${sqTerm.id}_TO_${currentNode!.id}_${edges.length}`,
                  sourceId: sqTerm.id,
                  targetId: currentNode!.id,
                  sourceName: sqTerm.displayName,
                  targetName: currentNode!.displayName,
                  sourceAlias: sqTerm.alias,
                  targetAlias: currentNode!.alias,
                  joinType: 'ON SUBQUERY',
                  onCondition: formatSubqueryPlaceholders(restoreStrings(rawOn, strings)),
                  detailedConditions: [formatSubqueryPlaceholders(restoreStrings(rawOn, strings))],
                  isSubqueryEdge: true,
                });
              });
            }
          }

          const restoredOnCondition = formatSubqueryPlaceholders(
            restoreStrings(rawOn, strings).trim()
          );

          const qualRefs = extractQualifiedColumnRefs(rawOn);
          const referencedSourceIds = new Set<string>();

          for (const ref of qualRefs) {
            const key = ref.qualifier.toUpperCase();
            if (branchTableAliasMap.has(key)) {
              referencedSourceIds.add(branchTableAliasMap.get(key)!);
            } else if (branchTableNameMap.has(key)) {
              referencedSourceIds.add(branchTableNameMap.get(key)!);
            }
          }

          referencedSourceIds.delete(currentNode.id);

          // If no qualified prefix matched a prior node, check if any prior subquery/table projected a column mentioned in ON
          if (referencedSourceIds.size === 0) {
            const onTokens = new Set(
              Array.from(rawOn.matchAll(/\b([A-Za-z0-9_]+)\b/g)).map((m) => m[1].toUpperCase())
            );
            for (const prevNode of branchNodes) {
              if (prevNode.id === currentNode.id) continue;
              if (prevNode.columns.some((c) => onTokens.has(c.toUpperCase()))) {
                referencedSourceIds.add(prevNode.id);
              }
            }
          }

          // Fallback to the primary / previous node in this branch
          if (referencedSourceIds.size === 0) {
            const prevCandidate = branchNodes.find((n) => n.id !== currentNode!.id);
            if (prevCandidate) {
              referencedSourceIds.add(prevCandidate.id);
            }
          }

          const subConditions = restoredOnCondition
            .split(/\s+AND\s+/i)
            .map((c) => c.trim())
            .filter(Boolean);

          referencedSourceIds.forEach((sourceNodeId) => {
            if (sourceNodeId !== currentNode!.id) {
              const sourceNode = nodes.find((n) => n.id === sourceNodeId);
              edges.push({
                id: `EDGE_${sourceNodeId}_TO_${currentNode!.id}_${edges.length}`,
                sourceId: sourceNodeId,
                targetId: currentNode!.id,
                sourceName: sourceNode?.displayName || sourceNodeId,
                targetName: currentNode!.displayName,
                sourceAlias: sourceNode?.alias || '',
                targetAlias: currentNode!.alias,
                joinType: seg.role === 'FROM' ? 'INNER JOIN' : seg.role,
                onCondition: restoredOnCondition,
                detailedConditions:
                  subConditions.length > 0 ? subConditions : [restoredOnCondition],
              });
            }
          });
        } else {
          // Join without explicit ON (e.g. comma CROSS JOIN, NATURAL JOIN, or incomplete join)
          const prevNode = branchNodes.find((n) => n.id !== currentNode!.id);
          if (prevNode) {
            edges.push({
              id: `EDGE_JOIN_${prevNode.id}_TO_${currentNode.id}_${edges.length}`,
              sourceId: prevNode.id,
              targetId: currentNode.id,
              sourceName: prevNode.displayName,
              targetName: currentNode.displayName,
              sourceAlias: prevNode.alias,
              targetAlias: currentNode.alias,
              joinType: seg.role === 'FROM' ? 'CROSS JOIN' : seg.role,
              onCondition:
                seg.role === 'CROSS JOIN'
                  ? '(Cartesian Product / Comma Join in FROM)'
                  : `(${seg.role})`,
              detailedConditions: [
                seg.role === 'CROSS JOIN'
                  ? 'Implicit or explicit CROSS JOIN in FROM clause'
                  : `${seg.role} relationship`,
              ],
            });
          }
        }
      }
    });

    // 3c. Extract WHERE Clause predicates & WHERE subqueries (IN, NOT IN, EXISTS, NOT EXISTS, scalar)
    if (whereClause) {
      const predicates = splitTopLevelAnd(whereClause);

      for (const predicate of predicates) {
        const rawPred = predicate.trim();
        if (!rawPred) continue;

        // Check if this predicate contains any masked subquery placeholders
        const sqPlaceholdersInPred = Array.from(rawPred.matchAll(/(__SQ_[A-Za-z0-9_]+__)/g));
        for (const sqMatch of sqPlaceholdersInPred) {
          const ph = sqMatch[1];
          const sqInner = subqueryMap.get(ph);
          if (sqInner && !visitedPlaceholders.has(ph)) {
            visitedPlaceholders.add(ph);
            const beforePh = rawPred.substring(0, sqMatch.index || 0);
            const isNotExists = /\bNOT\s+EXISTS\s*$/i.test(beforePh);
            const isExists = !isNotExists && /\bEXISTS\s*$/i.test(beforePh);
            const isNotIn = /\bNOT\s+IN\s*$/i.test(beforePh);
            const isIn = !isNotIn && /\bIN\s*$/i.test(beforePh);

            const sqEdgeJoinType = isNotExists
              ? 'WHERE NOT EXISTS'
              : isExists
              ? 'WHERE EXISTS'
              : isNotIn
              ? 'WHERE NOT IN'
              : isIn
              ? 'WHERE IN'
              : 'WHERE SUBQUERY';

            const whereSqGroupId = `GROUP_WSQ_${branchScopeId}_${subqueryGroups.length + 1}`;
            const whereSqRes = parseQueryScope(
              sqInner,
              `${branchScopeId}_${ph.replace(/[^A-Za-z0-9]/g, '')}`,
              `Subquery in WHERE (${sqEdgeJoinType.replace('WHERE ', '')})`,
              nodes,
              edges,
              subqueryGroups,
              globalWhereConditions,
              strings,
              cteNodeMap,
              depth + 1,
              whereSqGroupId
            );

            // Determine which outer table/subquery node this WHERE subquery filters
            let outerTarget = branchNodes[0];
            const predQualRefs = extractQualifiedColumnRefs(beforePh);
            for (const ref of predQualRefs) {
              const key = ref.qualifier.toUpperCase();
              const matchedId = branchTableAliasMap.get(key) || branchTableNameMap.get(key);
              if (matchedId) {
                const found = branchNodes.find((n) => n.id === matchedId);
                if (found) {
                  outerTarget = found;
                  break;
                }
              }
            }

            const cleanLabel = formatSubqueryPlaceholders(restoreStrings(rawPred, strings));
            if (outerTarget && whereSqRes.terminalNodes.length > 0) {
              whereSqRes.terminalNodes.forEach((sqSource) => {
                edges.push({
                  id: `EDGE_WHERE_SQ_${sqSource.id}_TO_${outerTarget.id}_${edges.length}`,
                  sourceId: sqSource.id,
                  targetId: outerTarget.id,
                  sourceName: sqSource.displayName,
                  targetName: outerTarget.displayName,
                  sourceAlias: sqSource.alias,
                  targetAlias: outerTarget.alias,
                  joinType: sqEdgeJoinType,
                  onCondition: cleanLabel,
                  detailedConditions: [cleanLabel],
                  isSubqueryEdge: true,
                });
              });
            }

            if (whereSqRes.scopeNodes.length > 0) {
              subqueryGroups.push({
                id: whereSqGroupId,
                label: `Subquery in WHERE (${sqEdgeJoinType.replace('WHERE ', '')})`,
                alias: '',
                role: sqEdgeJoinType,
                nodeIds: whereSqRes.scopeNodes.map((n) => n.id),
                x: 0,
                y: 0,
                width: 0,
                height: 0,
              });
            }
          }
        }

        const cleanPred = formatSubqueryPlaceholders(restoreStrings(rawPred, strings));
        const referencedNodeIds = new Set<string>();

        const predRefs = extractQualifiedColumnRefs(rawPred);
        for (const ref of predRefs) {
          const key = ref.qualifier.toUpperCase();
          if (branchTableAliasMap.has(key)) {
            referencedNodeIds.add(branchTableAliasMap.get(key)!);
          } else if (branchTableNameMap.has(key)) {
            referencedNodeIds.add(branchTableNameMap.get(key)!);
          }
        }

        if (referencedNodeIds.size === 1) {
          const targetNodeId = Array.from(referencedNodeIds)[0];
          const targetNode = branchNodes.find((n) => n.id === targetNodeId);
          if (targetNode && !targetNode.whereConditions.includes(cleanPred)) {
            targetNode.whereConditions.push(cleanPred);
          }
        } else if (referencedNodeIds.size > 1) {
          const nodeArray = Array.from(referencedNodeIds);
          const node1 = branchNodes.find((n) => n.id === nodeArray[0]);
          const node2 = branchNodes.find((n) => n.id === nodeArray[1]);

          if (node1 && node2) {
            let existingEdge = edges.find(
              (e) =>
                (e.sourceId === node1.id && e.targetId === node2.id) ||
                (e.sourceId === node2.id && e.targetId === node1.id)
            );

            if (!existingEdge) {
              existingEdge = {
                id: `EDGE_IMPLICIT_${node1.id}_${node2.id}_${edges.length}`,
                sourceId: node1.id,
                targetId: node2.id,
                sourceName: node1.displayName,
                targetName: node2.displayName,
                sourceAlias: node1.alias,
                targetAlias: node2.alias,
                joinType: 'WHERE JOIN (Implicit)',
                onCondition: cleanPred,
                detailedConditions: [cleanPred],
              };
              edges.push(existingEdge);
            } else if (!existingEdge.detailedConditions.includes(cleanPred)) {
              existingEdge.detailedConditions.push(cleanPred);
              existingEdge.onCondition += ` AND ${cleanPred}`;
            }
          }
          globalWhereConditions.push(
            isMultiBranch ? `[Branch ${branch.branchIndex}] ${cleanPred}` : cleanPred
          );
        } else {
          // Unqualified predicate (e.g. `WHERE ROW = 1` on `SELECT * FROM (SELECT ... AS ROW FROM T)`):
          // Match against projected columns of branch nodes first, else attribute to primary node
          const predWords = new Set(
            Array.from(cleanPred.matchAll(/\b([A-Za-z0-9_]+)\b/g)).map((m) => m[1].toUpperCase())
          );
          const matchingColNode = branchNodes.find((n) =>
            n.columns.some((c) => predWords.has(c.toUpperCase()))
          );
          const targetNode = matchingColNode || branchNodes[0];

          if (targetNode) {
            if (!targetNode.whereConditions.includes(cleanPred)) {
              targetNode.whereConditions.push(cleanPred);
            }
          } else {
            globalWhereConditions.push(
              isMultiBranch ? `[Branch ${branch.branchIndex}] ${cleanPred}` : cleanPred
            );
          }
        }
      }
    }

    // 3d. Parse any scalar subqueries in SELECT clause or HAVING clause (or any remaining unvisited subqueries)
    const extraClauses: Array<{ text: string; label: string; edgeType: string }> = [
      { text: selectClause, label: 'Subquery in SELECT', edgeType: 'SELECT SUBQUERY' },
      { text: havingClause, label: 'Subquery in HAVING', edgeType: 'HAVING SUBQUERY' },
    ];

    for (const extra of extraClauses) {
      if (!extra.text) continue;
      const sqMatches = Array.from(extra.text.matchAll(/(__SQ_[A-Za-z0-9_]+__)/g));
      for (const m of sqMatches) {
        const ph = m[1];
        const sqInner = subqueryMap.get(ph);
        if (sqInner && !visitedPlaceholders.has(ph)) {
          visitedPlaceholders.add(ph);
          const extraGroupId = `GROUP_EXSQ_${branchScopeId}_${subqueryGroups.length + 1}`;
          const extraRes = parseQueryScope(
            sqInner,
            `${branchScopeId}_${ph.replace(/[^A-Za-z0-9]/g, '')}`,
            extra.label,
            nodes,
            edges,
            subqueryGroups,
            globalWhereConditions,
            strings,
            cteNodeMap,
            depth + 1,
            extraGroupId
          );
          const primaryTarget = branchNodes[0];
          if (primaryTarget && extraRes.terminalNodes.length > 0) {
            extraRes.terminalNodes.forEach((sqTerm) => {
              edges.push({
                id: `EDGE_EXTRA_SQ_${sqTerm.id}_TO_${primaryTarget.id}_${edges.length}`,
                sourceId: sqTerm.id,
                targetId: primaryTarget.id,
                sourceName: sqTerm.displayName,
                targetName: primaryTarget.displayName,
                sourceAlias: sqTerm.alias,
                targetAlias: primaryTarget.alias,
                joinType: extra.edgeType,
                onCondition: `${extra.label} ➔ ${primaryTarget.displayName}`,
                detailedConditions: [`${extra.label} referenced by ${primaryTarget.displayName}`],
                isSubqueryEdge: true,
              });
            });
          }
        }
      }
    }

    // Safety net: ensure ANY remaining subquery in `subqueryMap` that wasn't visited is still parsed!
    subqueryMap.forEach((sqInner, ph) => {
      if (!visitedPlaceholders.has(ph)) {
        visitedPlaceholders.add(ph);
        buildDerivedSubqueryNode(ph, '', 'FROM', branchNodes.length === 0);
      }
    });

    // 3e. Attribute column references in this branch
    const allQualRefs = extractQualifiedColumnRefs(maskedSql);
    for (const ref of allQualRefs) {
      const key = ref.qualifier.toUpperCase();
      const col = ref.column;

      let targetNodeId: string | undefined;
      if (branchTableAliasMap.has(key)) targetNodeId = branchTableAliasMap.get(key);
      else if (branchTableNameMap.has(key)) targetNodeId = branchTableNameMap.get(key);

      if (targetNodeId) {
        const node = branchNodes.find((n) => n.id === targetNodeId);
        if (node && !node.columns.includes(col)) {
          node.columns.push(col);
        }
      }
    }

    // 3f. Determine ALL terminal/leaf nodes of this branch:
    // Every node in `branchNodes` that has no outgoing edge to another node in `branchNodes`
    if (branchNodes.length > 0) {
      const branchNodeIds = new Set(branchNodes.map((n) => n.id));
      const nodesWithOutgoingInBranch = new Set<string>();
      edges.forEach((e) => {
        if (
          branchNodeIds.has(e.sourceId) &&
          branchNodeIds.has(e.targetId) &&
          e.sourceId !== e.targetId
        ) {
          nodesWithOutgoingInBranch.add(e.sourceId);
        }
      });

      const leafNodes = branchNodes.filter((n) => !nodesWithOutgoingInBranch.has(n.id));
      if (leafNodes.length > 0) {
        branchTerminalNodes.push(...leafNodes);
      } else {
        branchTerminalNodes.push(branchNodes[branchNodes.length - 1]);
      }
    }
  });

  // 4. If multi-branch (UNION / UNION ALL / INTERSECT / EXCEPT) at this scope level, create a Combiner node
  if (isMultiBranch && branchTerminalNodes.length > 0) {
    const unionType = branches[1]?.branchType || 'UNION ALL';
    const unionNodeId = `OP_UNION_${scopeId}_${nodes.length + 1}`;
    const unionNode: TableNodeData = {
      id: unionNodeId,
      tableName: unionType,
      fullTableName: `${unionType} Output`,
      alias: '',
      displayName: `${unionType} (${branches.length} Branches)`,
      joinType: unionType.includes('UNION ALL') ? 'UNION ALL' : 'UNION',
      whereConditions: [],
      columns: [],
      isRoot: false,
      orderIndex: nodes.length,
      branchName: scopeLabel ? `${scopeLabel} • Set Combiner` : 'Set Operation Combiner',
      scopeGroupId: parentScopeGroupId,
      isOperator: true,
    };

    nodes.push(unionNode);
    allScopeNodes.push(unionNode);

    branchTerminalNodes.forEach((lastBranchNode, idx) => {
      const bType = branches[Math.min(idx, branches.length - 1)]?.branchType || 'SELECT';
      edges.push({
        id: `EDGE_UNION_${scopeId}_B${idx + 1}_TO_${unionNode.id}_${edges.length}`,
        sourceId: lastBranchNode.id,
        targetId: unionNode.id,
        sourceName: lastBranchNode.displayName,
        targetName: unionNode.displayName,
        sourceAlias: lastBranchNode.alias,
        targetAlias: '',
        joinType: idx === 0 ? 'INPUT (Initial)' : `INPUT (${bType})`,
        onCondition: `Feeds into ${unionType} output`,
        detailedConditions: [`Dataset concatenated into ${unionType}`],
        isUnionEdge: true,
      });
    });

    return {
      scopeNodes: allScopeNodes,
      terminalNodes: [unionNode],
      aliasMap: combinedAliasMap,
      tableNameMap: combinedTableNameMap,
      branchCount: branches.length,
    };
  }

  return {
    scopeNodes: allScopeNodes,
    terminalNodes: branchTerminalNodes,
    aliasMap: combinedAliasMap,
    tableNameMap: combinedTableNameMap,
    branchCount: branches.length,
  };
}

/**
 * Main parser function to extract table graph, ON conditions on edges,
 * and WHERE conditions per node, including FROM (SELECT ...) derived subqueries.
 */
export function parseSqlTableGraph(sql: string): ParsedTableGraph {
  const trimmed = sql.trim();
  if (!trimmed) {
    return {
      nodes: [],
      edges: [],
      subqueryGroups: [],
      globalWhereConditions: [],
      statementType: 'UNKNOWN',
      cteCount: 0,
      subqueryCount: 0,
      branchCount: 0,
      hasErrors: false,
      rawSql: sql,
    };
  }

  const { cleanText, strings } = cleanSqlForAnalysis(sql);

  // Detect statement type
  let statementType: ParsedTableGraph['statementType'] = 'SELECT';
  const firstWordMatch = cleanText.match(/^\s*(SELECT|INSERT|UPDATE|DELETE|MERGE|WITH)\b/i);
  if (firstWordMatch) {
    const word = firstWordMatch[1].toUpperCase();
    if (word === 'INSERT') statementType = 'INSERT';
    else if (word === 'UPDATE') statementType = 'UPDATE';
    else if (word === 'DELETE') statementType = 'DELETE';
    else if (word === 'MERGE') statementType = 'MERGE';
    else statementType = 'SELECT';
  }

  const nodes: TableNodeData[] = [];
  const edges: TableEdgeData[] = [];
  const subqueryGroups: SubqueryGroupBox[] = [];
  const globalWhereConditions: string[] = [];
  const cteNodeMap = new Map<string, TableNodeData>();

  // Extract TARGET Table for INSERT / UPDATE / MERGE
  let targetNode: TableNodeData | null = null;
  if (statementType === 'INSERT' || statementType === 'UPDATE' || statementType === 'MERGE') {
    const targetMatch = cleanText.match(
      /\b(?:INTO|UPDATE|MERGE\s+INTO)\s+("[^"]+"(?:\s*\.\s*"[^"]+")?|[A-Za-z0-9_.$#:\/`\[\]-]+)(?:\s+AS\s+("[^"]+"|[A-Za-z0-9_"`\[\]-]+)|\s+(?!(?:USING|ON|SET|VALUES|SELECT|WHERE)\b)("[^"]+"|[A-Za-z0-9_"`\[\]-]+))?/i
    );
    if (targetMatch) {
      const rawTarget = targetMatch[1];
      const targetAlias = stripQuotes(targetMatch[2] || targetMatch[3] || '');
      const { schema, table, fullName } = parseSchemaAndTable(rawTarget);
      const nodeId = `TARGET_${table.toUpperCase()}${targetAlias ? '_' + targetAlias : ''}_${nodes.length}`;

      targetNode = {
        id: nodeId,
        tableName: table,
        schemaName: schema,
        fullTableName: fullName,
        alias: targetAlias,
        displayName: targetAlias ? `${fullName} (${targetAlias}) [TARGET]` : `${fullName} [TARGET]`,
        joinType: 'TARGET',
        whereConditions: [],
        columns: [],
        isRoot: false,
        orderIndex: nodes.length,
        branchName: 'Target Table',
      };

      nodes.push(targetNode);
    }
  }

  // Recursively parse the main query scope (including any CTEs, FROM subqueries, JOIN subqueries, WHERE subqueries, and UNIONs)
  const rootResult = parseQueryScope(
    cleanText,
    'ROOT',
    '',
    nodes,
    edges,
    subqueryGroups,
    globalWhereConditions,
    strings,
    cteNodeMap,
    0
  );

  // If there is a DML target node (e.g. INSERT INTO target SELECT ...), connect terminal query nodes to target
  if (targetNode && rootResult.terminalNodes.length > 0) {
    rootResult.terminalNodes.forEach((term) => {
      if (term.id !== targetNode!.id) {
        edges.push({
          id: `EDGE_DML_${term.id}_TO_${targetNode!.id}_${edges.length}`,
          sourceId: term.id,
          targetId: targetNode!.id,
          sourceName: term.displayName,
          targetName: targetNode!.displayName,
          sourceAlias: term.alias,
          targetAlias: targetNode!.alias,
          joinType: statementType,
          onCondition: `Writes into ${targetNode!.tableName}`,
          detailedConditions: [`${statementType} target table ${targetNode!.fullTableName}`],
        });
      }
    });
  }

  // Calculate layout coordinates using DAG topological layering & compute subquery bounding boxes
  calculateNodeLayoutPositions(nodes, edges, subqueryGroups);

  const subqueryCount = nodes.filter(
    (n) => n.isSubqueryResult && n.joinType !== 'CTE'
  ).length + subqueryGroups.filter((g) => g.role.startsWith('WHERE')).length;

  return {
    nodes,
    edges,
    subqueryGroups,
    globalWhereConditions,
    statementType,
    cteCount: cteNodeMap.size,
    subqueryCount,
    branchCount: rootResult.branchCount,
    hasErrors: false,
    rawSql: sql,
  };
}

/**
 * Splits top-level WHERE predicates by AND, respecting nested parentheses and BETWEEN ... AND ...
 */
function splitTopLevelAnd(whereSql: string): string[] {
  const result: string[] = [];
  let current = '';
  let parenDepth = 0;
  let inQuotes = false;
  let quoteChar = '';
  let pendingBetween = false;

  for (let i = 0; i < whereSql.length; i++) {
    const char = whereSql[i];

    if (!inQuotes && (char === "'" || char === '"')) {
      inQuotes = true;
      quoteChar = char;
      current += char;
      continue;
    }

    if (inQuotes) {
      current += char;
      if (char === quoteChar) {
        inQuotes = false;
      }
      continue;
    }

    if (char === '(') {
      parenDepth++;
      current += char;
      continue;
    }

    if (char === ')') {
      parenDepth = Math.max(0, parenDepth - 1);
      current += char;
      continue;
    }

    if (parenDepth === 0) {
      const remaining = whereSql.substring(i);
      const betweenMatch = remaining.match(/^(\bBETWEEN\b)/i);
      if (betweenMatch && (i === 0 || /\s/.test(whereSql[i - 1]))) {
        pendingBetween = true;
      }

      const andMatch = remaining.match(/^(\s+AND\s+)/i);
      if (andMatch) {
        if (pendingBetween) {
          pendingBetween = false;
          current += andMatch[1];
          i += andMatch[1].length - 1;
          continue;
        }
        if (current.trim()) {
          result.push(current.trim());
        }
        current = '';
        i += andMatch[1].length - 1;
        continue;
      }
    }

    current += char;
  }

  if (current.trim()) {
    result.push(current.trim());
  }

  return result;
}

/**
 * Calculates responsive geometric coordinates for graph layout using longest-path DAG layering.
 * Ensures subquery tables appear to the left of the derived subquery node they feed into,
 * outer joins flow cleanly to the right, and subquery group bounding boxes wrap their member nodes.
 */
function calculateNodeLayoutPositions(
  nodes: TableNodeData[],
  edges: TableEdgeData[],
  subqueryGroups: SubqueryGroupBox[]
) {
  if (nodes.length === 0) return;

  const nodeWidth = 330;
  const nodeHeight = 250;
  const horizontalGap = 175;
  const verticalGap = 65;

  const inDegree = new Map<string, number>();
  const adj = new Map<string, string[]>();

  nodes.forEach((n) => {
    inDegree.set(n.id, 0);
    adj.set(n.id, []);
  });

  edges.forEach((e) => {
    if (adj.has(e.sourceId) && inDegree.has(e.targetId) && e.sourceId !== e.targetId) {
      inDegree.set(e.targetId, (inDegree.get(e.targetId) || 0) + 1);
      adj.get(e.sourceId)?.push(e.targetId);
    }
  });

  const layers = new Map<string, number>();
  const queue: string[] = [];

  // Start BFS from true source nodes (in-degree === 0)
  nodes.forEach((n) => {
    if ((inDegree.get(n.id) || 0) === 0) {
      layers.set(n.id, 0);
      queue.push(n.id);
    }
  });

  if (queue.length === 0 && nodes.length > 0) {
    layers.set(nodes[0].id, 0);
    queue.push(nodes[0].id);
  }

  let steps = 0;
  const maxSteps = nodes.length * nodes.length + 100;
  while (queue.length > 0 && steps < maxSteps) {
    steps++;
    const currentId = queue.shift()!;
    const currentLayer = layers.get(currentId) || 0;

    const neighbors = adj.get(currentId) || [];
    for (const neighborId of neighbors) {
      const neighborLayer = layers.get(neighborId);
      if (neighborLayer === undefined || neighborLayer < currentLayer + 1) {
        layers.set(neighborId, currentLayer + 1);
        queue.push(neighborId);
      }
    }
  }

  const layerGroups = new Map<number, TableNodeData[]>();
  nodes.forEach((n) => {
    const layer = layers.get(n.id) ?? 0;
    if (!layerGroups.has(layer)) {
      layerGroups.set(layer, []);
    }
    layerGroups.get(layer)!.push(n);
  });

  const startX = 90;
  const startY = 90;
  const sortedLayers = Array.from(layerGroups.keys()).sort((a, b) => a - b);

  // Order nodes within each layer by scopeGroupId / branchIndex / orderIndex so subquery members stay grouped together
  sortedLayers.forEach((layerIdx) => {
    const group = layerGroups.get(layerIdx)!;
    group.sort((a, b) => {
      if ((a.scopeGroupId || '') !== (b.scopeGroupId || '')) {
        return (a.scopeGroupId || '').localeCompare(b.scopeGroupId || '');
      }
      return a.orderIndex - b.orderIndex;
    });
  });

  let maxLayerHeight = 320;
  sortedLayers.forEach((layerIdx) => {
    const group = layerGroups.get(layerIdx)!;
    const h = group.length * nodeHeight + Math.max(0, group.length - 1) * verticalGap;
    if (h > maxLayerHeight) maxLayerHeight = h;
  });

  const nodeById = new Map<string, TableNodeData>();
  nodes.forEach((n) => nodeById.set(n.id, n));

  sortedLayers.forEach((layerIdx) => {
    const group = layerGroups.get(layerIdx)!;
    const x = startX + layerIdx * (nodeWidth + horizontalGap);
    const totalHeight = group.length * nodeHeight + Math.max(0, group.length - 1) * verticalGap;
    const layerStartY = Math.max(startY, startY + (maxLayerHeight - totalHeight) / 2);

    group.forEach((node, idx) => {
      node.x = x;
      node.y = layerStartY + idx * (nodeHeight + verticalGap);
    });
  });

  // Compute bounding boxes for each subquery group
  subqueryGroups.forEach((sg) => {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let count = 0;

    sg.nodeIds.forEach((nid) => {
      const n = nodeById.get(nid);
      if (n && n.x !== undefined && n.y !== undefined) {
        count++;
        minX = Math.min(minX, n.x);
        minY = Math.min(minY, n.y);
        maxX = Math.max(maxX, n.x + nodeWidth);
        maxY = Math.max(maxY, n.y + nodeHeight);
      }
    });

    if (count > 0) {
      sg.x = minX - 24;
      sg.y = minY - 40;
      sg.width = maxX - minX + 48;
      sg.height = maxY - minY + 64;
    }
  });
}
