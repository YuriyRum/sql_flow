/**
 * SQL Table Dependency & Condition Parser for SAP HANA
 * Extracts all table occurrences (including across multiple UNION / UNION ALL / INTERSECT / EXCEPT branches),
 * FROM (SELECT ...) derived subqueries, JOIN (SELECT ...) subqueries, WHERE IN/EXISTS subqueries, CTEs,
 * aliases, join relationships, ON conditions on edges, and specific WHERE conditions per table occurrence.
 */

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
    | 'JOIN SUBQUERY';
  whereConditions: string[]; // WHERE conditions specific to this table occurrence
  columns: string[]; // Referenced columns from this table
  isRoot: boolean;
  orderIndex: number;
  branchIndex?: number;
  branchName?: string; // e.g. "Branch 1", "Subquery in FROM (sub)"
  isOperator?: boolean; // true if this is a UNION / UNION ALL combiner node
  isSubqueryResult?: boolean; // true if this node represents the derived output of a FROM/JOIN subquery or CTE
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
}

export interface ParsedTableGraph {
  nodes: TableNodeData[];
  edges: TableEdgeData[];
  globalWhereConditions: string[]; // WHERE conditions not tied to a single table
  statementType: 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE' | 'MERGE' | 'UNKNOWN';
  cteCount: number;
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
  'AS', 'SELECT', 'FROM', 'LATERAL', 'UNNEST', 'TABLESAMPLE', 'SAMPLE', 'WITH'
]);

/**
 * Strips SQL comments and string literals temporarily to allow clean tokenization
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
 * Parses full table name into schema and table
 */
function parseSchemaAndTable(rawName: string): { schema?: string; table: string; fullName: string } {
  const clean = rawName.trim();
  const parts = clean.split('.');
  if (parts.length === 2) {
    const schema = stripQuotes(parts[0]);
    const table = stripQuotes(parts[1]);
    return { schema, table, fullName: clean };
  }
  const table = stripQuotes(clean);
  return { schema: undefined, table, fullName: clean };
}

/**
 * Unwraps outer parentheses if the entire SQL block is wrapped in `(...)`
 */
function unwrapOuterParens(sql: string): string {
  let current = sql.trim();
  while (current.startsWith('(') && current.endsWith(')')) {
    let depth = 0;
    let inQuotes = false;
    let quoteChar = '';
    let wrapsEntireString = true;

    for (let i = 0; i < current.length; i++) {
      const ch = current[i];
      if (!inQuotes && (ch === "'" || ch === '"')) {
        inQuotes = true;
        quoteChar = ch;
      } else if (inQuotes && ch === quoteChar) {
        inQuotes = false;
      } else if (!inQuotes) {
        if (ch === '(') depth++;
        else if (ch === ')') {
          depth--;
          if (depth === 0 && i < current.length - 1) {
            wrapsEntireString = false;
            break;
          }
        }
      }
    }

    if (wrapsEntireString && depth === 0) {
      current = current.substring(1, current.length - 1).trim();
    } else {
      break;
    }
  }
  return current;
}

/**
 * Masks direct parenthesized subqueries `(SELECT ...)` or `(WITH ...)` in `sqlText`
 * with synthetic tokens `__SQ_<scopeId>_<idx>__` so that outer FROM, JOIN, ON, and WHERE
 * regexes never leak into inner subqueries or duplicate inner tables.
 */
