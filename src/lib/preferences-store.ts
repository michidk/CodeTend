import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type ThemePreference = 'light' | 'dark' | 'system'

type PreferencesState = {
  readonly theme: ThemePreference
  readonly hasHydrated: boolean
  readonly setTheme: (theme: ThemePreference) => void
  readonly markHydrated: () => void
}

function isThemePreference(value: unknown): value is ThemePreference {
  return value === 'light' || value === 'dark' || value === 'system'
}

export const usePreferencesStore = create<PreferencesState>()(
  persist(
    (set) => ({
      theme: 'system',
      hasHydrated: false,
      setTheme: (theme) => set({ theme }),
      markHydrated: () => set({ hasHydrated: true }),
    }),
    {
      name: 'codetend-preferences',
      version: 1,
      skipHydration: true,
      partialize: ({ theme }) => ({ theme }),
      merge: (persistedState, currentState) => {
        const theme = Reflect.get(persistedState ?? {}, 'theme')
        return {
          ...currentState,
          ...(isThemePreference(theme) ? { theme } : {}),
        }
      },
    },
  ),
)
