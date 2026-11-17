import { useEffect, useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { settingsRepo, SETTINGS } from "@/db/repositories";
import { UserProvider } from "./UserContext";
import { Shell } from "./Shell";
import { OnboardingPage } from "@/features/onboarding/OnboardingPage";
import { TodayPage } from "@/features/records/TodayPage";
import { RecordsPage } from "@/features/records/RecordsPage";
import { MedicationsPage } from "@/features/medications/MedicationsPage";
import { UsersPage } from "@/features/users/UsersPage";
import { ProfilePage } from "@/features/profile/ProfilePage";
import { DiseasesPage } from "@/features/profile/DiseasesPage";
import { SettingsPage } from "@/features/settings/SettingsPage";
import { TrendsPage } from "@/features/review/TrendsPage";
import { ReviewPage } from "@/features/review/ReviewPage";
import { PlanPage } from "@/features/plan/PlanPage";
import { DietPage } from "@/features/diet/DietPage";
import { AiPage } from "@/features/ai/AiPage";
import { ErrorBoundary } from "./ErrorBoundary";

function Placeholder({ name }: { name: string }) {
  return (
    <div className="p-6">
      <h1 className="text-xl font-semibold">{name}</h1>
      <p className="mt-2 text-sm text-muted">该页面按 SRS 开发计划将在后续阶段实现。</p>
    </div>
  );
}

export function App() {
  const [onboarded, setOnboarded] = useState<boolean | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const { data } = useQuery({
    queryKey: ["app", "onboarding", refreshKey],
    queryFn: () => settingsRepo.get(SETTINGS.onboardingDone),
  });

  useEffect(() => {
    if (data !== undefined) setOnboarded(data === "1");
  }, [data]);

  useEffect(() => {
    void settingsRepo.get(SETTINGS.fontSize).then((v) => {
      const px = v === "large" ? 17 : v === "normal" || !v ? 15 : Number(v);
      const size = Number.isFinite(px) && px >= 13 && px <= 18 ? px : 15;
      document.documentElement.style.fontSize = `${size}px`;
      document.documentElement.style.setProperty("--ui-scale", String(size / 15));
      document.documentElement.dataset.fontScale = size >= 17 ? "large" : "";
    });
  }, []);

  if (onboarded === null) {
    return <div className="flex h-screen items-center justify-center text-sm text-muted">正在打开本地数据…</div>;
  }

  if (!onboarded) {
    return <OnboardingPage onDone={() => setRefreshKey((k) => k + 1)} />;
  }

  return (
    <UserProvider>
      <ErrorBoundary>
        <Routes>
          <Route element={<Shell />}>
            <Route path="/" element={<Navigate to="/today" replace />} />
            <Route path="/today" element={<TodayPage />} />
            <Route path="/records" element={<RecordsPage />} />
            <Route path="/medications" element={<MedicationsPage />} />
            <Route path="/users" element={<UsersPage />} />
            <Route path="/profile" element={<ProfilePage />} />
            <Route path="/diseases" element={<DiseasesPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/trends" element={<TrendsPage />} />
            <Route path="/review" element={<ReviewPage />} />
            <Route path="/review/:week" element={<ReviewPage />} />
            <Route path="/plan" element={<PlanPage />} />
            <Route path="/diet" element={<DietPage />} />
            <Route path="/ai" element={<AiPage />} />
            <Route path="*" element={<Placeholder name="减重提醒" />} />
          </Route>
        </Routes>
      </ErrorBoundary>
    </UserProvider>
  );
}
