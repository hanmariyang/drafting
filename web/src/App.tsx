import { useEffect, useState, createContext, useContext, useCallback } from 'react';
import { Routes, Route } from 'react-router-dom';
import { api, type Meta } from './lib/api.ts';
import { StartScreen } from './pages/StartScreen.tsx';
import { Hub } from './pages/Hub.tsx';
import { DocumentRoute } from './pages/DocumentRoute.tsx';
import { WireframesPage } from './pages/WireframesPage.tsx';
import { HandoffPage } from './pages/HandoffPage.tsx';
import { Settings } from './pages/Settings.tsx';
import { OnboardingWizard } from './components/OnboardingWizard.tsx';
import { NewPlanSheet } from './components/NewPlanSheet.tsx';
import { CommandPalette } from './components/CommandPalette.tsx';

interface MetaCtx {
  meta: Meta | null;
  reload: () => Promise<void>;
}
const MetaContext = createContext<MetaCtx>({ meta: null, reload: async () => {} });
export const useMeta = () => useContext(MetaContext);

/** 어디서든 새 기획 시트를 연다 (스위처 + 버튼 등에서 사용). */
export const NEW_PLAN_EVENT = 'drafting:new-plan';
export function openNewPlan(): void {
  window.dispatchEvent(new CustomEvent(NEW_PLAN_EVENT));
}

export function App() {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [planOpen, setPlanOpen] = useState(false);
  const [palOpen, setPalOpen] = useState(false);

  const reload = useCallback(async () => {
    setMeta(await api.meta());
  }, []);

  useEffect(() => {
    reload().catch(() => setMeta(null));
  }, [reload]);

  // 새 기획 = 지금 문맥 위에 뜨는 시트 (시안 3). ⌘N + 전역 이벤트.
  // 브라우저는 ⌘N을 새 창에 예약하므로 웹에선 버튼·이벤트가 주 경로다.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        setPlanOpen(true);
      }
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPalOpen((v) => !v);
      }
    };
    const onOpen = () => setPlanOpen(true);
    window.addEventListener('keydown', onKey);
    window.addEventListener(NEW_PLAN_EVENT, onOpen);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener(NEW_PLAN_EVENT, onOpen);
    };
  }, []);

  const showWizard = meta !== null && !meta.onboardingComplete;

  return (
    <MetaContext.Provider value={{ meta, reload }}>
      <Routes>
        <Route path="/" element={<StartScreen />} />
        <Route path="/projects/:pid" element={<Hub />} />
        <Route path="/projects/:pid/documents/:did" element={<DocumentRoute />} />
        <Route path="/projects/:pid/wireframes" element={<WireframesPage />} />
        <Route path="/projects/:pid/handoff" element={<HandoffPage />} />
        <Route path="/settings" element={<Settings />} />
      </Routes>

      {planOpen && <NewPlanSheet onClose={() => setPlanOpen(false)} />}
      {palOpen && <CommandPalette onClose={() => setPalOpen(false)} />}
      {showWizard && <OnboardingWizard onDone={reload} />}
    </MetaContext.Provider>
  );
}
