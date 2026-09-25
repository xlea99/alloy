// Phase 7 integration test. Throwaway tooling, per the OFCU Bible.
//
// Proves the whole export path end to end, with no browser and no hand-editing:
//   1. author an Alloy package in Node, from nothing
//   2. write a bare OFCU game file that carries it and calls the runtime API
//   3. install the engine into that file through OFCU Manager, the real lifecycle call
//   4. validate the result
//
// Run from anywhere: node alloy/alloy_integrate.js
'use strict';
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..');   // the universe: alloy/ and ofcu-manager/ are folders in it
const TARGET = 'workspace/integration-target.html';

let failures = 0;
const ok = (n) => console.log('  ok   ' + n);
const bad = (n, why) => { failures++; console.log('  FAIL ' + n + (why ? '\n         ' + why : '')); };
const check = (n, c, why) => (c ? ok(n) : bad(n, why));

// ---------------------------------------------------------------- load both engines in Node
function blockBody(html, attrMatch) {
  const openRe = /<script\b[^>]*>/gi;
  let m;
  while ((m = openRe.exec(html))) {
    if (attrMatch.test(m[0])) {
      const start = m.index + m[0].length;
      return html.slice(start, html.indexOf('</' + 'script', start));
    }
  }
  throw new Error('block not found: ' + attrMatch);
}

const alloyHtml = fs.readFileSync(path.join(DIR, 'alloy/alloy.html'), 'utf8');
const Alloy = new Function(blockBody(alloyHtml, /data-ofcu-type="exportable"/) + '\n;return Alloy;')();

const mgrHtml = fs.readFileSync(path.join(DIR, 'ofcu-manager/ofcu-manager.html'), 'utf8');
const { OFCU, OFCUManager } = new Function('require',
  // By the package on the tag: the manager's law block quotes example exportable tags.
  blockBody(mgrHtml, /data-ofcu-type="exportable"[^>]*data-ofcu-package="ofcu-manager"/) + '\n' +
  blockBody(mgrHtml, /data-ofcu-project="ofcu-manager"[^>]*data-ofcu-part="core"/) + '\n;return { OFCU, OFCUManager };')(require);

console.log('\n=== a package authored in Node ===');

// Everything below is written by hand, in a file with no DOM, no canvas and no GL. That is the
// claim the texture and mesh engines have been making since Phase 1, and this is where it gets
// cashed: the package a game ships can be produced by a script.
const pkg = Alloy.emptyPackage('foundry');

pkg.textures.panel = {
  name: 'panel', width: 64, height: 64, seed: 7,
  layers: [
    { type: 'generator', generator: 'perlin',
      params: { scale: 6, octaves: 3, low: '#39424f', high: '#7a8798' } },
    { type: 'ops', ops: [
      { op: 'rect', x: 0.04, y: 0.04, w: 0.92, h: 0.92, fill: null,
        stroke: '#0e1218', width: 0.035 },
    ] },
  ],
};
pkg.textures.stripe = {
  name: 'stripe', width: 64, height: 64, seed: 3,
  layers: [
    { type: 'generator', generator: 'checker',
      params: { cols: 1, rows: 8, colorA: '#e0a33a', colorB: '#20242c' } },
  ],
};

pkg.materials.hull = { name: 'hull', texture: 'panel', color: '#ffffff' };
pkg.materials.trim = { name: 'trim', texture: 'stripe', color: '#ffffff', emissive: '#241a06' };

// A two-bone arm on a body, so the clip below has something to move and the bone path is
// exercised rather than assumed.
pkg.models.turret = {
  name: 'turret',
  nodes: [
    { name: 'base', primitive: 'cylinder', material: 'hull',
      params: { radiusTop: 0.9, radiusBottom: 1, height: 0.5, radialSegments: 10 }, children: [
      { name: 'mast', position: [0, 0.25, 0], bone: true, primitive: 'box', material: 'trim',
        params: { width: 0.4, height: 1.2, depth: 0.4 }, children: [
        // Rotated a quarter turn about X so the cylinder lies along Z: a barrel, not a mast.
        { name: 'barrel', position: [0, 0.75, 0], rotation: [90, 0, 0], bone: true,
          primitive: 'cylinder', material: 'hull',
          params: { radiusTop: 0.13, radiusBottom: 0.18, height: 1.7, radialSegments: 8 } },
      ] },
    ] },
  ],
};

