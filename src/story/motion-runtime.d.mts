export const FORBIDDEN: [RegExp, string][];
export function checkScript(script: string): string[];
export function sanitizeHtml(html: string, assetUrl?: (p: string) => string): { html: string; errs: string[] };
export function scopeCss(css: string, rootId: string): { css: string; errs: string[] };
export function buildMotion(opts: {
  root: HTMLElement;
  html: string;
  css?: string;
  script: string;
  gsap: any;
  cue: (ref: string) => number;
  assetUrl?: (p: string) => string;
  W?: number;
  H?: number;
  dur?: number;
}): { tl: any; seek: (sec: number) => void; dispose: () => void };
export const KIT_ROLES: Record<string, { skin: string; hair: string; top: string; pants: string; extra: string; label: string }>;
export function personSvg(role: string, opts?: any): string;
export function expandKit(html: string): string;
