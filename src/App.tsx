import { Suspense, lazy } from 'react';
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './components/AppShell';

const HomePage = lazy(() => import('./pages/HomePage').then((module) => ({ default: module.HomePage })));
const MissionPage = lazy(() => import('./pages/MissionPage').then((module) => ({ default: module.MissionPage })));
const PlayPage = lazy(() => import('./pages/PlayPage').then((module) => ({ default: module.PlayPage })));
const ResultPage = lazy(() => import('./pages/ResultPage').then((module) => ({ default: module.ResultPage })));
const CollectionPage = lazy(() => import('./pages/CollectionPage').then((module) => ({ default: module.CollectionPage })));
const ParentPage = lazy(() => import('./pages/ParentPage').then((module) => ({ default: module.ParentPage })));
const IllustrationPreviewPage = lazy(() =>
  import('./pages/IllustrationPreviewPage').then((module) => ({ default: module.IllustrationPreviewPage })),
);
const AudioLabPage = lazy(() => import('./pages/AudioLabPage').then((module) => ({ default: module.AudioLabPage })));
const SettingsPage = lazy(() => import('./pages/SettingsPage').then((module) => ({ default: module.SettingsPage })));

function App() {
  return (
    <HashRouter>
      <AppShell>
        <Suspense
          fallback={
            <section className="card">
              <h1>よみこみちゅう...</h1>
            </section>
          }
        >
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
        </Suspense>
      </AppShell>
    </HashRouter>
  );
}

export default App;
