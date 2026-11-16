// Type declarations for the shared simulation module (sim.js).
// The implementation is plain JavaScript shared verbatim with the server,
// so the app's game and the server's replay can never drift apart.
// This .d.ts sits next to sim.js so TypeScript resolves these types for
// every importer, whatever the relative path. Node (server) ignores it.

export const FIELD_WIDTH: number;

export interface GameConfig {
  initialWidth: number;
  perfectTolerance: number;
  basePeriodMs: number;
  minPeriodMs: number;
  periodDecayPerFloor: number;
  pointsPerFloor: number;
  perfectBaseBonus: number;
  perfectComboStep: number;
}
export const GAME_CONFIG: GameConfig;

export function hashString32(text: string): number;
export function dailySeed(dateJst: string): number;
export function mulberry32(seed: number): () => number;
export function seedPhase(seed: number): { phase01: number; direction: number };
export function periodForLevel(level: number, config?: GameConfig): number;
export function blockLeftAt(
  elapsedMs: number,
  level: number,
  seed: number,
  width: number,
  config?: GameConfig,
): number;

export interface FloorResult {
  level: number;
  tapMs: number;
  blockLeft: number;
  widthBefore: number;
  offset: number;
  perfect: boolean;
  combo: number;
  newLeft: number;
  newWidth: number;
  points: number;
  gameOver: boolean;
}
export interface SimResult {
  floors: FloorResult[];
  floorsStacked: number;
  perfects: number;
  maxCombo: number;
  score: number;
  gameOver: boolean;
}
export function simulate(seed: number, tapTimesMs: number[], config?: GameConfig): SimResult;
