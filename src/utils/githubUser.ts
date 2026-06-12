let cachedLogin: string | null = null;

export async function fetchUserLogin(token: string): Promise<string | null> {
  if (cachedLogin) return cachedLogin;
  try {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 8000);
    const res = await fetch('https://api.github.com/user', {
      headers: { Authorization: 'token ' + token, Accept: 'application/vnd.github+json' },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const data = await res.json() as { login: string };
    cachedLogin = data.login;
    return cachedLogin;
  } catch { return null; }
}

export function clearUserLoginCache(): void { cachedLogin = null; }
