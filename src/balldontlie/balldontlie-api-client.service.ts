import { Injectable } from '@nestjs/common';
import { bdlGamesResponseSchema, type BdlGame } from './balldontlie.types.js';

/**
 * balldontlie の API クライアント
 */
@Injectable()
export class BalldontlieApiClient {
  /**
   * balldontlie の API エンドポイント
   */
  private endpoint = 'https://api.balldontlie.io/v1';

  /**
   * 認証用の API キー。Authorization ヘッダーにそのまま入れる
   */
  private apiKey: string;

  constructor() {
    this.apiKey = process.env.BDL_API_KEY ?? '';
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
    const res = await fetch(url, { headers: { Authorization: this.apiKey } });
    const body = bdlGamesResponseSchema.parse(await res.json());
    return { games: body.data, nextCursor: body.meta.next_cursor ?? null };
  }
}
