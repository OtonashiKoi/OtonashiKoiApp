import React from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import App from './App.jsx';
import { BattleViewerApp } from './viewer/BattleViewerApp.jsx';

export function AppRouter() {
  const basename = (import.meta.env.BASE_URL || '/').replace(/\/$/, '') || '/';

  return (
    <BrowserRouter basename={basename}>
      <Routes>
        <Route index element={<App />} />
        <Route path="viewer" element={<BattleViewerApp />} />
        <Route path="battle-viewer" element={<Navigate to="/viewer" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
