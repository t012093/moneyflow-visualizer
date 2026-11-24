/**
 * この端末への保存（localStorage）。キーはプロトタイプと同じ「yukue.*」。
 * 保存できない環境（プライベートウィンドウなど）でも、画面はそのまま動くようにする。
 */
const PREFIX = 'yukue.';

export const storage = {
  get(key: string): unknown {
    try {
      const v = localStorage.getItem(PREFIX + key);
      return v == null ? null : (JSON.parse(v) as unknown);
    } catch {
      return null;
    }
  },
  set(key: string, value: unknown): void {
    try {
      localStorage.setItem(PREFIX + key, JSON.stringify(value));
    } catch {
      /* storage unavailable */
    }
  },
  del(key: string): void {
    try {
      localStorage.removeItem(PREFIX + key);
    } catch {
      /* storage unavailable */
    }
  },
  /** JSON にしない素の文字列（「AIに聞く」を開いているかどうか） */
  getRaw(key: string): string | null {
    try {
      return localStorage.getItem(PREFIX + key);
    } catch {
      return null;
    }
  },
  setRaw(key: string, value: string): void {
    try {
      localStorage.setItem(PREFIX + key, value);
    } catch {
      /* storage unavailable */
    }
  }
};
