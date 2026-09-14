import React, { useState } from 'react';
import { FullSizeSqlEditor } from './components/FullSizeSqlEditor';

const STORAGE_KEY = 'sap_hana_sql_statement_v1';

const DEFAULT_SQL = `-- SAP HANA SQL SELECT Query
SELECT 
    v."SALES_DOCUMENT",
    v."COMPANY_CODE",
    v."CUSTOMER_ID",
    v."ORDER_DATE",
    COUNT(*) AS "TOTAL_ITEMS",
    SUM(p."NET_AMOUNT") AS "TOTAL_NET_AMOUNT"
FROM "SAP_S4HANA"."VBAK" AS v
INNER JOIN "SAP_S4HANA"."VBAP" AS p
    ON v."SALES_DOCUMENT" = p."SALES_DOCUMENT"
WHERE v."ORDER_DATE" >= ADD_MONTHS(CURRENT_DATE, -12)
    AND v."STATUS" = 'A'
GROUP BY 
    v."SALES_DOCUMENT",
    v."COMPANY_CODE",
    v."CUSTOMER_ID",
    v."ORDER_DATE"
ORDER BY "TOTAL_NET_AMOUNT" DESC;
`;

export default function App() {
  const [sql, setSql] = useState<string>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved && saved.trim()) {
        return saved;
      }
    } catch (e) {
      console.error('Error loading saved SQL:', e);
    }
    return DEFAULT_SQL;
  });

  const handleSaveSql = (newSql: string) => {
    setSql(newSql);
    try {
      localStorage.setItem(STORAGE_KEY, newSql);
    } catch (e) {
      console.error('Error saving SQL:', e);
    }
  };

  return (
    <div className="w-screen h-screen overflow-hidden bg-white text-slate-800 font-sans relative">
      <FullSizeSqlEditor
        initialSql={sql}
        onSaveSql={handleSaveSql}
      />
    </div>
  );
}
