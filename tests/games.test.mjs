import assert from 'node:assert/strict';
import { Game, ballCountForScore } from '../src/game/game.ts';
import { CONFIG } from '../src/game/config.ts';
import { LevelBuilder } from '../src/game/levels.ts';
import { moveBall } from '../src/game/physics.ts';
import { Random } from '../src/game/random.ts';

for (const [score, balls] of [
  [0, 1], [49, 1], [50, 2], [74, 2], [75, 3],
  [112, 3], [113, 4], [168, 4], [169, 5],
]) {
  assert.equal(ballCountForScore(score), balls, `ball count at ${score} points`);
}

function positions(seed) {
  const levels = new LevelBuilder(new Random(seed));
  return [levels.opening()[0].x, ...Array.from({ length: 24 }, (_, i) => levels.newRow(i + 2, [])[0].x)];
}
assert.deepEqual(positions(42), positions(42), 'a seed must reproduce the same random positions');
assert.notDeepEqual(positions(42), positions(43), 'different seeds must move the bricks');
assert.equal(new Set(positions(42)).size, 6, 'random placement should use all six lanes');

const returningBall = {
  x: 350, y: CONFIG.lossY - CONFIG.ballRadius - 2,
  vx: 0, vy: CONFIG.ballSpeed,
  age: CONFIG.previewSeconds + 1, lastBrickId: -1, lastBrickAt: -1,
};
assert.equal(moveBall(returningBall, [], [], CONFIG.fixedStep).collected, true);
assert.equal(returningBall.y + CONFIG.ballRadius, CONFIG.lossY);

const outboundBall = {
  ...returningBall, y: CONFIG.lossY + 40, vy: -CONFIG.ballSpeed,
};
assert.equal(moveBall(outboundBall, [], [], CONFIG.fixedStep).collected, false, 'outbound balls must cross the line');

const armored = { id: 99, x: 300, y: 500, w: 91, h: 70,
  hp: 100, initialHp: 100, hue: 36, armor: 2 };
for (let hit = 1; hit <= armored.armor; hit++) {
  const ball = { x: 345, y: 580, vx: 0, vy: -CONFIG.ballSpeed,
    age: 0, lastBrickId: -1, lastBrickAt: -1 };
  assert.equal(moveBall(ball, [armored], [], CONFIG.fixedStep).damage,
    hit === armored.armor ? 1 : 0);
}
assert.equal(armored.hp, 99, 'one full armor cycle must remove exactly one HP');

const delayedGame = new Game();
delayedGame.bricks = [];
delayedGame.phase = 'RESOLVING';
delayedGame.balls = [{ ...returningBall, y: CONFIG.lossY - CONFIG.ballRadius - 2 }];
delayedGame.update();
assert.equal(delayedGame.phase, 'ADVANCING', 'the shot ends when the ball touches the loss line');
delayedGame.update();
assert.equal(delayedGame.turn, 2);
assert.equal(delayedGame.bricks[0].y, CONFIG.topRowY);
for (let step = 1; step < CONFIG.turnDelaySeconds / CONFIG.fixedStep; step++) {
  delayedGame.update();
  assert.equal(delayedGame.phase, 'AIMING', 'the next shot waits one second');
}
delayedGame.update();
assert.equal(delayedGame.phase, 'FIRING');

const count = Number(process.env.GAME_COUNT || 8);
const seed = Number(process.env.GAME_SEED || CONFIG.seed);
const records = [];
const game = new Game(seed, (record) => {
  const brick = game.bricks.find((item) => item.id === record.losingBrickId);
  assert.ok(brick, 'the losing brick must exist at the boundary');
  assert.equal(brick.hp, record.losingBrickHp);
  assert.equal(brick.initialHp, record.losingBrickValue);
  assert.ok(brick.y + brick.h >= CONFIG.lossY);
  records.push(record);
});

function checkOpening() {
  assert.equal(game.turn, 1);
  assert.equal(game.bricks.length, 1, 'a new game must show only brick 1');
  assert.equal(game.bricks[0].initialHp, 1);
  assert.equal(game.bricks[0].hp, 1);
}

checkOpening();
let seen = new Set(game.bricks.map((brick) => brick.id));
let previousTurn = 1;
let previousGame = 1;
let hitIds = new Set();
let multiBrickShots = 0;
let spawned = 0;
let bonusBallsSeen = false;
let steps = 0;
const maxSteps = 120 * 1800 * count;

while (records.length < count && steps < maxSteps) {
  const before = new Map(game.bricks.map((brick) => [brick.id, brick.hp]));
  game.update(CONFIG.fixedStep);
  steps++;
  assert.equal(game.ballCount, ballCountForScore(game.score), 'ball count follows the growing score thresholds');
  if (game.ballCount > CONFIG.startingBalls) bonusBallsSeen = true;

  if (game.gameIndex !== previousGame) {
    previousGame = game.gameIndex;
    previousTurn = 1;
    seen = new Set(game.bricks.map((brick) => brick.id));
    hitIds = new Set();
    checkOpening();
    continue;
  }

  for (const [id, hp] of before) {
    const after = game.bricks.find((brick) => brick.id === id);
    if ((after?.hp ?? 0) < hp) hitIds.add(id);
  }
  if (game.turn === 1 && game.score > 0) {
    assert.equal(game.score, 1, 'the first collision must break brick 1');
    assert.equal(game.bricks.length, 0);
  }

  if (game.turn !== previousTurn) {
    assert.equal(game.turn, previousTurn + 1);
    if (previousTurn === 2) {
      assert.equal(game.bricks.find((brick) => brick.initialHp === 2)?.hp, 1, 'brick 2 should survive to form the first ricochet pair');
    }
    if (previousTurn === 3) {
      assert.ok(hitIds.size >= 2, 'the third shot should bounce into both available bricks');
    }
    if (hitIds.size >= 2) multiBrickShots++;
    hitIds = new Set();
    previousTurn = game.turn;
    const fresh = game.bricks.filter((brick) => !seen.has(brick.id));
    const expectedCount = Math.min(CONFIG.maxBricksPerRow,
      1 + Math.floor((game.turn - 1) / CONFIG.turnsPerExtraBrick));
    assert.ok(fresh.length > 0 && fresh.length <= expectedCount,
      'each turn should add bricks up to its current wave size');
    for (const brick of fresh) {
      assert.equal(brick.initialHp, game.turn, 'new bricks must display the current turn value');
      assert.equal(brick.y, CONFIG.topRowY);
      assert.equal(brick.armor ?? 1, expectedCount);
      for (const other of game.bricks) {
        if (other.id === brick.id) continue;
        assert.ok(brick.x + brick.w <= other.x || other.x + other.w <= brick.x ||
          brick.y + brick.h <= other.y || other.y + other.h <= brick.y,
        'new bricks must not overlap active bricks');
      }
      seen.add(brick.id);
      spawned++;
    }
  }
}

assert.equal(records.length, count, `${count} consecutive games must end and restart automatically`);
assert.ok(multiBrickShots >= count, 'balls must hit multiple bricks during a shot in each game');
assert.ok(bonusBallsSeen, 'the autoplay must reach a 50-point ball reward');
for (const record of records) {
  assert.ok(Number.isInteger(record.losingBrickHp) && record.losingBrickHp > 0,
    'the crossing brick must still have positive HP');
}
console.log(JSON.stringify({ seed, games: count, spawned, multiBrickShots, simulatedSeconds: Math.round(steps * CONFIG.fixedStep), losses: count <= 12 ? records : undefined }, null, 2));
