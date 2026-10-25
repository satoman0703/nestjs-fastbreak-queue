import {
  BalldontlieApiClient,
  BalldontlieApiError,
} from '@/balldontlie/balldontlie-api-client.service.js';
import type { BdlGame } from '@/balldontlie/balldontlie.types.js';

const team = (id: number) => ({
  id,
  abbreviation: 'ATL',
  full_name: 'Atlanta Hawks',
  conference: 'East',
  division: 'Southeast',
});

/** 実際の API レスポンス（2015-10-27 ATL vs DET）から、使う項目を抜き出したもの */
const game: BdlGame = {
  id: 27682,
  date: '2015-10-27',
  season: 2015,
  status: 'Final',
  postseason: false,
  home_team_score: 94,
  visitor_team_score: 106,
  home_q1: 25,
  home_q2: 18,
  home_q3: 23,
  home_q4: 28,
  home_ot1: null,
  home_ot2: null,
  home_ot3: null,
  visitor_q1: 25,
  visitor_q2: 23,
  visitor_q3: 34,
  visitor_q4: 24,
  visitor_ot1: null,
  visitor_ot2: null,
  visitor_ot3: null,
  home_team: team(1),
  visitor_team: team(9),
};

const jsonResponse = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

describe('BalldontlieApiClient.fetchGamesPage', () => {
  let client: BalldontlieApiClient;
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    process.env.BDL_API_KEY = 'test-key';
    client = new BalldontlieApiClient();
    // spyOn だけだと本物の fetch が呼ばれ、本物の API を叩いてしまうため既定で失敗させる
    fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('テストで本物の API を叩こうとした'));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.BDL_API_KEY;
  });

  it('シーズンと per_page=100 を付けて、API キーをヘッダーに入れて叩く', async () => {
    fetchSpy.mockResolvedValue(jsonResponse({ data: [], meta: { per_page: 100 } }));

    await client.fetchGamesPage(2015);

    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('https://api.balldontlie.io/v1/games?seasons[]=2015&per_page=100');
    expect((init as RequestInit).headers).toEqual({ Authorization: 'test-key' });
  });

  it('cursor を渡すと URL に付ける', async () => {
    fetchSpy.mockResolvedValue(jsonResponse({ data: [], meta: { per_page: 100 } }));

    await client.fetchGamesPage(2015, { cursor: 28892 });

    expect(fetchSpy.mock.calls[0][0]).toBe(
      'https://api.balldontlie.io/v1/games?seasons[]=2015&per_page=100&cursor=28892',
    );
  });

  it('perPage を渡すとその件数で取得する', async () => {
    fetchSpy.mockResolvedValue(jsonResponse({ data: [], meta: { per_page: 10 } }));

    await client.fetchGamesPage(2015, { perPage: 10 });

    expect(fetchSpy.mock.calls[0][0]).toBe(
      'https://api.balldontlie.io/v1/games?seasons[]=2015&per_page=10',
    );
  });

  it('試合の一覧と次のページの cursor を返す', async () => {
    fetchSpy.mockResolvedValue(
      jsonResponse({ data: [game], meta: { next_cursor: 28892, per_page: 100 } }),
    );

    const result = await client.fetchGamesPage(2015);

    expect(result).toEqual({ games: [game], nextCursor: 28892 });
  });

  it('想定と違う形のレスポンスはエラーにする（項目名が変わった場合）', async () => {
    const { home_q1: _, ...renamed } = game;
    fetchSpy.mockResolvedValue(
      jsonResponse({ data: [{ ...renamed, home_quarter_1: 25 }], meta: { per_page: 100 } }),
    );

    await expect(client.fetchGamesPage(2015)).rejects.toThrow('home_q1');
  });

  it('429 が返ったら状態コードと本文を持った BalldontlieApiError を投げる', async () => {
    fetchSpy.mockResolvedValue(new Response('Too Many Requests', { status: 429 }));

    const error = await client.fetchGamesPage(2015).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(BalldontlieApiError);
    expect(error).toMatchObject({
      message: 'HTTP Error: 429',
      info: { status: 429, data: 'Too Many Requests' },
    });
  });

  it('API キーが未設定なら API を叩かずにエラーにする', async () => {
    delete process.env.BDL_API_KEY;
    const clientWithoutKey = new BalldontlieApiClient();

    await expect(clientWithoutKey.fetchGamesPage(2015)).rejects.toThrow('BDL_API_KEY is not set');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('最後のページ（next_cursor が無い）では nextCursor を null にする', async () => {
    fetchSpy.mockResolvedValue(jsonResponse({ data: [game], meta: { per_page: 100 } }));

    const result = await client.fetchGamesPage(2015);

    expect(result.nextCursor).toBeNull();
  });

  it('BDL_API_URL を指定すると、本物の代わりにその URL を叩く', async () => {
    vi.stubEnv('BDL_API_URL', 'http://localhost:4010/v1');
    const fakeClient = new BalldontlieApiClient();
    fetchSpy.mockResolvedValue(jsonResponse({ data: [game], meta: { per_page: 100 } }));

    await fakeClient.fetchGamesPage(2015);

    expect(fetchSpy.mock.calls[0][0]).toBe(
      'http://localhost:4010/v1/games?seasons[]=2015&per_page=100',
    );
    vi.unstubAllEnvs();
  });
});
