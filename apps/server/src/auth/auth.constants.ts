const envSecret = process.env.JWT_SECRET;
if (!envSecret && process.env.NODE_ENV === 'production') {
  // eslint-disable-next-line no-console
  console.warn(
    '[auth] JWT_SECRET 未配置，正在使用开发默认值——生产环境务必设置 JWT_SECRET 环境变量',
  );
}

export const JWT_SECRET = envSecret ?? 'guess-draw-anime-dev-secret';
export const JWT_EXPIRES_IN = '7d';