pkg.clips.sweep = {
  name: 'sweep', model: 'turret', duration: 3, loop: true,
  tracks: {
    mast: { rotation: [
      { t: 0, v: [0, -55, 0], ease: 'easeInOut' },
      { t: 1.5, v: [0, 55, 0], ease: 'easeInOut' },
      { t: 3, v: [0, -55, 0] },
    ] },
    barrel: { rotation: [
      { t: 0, v: [-8, 0, 0] },
      { t: 0.75, v: [-26, 0, 0], ease: 'easeInOut' },
      { t: 2.25, v: [-26, 0, 0] },
      { t: 3, v: [-8, 0, 0], ease: 'easeInOut' },
    ] },
  },
  events: [{ t: 1.5, name: 'sweep-centre' }],
};

check('the package validates', Alloy.validatePackage(pkg).length === 0,
  Alloy.validatePackage(pkg).join('; '));

// The textures evaluate here, in Node, which is the only way to know the game will not open on a
// throw. Pixels, not promises.
const px = Alloy.texture.evaluate(pkg.textures.panel);
check('a texture evaluates to pixels', px.width === 64 && px.data.length === 64 * 64 * 4);
let lit = 0;
for (let i = 0; i < px.data.length; i += 4) if (px.data[i] > 0.01) lit++;
check('and the pixels are not blank', lit > 3000, lit + ' of ' + (64 * 64));

// The model merges, and the bones the clip names are the bones the rig has.
const merged = Alloy.mergeModel(pkg.models.turret);
const boneNames = merged.bones.map((b) => b.name).join(',');
check('the model merges with its bones', boneNames === ',mast,barrel', boneNames);
const missing = Object.keys(pkg.clips.sweep.tracks)
  .filter((b) => merged.bones.every((x) => x.name !== b));
check('every bone the clip names exists on the rig', missing.length === 0, missing.join(', '));

// And the clip actually moves it — a rig that poses identically at every time is a clip nobody
// would notice was broken.
const anim = Alloy.makeAnimator({ model: pkg.models.turret, bones: merged.bones, clips: pkg.clips });
const out = new Float32Array(merged.bones.length * 16);
/**
 * Where the barrel points at a given time: the third column of its world matrix, which is the
 * bone's local +Z in world space. Asking the animator beats working it out from the rig by hand,
 * and a test that computes the answer the same way the code does proves nothing anyway.
 * @param {number} t - the time in the clip
 * @returns {number[]} - a unit vector
 */
function aimAt(t) {
  anim.poseAt([{ clip: 'sweep', time: t }], out);
  const m = anim.worldOf('barrel');
  return Alloy.vec3.normalize([], [m[8], m[9], m[10]]);
}
const a = aimAt(0), b = aimAt(1.5);
const swing = Math.acos(Math.max(-1, Math.min(1, Alloy.vec3.dot(a, b)))) * 180 / Math.PI;
// The mast sweeps from -55 to +55 degrees, so the barrel should end up about 110 degrees round.
check('the clip swings the barrel', swing > 90 && swing < 130, swing.toFixed(1) + ' degrees');

console.log('\n=== a game file, written from the package ===');

const constName = Alloy.packageIdent('foundry');
// The engine hands back attrs and content (law engine.block); the manager renders the block.
const rendered = Alloy.packageBlock(pkg, {
  project: 'foundry',
  changelog: ['Authored in Node by the Phase 7 integration test, then installed into this file.',
              'Plain data: edit it here, or open it in alloy.html and re-export.'],
});
const dataBlock = OFCUManager.renderBlock(rendered.attrs, rendered.content, { tag: '', content: '  ' }, '\n');
check('the data block round-trips', (() => {
  const back = Alloy.parsePackageBlock(rendered.content);
  return JSON.stringify(back) === JSON.stringify(pkg);
})());
check('the block declares the expected global', dataBlock.indexOf('const ' + constName + ' =') > 0,
  constName);