function maskDirectSubqueries(
  sqlText: string,
  scopeId: string
): {
  maskedSql: string;
  subqueryMap: Map<string, string>;
} {
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
      // Check if this '(' starts a subquery (SELECT or WITH, possibly wrapped in extra parens)
      const afterParen = sqlText.substring(i + 1);
      if (/^\s*(?:\(\s*)*(?:SELECT|WITH)\b/i.test(afterParen)) {
        // Find matching closing ')'
        let depth = 1;
        let j = i + 1;
        let innerQuotes = false;
        let innerQuoteChar = '';

        while (j < len && depth > 0) {
          const c = sqlText[j];
          if (!innerQuotes && (c === "'" || c === '"')) {
            innerQuotes = true;
            innerQuoteChar = c;
          } else if (innerQuotes && c === innerQuoteChar) {
            innerQuotes = false;
          } else if (!innerQuotes) {
            if (c === '(') depth++;
            else if (c === ')') depth--;
          }
          j++;
        }

        if (depth === 0) {
          const innerSql = unwrapOuterParens(sqlText.substring(i + 1, j - 1));
          const placeholder = `__SQ_${scopeId}_${sqCounter++}__`;
          subqueryMap.set(placeholder, innerSql);
          maskedSql += placeholder;
          i = j;
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
  return text.replace(/__SQ_[A-Za-z0-9_]+__/g, '(Subquery)');
}

/**
 * Extracts table/placeholder and optional alias from a FROM item like:
 * `"SAP_S4HANA"."VBAK" AS v`, `TABLE_A a`, `LATERAL __SQ_0_0__ AS sub`, `__SQ_0_0__`
 */
function parseTableEntryAndAlias(rawEntry: string): {
  rawTable: string;
  alias: string;
} | null {
  let cleaned = rawEntry.trim().replace(/^LATERAL\s+/i, '').trim();
  if (!cleaned) return null;

  // Match table token followed by optional [AS] alias
  const match = cleaned.match(
    /^([A-Za-z0-9_".`\/\[\]-]+)(?:\s+AS\s+([A-Za-z0-9_"`\[\]-]+)|\s+([A-Za-z0-9_"`\[\]-]+))?/i
  );
  if (!match) return null;

  const rawTable = match[1];
  const explicitAsAlias = match[2] ? stripQuotes(match[2]) : '';
  const implicitAliasCandidate = match[3] ? stripQuotes(match[3]) : '';

  let alias = '';
  if (explicitAsAlias) {
    alias = explicitAsAlias;
  } else if (
    implicitAliasCandidate &&
    !NON_ALIAS_SQL_KEYWORDS.has(implicitAliasCandidate.toUpperCase())
  ) {
    alias = implicitAliasCandidate;
  }

  return { rawTable, alias };
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
 * while respecting parentheses.
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
        const branchSql = unwrapped.substring(currentStart, i).trim();
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

  const lastBranchSql = unwrapped.substring(currentStart).trim();
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
 * Splits comma-separated items in a FROM clause while respecting parentheses
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
 * WHERE conditions (including WHERE IN/EXISTS subqueries), and UNION branches.
 */
function parseQueryScope(
  rawScopeSql: string,
  scopeId: string,
  scopeLabel: string,
  nodes: TableNodeData[],
  edges: TableEdgeData[],
  globalWhereConditions: string[],
  strings: string[],
  cteNodeMap: Map<string, TableNodeData>,
  depth: number = 0
): ScopeParseResult {
  if (depth > 12) {
    return {
      scopeNodes: [],
      terminalNodes: [],
      aliasMap: new Map(),
      tableNameMap: new Map(),
      branchCount: 0,
    };
  }

  let workingSql = unwrapOuterParens(rawScopeSql);

  // 1. Check for leading WITH clause at this scope level
  const preMask = maskDirectSubqueries(workingSql, `${scopeId}_with`);
  if (/^\s*WITH\b/i.test(preMask.maskedSql)) {
    const withoutWithKeyword = preMask.maskedSql.replace(/^\s*WITH\s+(?:RECURSIVE\s+)?/i, '');
    const cteDefRegex = /([A-Za-z0-9_"`\[\]-]+)\s+AS\s+(__SQ_[A-Za-z0-9_]+__)/gi;
    let cteMatch: RegExpExecArray | null;
    let lastCteEnd = 0;

    while ((cteMatch = cteDefRegex.exec(withoutWithKeyword)) !== null) {
      const cteName = stripQuotes(cteMatch[1]);
      const placeholder = cteMatch[2];
      lastCteEnd = cteMatch.index + cteMatch[0].length;

      const cteInnerSql = preMask.subqueryMap.get(placeholder);
      if (cteInnerSql) {
        const cteRes = parseQueryScope(
          cteInnerSql,
          `${scopeId}_cte_${cteName}`,
          `CTE (${cteName})`,
          nodes,
          edges,
          globalWhereConditions,
          strings,
          cteNodeMap,
          depth + 1
        );

        const cteNodeId = `CTE_${scopeId}_${cteName.toUpperCase()}_${nodes.length + 1}`;
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
          isSubqueryResult: true,
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
          });
        });

        cteNodeMap.set(cteName.toUpperCase(), cteNode);
      }
    }

    if (lastCteEnd > 0) {
      // Restore remaining subqueries in the main query body after the CTE definitions
      let remainder = withoutWithKeyword.substring(lastCteEnd).replace(/^\s*,\s*/, '').trim();
      preMask.subqueryMap.forEach((inner, ph) => {
        remainder = remainder.split(ph).join(`(${inner})`);
      });
      workingSql = remainder;
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
    const { maskedSql, subqueryMap } = maskDirectSubqueries(branch.sql, branchScopeId);

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
     * and wire its inner tables into it.
     */
    const buildDerivedSubqueryNode = (
      placeholder: string,
      subAlias: string,
      role: 'FROM' | 'INNER JOIN' | 'LEFT JOIN' | 'RIGHT JOIN' | 'FULL JOIN' | 'CROSS JOIN',
      isFirstFromItem: boolean
    ): TableNodeData | null => {
      const innerSql = subqueryMap.get(placeholder);
      if (!innerSql) return null;

      const subContextLabel =
        role === 'FROM'
          ? subAlias
            ? `Subquery in FROM (${subAlias})`
            : 'Subquery in FROM'
          : subAlias
          ? `Subquery in ${role} (${subAlias})`
          : `Subquery in ${role}`;

      const subResult = parseQueryScope(
        innerSql,
        `${branchScopeId}_${placeholder.replace(/[^A-Za-z0-9]/g, '')}`,
        subContextLabel,
        nodes,
        edges,
        globalWhereConditions,
        strings,
        cteNodeMap,
        depth + 1
      );

      // Extract projected column names/aliases from the subquery SELECT list for display
      const projectedCols: string[] = [];
      const innerMasked = maskDirectSubqueries(innerSql, 'proj');
      const selectMatch = innerMasked.maskedSql.match(/^\s*SELECT\s+(?:DISTINCT\s+|ALL\s+|TOP\s+\d+\s+)*([\s\S]*?)\bFROM\b/i);
      if (selectMatch) {
        const projItems = splitTopLevelCommas(selectMatch[1]);
        projItems.forEach((item) => {
          const asMatch = item.match(/\bAS\s+([A-Za-z0-9_"`\[\]]+)\s*$/i);
          if (asMatch) {
            projectedCols.push(stripQuotes(asMatch[1]));
          } else {
            const colMatch = item.trim().match(/(?:[A-Za-z0-9_"]+\.)?([A-Za-z0-9_"*]+)\s*$/);
            if (colMatch && colMatch[1] !== '*') {
              projectedCols.push(stripQuotes(colMatch[1]));
            }
          }
        });
      }

      const sqNodeId = `SQ_${branchScopeId}_${subAlias || 'DERIVED'}_${nodes.length + 1}`;
      const sqTableName = subAlias ? `FROM Subquery (${subAlias})` : role === 'FROM' ? 'FROM Subquery' : `${role} Subquery`;
      const sqDisplayName = subAlias
        ? `Subquery (${subAlias})`
        : role === 'FROM'
        ? 'FROM (SELECT ...)'
        : `${role} (SELECT ...)`;

      const sqNode: TableNodeData = {
        id: sqNodeId,
        tableName: sqTableName,
        fullTableName: 'Derived Table (SELECT ...)',
        alias: subAlias,
        displayName: sqDisplayName,
        joinType: role === 'FROM' ? 'FROM SUBQUERY' : 'JOIN SUBQUERY',
        whereConditions: [],
        columns: projectedCols,
        isRoot: isFirstFromItem && subResult.scopeNodes.length === 0,
        orderIndex: nodes.length,
        branchIndex: branch.branchIndex,
        branchName: effectiveBranchLabel,
        isSubqueryResult: true,
      };

      nodes.push(sqNode);
      branchNodes.push(sqNode);
      allScopeNodes.push(sqNode);

      // Connect terminal nodes of the inner subquery into this Derived Subquery node
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
            ? `Feeds into Subquery (${subAlias})`
            : 'Feeds into Derived Subquery',
          detailedConditions: [
            subAlias
              ? `Inner query result materializes derived table "${subAlias}"`
              : 'Inner query result materializes derived FROM subquery',
          ],
        });
      });

      // Register the subquery alias (and inner table aliases as fallback) to point to sqNode
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

    // 3a. Extract FROM clause section from maskedSql
    const fromClauseMatch = maskedSql.match(
      /\bFROM\s+([\s\S]*?)(?=\b(?:INNER\s+JOIN|LEFT\s+(?:OUTER\s+)?JOIN|RIGHT\s+(?:OUTER\s+)?JOIN|FULL\s+(?:OUTER\s+)?JOIN|CROSS\s+JOIN|NATURAL\s+JOIN|JOIN|WHERE|GROUP\s+BY|HAVING|QUALIFY|WINDOW|ORDER\s+BY|LIMIT|OFFSET|UNION|EXCEPT|INTERSECT|MINUS|FOR\s+UPDATE)\b|;|$)/i
    );

    if (fromClauseMatch) {
      const fromSection = fromClauseMatch[1].trim();
      const commaEntries = splitTopLevelCommas(fromSection);

      commaEntries.forEach((entry, idx) => {
        const parsed = parseTableEntryAndAlias(entry);
        if (!parsed) return;

        const { rawTable, alias } = parsed;

        // Check if this FROM item is a masked subquery: `FROM (SELECT ...) [AS sub]`
        if (/^__SQ_[A-Za-z0-9_]+__$/.test(rawTable)) {
          buildDerivedSubqueryNode(rawTable, alias, 'FROM', idx === 0);
          return;
        }

        const { schema, table, fullName } = parseSchemaAndTable(rawTable);
        if (['(', 'SELECT', 'LATERAL', 'UNNEST'].includes(table.toUpperCase())) return;

        // Check if this table references a known CTE
        const matchingCte = cteNodeMap.get(table.toUpperCase());

        const occurrenceNumber = nodes.length + 1;
        const nodeId = `TBL_${branchScopeId}_${idx + 1}_${table.toUpperCase()}${alias ? '_' + alias : ''}_${occurrenceNumber}`;
        const branchPrefix = isMultiBranch && depth === 0 ? `[Branch ${branch.branchIndex}] ` : '';
        const displayName = alias ? `${branchPrefix}${fullName} (${alias})` : `${branchPrefix}${fullName}`;

        const node: TableNodeData = {
          id: nodeId,
          tableName: table,
          schemaName: schema,
          fullTableName: fullName,
          alias,
          displayName,
          joinType: idx === 0 ? 'FROM' : 'CROSS JOIN',
          whereConditions: [],
          columns: [],
          isRoot: idx === 0 && depth === 0 && !matchingCte,
          orderIndex: nodes.length,
          branchIndex: branch.branchIndex,
          branchName: effectiveBranchLabel,
        };

        nodes.push(node);
        branchNodes.push(node);
        allScopeNodes.push(node);

        if (matchingCte) {
          edges.push({
            id: `EDGE_CTE_REF_${matchingCte.id}_TO_${node.id}_${edges.length}`,
            sourceId: matchingCte.id,
            targetId: node.id,
            sourceName: matchingCte.displayName,
            targetName: node.displayName,
            sourceAlias: matchingCte.alias,
            targetAlias: node.alias,
            joinType: 'FROM CTE',
            onCondition: `Reads from CTE ${matchingCte.tableName}`,
            detailedConditions: [`References Common Table Expression ${matchingCte.tableName}`],
          });
        } else if (idx > 0 && branchNodes[0] && branchNodes[0].id !== node.id) {
          edges.push({
            id: `EDGE_COMMA_JOIN_${branchNodes[0].id}_TO_${node.id}_${edges.length}`,
            sourceId: branchNodes[0].id,
            targetId: node.id,
            sourceName: branchNodes[0].displayName,
            targetName: node.displayName,
            sourceAlias: branchNodes[0].alias,
            targetAlias: node.alias,
            joinType: 'CROSS JOIN',
            onCondition: '(Comma Join in FROM)',
            detailedConditions: ['Implicit cross/comma join in FROM clause'],
          });
        }

        if (alias) {
          branchTableAliasMap.set(alias.toUpperCase(), nodeId);
          combinedAliasMap.set(alias.toUpperCase(), nodeId);
        }
        branchTableNameMap.set(table.toUpperCase(), nodeId);
        branchTableNameMap.set(fullName.toUpperCase(), nodeId);
        combinedTableNameMap.set(table.toUpperCase(), nodeId);
        combinedTableNameMap.set(fullName.toUpperCase(), nodeId);
      });
    }

    // 3b. Extract JOIN clauses in this branch (supports both regular tables and `__SQ_...__` subqueries)
    const joinRegex =
      /\b(INNER\s+JOIN|LEFT\s+(?:OUTER\s+)?JOIN|RIGHT\s+(?:OUTER\s+)?JOIN|FULL\s+(?:OUTER\s+)?JOIN|CROSS\s+JOIN|NATURAL\s+JOIN|JOIN)\s+(?:LATERAL\s+)?([A-Za-z0-9_".`\/\[\]-]+)(?:\s+AS\s+([A-Za-z0-9_"`\[\]-]+)|\s+(?!(?:ON|USING|WHERE|GROUP|HAVING|QUALIFY|WINDOW|ORDER|LIMIT|OFFSET|INNER|LEFT|RIGHT|FULL|CROSS|NATURAL|OUTER|JOIN|UNION|EXCEPT|INTERSECT|MINUS|FOR)\b)([A-Za-z0-9_"`\[\]-]+))?(?:\s+ON\s+([\s\S]*?)(?=\b(?:INNER\s+JOIN|LEFT\s+(?:OUTER\s+)?JOIN|RIGHT\s+(?:OUTER\s+)?JOIN|FULL\s+(?:OUTER\s+)?JOIN|CROSS\s+JOIN|NATURAL\s+JOIN|JOIN|WHERE|GROUP\s+BY|HAVING|QUALIFY|WINDOW|ORDER\s+BY|LIMIT|OFFSET|UNION|EXCEPT|INTERSECT|MINUS|FOR\s+UPDATE)\b|;|$))?/gi;

    let joinMatch: RegExpExecArray | null;
    let joinIndex = 0;
    while ((joinMatch = joinRegex.exec(maskedSql)) !== null) {
      joinIndex++;
      const rawJoinType = joinMatch[1].toUpperCase().replace(/\s+/g, ' ');
      const rawTable = joinMatch[2];
      const explicitAlias = joinMatch[3] ? stripQuotes(joinMatch[3]) : '';
      const implicitAlias =
        joinMatch[4] && !NON_ALIAS_SQL_KEYWORDS.has(stripQuotes(joinMatch[4]).toUpperCase())
          ? stripQuotes(joinMatch[4])
          : '';
      const alias = explicitAlias || implicitAlias;
      const rawOnCondition = joinMatch[5] ? joinMatch[5].trim() : '';

      let normalizedJoinType:
        | 'INNER JOIN'
        | 'LEFT JOIN'
        | 'RIGHT JOIN'
        | 'FULL JOIN'
        | 'CROSS JOIN' = 'INNER JOIN';
      if (rawJoinType.includes('LEFT')) normalizedJoinType = 'LEFT JOIN';
      else if (rawJoinType.includes('RIGHT')) normalizedJoinType = 'RIGHT JOIN';
      else if (rawJoinType.includes('FULL')) normalizedJoinType = 'FULL JOIN';
      else if (rawJoinType.includes('CROSS')) normalizedJoinType = 'CROSS JOIN';
      else normalizedJoinType = 'INNER JOIN';

      let targetNode: TableNodeData | null = null;

      if (/^__SQ_[A-Za-z0-9_]+__$/.test(rawTable)) {
        // JOIN (SELECT ...) [AS alias] ON ...
        targetNode = buildDerivedSubqueryNode(rawTable, alias, normalizedJoinType, false);
      } else {
        const { schema, table, fullName } = parseSchemaAndTable(rawTable);
        if (['(', 'SELECT', 'LATERAL', 'UNNEST'].includes(table.toUpperCase())) continue;

        const matchingCte = cteNodeMap.get(table.toUpperCase());
        const occurrenceNumber = nodes.length + 1;
        const nodeId = `TBL_${branchScopeId}_J${joinIndex}_${table.toUpperCase()}${alias ? '_' + alias : ''}_${occurrenceNumber}`;
        const branchPrefix = isMultiBranch && depth === 0 ? `[Branch ${branch.branchIndex}] ` : '';
        const displayName = alias ? `${branchPrefix}${fullName} (${alias})` : `${branchPrefix}${fullName}`;

        targetNode = {
          id: nodeId,
          tableName: table,
          schemaName: schema,
          fullTableName: fullName,
          alias,
          displayName,
          joinType: normalizedJoinType,
          whereConditions: [],
          columns: [],
          isRoot: false,
          orderIndex: nodes.length,
          branchIndex: branch.branchIndex,
          branchName: effectiveBranchLabel,
        };

        nodes.push(targetNode);
        branchNodes.push(targetNode);
        allScopeNodes.push(targetNode);

        if (matchingCte) {
          edges.push({
            id: `EDGE_CTE_JOIN_${matchingCte.id}_TO_${targetNode.id}_${edges.length}`,
            sourceId: matchingCte.id,
            targetId: targetNode.id,
            sourceName: matchingCte.displayName,
            targetName: targetNode.displayName,
            sourceAlias: matchingCte.alias,
            targetAlias: targetNode.alias,
            joinType: 'FROM CTE',
            onCondition: `Reads from CTE ${matchingCte.tableName}`,
            detailedConditions: [`References Common Table Expression ${matchingCte.tableName}`],
          });
        }

        if (alias) {
          branchTableAliasMap.set(alias.toUpperCase(), nodeId);
          combinedAliasMap.set(alias.toUpperCase(), nodeId);
        }
        branchTableNameMap.set(table.toUpperCase(), nodeId);
        branchTableNameMap.set(fullName.toUpperCase(), nodeId);
        combinedTableNameMap.set(table.toUpperCase(), nodeId);
        combinedTableNameMap.set(fullName.toUpperCase(), nodeId);
      }

      if (!targetNode) continue;

      // Connect JOIN edge based on ON condition
      if (rawOnCondition) {
        const restoredOnCondition = formatSubqueryPlaceholders(
          restoreStrings(rawOnCondition, strings).trim()
        );

        const idMatches = Array.from(
          rawOnCondition.matchAll(/([A-Za-z0-9_"]+)\s*\.\s*[A-Za-z0-9_"]+/g)
        );
        const referencedNodeIds = new Set<string>();

        for (const m of idMatches) {
          const refAlias = stripQuotes(m[1]).toUpperCase();
          if (branchTableAliasMap.has(refAlias)) {
            referencedNodeIds.add(branchTableAliasMap.get(refAlias)!);
          } else if (branchTableNameMap.has(refAlias)) {
            referencedNodeIds.add(branchTableNameMap.get(refAlias)!);
          }
        }

        referencedNodeIds.delete(targetNode.id);

        let sourceNodeId: string | null = null;
        if (referencedNodeIds.size > 0) {
          sourceNodeId = Array.from(referencedNodeIds)[0];
        } else {
          // Fallback to first node in this branch (e.g. FROM table or FROM Subquery)
          const firstCandidate = branchNodes.find((n) => n.id !== targetNode!.id);
          sourceNodeId = firstCandidate?.id || null;
        }

        if (sourceNodeId && sourceNodeId !== targetNode.id) {
          const sourceNode = nodes.find((n) => n.id === sourceNodeId);
          const edgeId = `EDGE_${sourceNodeId}_TO_${targetNode.id}_${edges.length}`;

          const subConditions = restoredOnCondition
            .split(/\s+AND\s+/i)
            .map((c) => c.trim())
            .filter(Boolean);

          edges.push({
            id: edgeId,
            sourceId: sourceNodeId,
            targetId: targetNode.id,
            sourceName: sourceNode?.displayName || sourceNodeId,
            targetName: targetNode.displayName,
            sourceAlias: sourceNode?.alias || '',
            targetAlias: targetNode.alias,
            joinType: normalizedJoinType,
            onCondition: restoredOnCondition,
            detailedConditions: subConditions.length > 0 ? subConditions : [restoredOnCondition],
          });
        }
      } else if (normalizedJoinType === 'CROSS JOIN') {
        const prevNode = branchNodes.find((n) => n.id !== targetNode!.id);
        if (prevNode) {
          edges.push({
            id: `EDGE_CROSS_${prevNode.id}_TO_${targetNode.id}_${edges.length}`,
            sourceId: prevNode.id,
            targetId: targetNode.id,
            sourceName: prevNode.displayName,
            targetName: targetNode.displayName,
            sourceAlias: prevNode.alias,
            targetAlias: targetNode.alias,
            joinType: 'CROSS JOIN',
            onCondition: '(Cartesian Product / Cross Join)',
            detailedConditions: ['CROSS JOIN: No explicit ON condition'],
          });
        }
      }
    }

    // 3c. Extract WHERE Clause for this specific branch (using maskedSql so inner subquery WHEREs never collide!)
    const whereMatch = maskedSql.match(
      /\bWHERE\s+([\s\S]*?)(?=\b(?:GROUP\s+BY|HAVING|QUALIFY|WINDOW|ORDER\s+BY|LIMIT|OFFSET|UNION|EXCEPT|INTERSECT|MINUS|FOR\s+UPDATE)\b|;|$)/i
    );

    if (whereMatch) {
      const rawWhere = whereMatch[1].trim();
      const predicates = splitTopLevelAnd(rawWhere);

      for (const predicate of predicates) {
        const rawPred = predicate.trim();
        if (!rawPred) continue;

        // Check if this predicate contains a masked subquery placeholder (e.g. `x IN __SQ_...__` or `EXISTS __SQ_...__`)
        const sqPlaceholdersInPred = Array.from(rawPred.matchAll(/(__SQ_[A-Za-z0-9_]+__)/g));
        for (const sqMatch of sqPlaceholdersInPred) {
          const ph = sqMatch[1];
          const sqInner = subqueryMap.get(ph);
          if (sqInner) {
            const isExists = /\bEXISTS\s*$/i.test(rawPred.substring(0, sqMatch.index));
            const sqTypeLabel = isExists ? 'Subquery in WHERE (EXISTS)' : 'Subquery in WHERE (IN)';
            const whereSqRes = parseQueryScope(
              sqInner,
              `${branchScopeId}_${ph.replace(/[^A-Za-z0-9]/g, '')}`,
              sqTypeLabel,
              nodes,
              edges,
              globalWhereConditions,
              strings,
              cteNodeMap,
              depth + 1
            );

            const outerTarget = branchNodes[0];
            if (outerTarget && whereSqRes.terminalNodes.length > 0) {
              const sqSource = whereSqRes.terminalNodes[0];
              const cleanLabel = formatSubqueryPlaceholders(restoreStrings(rawPred, strings));
              edges.push({
                id: `EDGE_WHERE_SQ_${sqSource.id}_TO_${outerTarget.id}_${edges.length}`,
                sourceId: sqSource.id,
                targetId: outerTarget.id,
                sourceName: sqSource.displayName,
                targetName: outerTarget.displayName,
                sourceAlias: sqSource.alias,
                targetAlias: outerTarget.alias,
                joinType: isExists ? 'WHERE EXISTS' : 'WHERE IN',
                onCondition: cleanLabel,
                detailedConditions: [cleanLabel],
              });
            }
          }
        }

        const cleanPred = formatSubqueryPlaceholders(restoreStrings(rawPred, strings));
        const referencedNodeIds = new Set<string>();

        const aliasColMatches = Array.from(
          cleanPred.matchAll(/([A-Za-z0-9_"]+)\s*\.\s*[A-Za-z0-9_"]+/g)
        );
        for (const m of aliasColMatches) {
          const ref = stripQuotes(m[1]).toUpperCase();
          if (branchTableAliasMap.has(ref)) {
            referencedNodeIds.add(branchTableAliasMap.get(ref)!);
          } else if (branchTableNameMap.has(ref)) {
            referencedNodeIds.add(branchTableNameMap.get(ref)!);
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
          // Attribute to the primary FROM table/subquery of this branch
          if (branchNodes.length >= 1) {
            const primaryNode = branchNodes[0];
            if (!primaryNode.whereConditions.includes(cleanPred)) {
              primaryNode.whereConditions.push(cleanPred);
            }
          } else {
            globalWhereConditions.push(
              isMultiBranch ? `[Branch ${branch.branchIndex}] ${cleanPred}` : cleanPred
            );
          }
        }
      }
    }

    // 3d. Attribute column references in this branch (using maskedSql so only this scope's references are matched)
    const colRefMatches = Array.from(
      maskedSql.matchAll(/([A-Za-z0-9_"]+)\s*\.\s*([A-Za-z0-9_"]+)/g)
    );
    for (const m of colRefMatches) {
      const alias = stripQuotes(m[1]).toUpperCase();
      const col = stripQuotes(m[2]);

      let targetNodeId: string | undefined;
      if (branchTableAliasMap.has(alias)) targetNodeId = branchTableAliasMap.get(alias);
      else if (branchTableNameMap.has(alias)) targetNodeId = branchTableNameMap.get(alias);

      if (targetNodeId) {
        const node = branchNodes.find((n) => n.id === targetNodeId);
        if (node && !node.columns.includes(col)) {
          node.columns.push(col);
        }
      }
    }

    if (branchNodes.length > 0) {
      branchTerminalNodes.push(branchNodes[branchNodes.length - 1]);
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
      isOperator: true,
    };

    nodes.push(unionNode);
    allScopeNodes.push(unionNode);

    branchTerminalNodes.forEach((lastBranchNode, idx) => {
      const bType = branches[idx]?.branchType || 'SELECT';
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
        detailedConditions: [`Branch ${idx + 1} dataset concatenated into ${unionType}`],
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
      globalWhereConditions: [],
      statementType: 'UNKNOWN',
      cteCount: 0,
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
  const globalWhereConditions: string[] = [];
  const cteNodeMap = new Map<string, TableNodeData>();

  // Extract TARGET Table for INSERT / UPDATE / MERGE
  let targetNode: TableNodeData | null = null;
  if (statementType === 'INSERT' || statementType === 'UPDATE' || statementType === 'MERGE') {
    const targetMatch = cleanText.match(
      /\b(?:INTO|UPDATE|MERGE\s+INTO)\s+([A-Za-z0-9_".`\/\[\]-]+)(?:\s+AS\s+([A-Za-z0-9_"`\[\]-]+)|\s+(?!(?:USING|ON|SET|VALUES|SELECT|WHERE)\b)([A-Za-z0-9_"`\[\]-]+))?/i
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

  // Calculate layout coordinates using DAG topological layering
  calculateNodeLayoutPositions(nodes, edges);

  return {
    nodes,
    edges,
    globalWhereConditions,
    statementType,
    cteCount: cteNodeMap.size,
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
          // This AND belongs to BETWEEN <low> AND <high>
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
 * and outer joins flow cleanly to the right.
 */
function calculateNodeLayoutPositions(nodes: TableNodeData[], edges: TableEdgeData[]) {
  if (nodes.length === 0) return;

  const nodeWidth = 330;
  const nodeHeight = 235;
  const horizontalGap = 165;
  const verticalGap = 55;

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

  // Start BFS only from true source nodes (in-degree === 0) so subquery base tables are at layer 0
  // and the FROM Subquery node they feed into is placed at layer >= 1
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

  // Guard against accidental cycles with max iterations
  let steps = 0;
  const maxSteps = nodes.length * nodes.length + 50;
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

  const startX = 80;
  const startY = 80;
  const sortedLayers = Array.from(layerGroups.keys()).sort((a, b) => a - b);

  // Find max height across all layers to vertically center smaller layers nicely
  let maxLayerHeight = 300;
  sortedLayers.forEach((layerIdx) => {
    const group = layerGroups.get(layerIdx)!;
    const h = group.length * nodeHeight + Math.max(0, group.length - 1) * verticalGap;
    if (h > maxLayerHeight) maxLayerHeight = h;
  });

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
}
