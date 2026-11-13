import { createDefaultProfile, type AppSettings, type DomainProfile } from './types';

const SETTINGS_KEY = 'app:settings';
const profileKey = (host: string) => `profile:${host}`;

function storageGet<T>(key: string): Promise<T | undefined> {
  return new Promise((resolve) => {
    chrome.storage.local.get(key, (items) => resolve(items[key] as T | undefined));
  });
}

function storageSet(key: string, value: unknown): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [key]: value }, () => resolve());
  });
}

export async function getSettings(): Promise<AppSettings> {
  return (await storageGet<AppSettings>(SETTINGS_KEY)) ?? { enabled: true };
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  await storageSet(SETTINGS_KEY, settings);
}

export async function getProfile(host: string): Promise<DomainProfile> {
  const stored = await storageGet<Partial<DomainProfile>>(profileKey(host));
  return { ...createDefaultProfile(), ...(stored ?? {}) };
}

export async function saveProfile(host: string, profile: DomainProfile): Promise<void> {
  await storageSet(profileKey(host), profile);
}

/** Hostname used as the per-site profile key. */
export function currentHost(): string {
  return location.hostname || location.origin || 'unknown';
}

export function debounce<T extends (...args: never[]) => void>(fn: T, ms: number): T & { flush: () => void; cancel: () => void } {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const wrapped = ((...args: Parameters<T>) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn(...args);
    }, ms);
  }) as T & { flush: () => void; cancel: () => void };
  wrapped.flush = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
      fn();
    }
  };
  wrapped.cancel = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };
  return wrapped;
}