// The target starts with NO engine in it: data and app only. Installing has to put the engine
// above them both, which is the ordering rule doing real work rather than being asserted about.
const appBlock = [
  '  "use strict";',
  '',
  '  // A game file. The engine above is a managed package installed by OFCU Manager; the data',
  '  // block above it was authored in Node. This block is the only part written by hand.',
  '',
  '  const canvas = document.getElementById("view");',
  '  const stage = Alloy.init(canvas, {',
  '    package: ' + constName + ',',
  '    camera: { distance: 8, yaw: 34, pitch: 20 },',
  '  });',
  '  stage.camera.attach(canvas);',
  '',
  '  // Three turrets, one model, one vertex buffer, three poses.',
  '  const cast = [-3, 0, 3].map((x, i) => stage.createInstance("turret", {',
  '    position: [x, 0, 0],',
  '  }).play("sweep", { loop: true, offset: i * 0.7 }));',
  '',
  '  // Events fire on crossing, in a game exactly as in the clip editor.',
  '  window.ALLOY_EVENTS = [];',
  '  cast[0].onEvent((e) => window.ALLOY_EVENTS.push(e.name));',
  '',
  '  // Proof for the test harness that the runtime API is all reachable from here.',
  '  window.ALLOY_STAGE = stage;',
  '  window.ALLOY_CAST = cast;',
  '',
  '  let last = performance.now();',
  '  function frame(now) {',
  '    const dt = Math.min((now - last) / 1000, 0.1);',
  '    last = now;',
  '    window.ALLOY_STATS = stage.render(dt);',
  '    requestAnimationFrame(frame);',
  '  }',
  '  requestAnimationFrame(frame);',
].join('\n');

const bare = [
  '<!DOCTYPE html>',
  '<html lang="en">',
  '<head>',
  '<meta charset="utf-8">',
  '<title>foundry</title>',
  '<style>',
  '  html, body { margin: 0; height: 100%; background: #0a0c10; overflow: hidden; }',
  '  canvas { display: block; width: 100%; height: 100%; }',
  '<' + '/' + 'style>',
  '<' + '/' + 'head>',
  '<body>',
  '<canvas id="view"><' + '/' + 'canvas>',
  '',
  dataBlock,
  '',
  '<' + 'script data-ofcu-type="app" data-ofcu-project="foundry">',
  appBlock,
  '<' + '/' + 'script>',
  '<' + '/' + 'body>',
  '<' + '/' + 'html>',
  '',
].join('\n');

fs.writeFileSync(path.join(DIR, TARGET), bare, 'utf8');
ok('wrote ' + TARGET + ' with no engine in it');

(async () => {
  console.log('\n=== installing through OFCU Manager ===');

  // Dry run first, exactly as a human would from the manager's UI. The token is the hash of the
  // file it planned against, and passing it back is what makes the install refuse a file that
  // moved underneath it.
  const plan = await OFCU.install('alloy', TARGET, { dir: DIR, dryRun: true });
  check('the dry run plans an install', !!plan && !!plan.token, JSON.stringify(plan && plan.action));

  const done = await OFCU.install('alloy', TARGET, { dir: DIR, token: plan.token });
  check('the install performed', !!done, JSON.stringify(done && done.action));

  const after = fs.readFileSync(path.join(DIR, TARGET), 'utf8');
  check('the engine landed as a managed package',
    /data-ofcu-type="managed-package"[\s\S]{0,300}data-ofcu-package="alloy"/.test(after));
  // By path from the top of the universe, since the manager scans subfolders (rule folder-tree).
  check('it records where it came from', /data-ofcu-source="alloy\/alloy\.html"/.test(after));
  check('it carries the source hash',
    after.indexOf(/data-ofcu-hash="([^"]+)"/.exec(alloyHtml)[1]) > 0);

  // Ordering: engine, then data, then app. Not asserted about — measured.
  const order = [...after.matchAll(/<script\b[^>]*>/g)]
    .map((m) => (/data-ofcu-type="([a-z-]+)"/.exec(m[0]) || [])[1])
    .filter(Boolean).join(' ');
  check('blocks are in convention order', order === 'managed-package managed-data app', order);

  const report = await OFCU.validate(TARGET, { dir: DIR });
  check('the installed file validates', report.valid,
    report.issues.concat(report.warnings).join('; '));

  // Installing twice must not install twice.
  let second = null;
  try {
    second = await OFCU.install('alloy', TARGET, { dir: DIR });
  } catch (e) {
    second = { refused: e.message };
  }
  const again = fs.readFileSync(path.join(DIR, TARGET), 'utf8');
  const packages = [...again.matchAll(/<script\b[^>]*>/g)]
    .filter((m) => /data-ofcu-type="managed-package"/.test(m[0])).length;
  check('a second install does not duplicate the block', packages === 1,
    packages + ' package blocks');
  check('and it refuses rather than silently doing nothing',
    !!second && /already installed/.test(second.refused || ''), JSON.stringify(second));

  console.log('\n' + (failures ? failures + ' FAILURE(S)' : 'integration clean') +
              '  ·  ' + TARGET);
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error('THREW: ' + e.stack); process.exit(1); });
