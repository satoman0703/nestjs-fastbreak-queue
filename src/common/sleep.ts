import { setTimeout } from 'node:timers/promises';

export type Sleep = (ms: number) => Promise<void>;

/**
 * 待機処理の DI トークン。
 * テストで本当に待たずに済むよう、setTimeout を直接呼ばずに差し替えられるようにする
 */
export const SLEEP = Symbol('SLEEP');

export const sleep: Sleep = async (ms) => {
  await setTimeout(ms);
};
