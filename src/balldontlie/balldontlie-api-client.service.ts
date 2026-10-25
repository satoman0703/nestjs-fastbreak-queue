import { Injectable } from '@nestjs/common';
import { bdlGamesResponseSchema, type BdlGame } from '@/balldontlie/balldontlie.types.js';

/**
 * balldontlie の API が 400 以上を返したときのエラー。
 * 429（レート制限）と 401（キー不正）では対処が違うため、呼び出し側が status で見分けられるようにする
 */
export class BalldontlieApiError extends Error {
  info: { url: string; status: number; data: string };

  constructor(message: string, info: BalldontlieApiError['info']) {
    super(message);
    this.name = 'BalldontlieApiError';
    this.info = info;
  }
}

/**
 * balldontlie の API クライアント
 */
@Injectable()
export class BalldontlieApiClient {
  /**
   * balldontlie の API エンドポイント。複数 worker の計測などで本物に負荷をかけないよう、BDL_API_URL で偽物に差し替えられる
   */
  private endpoint: string;

  /**
   * 認証用の API キー。Authorization ヘッダーにそのまま入れる
   */
  private apiKey: string;

  /**
   * キーが無くてもここでは例外にしない。
   * Nest は起動時に全 provider を new するため、ここで投げると balldontlie を叩かない api プロセスまで起動できなくなる。
   * キーのチェックは fetchGamesPage で叩く直前に行う
   */
  constructor() {
    this.apiKey = process.env.BDL_API_KEY ?? '';
    this.endpoint = process.env.BDL_API_URL || 'https://api.balldontlie.io/v1';
  }

  /**
   * fetch は 400 番台でもエラーにならないので、400 以上であればエラーを投げる
   */
  private async checkHttpError(res: Response): Promise<void> {
    if (res.status >= 400) {
      throw new BalldontlieApiError(`HTTP Error: ${res.status}`, {
        url: res.url,
        status: res.status,
        data: await res.text(),
      });
    }
  }

  /**
   * 1 シーズン分の試合を 1 ページ取得する。
   * cursor 方式なので総件数はわからず、nextCursor が null になるまで呼び続ける。
   * @param options.perPage 既定は API の上限の 100。5 回/分の制限があるため、件数を増やしてリクエスト回数を減らす
   */
  async fetchGamesPage(
    season: number,
    { cursor, perPage = 100 }: { cursor?: number; perPage?: number } = {},
  ): Promise<{ games: BdlGame[]; nextCursor: number | null }> {
    const url = `${this.endpoint}/games?seasons[]=${season}&per_page=${perPage}${cursor === undefined ? '' : `&cursor=${cursor}`}`;
    if (!this.apiKey) {
      throw new Error('BDL_API_KEY is not set');
    }
    const res = await fetch(url, { headers: { Authorization: this.apiKey } });
    await this.checkHttpError(res);
    const body = bdlGamesResponseSchema.parse(await res.json());
    return { games: body.data, nextCursor: body.meta.next_cursor ?? null };
  }
}
