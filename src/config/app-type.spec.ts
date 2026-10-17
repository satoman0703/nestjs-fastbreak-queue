import { getAppType } from './app-type.js';

describe('getAppType', () => {
  it('APP_TYPE=api なら api を返す', () => {
    expect(getAppType({ APP_TYPE: 'api' })).toBe('api');
  });

  it('APP_TYPE=worker なら worker を返す', () => {
    expect(getAppType({ APP_TYPE: 'worker' })).toBe('worker');
  });

  it('APP_TYPE が未設定ならエラーにする', () => {
    expect(() => getAppType({})).toThrow('APP_TYPE must be "api" or "worker"');
  });

  it('APP_TYPE が想定外の値ならエラーにする', () => {
    expect(() => getAppType({ APP_TYPE: 'wroker' })).toThrow('APP_TYPE must be "api" or "worker"');
  });
});
