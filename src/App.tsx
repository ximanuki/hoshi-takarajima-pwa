import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { CollectionPage } from './pages/CollectionPage';
import { HomePage } from './pages/HomePage';
import { IllustrationPreviewPage } from './pages/IllustrationPreviewPage';
import { AudioLabPage } from './pages/AudioLabPage';
import { MissionPage } from './pages/MissionPage';
import { ParentPage } from './pages/ParentPage';
import { PlayPage } from './pages/PlayPage';
import { ResultPage } from './pages/ResultPage';
import { SettingsPage } from './pages/SettingsPage';

function App() {
  return (
    <HashRouter>
      <AppShell>
        <Routes>
          <Route element={<HomePage />} path="/" />
          <Route element={<MissionPage />} path="/mission" />
          <Route element={<PlayPage />} path="/play" />
          <Route element={<ResultPage />} path="/result" />
          <Route element={<CollectionPage />} path="/collection" />
          <Route element={<ParentPage />} path="/parent" />
          <Route element={<IllustrationPreviewPage />} path="/illustrations" />
          <Route element={<AudioLabPage />} path="/settings/audio-lab" />
          <Route element={<SettingsPage />} path="/settings" />
          <Route element={<Navigate to="/" replace />} path="*" />
        </Routes>
      </AppShell>
    </HashRouter>
  );
}

export default App;
