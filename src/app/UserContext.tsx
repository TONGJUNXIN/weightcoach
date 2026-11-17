import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { userRepo } from "@/db/repositories";
import type { UserRow } from "@/db/types";
import { useToast, showError } from "@/components/ui";

interface UserContextValue {
  user: UserRow | null;
  ready: boolean;
  switching: boolean;
  refresh: () => Promise<void>;
  switchTo: (id: string) => Promise<void>;
}

const UserContext = createContext<UserContextValue>({
  user: null,
  ready: false,
  switching: false,
  refresh: async () => {},
  switchTo: async () => {},
});

export function UserProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserRow | null>(null);
  const [ready, setReady] = useState(false);
  const [switching, setSwitching] = useState(false);
  const queryClient = useQueryClient();
  const { show } = useToast();

  const refresh = useCallback(async () => {
    const u = await userRepo.resolveActive();
    setUser(u);
    setReady(true);
  }, []);

  useEffect(() => {
    refresh().catch((e) => {
      showError(e, show);
      setReady(true);
    });
  }, [refresh, show]);

  const switchTo = useCallback(async (id: string) => {
    if (!user || id === user.id) return;
    setSwitching(true);
    try {
      await userRepo.switch(user.id, id);
      // 失效全部查询并刷新（SRS 表 5-1）
      queryClient.clear();
      await refresh();
    } catch (e) {
      showError(e, show); // 失败保留原成员
    } finally {
      setSwitching(false);
    }
  }, [user, queryClient, refresh, show]);

  const value = useMemo(() => ({ user, ready, switching, refresh, switchTo }), [user, ready, switching, refresh, switchTo]);
  return <UserContext.Provider value={value}>{children}</UserContext.Provider>;
}

export function useUser() {
  return useContext(UserContext);
}
