/**
 * balldontlie の GET /v1/games の偽物。worker を増やしたときの呼び出し回数を、本物の 5 回/分を超えずに計測するために使う。
 * 1 シーズン 14 ページ（100 件 × 13 + 30 件）を返し、受けたリクエストを「最初の 1 回からの経過秒」付きでログに出す。
 * 使い方: pnpm fake:bdl → api / worker を BDL_API_URL=http://host.docker.internal:4010/v1 で起動する
 */
import { createServer } from 'node:http';

const PORT = Number(process.env.FAKE_BDL_PORT ?? 4010);
const PER_PAGE = 100;
const PAGES = 14;
const LAST_PAGE_SIZE = 30;
/**
 * 開発用 DB に保存されるので、本物のチーム（1〜45）・試合と id がぶつからない範囲を使う。
 * 計測の後は pnpm db:psql で `DELETE FROM "Game" WHERE id >= 900000000;` と `DELETE FROM "Team" WHERE id >= 9000;` を流して消す
 */
const FAKE_GAME_ID_BASE = 900_000_000;
const FAKE_TEAM_IDS = [9001, 9002] as const;

const team = (id: number) => ({
  id,
  abbreviation: `F${id}`,
  full_name: `Fake Team ${id}`,
  conference: 'East',
  division: 'Atlantic',
});

const game = (id: number, season: number) => ({
  id,
  date: `${season}-11-01`,
  season,
  status: 'Final',
  postseason: false,
  home_team_score: 100,
  visitor_team_score: 90,
  home_q1: 25,
  home_q2: 25,
  home_q3: 25,
  home_q4: 25,
  home_ot1: null,
  home_ot2: null,
  home_ot3: null,
  visitor_q1: 20,
  visitor_q2: 20,
  visitor_q3: 25,
  visitor_q4: 25,
  visitor_ot1: null,
  visitor_ot2: null,
  visitor_ot3: null,
  home_team: team(FAKE_TEAM_IDS[0]),
  visitor_team: team(FAKE_TEAM_IDS[1]),
});

let firstRequestAt: number | undefined;

createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
  if (url.pathname !== '/v1/games') {
    res.writeHead(404).end();
    return;
  }
  const season = Number(url.searchParams.get('seasons[]'));
  // cursor はページ番号 × 100 にしている（本物は試合 id だが、次のページを指せれば足りる）
  const page = Number(url.searchParams.get('cursor') ?? 0) / PER_PAGE;
  const size = page === PAGES - 1 ? LAST_PAGE_SIZE : PER_PAGE;
  // シーズンごとに id がぶつからないよう、シーズン × 10000 から振る
  const data = Array.from({ length: size }, (_, i) =>
    game(FAKE_GAME_ID_BASE + season * 10_000 + page * PER_PAGE + i, season),
  );
  const nextCursor = page < PAGES - 1 ? (page + 1) * PER_PAGE : undefined;

  firstRequestAt ??= Date.now();
  const elapsed = ((Date.now() - firstRequestAt) / 1000).toFixed(1).padStart(6);
  console.log(`${elapsed}s season=${season} page=${page + 1}/${PAGES}`);

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ data, meta: { next_cursor: nextCursor, per_page: PER_PAGE } }));
}).listen(PORT, '127.0.0.1', () => {
  console.log(`fake balldontlie: http://localhost:${PORT}/v1/games`);
});
