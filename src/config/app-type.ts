/**
 * 同じコード・同じ image を、環境変数で API プロセスと worker プロセスに切り替える。
 * 未設定を api 扱いにしないのは、worker のつもりで起動したプロセスが黙って api になり、
 * ジョブが誰にも消費されない事故を起動時に止めるため。
 */
export type AppType = 'api' | 'worker';

/**
 * AppModule.register が受け取った appType を DI で渡すための鍵。起動後に環境変数を読み直さない
 */
export const APP_TYPE = Symbol('APP_TYPE');

const APP_TYPES: readonly AppType[] = ['api', 'worker'];

export function getAppType(env: NodeJS.ProcessEnv = process.env): AppType {
  const value = env.APP_TYPE;
  if (!APP_TYPES.includes(value as AppType)) {
    throw new Error('APP_TYPE must be "api" or "worker"');
  }
  return value as AppType;
}
