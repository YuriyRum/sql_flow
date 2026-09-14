import React, { useState } from 'react';
import { FullSizeSqlEditor } from './components/FullSizeSqlEditor';

const STORAGE_KEY = 'sap_hana_sql_statement_v1';

export default function App() {
  const [sql, setSql] = useState<string>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved !== null) {
        return saved;
      }
    } catch (e) {
      console.error('Error loading saved SQL:', e);
    }
    return '';
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
