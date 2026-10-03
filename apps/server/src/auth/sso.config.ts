/**
 * SSO（OIDC IdP）接入配置：每次调用时读取 process.env，
 * 便于 e2e 用进程内伪造 IdP 覆盖 SSO_ISSUER（应用启动后再改环境也生效）。
 * 开发默认值与根目录 .env / sso-server 本地内存模式一致。
 */
export interface SsoConfig {
  issuer: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  frontendOrigin: string;
}

export function ssoConfig(): SsoConfig {
  const issuer = (process.env.SSO_ISSUER ?? 'http://127.0.0.1:8080').replace(
    /\/+$/,
    '',
  );
  const publicUrl = (
    process.env.SERVER_PUBLIC_URL ?? 'http://127.0.0.1:3001'
  ).replace(/\/+$/, '');
  return {
    issuer,
    clientId: process.env.SSO_CLIENT_ID ?? 'guess-draw-anime',
    clientSecret: process.env.SSO_CLIENT_SECRET ?? 'devsecret123',
    redirectUri: `${publicUrl}/auth/sso/callback`,
    frontendOrigin: (
      process.env.FRONTEND_ORIGIN ?? 'http://127.0.0.1:5175'
    ).replace(/\/+$/, ''),
  };
}
