import { SQLNode } from '../types';

export function getDefaultDocumentation(node: SQLNode): string {
  if (node.documentation && node.documentation.trim().length > 0) {
    return node.documentation;
  }

  const inputsFormatted =
    node.inputTables && node.inputTables.length > 0
      ? node.inputTables.map((t) => `  - ${t}`).join('\n')
      : '  - None specified';

  const targetAsset = node.targetTable
    ? (node.targetSchema ? `"${node.targetSchema}"."${node.targetTable}"` : node.targetTable)
    : '(In-memory intermediate query dataset)';

  return `STEP ${node.executionOrder}: ${node.name}
================================================================================

1. BUSINESS PURPOSE & OVERVIEW
--------------------------------------------------------------------------------
${node.description || 'SAP HANA analytical query node performing data transformation.'}

- Execution Order: Step #${node.executionOrder}
- Query Type:      ${node.queryType} (Analytical Read-Only SELECT)
- Target Output:   ${targetAsset}
- Status:          ${node.enabled ? 'Active / Enabled' : 'Disabled'}


2. SOURCE TABLES & DATA DEPENDENCIES
--------------------------------------------------------------------------------
${inputsFormatted}


3. BUSINESS LOGIC & TRANSFORMATION RULES
--------------------------------------------------------------------------------
- Filters source data records according to business dates and tenant scope.
- Columnar in-memory pushdown optimization in SAP HANA engine.
- Aggregates and calculates metrics safely with NULL handling.


4. SAP HANA SQL QUERY CONTENT
--------------------------------------------------------------------------------
${node.sqlContent}


5. OPERATIONAL & GOVERNANCE NOTES
--------------------------------------------------------------------------------
- Dialect: SAP HANA Cloud / SAP HANA 2.0 SPS06+
- Execution: Column-store parallel vectorized execution
- Security: Requires read privileges on source catalog tables
`;
}
