export const TOKEN_KEY = 'gda.token';
export const USER_KEY = 'gda.user';

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

interface ApiOptions {
  method?: 'GET' | 'POST';
  body?: unknown;
  /** 覆盖 token（默认读 localStorage） */
  token?: string | null;
}

/** 原生 fetch 封装：/api 前缀（vite 代理会去掉）、JSON、Authorization 头。 */
export async function api<T>(path: string, opts: ApiOptions = {}): Promise<T> {
  const token = opts.token !== undefined ? opts.token : localStorage.getItem(TOKEN_KEY);
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method: opts.method ?? 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  } catch {
    throw new ApiError(0, '网络连接失败，请确认服务已启动');
  }

  let data: unknown = null;
  const text = await res.text();
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }
  if (!res.ok) {
    const m = (data as { message?: unknown } | null)?.message;
    throw new ApiError(
      res.status,
      Array.isArray(m)
        ? m.join(' ')
        : typeof m === 'string' && m
          ? m
          : `请求失败（${res.status}）`,
    );
  }
  return data as T;
}
