import { Suspense, lazy } from 'react';
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './components/AppShell';

const WorldPage = lazy(() => import('./pages/WorldPage').then((module) => ({ default: module.WorldPage })));
const IslandPage = lazy(() => import('./pages/IslandPage').then((module) => ({ default: module.IslandPage })));
const LessonPage = lazy(() => import('./pages/LessonPage').then((module) => ({ default: module.LessonPage })));
const PlayPage = lazy(() => import('./pages/PlayPage').then((module) => ({ default: module.PlayPage })));
const ResultPage = lazy(() => import('./pages/ResultPage').then((module) => ({ default: module.ResultPage })));
const TreasurePage = lazy(() => import('./pages/TreasurePage').then((module) => ({ default: module.TreasurePage })));
const ParentPage = lazy(() => import('./pages/ParentPage').then((module) => ({ default: module.ParentPage })));
const IllustrationPreviewPage = lazy(() =>
  import('./pages/IllustrationPreviewPage').then((module) => ({ default: module.IllustrationPreviewPage })),
);

function App() {
  return (
    <HashRouter>
      <AppShell>
        <Suspense
          fallback={
            <div className="screen">
              <p className="on-night" style={{ textAlign: 'center', paddingTop: '30vh' }}>
                ⛵ よみこみちゅう…
              </p>
            </div>
          }
        >
          <Routes>
            <Route element={<WorldPage />} path="/" />
            <Route element={<IslandPage />} path="/island/:subject" />
            <Route element={<LessonPage />} path="/lesson/:skillId" />
            <Route element={<PlayPage />} path="/play" />
            <Route element={<ResultPage />} path="/result" />
            <Route element={<TreasurePage />} path="/treasure" />
            <Route element={<ParentPage />} path="/parent" />
            <Route element={<IllustrationPreviewPage />} path="/illustrations" />
            {/* v2 までの URL */}
            <Route element={<Navigate to="/" replace />} path="/mission" />
            <Route element={<Navigate to="/treasure" replace />} path="/collection" />
            <Route element={<Navigate to="/parent" replace />} path="/settings" />
            <Route element={<Navigate to="/" replace />} path="*" />
          </Routes>
        </Suspense>
      </AppShell>
    </HashRouter>
  );
}

export default App;
