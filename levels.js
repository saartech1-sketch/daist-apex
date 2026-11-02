const LEVELS = [
  {
    name: 'Meadow',
    map: [
      '..W.......',
      '.S........',
      '.......X..',
      '....G.....',
      '..........',
      '.......G..',
      '..........',
      '..G.......',
      '........W.',
      '..........',
    ],
  },
  {
    name: 'Fences',
    map: [
      '.W...X......',
      '.S....#.....',
      '......#..G..',
      '..FFF.#.....',
      '....#.#####.',
      '.G..#.......',
      '....#####...',
      '........#.G.',
      '.######.#...',
      '...W....#...',
      '..G.....#...',
      '............',
    ],
  },
  {
    name: 'Maze',
    map: [
      '#############',
      '#S....#..W.X#',
      '#.###.#.###.#',
      '#.#...#..W#.#',
      '#.#.#####.#.#',
      '#.#.....#.#G#',
      '#.#####.#.###',
      '#...G.#.#.X.#',
      '###.#.#.###.#',
      '#...#.#.....#',
      '#.###.#####.#',
      '#..W..#....G#',
      '#############',
    ],
  },
];

 function parseLevel(level) {
  const height = level.map.length;
  const width = Math.max(...level.map.map((row) => row.length));
  const stones = [];
  const fences = [];
  const grass = [];
  const water = [];
  const wolves = [];
  let sheep = { x: 0, y: 0 };
  level.map.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      if (ch === '#') stones.push({ x, y });
      else if (ch === 'F') fences.push({ x, y });
      else if (ch === 'G') grass.push({ x, y });
      else if (ch === 'W') water.push({ x, y });
      else if (ch === 'X') wolves.push({ x, y });
      else if (ch === 'S') sheep = { x, y };
    });
  });
  return { width, height, stones, fences, grass, water, wolves, sheep };
}
