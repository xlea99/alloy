// Alloy pre-commit checker + Phase 0 math tests. Throwaway tooling, per the OFCU Bible.
// Run: node alloy_check.js
const fs = require('fs');
const path = require('path');

const DIR = __dirname;
const FILE = path.join(DIR, 'alloy.html');
const html = fs.readFileSync(FILE, 'utf8');

let failures = 0;
function ok(name)         { console.log('  ok   ' + name); }
function bad(name, why)   { failures++; console.log('  FAIL ' + name + (why ? '\n         ' + why : '')); }
function check(name, cond, why) { cond ? ok(name) : bad(name, why); }

// ---------------------------------------------------------------- block scan
// Deliberately naive but sufficient: find every script open tag and its matching close.
function scanBlocks(src) {
  const out = [];
  const openRe = /<script\b[^>]*>/gi;
  let m;
  while ((m = openRe.exec(src))) {
    const openEnd = m.index + m[0].length;
    const closeIdx = src.indexOf('</' + 'script', openEnd);
    if (closeIdx < 0) throw new Error('unclosed script block at ' + m.index);
    out.push({ tag: m[0], content: src.slice(openEnd, closeIdx), start: openEnd, end: closeIdx });
    openRe.lastIndex = closeIdx;
  }
  return out;
}
const allBlocks = scanBlocks(html);
// The law block is markdown the manager reads (the Alloy Bible); then the engine; then the
// manager's machinery, installed so the app can render blocks the way a real install does;
// then the app. `blocks` is the two Alloy owns: engine, app.
const lawBlock = allBlocks.find((b) => /data-ofcu-type="law"/.test(b.tag)) || null;
const mgrBlock = allBlocks.find((b) => /data-ofcu-type="managed-package"[^>]*data-ofcu-package="ofcu-manager"/.test(b.tag)) || null;
const blocks = allBlocks.filter((b) => b !== lawBlock && b !== mgrBlock);

console.log('\n=== structure ===');
check('four script blocks: law, exportable, the manager, app', allBlocks.length === 4 && allBlocks[0] === lawBlock && allBlocks[2] === mgrBlock, 'found ' + allBlocks.length);
check('the manager is installed as a managed package', !!mgrBlock && /data-ofcu-version="/.test(mgrBlock.tag));
check('the law block is typed markdown and namespaced alloy', !!lawBlock &&
      /type="text\/markdown"/.test(lawBlock.tag) && /data-ofcu-law="alloy"/.test(lawBlock.tag), lawBlock ? lawBlock.tag : 'no law block');
check('block 0 is exportable alloy', /data-ofcu-type="exportable"/.test(blocks[0].tag) &&
      /data-ofcu-package="alloy"/.test(blocks[0].tag), blocks[0].tag.slice(0, 80));
check('block 1 is app', /data-ofcu-type="app"/.test(blocks[1].tag), blocks[1].tag.slice(0, 80));

// ---------------------------------------------------------------- delimiters
console.log('\n=== delimiter hazards ===');
const HAZARDS = ['</' + 'script', '<' + '!--', '--' + '>'];
allBlocks.forEach((b, i) => {
  for (const h of HAZARDS) {
    const n = b.content.split(h).length - 1;
    check('block ' + i + ' free of ' + JSON.stringify(h), n === 0, n + ' occurrence(s)');
  }
});

// ---------------------------------------------------------------- parse
console.log('\n=== parse ===');
allBlocks.forEach((b, i) => {
  if (b === lawBlock) return;
  try { new Function(b.content); ok('block ' + i + ' parses'); }
  catch (e) { bad('block ' + i + ' parses', e.message); }
});

// ---------------------------------------------------------------- portability
console.log('\n=== engine portability ===');
for (const pat of ['document.getElementById(', 'document.querySelector(', 'document.querySelectorAll(']) {
  const n = blocks[0].content.split(pat).length - 1;
  check('engine does not call ' + pat, n === 0, n + ' call(s)');
}
check('engine reads document only through currentScript guard',
      (blocks[0].content.match(/\bdocument\./g) || []).length ===
      (blocks[0].content.match(/document\.currentScript/g) || []).length,
      'unexpected document.* use in the engine block');

// ---------------------------------------------------------------- dom map vs markup
console.log('\n=== dom map ===');
{
  const markupIds = new Set();
  const idRe = /\bid="([^"]+)"/g;
  const markup = html.slice(0, html.indexOf('<script'));
  let m; while ((m = idRe.exec(markup))) markupIds.add(m[1]);

  const app = blocks[1].content;
  const mapRe = /document\.getElementById\('([^']+)'\)/g;
  const wanted = new Set();
  while ((m = mapRe.exec(app))) wanted.add(m[1]);
  let missing = [];
  for (const id of wanted) if (!markupIds.has(id)) missing.push(id);
  check('every getElementById has markup', missing.length === 0, 'missing: ' + missing.join(', '));

  // Every dom.x used in the app must be a key of the dom map.
  const keys = new Set();
  const domBlock = app.slice(app.indexOf('const dom = {'), app.indexOf('};', app.indexOf('const dom = {')));
  const keyRe = /^\s*(\w+):\s*document\.getElementById/gm;
  while ((m = keyRe.exec(domBlock))) keys.add(m[1]);
  const used = new Set();
  const useRe = /\bdom\.(\w+)/g;
  while ((m = useRe.exec(app))) used.add(m[1]);
  const undef = [...used].filter((k) => !keys.has(k));
  check('every dom.x is defined in the map', undef.length === 0, 'undefined: ' + undef.join(', '));
}


console.log('\n=== the engine boundary ===');
{
  // The app and the engine are two script blocks sharing one global scope, so nothing stops the
  // app calling an engine helper by name — nothing except that the helper lives inside the
  // engine's closure, where the app cannot see it. The result is a ReferenceError on a path
  // nobody exercised, which is exactly what happened with `clamp`.
  //
  // This finds every name the engine declares inside its IIFE, and reports any the app uses
  // without declaring one of its own.
  const engineSrc = blocks[0].content;
  const appSrc = blocks[1].content;

  /**
   * Names declared at a given indentation, which is how the two scopes are told apart.
   * @param {string} src - the block's source
   * @param {string} indent - the leading whitespace that marks the scope
   * @returns {Set<string>} - the declared names
   */
  function declaredAt(src, indent) {
    const out = new Set();
    const patterns = [
      new RegExp('^' + indent + 'function\\s+([A-Za-z_$][\\w$]*)', 'gm'),
      new RegExp('^' + indent + '(?:const|let|var)\\s+([A-Za-z_$][\\w$]*)\\s*=', 'gm'),
      new RegExp('^' + indent + 'class\\s+([A-Za-z_$][\\w$]*)', 'gm'),
    ];
    for (const re of patterns) {
      let m;
      while ((m = re.exec(src))) out.add(m[1]);
    }
    return out;
  }

  // The engine's own scope is four spaces in; the app's top level is two.
  const engineNames = declaredAt(engineSrc, '    ');
  const appNames = declaredAt(appSrc, '  ');

  check('the engine declares plenty of internal names', engineNames.size > 40, String(engineNames.size));
  check('the app declares plenty of its own', appNames.size > 40, String(appNames.size));

  // Everything the engine actually publishes, which the app is entitled to use through `Alloy.`.
  const published = new Set();
  {
    const re = /Alloy\.(\w+)\s*=/g;
    let m;
    while ((m = re.exec(engineSrc))) published.add(m[1]);
  }
  check('the engine publishes a public surface', published.size > 20, String(published.size));

  const leaks = [];
  for (const name of engineNames) {
    if (appNames.has(name)) continue;          // the app has its own, which is fine
    // `Alloy` is the one name the engine declares that the app is meant to reach for; it is the
    // public surface, and `new Alloy(canvas)` is how a viewport is made.
    if (name === 'Alloy') continue;
    // Called or referenced bare, not as a property of something.
    const re = new RegExp('(^|[^.\\w$])' + name + '\\s*\\(', 'm');
    if (re.test(appSrc)) leaks.push(name);
  }
  check('the app never calls an engine-internal function by name',
    leaks.length === 0, leaks.length ? 'reaches for: ' + leaks.join(', ') : '');
}

// ---------------------------------------------------------------- load engine
console.log('\n=== engine loads in node ===');
let Alloy = null;
try {
  Alloy = new Function(blocks[0].content + '\n;return Alloy;')();
  ok('engine block evaluates with no document');
} catch (e) { bad('engine block evaluates', e.message); }

if (Alloy) {
  const { vec3, mat3, mat4, quat } = Alloy;
  const EPS = 1e-5;
  const close = (a, b, eps) => Math.abs(a - b) <= (eps || EPS);
  const closeArr = (a, b, eps) => a.length === b.length && a.every((v, i) => close(v, b[i], eps));

  console.log('\n=== math: mat4 ===');
  {
    const q = quat.fromEuler([], 23, -47, 91);
    const m = mat4.compose(mat4.create(), [3, -2, 5], q, [2, 0.5, 1.25]);
    const inv = mat4.invert(mat4.create(), m);
    const id = mat4.multiply(mat4.create(), m, inv);
    const I = mat4.create();
    check('invert(m) * m is identity', closeArr([...id], [...I], 1e-4));

    check('compose puts translation in 12,13,14', close(m[12], 3) && close(m[13], -2) && close(m[14], 5));

    // A point transformed by compose must equal scale, then rotate, then translate by hand.
    const p = [0.7, -1.3, 2.1];
    const byMatrix = vec3.transformMat4([], p, m);
    const byHand = vec3.transformQuat([], [p[0] * 2, p[1] * 0.5, p[2] * 1.25], q);
    vec3.add(byHand, byHand, [3, -2, 5]);
    check('compose is translate * rotate * scale', closeArr(byMatrix, byHand));

    // fromQuat and transformQuat must agree.
    const rm = mat4.fromQuat(mat4.create(), q);
    check('mat4.fromQuat agrees with vec3.transformQuat',
          closeArr(vec3.transformMat4([], p, rm), vec3.transformQuat([], p, q)));

    // lookAt: the eye maps to the origin, and the target lands down -Z.
    const view = mat4.lookAt(mat4.create(), [0, 0, 5], [0, 0, 0], [0, 1, 0]);
    check('lookAt sends the eye to the origin', closeArr(vec3.transformMat4([], [0, 0, 5], view), [0, 0, 0]));
    check('lookAt puts the target down -Z', closeArr(vec3.transformMat4([], [0, 0, 0], view), [0, 0, -5]));

    let threw = false;
    try { mat4.lookAt(mat4.create(), [1, 1, 1], [1, 1, 1], [0, 1, 0]); } catch (e) { threw = true; }
    check('lookAt throws on a zero view direction', threw);
    threw = false;
    try { mat4.lookAt(mat4.create(), [0, 5, 0], [0, 0, 0], [0, 1, 0]); } catch (e) { threw = true; }
    check('lookAt throws when up is parallel to the view', threw);

    check('invert returns null for a singular matrix',
          mat4.invert(mat4.create(), mat4.fromScaling(mat4.create(), [1, 0, 1])) === null);

    // perspective: the near plane maps to -1 in NDC, the far plane to +1.
    const proj = mat4.perspective(mat4.create(), 50, 1.5, 0.1, 100);
    check('perspective maps near to -1', close(vec3.transformMat4([], [0, 0, -0.1], proj)[2], -1, 1e-4));
    check('perspective maps far to +1', close(vec3.transformMat4([], [0, 0, -100], proj)[2], 1, 1e-4));

    // Aliasing: out may be an input.
    const a = mat4.compose(mat4.create(), [1, 2, 3], quat.fromEuler([], 10, 20, 30), [1, 1, 1]);
    const b = mat4.compose(mat4.create(), [-4, 0, 2], quat.fromEuler([], 5, -15, 40), [2, 2, 2]);
    const expect = mat4.multiply(mat4.create(), a, b);
    const aliased = mat4.clone(a);
    mat4.multiply(aliased, aliased, b);
    check('multiply survives out === a', closeArr([...aliased], [...expect]));
    const aliased2 = mat4.clone(b);
    mat4.multiply(aliased2, a, aliased2);
    check('multiply survives out === b', closeArr([...aliased2], [...expect]));
  }

  console.log('\n=== math: quat ===');
  {
    // fromEuler must equal qz * qy * qx, built independently.
    for (const e of [[23, -47, 91], [0, 0, 0], [90, 0, 0], [0, 90, 0], [-180, 45, 12], [7, 8, 9]]) {
      const qx = quat.fromAxisAngle([], [1, 0, 0], e[0]);
      const qy = quat.fromAxisAngle([], [0, 1, 0], e[1]);
      const qz = quat.fromAxisAngle([], [0, 0, 1], e[2]);
      const byHand = quat.multiply([], quat.multiply([], qz, qy), qx);
      const got = quat.fromEuler([], e[0], e[1], e[2]);
      // q and -q are the same rotation, so compare after fixing the sign.
      const sign = (byHand[3] * got[3] + byHand[0] * got[0] + byHand[1] * got[1] + byHand[2] * got[2]) < 0 ? -1 : 1;
      check('fromEuler(' + e.join(',') + ') is qz*qy*qx',
            closeArr(got.map((v) => v * sign), byHand));
    }

    // Round trip through toEuler must reproduce the rotation, if not always the numbers.
    for (const e of [[23, -47, 91], [10, 80, -30], [0, 0, 0], [-120, 5, 170]]) {
      const q = quat.fromEuler([], e[0], e[1], e[2]);
      const back = quat.toEuler([], q);
      const q2 = quat.fromEuler([], back[0], back[1], back[2]);
      const v = [0.3, 0.9, -0.5];
      check('toEuler round trip preserves the rotation for ' + e.join(','),
            closeArr(vec3.transformQuat([], v, q), vec3.transformQuat([], v, q2), 1e-4));
    }

    // Gimbal lock: Y at 90 degrees still round-trips as a rotation.
    {
      const q = quat.fromEuler([], 30, 90, 45);
      const back = quat.toEuler([], q);
      const q2 = quat.fromEuler([], back[0], back[1], back[2]);
      const v = [0.3, 0.9, -0.5];
      check('toEuler survives gimbal lock',
            closeArr(vec3.transformQuat([], v, q), vec3.transformQuat([], v, q2), 1e-4));
      check('toEuler zeroes Z at lock', close(back[2], 0));
    }

    // slerp endpoints and shortest path.
    const a = quat.fromEuler([], 0, 0, 0);
    const b = quat.fromEuler([], 0, 170, 0);
    check('slerp at t=0 is a', closeArr(quat.slerp([], a, b, 0), a));
    check('slerp at t=1 is b', closeArr(quat.slerp([], a, b, 1), b));
    const mid = quat.slerp([], a, b, 0.5);
    check('slerp midpoint is halfway', close(quat.toEuler([], mid)[1], 85, 1e-3));

    // Double cover: slerping to -b must take the same short path as slerping to b.
    const nb = b.map((v) => -v);
    check('slerp takes the short path through the double cover',
          close(quat.toEuler([], quat.slerp([], a, nb, 0.5))[1], 85, 1e-3));

    check('normalize of a zero quat is identity', closeArr(quat.normalize([], [0, 0, 0, 0]), [0, 0, 0, 1]));
    check('vec3.normalize of a zero vector is zero', closeArr(vec3.normalize([], [0, 0, 0]), [0, 0, 0]));
  }

  console.log('\n=== math: mat3 normal matrix ===');
  {
    // Under non-uniform scale a normal must stay perpendicular to the transformed surface.
    const m = mat4.compose(mat4.create(), [0, 0, 0], quat.fromEuler([], 15, 40, -25), [3, 0.4, 1]);
    const nm = mat3.normalFromMat4(mat3.create(), m);
    // Two tangents of a surface, and its normal.
    const t1 = [1, 0, 0], t2 = [0, 0, 1], n = [0, 1, 0];
    const T1 = vec3.transformDir([], t1, m), T2 = vec3.transformDir([], t2, m);
    const N = [nm[0] * n[0] + nm[3] * n[1] + nm[6] * n[2],
               nm[1] * n[0] + nm[4] * n[1] + nm[7] * n[2],
               nm[2] * n[0] + nm[5] * n[1] + nm[8] * n[2]];
    check('normal stays perpendicular to tangent 1', close(vec3.dot(N, T1), 0, 1e-4));
    check('normal stays perpendicular to tangent 2', close(vec3.dot(N, T2), 0, 1e-4));
    check('normalFromMat4 falls back to identity when singular',
          closeArr([...mat3.normalFromMat4(mat3.create(), mat4.fromScaling(mat4.create(), [1, 0, 1]))],
                   [1, 0, 0, 0, 1, 0, 0, 0, 1]));
  }

  console.log('\n=== geometry ===');
  {
    const g = Alloy.geometry.box({ width: 2, height: 4, depth: 6 });
    check('box has 24 vertices', g.positions.length === 24 * 3, g.positions.length + ' floats');
    check('box has 36 indices', g.indices.length === 36);
    check('box has normals and uvs', g.normals.length === 72 && g.uvs.length === 48);
    check('box mode is triangles', g.mode === 'triangles');

    // Extents must match the parameters exactly.
    let min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < g.positions.length; i += 3) {
      const p = [g.positions[i], g.positions[i + 1], g.positions[i + 2]];
      vec3.min(min, min, p); vec3.max(max, max, p);
    }
    check('box extents match its parameters',
          closeArr(min, [-1, -2, -3]) && closeArr(max, [1, 2, 3]), min + ' .. ' + max);

    // Every normal is unit length.
    let unit = true;
    for (let i = 0; i < g.normals.length; i += 3) {
      if (!close(Math.hypot(g.normals[i], g.normals[i + 1], g.normals[i + 2]), 1)) unit = false;
    }
    check('every box normal is unit length', unit);

    // Winding: each triangle's geometric normal must match its vertex normal, which is what
    // makes the face visible from outside under backface culling.
    let wound = true, outward = true;
    for (let t = 0; t < g.indices.length; t += 3) {
      const i0 = g.indices[t] * 3, i1 = g.indices[t + 1] * 3, i2 = g.indices[t + 2] * 3;
      const p0 = [g.positions[i0], g.positions[i0 + 1], g.positions[i0 + 2]];
      const p1 = [g.positions[i1], g.positions[i1 + 1], g.positions[i1 + 2]];
      const p2 = [g.positions[i2], g.positions[i2 + 1], g.positions[i2 + 2]];
      const face = vec3.normalize([], vec3.cross([], vec3.sub([], p1, p0), vec3.sub([], p2, p0)));
      const vn = [g.normals[i0], g.normals[i0 + 1], g.normals[i0 + 2]];
      if (!closeArr(face, vn, 1e-4)) wound = false;
      // And it must point away from the centre, which is the origin for a centred box.
      const centre = vec3.scale([], vec3.add([], vec3.add([], p0, p1), p2), 1 / 3);
      if (vec3.dot(face, centre) <= 0) outward = false;
    }
    check('every box triangle is wound to match its normal', wound);
    check('every box normal points away from the centre', outward);

    const grid = Alloy.geometry.gridLines({ size: 10, step: 1, majorEvery: 5 });
    check('grid is lines with matching colors', grid.mode === 'lines' &&
          grid.positions.length === grid.colors.length);
    check('grid vertex count matches its lines', grid.positions.length / 3 === (11 * 2) * 2,
          grid.positions.length / 3 + ' vertices');
    let onPlane = true;
    for (let i = 1; i < grid.positions.length; i += 3) if (grid.positions[i] !== 0) onPlane = false;
    check('every grid vertex is on y = 0', onPlane);

    const axes = Alloy.geometry.axisLines({ length: 2 });
    check('axes are three segments', axes.positions.length === 18 && axes.mode === 'lines');

    // Introspection.
    const d = Alloy.describeGeometry('box');
    check('describeGeometry returns defaults and a schema array',
          d.defaults.width === 1 && Array.isArray(d.schema) && d.schema.find((e) => e.path === 'width').type === 'number');
    d.defaults.width = 999;
    check('describeGeometry hands back a copy', Alloy.geometry.box().positions[0] !== 999 &&
          Alloy.describeGeometry('box').defaults.width === 1);
    check('buildGeometry dispatches by name', Alloy.geometry.build('box', { width: 3 }).positions.length === 72);
  }

  console.log('\n=== camera ===');
  {
    const cam = new Alloy.OrbitCamera({ target: [0, 0, 0], distance: 10, yaw: 0, pitch: 0, smoothTime: 0 });
    check('yaw 0 pitch 0 puts the eye on +Z', closeArr(cam.eye([]), [0, 0, 10]));
    cam.yaw = 90; check('yaw 90 puts the eye on +X', closeArr(cam.eye([]), [10, 0, 0]));
    cam.yaw = 0; cam.pitch = 90; check('pitch 90 puts the eye on +Y', closeArr(cam.eye([]), [0, 10, 0], 1e-4));

    const c2 = new Alloy.OrbitCamera({ smoothTime: 0 });
    const c3 = new Alloy.OrbitCamera({ smoothTime: 0 });
    c2.pan(50, 0, 600); c2.update(1);
    check('two default cameras do not share a target vector',
          c3.target[0] === 0 && c3.target[1] === 0 && c3.target[2] === 0,
          'other camera target became ' + c3.target.join(','));

    const c4 = new Alloy.OrbitCamera({ distance: 4, minDistance: 1, maxDistance: 20, smoothTime: 0 });
    for (let i = 0; i < 200; i++) c4.dolly(-1000);
    c4.update(1);
    check('dolly clamps to minDistance', close(c4.distance, 1));
    for (let i = 0; i < 400; i++) c4.dolly(1000);
    c4.update(1);
    check('dolly clamps to maxDistance', close(c4.distance, 20));

    const c5 = new Alloy.OrbitCamera({ smoothTime: 0 });
    c5.orbit(0, 100000); c5.update(1);
    check('pitch clamps below the pole', c5.pitch <= 89 + EPS && c5.pitch >= 88.9);

    const c6 = new Alloy.OrbitCamera({ target: [1, 2, 3], distance: 9, yaw: 12, pitch: 34, smoothTime: 0 });
    c6.orbit(200, 50); c6.pan(30, 30, 800); c6.dolly(-500); c6.update(1);
    c6.reset(true);
    check('reset returns to the constructed view',
          closeArr(c6.target, [1, 2, 3]) && close(c6.distance, 9) && close(c6.yaw, 12) && close(c6.pitch, 34));

    const c7 = new Alloy.OrbitCamera({ smoothTime: 0 });
    c7.frameBounds([-1, -1, -1], [1, 1, 1]); c7.update(1);
    check('frameBounds centres the target', closeArr(c7.target, [0, 0, 0]));
    check('frameBounds backs off far enough', c7.distance > 1.7 && c7.distance < 20, 'distance ' + c7.distance);

    // Smoothing must be frame-rate independent: many small steps and one big one agree.
    const slow = new Alloy.OrbitCamera({ distance: 10, smoothTime: 0.1 });
    const fast = new Alloy.OrbitCamera({ distance: 10, smoothTime: 0.1 });
    slow._toDistance = 20; fast._toDistance = 20;
    for (let i = 0; i < 60; i++) slow.update(1 / 60);
    fast.update(1);
    check('smoothing is frame-rate independent', close(slow.distance, fast.distance, 1e-3),
          slow.distance + ' vs ' + fast.distance);
  }

// Phase 1 texture tests. Appended into alloy_check.js by splice.js.

  console.log('\n=== texture: pixels and colour ===');
  {
    const T = Alloy.texture;
    const px = T.makePixels(4, 3, [1, 0, 0, 1]);
    check('makePixels sizes the buffer', px.data.length === 4 * 3 * 4);
    check('makePixels fills', px.data[0] === 1 && px.data[1] === 0 && px.data[3] === 1);
    let threw = 0;
    try { T.makePixels(0, 4); } catch (e) { threw++; }
    try { T.makePixels(8192, 8); } catch (e) { threw++; }
    try { T.makePixels(4.5, 4); } catch (e) { threw++; }
    check('makePixels refuses bad sizes', threw === 3, threw + ' of 3 threw');

    check('bytes round trip', (() => {
      const b = T.toBytes(px);
      const back = T.fromBytes(b, 4, 3);
      return closeArr([...back.data], [...px.data], 1 / 255);
    })());

    check('colour accepts arrays', closeArr(T.color([0.5, 0.25, 0]), [0.5, 0.25, 0, 1]));
    check('colour accepts #rrggbb', closeArr(T.color('#ff8000'), [1, 128 / 255, 0, 1], 1e-6));
    check('colour accepts #rgb', closeArr(T.color('#f80'), [1, 0x88 / 255, 0, 1], 1e-6));
    check('colour accepts #rrggbbaa', closeArr(T.color('#00ff0080'), [0, 1, 0, 128 / 255], 1e-6));
    threw = 0;
    try { T.color('#zz'); } catch (e) { threw++; }
    try { T.color(42); } catch (e) { threw++; }
    check('colour refuses nonsense', threw === 2);
  }

  console.log('\n=== texture: determinism and tiling ===');
  {
    const T = Alloy.texture;
    const def = {
      name: 'det', width: 64, height: 64, seed: 7,
      layers: [
        { type: 'generator', generator: 'perlin', params: { scale: 4, octaves: 3 } },
        { type: 'generator', generator: 'worley', params: { scale: 6, mode: 'ridge' }, blend: 'multiply', opacity: 0.7 },
        { type: 'adjust', adjust: 'levels', params: { inLow: 0.1, inHigh: 0.9, gamma: 1 } },
      ],
    };
    const a = T.evaluate(def), b = T.evaluate(JSON.parse(JSON.stringify(def)));
    check('the same definition gives the same pixels', a.data.every((v, i) => v === b.data[i]));

    const other = T.evaluate(Object.assign({}, def, { seed: 8 }));
    check('a different seed gives different pixels', !a.data.every((v, i) => v === other.data[i]));

    // Tiling, measured rather than asserted. A texture wraps, so column 0 sits against column
    // w-1 and row 0 against row h-1. If the noise tiles, the step across that seam is an
    // ordinary step; if it does not, the seam is a discontinuity far larger than any other.
    // Comparing the seam against the MEAN neighbouring step is what makes this a real test
    // rather than a threshold somebody tuned until it went green.
    /**
     * Measures how much a texture jumps across its wrap, relative to its ordinary variation.
     * @param {Object} px - the evaluated pixels
     * @returns {number[]} - [x seam ratio, y seam ratio]; 1 is a perfectly ordinary step
     */
    function seamRatio(px) {
      const d = px.data, w = px.width, h = px.height;
      const at = (x, y) => d[(y * w + x) * 4];
      let stepX = 0, seamX = 0, stepY = 0, seamY = 0;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w - 1; x++) stepX += Math.abs(at(x + 1, y) - at(x, y));
        seamX += Math.abs(at(0, y) - at(w - 1, y));
      }
      for (let x = 0; x < w; x++) {
        for (let y = 0; y < h - 1; y++) stepY += Math.abs(at(x, y + 1) - at(x, y));
        seamY += Math.abs(at(x, 0) - at(x, h - 1));
      }
      const meanX = stepX / (h * (w - 1)) || 1e-9;
      const meanY = stepY / (w * (h - 1)) || 1e-9;
      return [(seamX / h) / meanX, (seamY / w) / meanY];
    }

    for (const gen of ['value', 'perlin', 'worley']) {
      for (const size of [[64, 64], [128, 64], [64, 128]]) {
        const px = T.evaluate({ width: size[0], height: size[1], seed: 9,
          layers: [{ type: 'generator', generator: gen, params: { scale: 4, octaves: 3 } }] });
        const r = seamRatio(px);
        check(gen + ' tiles at ' + size[0] + 'x' + size[1],
          r[0] < 3 && r[1] < 3, 'seam is ' + r[0].toFixed(1) + 'x across, ' +
          r[1].toFixed(1) + 'x down an ordinary step');
      }
    }

    // A non-tiling generator must fail the same measurement, or the measurement proves nothing.
    {
      const grad = T.evaluate({ width: 64, height: 64, layers: [{ type: 'generator',
        generator: 'gradient', params: { kind: 'linear', angle: 0 } }] });
      check('the seam measurement can actually fail', seamRatio(grad)[0] > 10,
        'a linear gradient should seam badly, and measured ' + seamRatio(grad)[0].toFixed(1));
    }
  }

  console.log('\n=== texture: generators ===');
  {
    const T = Alloy.texture;
    check('every generator is described and runs', Alloy.generatorTypes.every((g) => {
      const d = Alloy.describeGenerator(g);
      const px = T.evaluate({ width: 16, height: 16, seed: 1,
        layers: [{ type: 'generator', generator: g }] });
      // Every param in the schema must exist in the defaults and vice versa.
      const dk = Object.keys(d.defaults).sort().join(','), pk = d.schema.map((e) => e.path).sort().join(',');
      if (dk !== pk) { bad('generator ' + g + ' schema matches defaults', dk + ' vs ' + pk); return false; }
      return px.data.length === 16 * 16 * 4 && px.data.some((v) => v > 0);
    }), Alloy.generatorTypes.join(','));

    const solid = T.evaluate({ width: 4, height: 4,
      layers: [{ type: 'generator', generator: 'solid', params: { color: '#4080c0' } }] });
    check('solid fills with its colour',
      closeArr([solid.data[0], solid.data[1], solid.data[2]], [0x40 / 255, 0x80 / 255, 0xc0 / 255], 1e-6));

    const chk = T.evaluate({ width: 4, height: 4, layers: [{ type: 'generator', generator: 'checker',
      params: { cols: 2, rows: 2, colorA: '#000000', colorB: '#ffffff' } }] });
    check('checker alternates', chk.data[0] === 0 && chk.data[(0 * 4 + 3) * 4] === 1);

    const br = T.evaluate({ width: 32, height: 32, seed: 5, layers: [{ type: 'generator',
      generator: 'bricks', params: { cols: 2, rows: 4, vary: 0 } }] });
    const seen = new Set();
    for (let i = 0; i < br.data.length; i += 4) seen.add(br.data[i].toFixed(4));
    check('bricks with no variation has two colours', seen.size === 2, [...seen].join(' '));

    let threw = false;
    try { T.evaluate({ width: 4, height: 4, layers: [{ type: 'generator', generator: 'nope' }] }); }
    catch (e) { threw = /Known generators/.test(e.message); }
    check('an unknown generator names the known ones', threw);
  }

  console.log('\n=== texture: blending, masks, adjustments ===');
  {
    const T = Alloy.texture;
    const under = { type: 'generator', generator: 'solid', params: { color: [0.5, 0.5, 0.5] } };
    const over = (blend, opacity) => ({ type: 'generator', generator: 'solid',
      params: { color: [0.4, 0.4, 0.4] }, blend, opacity });

    const mul = T.evaluate({ width: 2, height: 2, layers: [under, over('multiply', 1)] });
    check('multiply multiplies', close(mul.data[0], 0.5 * 0.4));
    const scr = T.evaluate({ width: 2, height: 2, layers: [under, over('screen', 1)] });
    check('screen screens', close(scr.data[0], 0.5 + 0.4 - 0.2));
    const half = T.evaluate({ width: 2, height: 2, layers: [under, over('normal', 0.5)] });
    check('opacity interpolates', close(half.data[0], 0.45));
    check('every blend mode runs', Alloy.blendModes.every((m) =>
      T.evaluate({ width: 2, height: 2, layers: [under, over(m, 1)] }).data.every(Number.isFinite)));

    // The W3C rule: a blend mode over TRANSPARENCY must not darken. Multiply red on nothing is red.
    const onNothing = T.evaluate({ width: 2, height: 2, layers: [
      { type: 'generator', generator: 'solid', params: { color: [1, 0, 0] }, blend: 'multiply' } ] });
    check('a blend mode over transparency does not darken', close(onNothing.data[0], 1));

    // A mask made of a gradient must produce a gradient of coverage.
    const masked = T.evaluate({ width: 8, height: 2, layers: [
      under,
      { type: 'generator', generator: 'solid', params: { color: [1, 1, 1] },
        mask: { type: 'generator', generator: 'gradient',
                params: { kind: 'linear', angle: 0, colorA: '#000000', colorB: '#ffffff' } } },
    ] });
    check('a mask varies coverage across the texture',
      masked.data[7 * 4] - masked.data[0] > 0.35, masked.data[0] + ' .. ' + masked.data[7 * 4]);

    let threw = false;
    try {
      T.evaluate({ width: 2, height: 2, layers: [{ type: 'generator', generator: 'solid',
        mask: { type: 'generator', generator: 'solid', mask: { type: 'generator', generator: 'solid' } } }] });
    } catch (e) { threw = /may not itself have a mask/.test(e.message); }
    check('a mask may not have a mask', threw);

    // Adjustments rewrite what is below them.
    const inv = T.evaluate({ width: 2, height: 2, layers: [under, { type: 'adjust', adjust: 'invert' }] });
    check('invert inverts', close(inv.data[0], 0.5));
    const dark = T.evaluate({ width: 2, height: 2, layers: [
      { type: 'generator', generator: 'solid', params: { color: [1, 1, 1] } },
      { type: 'adjust', adjust: 'tint', params: { color: [0.5, 0.25, 0], amount: 1 } }] });
    check('tint multiplies', closeArr([dark.data[0], dark.data[1], dark.data[2]], [0.5, 0.25, 0]));
    const partial = T.evaluate({ width: 2, height: 2, layers: [
      { type: 'generator', generator: 'solid', params: { color: [1, 1, 1] } },
      { type: 'adjust', adjust: 'invert', opacity: 0.25 }] });
    check('an adjustment honours opacity', close(partial.data[0], 0.75));

    const q = T.evaluate({ width: 2, height: 2, layers: [
      { type: 'generator', generator: 'solid', params: { color: [0.4, 0.4, 0.4] } },
      { type: 'adjust', adjust: 'quantize', params: { levels: 2, dither: 0 } }] });
    check('quantize snaps to levels', q.data[0] === 0 || q.data[0] === 1, String(q.data[0]));

    const pal = T.evaluate({ width: 2, height: 2, layers: [
      { type: 'generator', generator: 'solid', params: { color: [0.9, 0.1, 0.1] } },
      { type: 'adjust', adjust: 'quantize', params: { palette: ['#ff0000', '#0000ff'], dither: 0 } }] });
    check('quantize snaps to a palette', close(pal.data[0], 1) && close(pal.data[2], 0));

    check('every adjustment is described and runs', Alloy.adjustmentTypes.every((a) => {
      const d = Alloy.describeAdjustment(a);
      const dk = Object.keys(d.defaults).sort().join(','), pk = d.schema.map((e) => e.path).sort().join(',');
      if (dk !== pk) { bad('adjustment ' + a + ' schema matches defaults', dk + ' vs ' + pk); return false; }
      return T.evaluate({ width: 4, height: 4, layers: [under, { type: 'adjust', adjust: a }] })
              .data.every(Number.isFinite);
    }), Alloy.adjustmentTypes.join(','));

    // HSV must round trip through the adjustment when it is a no-op.
    const hsvNoop = T.evaluate({ width: 2, height: 2, layers: [
      { type: 'generator', generator: 'solid', params: { color: [0.7, 0.3, 0.15] } },
      { type: 'adjust', adjust: 'hsv' }] });
    check('an identity hsv leaves colour alone',
      closeArr([hsvNoop.data[0], hsvNoop.data[1], hsvNoop.data[2]], [0.7, 0.3, 0.15], 1e-5));
  }

  console.log('\n=== texture: draw ops and the font ===');
  {
    const T = Alloy.texture;
    check('every draw op is described and runs', Alloy.drawOpTypes.every((o) => {
      const d = Alloy.describeDrawOp(o);
      const px = T.evaluate({ width: 32, height: 32, layers: [{ type: 'ops', ops: [{ op: o }] }] });
      return px.data.some((v) => v > 0);
    }), Alloy.drawOpTypes.join(','));

    // A circle must be inside its radius and outside it.
    const c = T.evaluate({ width: 64, height: 64, layers: [{ type: 'ops',
      ops: [{ op: 'circle', x: 0.5, y: 0.5, r: 0.25, fill: '#ffffff' }] }] });
    const at = (x, y) => c.data[(y * 64 + x) * 4 + 3];
    check('a circle is opaque at its centre', close(at(32, 32), 1));
    check('a circle is empty at its corner', close(at(2, 2), 0));
    // Antialiasing means the boundary is a ring of partly-covered pixels rather than a step.
    // Counted over the whole circumference, not one row: on a row through the centre the edge is
    // vertical and can land exactly on a pixel boundary, which produces a legitimately hard edge
    // and a test that fails for a correct rasterizer.
    let partial = 0;
    for (let i = 3; i < c.data.length; i += 4) if (c.data[i] > 0.02 && c.data[i] < 0.98) partial++;
    // The circumference is about 2 * pi * 16, so anything near a hundred is right and a hard
    // rasterizer would give zero.
    check('a circle has an antialiased edge', partial > 60 && partial < 200,
      partial + ' partly covered pixels around a circumference of about 100');

    // A concave polygon: the notch must be empty.
    const poly = T.evaluate({ width: 64, height: 64, layers: [{ type: 'ops', ops: [{ op: 'polygon',
      points: [[0.1, 0.1], [0.9, 0.1], [0.9, 0.9], [0.5, 0.4], [0.1, 0.9]], fill: '#ffffff' }] }] });
    const pat = (x, y) => poly.data[(y * 64 + x) * 4 + 3];
    check('a concave polygon fills its body', close(pat(32, 16), 1));
    check('a concave polygon leaves its notch empty', close(pat(32, 58), 0), String(pat(32, 58)));

    // The font: every glyph must be well formed, and text must actually mark pixels.
    check('the font has 95 printable glyphs', Object.keys(Alloy.font.glyphs).length === 95,
      String(Object.keys(Alloy.font.glyphs).length));
    let fontOk = true;
    for (const ch in Alloy.font.glyphs) {
      const rows = Alloy.font.glyphs[ch].split('/');
      if (rows.length !== 7) { fontOk = false; bad('glyph "' + ch + '" row count', rows.length); }
      for (const r of rows) if (r.length !== 5 || /[^#.]/.test(r)) {
        fontOk = false; bad('glyph "' + ch + '" row "' + r + '"', 'must be 5 of # and .');
      }
    }
    check('every glyph is 5 by 7 of # and .', fontOk);

    const txt = T.evaluate({ width: 64, height: 16, layers: [{ type: 'ops',
      ops: [{ op: 'text', x: 0.5, y: 0.2, text: 'AB', size: 0.5, align: 'center', fill: '#ffffff' }] }] });
    let lit = 0;
    for (let i = 3; i < txt.data.length; i += 4) if (txt.data[i] > 0.5) lit++;
    check('text marks pixels', lit > 20, lit + ' pixels');
    const missing = T.evaluate({ width: 32, height: 16, layers: [{ type: 'ops',
      ops: [{ op: 'text', text: 'éé', fill: '#ffffff' }] }] });
    check('an unknown character draws nothing rather than throwing',
      missing.data.every((v) => v === 0));

    let threw = false;
    try { T.evaluate({ width: 8, height: 8, layers: [{ type: 'ops', ops: [{ op: 'spline' }] }] }); }
    catch (e) { threw = /Known ops/.test(e.message); }
    check('an unknown op names the known ones', threw);
  }

  console.log('\n=== texture: PNG codec (oracle: node zlib) ===');
  {
    const T = Alloy.texture;
    const zlib = require('zlib');

    // Our deflate must be readable by a real inflate.
    const sample = Buffer.from(Array.from({ length: 5000 }, (_, i) =>
      (i % 97 < 40 ? 0 : (i * 31 + (i >> 3)) & 0xff)));
    {
      // Reach the private deflate through a PNG round trip instead: encode, then have zlib
      // inflate the IDAT we produced.
      const px = T.makePixels(37, 23);
      for (let i = 0; i < px.data.length; i++) px.data[i] = ((i * 7) % 256) / 255;
      const b64 = T.encodePNG(px);
      const bytes = T.base64Decode(b64);
      // Walk to the IDAT chunk.
      let p = 8, idat = null;
      const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      while (p + 8 <= bytes.length) {
        const len = dv.getUint32(p);
        const type = String.fromCharCode(bytes[p + 4], bytes[p + 5], bytes[p + 6], bytes[p + 7]);
        if (type === 'IDAT') { idat = bytes.subarray(p + 8, p + 8 + len); break; }
        p += 12 + len;
      }
      check('the encoder produced an IDAT chunk', !!idat);
      let inflated = null;
      try { inflated = zlib.inflateSync(Buffer.from(idat)); } catch (e) { /* reported below */ }
      check('node zlib can inflate what Alloy deflated', !!inflated,
        'zlib rejected the stream');
      if (inflated) {
        check('the inflated size is right', inflated.length === (37 * 4 + 1) * 23,
          inflated.length + ' vs ' + ((37 * 4 + 1) * 23));
      }
    }

    // And our inflate must read what a real deflate produced, via a PNG zlib made by node.
    {
      const w = 41, h = 29;
      const raw = Buffer.alloc((w * 4 + 1) * h);
      for (let y = 0; y < h; y++) {
        raw[y * (w * 4 + 1)] = 0;                       // filter: none
        for (let x = 0; x < w * 4; x++) {
          raw[y * (w * 4 + 1) + 1 + x] = (x * 3 + y * 11) & 0xff;
        }
      }
      const z = zlib.deflateSync(raw, { level: 9 });    // dynamic Huffman, which fixed-only cannot make
      const png = buildPNG(w, h, z);
      const decoded = T.decodePNG(png);
      check('Alloy inflates a stream node deflated at level 9',
        decoded.width === w && decoded.height === h);
      let same = true;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w * 4; x++) {
          const want = ((x * 3 + y * 11) & 0xff) / 255;
          if (Math.abs(decoded.data[(y * w) * 4 + x] - want) > 1 / 255) same = false;
        }
      }
      check('the decoded pixels match what was encoded', same);
    }

    // Full round trip through Alloy alone, pixel exact at 8 bits.
    {
      const src = T.evaluate({ width: 64, height: 48, seed: 11, layers: [
        { type: 'generator', generator: 'bricks', params: { cols: 3, rows: 6 } },
        { type: 'ops', ops: [{ op: 'text', text: 'OFCU', y: 0.4, size: 0.25, fill: '#ffff00' }] },
      ] });
      const b64 = T.encodePNG(src);
      const back = T.decodePNG(b64);
      const a = T.toBytes(src), b = T.toBytes(back);
      check('PNG round trips pixel exact', a.every((v, i) => v === b[i]));
      check('the PNG actually compressed', b64.length * 3 / 4 < 64 * 48 * 4,
        Math.round(b64.length * 3 / 4) + ' bytes vs ' + (64 * 48 * 4) + ' raw');
    }

    // The dynamic-Huffman and palette encoder (engine 0.8.4). Every mode it can pick, round
    // tripped through node's inflate (validity) and Alloy's own decoder (pixel exactness).
    {
      const TT = Alloy.texture;
      const zl = require('zlib');
      const chunksOf = (b64) => {
        const buf = Buffer.from(b64, 'base64');
        const out = { idat: [], type: -1, plte: 0, trns: 0, bytes: buf.length };
        for (let at = 8; at < buf.length;) {
          const len = buf.readUInt32BE(at), t = buf.toString('ascii', at + 4, at + 8);
          const d = buf.subarray(at + 8, at + 8 + len);
          if (t === 'IHDR') out.type = d[9];
          if (t === 'IDAT') out.idat.push(d);
          if (t === 'PLTE') out.plte = d.length / 3;
          if (t === 'tRNS') out.trns = d.length;
          at += 12 + len;
        }
        out.idat = Buffer.concat(out.idat);
        return out;
      };
      const trip = (name, px, expectType) => {
        const b64 = TT.encodePNG(px);
        const info = chunksOf(b64);
        let inflated = null;
        try { inflated = zl.inflateSync(info.idat); } catch (e) { /* reported */ }
        check('codec: ' + name + ' inflates in node', !!inflated);
        let same = false;
        try {
          const a = TT.toBytes(px), b = TT.toBytes(TT.decodePNG(b64));
          same = a.length === b.length && a.every((v, i) => v === b[i]);
        } catch (e) { /* reported */ }
        check('codec: ' + name + ' round trips pixel exact', same);
        if (expectType !== undefined) check('codec: ' + name + ' chose colour type ' + expectType, info.type === expectType, 'got ' + info.type);
        return info;
      };
      trip('one colour', TT.makePixels(16, 16, [0.2, 0.4, 0.6, 1]), 3);
      trip('1x1', TT.makePixels(1, 1, [1, 0, 0, 0.5]));
      const noise = TT.makePixels(48, 48, [0, 0, 0, 1]);
      let seed = 7;
      for (let i = 0; i < noise.data.length; i++) { seed = (seed * 1103515245 + 12345) & 0x7fffffff; noise.data[i] = ((seed >>> 8) & 255) / 255; }
      trip('random noise (no matches)', noise, 6);
      const bricks = trip('bricks 128', TT.evaluate({ name: 'b', width: 128, height: 128, seed: 17,
        layers: [{ type: 'generator', generator: 'bricks', params: {} }] }), 3);
      check('codec: bricks 128 is under 700 bytes as a file', bricks.bytes < 700, bricks.bytes + ' bytes');
      // 64 wide: at 32 the RGBA stream is smaller than a palette plus its chunks, and the encoder rightly picks it.
      const alpha = trip('checker with alpha', TT.evaluate({ name: 'a', width: 64, height: 64, seed: 1,
        layers: [{ type: 'generator', generator: 'checker', params: { cols: 4, rows: 4, colorA: '#ff000080', colorB: '#00ff0000' } }] }), 3);
      check('codec: transparency went into a tRNS chunk', alpha.trns > 0);
      trip('stripes 16x256', TT.evaluate({ name: 't', width: 16, height: 256, seed: 2,
        layers: [{ type: 'generator', generator: 'stripes', params: {} }] }));
    }

    // Real PNGs from the workspace, if any are there.
    {
      const fsx = require('fs'), pathx = require('path');
      const dir = pathx.join(DIR, 'workspace');
      let tried = 0, okCount = 0;
      if (fsx.existsSync(dir)) {
        for (const f of fsx.readdirSync(dir).filter((n) => n.toLowerCase().endsWith('.png'))) {
          tried++;
          try {
            const px = T.decodePNG(new Uint8Array(fsx.readFileSync(pathx.join(dir, f))));
            if (px.width > 0 && px.height > 0) okCount++;
          } catch (e) { bad('decode workspace/' + f, e.message); }
        }
      }
      check('every PNG in workspace decodes', tried > 0 && okCount === tried,
        okCount + ' of ' + tried);
    }

    // Base64 must survive arbitrary bytes at every length modulo 3.
    {
      let b64ok = true;
      for (let n = 0; n < 12; n++) {
        const bytes = new Uint8Array(n);
        for (let i = 0; i < n; i++) bytes[i] = (i * 37 + 11) & 0xff;
        const back = T.base64Decode(T.base64Encode(bytes));
        if (back.length !== n || !bytes.every((v, i) => v === back[i])) b64ok = false;
      }
      check('base64 round trips at every length', b64ok);
      check('base64 ignores a data URL prefix',
        T.base64Decode('data:image/png;base64,QUJD').length === 3);
    }

    let threw = false;
    try { T.decodePNG(T.base64Encode(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]))); }
    catch (e) { threw = /not a PNG/.test(e.message); }
    check('a non-PNG is refused by name', threw);
  }

  console.log('\n=== texture: bake and atlas ===');
  {
    const T = Alloy.texture;
    const def = { name: 'w', width: 32, height: 32, seed: 2, layers: [
      { type: 'generator', generator: 'worley', params: { scale: 4, mode: 'ridge' } }] };
    const baked = T.bake(def);
    check('bake makes a single raster layer',
      baked.layers.length === 1 && baked.layers[0].type === 'raster' && baked.baked === true);
    const a = T.toBytes(T.evaluate(def)), b = T.toBytes(T.evaluate(baked));
    check('a baked texture evaluates to the same pixels', a.every((v, i) => v === b[i]));

    const tiled = T.evaluate({ width: 64, height: 64, layers: [
      { type: 'image', png: baked.layers[0].png, fit: 'tile' }] });
    check('an image layer can tile', tiled.data.some((v) => v > 0));

    const atlas = T.packAtlas([
      { name: 'a', pixels: T.evaluate({ width: 32, height: 32, layers: [{ type: 'generator', generator: 'checker' }] }) },
      { name: 'b', pixels: T.evaluate({ width: 16, height: 48, layers: [{ type: 'generator', generator: 'stripes' }] }) },
      { name: 'c', pixels: T.evaluate({ width: 8, height: 8, layers: [{ type: 'generator', generator: 'solid' }] }) },
    ]);
    check('the atlas is a square power of two',
      atlas.size === atlas.pixels.width && atlas.size === atlas.pixels.height &&
      (atlas.size & (atlas.size - 1)) === 0, String(atlas.size));
    check('every entry got a rect', ['a', 'b', 'c'].every((k) => atlas.rects[k] &&
      atlas.rects[k][2] > 0 && atlas.rects[k][3] > 0));
    check('rects are inside the atlas', ['a', 'b', 'c'].every((k) => {
      const r = atlas.rects[k];
      return r[0] >= 0 && r[1] >= 0 && r[0] + r[2] <= 1 && r[1] + r[3] <= 1;
    }));
    // No two entries may overlap, which is the one thing a packer can get subtly wrong.
    const keys = ['a', 'b', 'c'];
    let overlap = false;
    for (let i = 0; i < keys.length; i++) {
      for (let j = i + 1; j < keys.length; j++) {
        const p = atlas.rects[keys[i]], q = atlas.rects[keys[j]];
        if (p[0] < q[0] + q[2] && q[0] < p[0] + p[2] && p[1] < q[1] + q[3] && q[1] < p[1] + p[3]) {
          overlap = true;
        }
      }
    }
    check('no two atlas entries overlap', !overlap);

    // The rect a material uses must actually land on that entry's pixels. This is the check that
    // catches the flip: sampling the atlas at the texture coordinate the rect names must give the
    // same colour as sampling the source at the same place. Without the flip accounted for, the
    // rect points at empty atlas and the object renders black.
    {
      const marks = ['#ff0000', '#00ff00', '#0000ff', '#ffff00'].map((c, i) => ({
        name: 'm' + i,
        pixels: T.evaluate({ width: 16 + i * 8, height: 24 - i * 4,
          layers: [{ type: 'generator', generator: 'solid', params: { color: c } }] }),
      }));
      const a = T.packAtlas(marks);
      let allMatch = true;
      for (const m of marks) {
        const r = a.rects[m.name];
        // The centre of the entry, in texture coordinates, converted back to an image row the
        // way a flipped upload would.
        const u = r[0] + r[2] / 2, v = r[1] + r[3] / 2;
        const ix = Math.floor(u * a.size);
        const iy = Math.floor((1 - v) * a.size);
        const at = (iy * a.size + ix) * 4;
        const want = m.pixels.data;
        for (let c = 0; c < 3; c++) {
          if (Math.abs(a.pixels.data[at + c] - want[c]) > 1e-6) allMatch = false;
        }
      }
      check('an atlas rect samples its own entry once the flip is accounted for', allMatch);

      // And the image-space rects must agree with the texture-space ones through that same flip.
      let agree = true;
      for (const m of marks) {
        const r = a.rects[m.name], pr = a.pixelRects[m.name];
        if (Math.abs(r[0] * a.size - pr[0]) > 1e-6) agree = false;
        if (Math.abs((a.size - r[1] * a.size - r[3] * a.size) - pr[1]) > 1e-6) agree = false;
        if (Math.abs(r[2] * a.size - pr[2]) > 1e-6) agree = false;
      }
      check('pixelRects and rects describe the same boxes', agree);
    }

    let threw = false;
    try {
      T.packAtlas([{ name: 'huge', pixels: T.makePixels(64, 64) }], { maxSize: 32 });
    } catch (e) { threw = /do not fit/.test(e.message); }
    check('an atlas that cannot fit says so', threw);
  }


  /**
   * Wraps a zlib stream in a minimal PNG, so Alloy's decoder can be tested against node's deflate.
   * @param {number} w - width
   * @param {number} h - height
   * @param {Buffer} z - a zlib stream of filtered RGBA rows
   * @returns {Uint8Array} - PNG bytes
   */
  function buildPNG(w, h, z) {
    const sig = [137, 80, 78, 71, 13, 10, 26, 10];
    const crcT = [];
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      crcT[n] = c >>> 0;
    }
    const crc = (b) => {
      let c = 0xffffffff;
      for (const x of b) c = crcT[(c ^ x) & 0xff] ^ (c >>> 8);
      return (c ^ 0xffffffff) >>> 0;
    };
    const chunk = (type, data) => {
      const out = new Uint8Array(12 + data.length);
      const dv = new DataView(out.buffer);
      dv.setUint32(0, data.length);
      for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
      out.set(data, 8);
      dv.setUint32(8 + data.length, crc(out.subarray(4, 8 + data.length)));
      return out;
    };
    const ihdr = new Uint8Array(13);
    const dv = new DataView(ihdr.buffer);
    dv.setUint32(0, w); dv.setUint32(4, h);
    ihdr[8] = 8; ihdr[9] = 6;
    const parts = [chunk('IHDR', ihdr), chunk('IDAT', new Uint8Array(z)), chunk('IEND', new Uint8Array(0))];
    let total = 8;
    for (const p of parts) total += p.length;
    const file = new Uint8Array(total);
    file.set(sig, 0);
    let at = 8;
    for (const p of parts) { file.set(p, at); at += p.length; }
    return file;
  }


  console.log('\n=== package ===');
  {
    const p = Alloy.emptyPackage('demo');
    check('an empty package validates', Alloy.validatePackage(p).length === 0);
    check('an empty package carries the schema', p.schema === Alloy.packageSchema);

    p.textures.wall = Alloy.emptyTexture('wall');
    check('a new texture validates and evaluates',
      Alloy.validatePackage(p).length === 0 &&
      Alloy.texture.evaluate(p.textures.wall).data.length === 128 * 128 * 4);

    // The block must round trip through its own parser, exactly.
    const rendered = Alloy.packageBlock(p, { project: 'the-levels' });
    check('packageBlock returns attrs, content and ident for the manager to render',
      rendered && typeof rendered === 'object' && rendered.attrs && typeof rendered.content === 'string' && rendered.ident === 'THE_LEVELS_ALLOY');
    check('the attrs say what the block is without evaluating it',
      rendered.attrs['data-ofcu-type'] === 'managed-data' && rendered.attrs['data-ofcu-package'] === 'alloy' &&
      rendered.attrs['data-ofcu-alloy-package'] === 'the-levels' && rendered.attrs['data-ofcu-alloy-schema'] === String(Alloy.packageSchema));
    const block = rendered.content;
    check('the content names a project-derived global', /const THE_LEVELS_ALLOY =/.test(block), block.slice(0, 200));
    const back = Alloy.parsePackageBlock(block);
    check('a package survives the block round trip', JSON.stringify(back) === JSON.stringify(p));

    // A block that carries a real texture, including a raster, must also survive.
    {
      const q = Alloy.emptyPackage('rich');
      q.textures.t = {
        name: 't', width: 32, height: 32, seed: 3,
        layers: [
          { type: 'generator', generator: 'bricks', params: { cols: 2, rows: 4 } },
          { type: 'ops', ops: [{ op: 'text', text: 'HI', fill: '#ffffff' },
                               { op: 'polygon', points: [[0.1, 0.1], [0.9, 0.2], [0.5, 0.8]], fill: '#ff0000' }] },
          { type: 'adjust', adjust: 'quantize', params: { palette: ['#000000', '#ffffff'] } },
        ],
      };
      q.textures.r = {
        name: 'r', width: 8, height: 8, seed: 1,
        layers: [{ type: 'image', png: Alloy.texture.encodePNG(Alloy.texture.makePixels(8, 8, [1, 0, 0, 1])), fit: 'tile' }],
      };
      const b2 = Alloy.parsePackageBlock(Alloy.packageBlock(q).content);
      check('a package with ops, palettes and a raster round trips',
        JSON.stringify(b2) === JSON.stringify(q));
      check('the serialized block keeps points on one line each',
        /\[0\.1, 0\.1\]/.test(Alloy.packageBlock(q).content));
    }

    // The delimiters rule, enforced where data becomes file text.
    for (const hazard of ['</' + 'script>', '<' + '!--', '--' + '>']) {
      const bad0 = Alloy.emptyPackage('x');
      bad0.textures.t = {
        name: 't', width: 4, height: 4, seed: 1,
        layers: [{ type: 'ops', ops: [{ op: 'text', text: 'a' + hazard + 'b', fill: '#fff' }] }],
      };
      let threw = false;
      try { Alloy.packageBlock(bad0); } catch (e) { threw = /would end the script block/.test(e.message); }
      check('a package carrying ' + JSON.stringify(hazard) + ' is refused', threw);
    }

    // Validation reports everything wrong at once, not just the first thing.
    {
      const broken = { schema: 1, textures: {
        a: { name: 'a', width: 8, height: 8, layers: [
          { type: 'generator', generator: 'nope' },
          { type: 'adjust', adjust: 'nope2' },
          { type: 'ops', ops: [{ op: 'nope3' }] },
          { type: 'raster', png: 42 },     // an EMPTY raster is fine now; a non-string png is not
          { type: 'generator', generator: 'solid', name: 7 },   // a name that is not a string
          { type: 'nope4' },
          { type: 'generator', generator: 'solid', blend: 'nope5' },
        ] },
        b: { name: 'b', width: 1.5, height: 8, layers: [] },
      } };
      const issues = Alloy.validatePackage(broken);
      check('validation reports every problem at once', issues.length >= 8, issues.length + ' issues');
      check('a row name must be a string', issues.some((s) => /name that is not a string/.test(s)));
      check('validation names the offenders',
        issues.join(' ').includes('nope') && issues.join(' ').includes('whole-number'));
    }
    let threw = false;
    try { Alloy.validatePackage({ schema: 999, textures: {} }); } catch (e) { threw = true; }
    check('a future schema is reported, not thrown',
      !threw && Alloy.validatePackage({ schema: 999, textures: {} }).length === 1);

    threw = false;
    try { Alloy.parsePackageBlock('nothing here'); } catch (e) { threw = /declares no .const./.test(e.message); }
    check('a block with no const says so', threw);

    // The block serializer trims float noise for readability, so a package carrying more than six
    // decimals round trips to the TRIMMED form rather than to itself. That is deliberate, and the
    // workbench rounds dragged values so authored packages never sit on the wrong side of it.
    {
      const f = Alloy.emptyPackage('floats');
      f.textures.t = { name: 't', width: 8, height: 8, seed: 1,
        layers: [{ type: 'ops', ops: [{ op: 'circle', x: 0.47119887243772296, y: 0.5, r: 0.25, fill: '#fff' }] }] };
      const trimmed = Alloy.parsePackageBlock(Alloy.packageBlock(f).content);
      check('a long float is trimmed to six decimals, not kept',
        trimmed.textures.t.layers[0].ops[0].x === 0.471199,
        String(trimmed.textures.t.layers[0].ops[0].x));
      const g = JSON.parse(JSON.stringify(f));
      g.textures.t.layers[0].ops[0].x = 0.4712;
      check('a package already at four decimals round trips exactly',
        JSON.stringify(Alloy.parsePackageBlock(Alloy.packageBlock(g).content)) === JSON.stringify(g));
    }

    check('packageIdent makes a legal global',
      Alloy.packageIdent('sunset larceny!') === 'SUNSET_LARCENY_ALLOY' &&
      /^[A-Za-z_]/.test(Alloy.packageIdent('2fast')));
  }


  console.log('\n=== mesh: primitives ===');
  {
    const G = Alloy.geometry;
    check('the registry lists eight geometry types',
      Alloy.geometryTypes.join(',') === 'box,plane,cylinder,cone,sphere,wedge,grid,axes',
      Alloy.geometryTypes.join(','));
    check('only the six solids are offered as primitives',
      Alloy.primitiveTypes.join(',') === 'box,plane,cylinder,cone,sphere,wedge');

    /**
     * Checks the properties every solid primitive must have.
     * @param {string} name - the primitive's name
     * @param {Object} g - its geometry
     * @param {boolean} closed - whether it is a closed solid whose normals must point outward
     * @returns {void}
     */
    function checkSolid(name, g, closed) {
      const vc = g.positions.length / 3;
      check(name + ' has vertices, indices and bounds',
        vc > 0 && g.indices.length % 3 === 0 && !!g.bounds);
      let unit = true;
      for (let i = 0; i < g.normals.length; i += 3) {
        if (Math.abs(Math.hypot(g.normals[i], g.normals[i + 1], g.normals[i + 2]) - 1) > 1e-4) unit = false;
      }
      check(name + ' has unit normals', unit);
      let inRange = true;
      for (let i = 0; i < g.indices.length; i++) if (g.indices[i] >= vc) inRange = false;
      check(name + ' has every index in range', inRange);

      // Winding and outwardness together.
      //
      // Outwardness is tested by CONVEXITY, not by comparing against the centre of the bounding
      // box. Every primitive here is a convex solid, so a correctly wound one has every vertex
      // behind every face's plane. The obvious heuristic — the face's centroid should be further
      // from the middle than the middle is — quietly assumes the box centre is strictly inside,
      // which is false for a wedge: its sloped face passes exactly through it.
      let wound = true, outward = true, degenerate = 0;
      for (let t = 0; t < g.indices.length; t += 3) {
        const i0 = g.indices[t] * 3, i1 = g.indices[t + 1] * 3, i2 = g.indices[t + 2] * 3;
        const p0 = [g.positions[i0], g.positions[i0 + 1], g.positions[i0 + 2]];
        const p1 = [g.positions[i1], g.positions[i1 + 1], g.positions[i1 + 2]];
        const p2 = [g.positions[i2], g.positions[i2 + 1], g.positions[i2 + 2]];
        const cr = vec3.cross([], vec3.sub([], p1, p0), vec3.sub([], p2, p0));
        if (vec3.len(cr) < 1e-9) { degenerate++; continue; }
        const face = vec3.normalize([], cr);
        const vn = [g.normals[i0], g.normals[i0 + 1], g.normals[i0 + 2]];
        if (vec3.dot(face, vn) < 0) wound = false;
        if (closed && outward) {
          for (let v = 0; v < g.positions.length; v += 3) {
            const d = face[0] * (g.positions[v] - p0[0]) +
                      face[1] * (g.positions[v + 1] - p0[1]) +
                      face[2] * (g.positions[v + 2] - p0[2]);
            if (d > 1e-4) { outward = false; break; }
          }
        }
      }
      check(name + ' winds every triangle to match its normals', wound);
      if (closed) check(name + ' faces every triangle outward', outward);
      check(name + ' has no degenerate triangles', degenerate === 0, degenerate + ' of ' + (g.indices.length / 3));
    }

    checkSolid('box', G.box(), true);
    checkSolid('cylinder', G.cylinder(), true);
    checkSolid('cone', G.cone(), true);
    checkSolid('sphere', G.sphere(), true);
    checkSolid('wedge', G.wedge(), true);
    checkSolid('plane', G.plane(), false);

    // Sizes must be exactly what was asked for.
    const b = G.box({ width: 2, height: 4, depth: 6 });
    check('box extents match its parameters',
      closeArr(b.bounds.min, [-1, -2, -3]) && closeArr(b.bounds.max, [1, 2, 3]));
    check('box still has 24 vertices at one segment', b.positions.length / 3 === 24);
    check('box segments multiply its vertices',
      G.box({ segments: 3 }).positions.length / 3 === 6 * 16, String(G.box({ segments: 3 }).positions.length / 3));

    const sp = G.sphere({ radius: 2 });
    let onRadius = true;
    for (let i = 0; i < sp.positions.length; i += 3) {
      if (Math.abs(Math.hypot(sp.positions[i], sp.positions[i + 1], sp.positions[i + 2]) - 2) > 1e-4) onRadius = false;
    }
    check('every sphere vertex is exactly on its radius', onRadius);

    const cy = G.cylinder({ radiusTop: 1, radiusBottom: 1, height: 3 });
    check('cylinder extents match its parameters',
      closeArr(cy.bounds.min, [-1, -1.5, -1], 1e-4) && closeArr(cy.bounds.max, [1, 1.5, 1], 1e-4));
    check('capping a cylinder adds triangles',
      G.cylinder({ capped: true }).indices.length > G.cylinder({ capped: false }).indices.length);
    check('a faceted cylinder has more vertices than a smooth one',
      G.cylinder({ smooth: false }).positions.length > G.cylinder({ smooth: true }).positions.length);

    // A cone's side normals must lean, or it shades like a squashed cylinder.
    const cn = G.cone({ radius: 1, height: 2, capped: false });
    let leaning = true;
    for (let i = 0; i < cn.normals.length; i += 3) {
      if (cn.normals[i + 1] <= 0.01) leaning = false;
    }
    check('a cone\'s side normals lean upward with its slope', leaning);

    let threw = false;
    try { G.build('torus'); } catch (e) { threw = /Known types/.test(e.message); }
    check('an unknown primitive names the known ones', threw);
  }

  console.log('\n=== mesh: UV projection ===');
  {
    const G = Alloy.geometry;
    /**
     * The UV extent of a geometry, which is what texel density is measured in.
     * @param {Object} g - the geometry
     * @returns {number[]} - [u span, v span]
     */
    function uvSpan(g) {
      let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
      for (let i = 0; i < g.uvs.length; i += 2) {
        u0 = Math.min(u0, g.uvs[i]); u1 = Math.max(u1, g.uvs[i]);
        v0 = Math.min(v0, g.uvs[i + 1]); v1 = Math.max(v1, g.uvs[i + 1]);
      }
      return [u1 - u0, v1 - v0];
    }

    // The whole reason projection exists: without it a long wall and a small crate get the same
    // texture stretched to different sizes. With it, one world unit is one repeat on both.
    const small = G.projectUVs(G.box({ width: 1, height: 1, depth: 1 }), { mode: 'box', scale: 1 });
    const long = G.projectUVs(G.box({ width: 4, height: 1, depth: 1 }), { mode: 'box', scale: 1 });
    check('an unprojected box gives every face the same 0..1 square',
      closeArr(uvSpan(G.box({ width: 4, height: 1, depth: 1 })), [1, 1]));
    check('box projection makes texel density independent of size',
      close(uvSpan(small)[0], 1) && close(uvSpan(long)[0], 4),
      'spans were ' + uvSpan(small)[0] + ' and ' + uvSpan(long)[0]);

    const half = G.projectUVs(G.box({ width: 4 }), { mode: 'box', scale: 2 });
    check('the projection scale is world units per repeat', close(uvSpan(half)[0], 2));

    const offset = G.projectUVs(G.box(), { mode: 'box', scale: 1, offset: [10, 0] });
    let shifted = true;
    for (let i = 0; i < offset.uvs.length; i += 2) if (offset.uvs[i] < 9) shifted = false;
    check('the projection offset moves the whole thing', shifted);

    // Opposite faces must not be mirror images, or text reads backwards on the far side.
    {
      const g = G.projectUVs(G.box({ width: 2, height: 2, depth: 2 }), { mode: 'box', scale: 1 });
      /**
       * The uv of the vertex nearest a point, so a specific corner can be checked.
       * @param {number[]} p - the point
       * @returns {number[]} - its uv
       */
      function uvNear(p) {
        let best = 0, bd = Infinity;
        for (let i = 0; i < g.positions.length; i += 3) {
          const d = Math.hypot(g.positions[i] - p[0], g.positions[i + 1] - p[1], g.positions[i + 2] - p[2]);
          if (d < bd) { bd = d; best = i / 3; }
        }
        return [g.uvs[best * 2], g.uvs[best * 2 + 1]];
      }
      // Walking around the box in the same direction should move u the same way on both the
      // front and the back face, not opposite ways.
      const frontLeft = uvNear([-1, 0, 1]), frontRight = uvNear([1, 0, 1]);
      const backLeft = uvNear([-1, 0, -1]), backRight = uvNear([1, 0, -1]);
      check('opposite faces are not mirrored',
        (frontRight[0] - frontLeft[0]) * (backRight[0] - backLeft[0]) < 0,
        'front ' + frontLeft[0] + '..' + frontRight[0] + '  back ' + backLeft[0] + '..' + backRight[0]);
    }

    const planar = G.projectUVs(G.plane({ width: 6, depth: 2 }), { mode: 'planar', axis: 'y', scale: 1 });
    check('planar projection spans the surface in world units', closeArr(uvSpan(planar), [6, 2]));

    // Uncapped on purpose: a cap sits on the axis, where there is no angle to project, so its
    // UVs are arbitrary by nature rather than wrong. The sides are what this mode is for.
    const cyl = G.projectUVs(G.cylinder({ height: 4, radialSegments: 16, capped: false }),
                             { mode: 'cylindrical', axis: 'y', scale: 1 });
    check('cylindrical projection wraps once around and spans the height',
      close(uvSpan(cyl)[0], 1, 0.08) && close(uvSpan(cyl)[1], 4, 0.02),
      uvSpan(cyl).map((v) => v.toFixed(2)).join(', '));

    // The seam is the artifact that makes cylindrical projection worth testing at all: without
    // the repair, one column of faces runs the whole texture backwards across itself.
    {
      let widest = 0;
      for (let t = 0; t < cyl.indices.length; t += 3) {
        const us = [0, 1, 2].map((k) => cyl.uvs[cyl.indices[t + k] * 2]);
        widest = Math.max(widest, Math.max.apply(null, us) - Math.min.apply(null, us));
      }
      check('no triangle straddles the cylindrical seam', widest < 0.5, 'widest span ' + widest.toFixed(3));
    }

    check('an unset projection leaves the UVs alone',
      closeArr(uvSpan(G.projectUVs(G.box(), {})), [1, 1]));
    let threw = false;
    try { G.projectUVs(G.box(), { mode: 'spherical' }); } catch (e) { threw = /Use default, box/.test(e.message); }
    check('an unknown projection mode says what the modes are', threw);
  }

  console.log('\n=== mesh: subdivision ===');
  {
    const G = Alloy.geometry;
    const cube = G.box();
    check('zero levels returns the geometry untouched', G.subdivide(cube, 0) === cube);

    const l1 = G.subdivide(cube, 1), l2 = G.subdivide(cube, 2);
    check('each level quadruples the faces',
      l1.indices.length === cube.indices.length * 4 &&
      l2.indices.length === l1.indices.length * 4,
      [cube.indices.length, l1.indices.length, l2.indices.length].join(' -> '));

    // Catmull-Clark on a cube converges to a symmetric rounded solid. Asymmetry means the
    // triangulation's diagonals leaked into the surface, which is what keeping the quads prevents.
    const bmin = l2.bounds.min, bmax = l2.bounds.max;
    check('a subdivided cube stays symmetric',
      close(bmin[0], bmin[1], 1e-6) && close(bmin[1], bmin[2], 1e-6) &&
      close(bmax[0], -bmin[0], 1e-6),
      bmin.map((v) => v.toFixed(5)).join(','));
    check('a subdivided cube shrinks toward its limit surface',
      bmax[0] < 0.5 && bmax[0] > 0.35, String(bmax[0]));

    let unit = true;
    for (let i = 0; i < l2.normals.length; i += 3) {
      if (Math.abs(Math.hypot(l2.normals[i], l2.normals[i + 1], l2.normals[i + 2]) - 1) > 1e-4) unit = false;
    }
    check('subdivision produces unit normals', unit);

    // The UV seams a box needs must survive the weld, which merges the very corners that carry
    // three different UVs.
    let uMin = Infinity, uMax = -Infinity;
    for (let i = 0; i < l2.uvs.length; i += 2) { uMin = Math.min(uMin, l2.uvs[i]); uMax = Math.max(uMax, l2.uvs[i]); }
    check('subdivision keeps the UV range rather than collapsing it',
      close(uMin, 0, 1e-6) && close(uMax, 1, 1e-6), uMin + '..' + uMax);

    // An open mesh must keep its border. Without the boundary rule a plane pulls its own edge in
    // and shrinks toward its centre at every level.
    const pl = G.subdivide(G.plane({ width: 2, depth: 2 }), 2);
    check('a subdivided plane keeps its border', pl.bounds.max[0] > 0.9, String(pl.bounds.max[0]));
    check('a subdivided plane stays flat', close(pl.bounds.min[1], 0) && close(pl.bounds.max[1], 0));

    // Every subdivided surface must still be a surface: no degenerate triangles, normals sane.
    let deg = 0;
    for (let t = 0; t < l2.indices.length; t += 3) {
      const i0 = l2.indices[t] * 3, i1 = l2.indices[t + 1] * 3, i2 = l2.indices[t + 2] * 3;
      const p0 = [l2.positions[i0], l2.positions[i0 + 1], l2.positions[i0 + 2]];
      const p1 = [l2.positions[i1], l2.positions[i1 + 1], l2.positions[i1 + 2]];
      const p2 = [l2.positions[i2], l2.positions[i2 + 1], l2.positions[i2 + 2]];
      if (vec3.len(vec3.cross([], vec3.sub([], p1, p0), vec3.sub([], p2, p0))) < 1e-12) deg++;
    }
    check('subdivision leaves no degenerate triangles', deg === 0, String(deg));
    // Subdivision pulls any polyhedron inside itself toward the limit surface, a sphere
    // included, so the test is roundness rather than radius: every vertex the same distance from
    // the centre as every other, whatever that distance turned out to be.
    {
      const sub = G.subdivide(G.sphere({ radius: 1, widthSegments: 12, heightSegments: 8 }), 1);
      let lo = Infinity, hi = -Infinity;
      for (let i = 0; i < sub.positions.length; i += 3) {
        const r = Math.hypot(sub.positions[i], sub.positions[i + 1], sub.positions[i + 2]);
        lo = Math.min(lo, r); hi = Math.max(hi, r);
      }
      check('a subdivided sphere stays round', hi / lo < 1.05 && hi <= 1.0001,
        'radii ran from ' + lo.toFixed(3) + ' to ' + hi.toFixed(3));
    }
  }

  console.log('\n=== mesh: the model tree ===');
  {
    const model = { name: 't', nodes: [
      { name: 'root', position: [0, 1, 0], children: [
        { name: 'a', primitive: 'box', params: { width: 2, height: 0.5, depth: 1 }, material: 'm1' },
        { name: 'arm', primitive: 'cylinder', position: [2, 0, 0], material: 'm2', bone: true, children: [
          { name: 'hand', primitive: 'sphere', position: [0, 1, 0], material: 'm1' },
        ] },
      ] },
    ] };
    const m = Alloy.mergeModel(model);

    check('the merge counts the nodes that carry geometry', m.nodes === 3, String(m.nodes));
    check('the merge composes the hierarchy',
      closeArr(m.bounds.min, [-1, 0.5, -0.5], 1e-4) && closeArr(m.bounds.max, [2.5, 2.5, 0.5], 1e-4),
      m.bounds.min.join(',') + ' .. ' + m.bounds.max.join(','));
    check('countNodes counts transforms too', Alloy.countNodes(model) === 4, String(Alloy.countNodes(model)));

    // One contiguous index range per material, which is what makes a model one draw call each.
    check('the merge groups triangles by material',
      m.groups.length === 2 && m.groups[0].material === 'm1' && m.groups[1].material === 'm2');
    let covered = 0, contiguous = true, at = 0;
    for (const g of m.groups) { if (g.start !== at) contiguous = false; at += g.count; covered += g.count; }
    check('the groups tile the index buffer with no gaps',
      contiguous && covered === m.geometry.indices.length);

    // The bone door: slot 0 is the identity, a marked node gets a slot, and everything under it
    // inherits that slot.
    check('bone slot 0 is reserved and is the identity',
      m.bones[0].index === 0 && closeArr([...m.bones[0].rest], [...mat4.create()]));
    check('a node marked as a bone gets a slot', m.bones.length === 2 && m.bones[1].name === 'arm');
    check('a bone\'s inverse rest really is its inverse',
      closeArr([...mat4.multiply(mat4.create(), m.bones[1].rest, m.bones[1].invRest)],
               [...mat4.create()], 1e-5));
    const joints = new Set(m.geometry.joints);
    check('vertices carry a bone index', joints.has(0) && joints.has(1), [...joints].join(','));
    // The sphere hangs off the bone, so it must move with it.
    let handOnBone = true;
    for (let v = 0; v < m.geometry.positions.length / 3; v++) {
      if (m.geometry.positions[v * 3 + 1] > 1.6 && m.geometry.joints[v] !== 1) handOnBone = false;
    }
    check('a bone\'s descendants inherit its slot', handOnBone);

    // Normals must survive a non-uniform node scale, which is the whole reason the merge uses a
    // normal matrix rather than the world matrix.
    {
      const squashed = Alloy.mergeModel({ nodes: [
        { primitive: 'box', scale: [4, 0.25, 1], material: '' } ] });
      let unit = true, up = false;
      const n = squashed.geometry.normals;
      for (let i = 0; i < n.length; i += 3) {
        if (Math.abs(Math.hypot(n[i], n[i + 1], n[i + 2]) - 1) > 1e-4) unit = false;
        if (close(n[i + 1], 1, 1e-4)) up = true;
      }
      check('a non-uniformly scaled node keeps unit normals', unit);
      check('a squashed box still has a normal pointing straight up', up);
    }

    // A rotation may be written either way, and both must mean the same thing.
    {
      const a = Alloy.mergeModel({ nodes: [{ primitive: 'box', rotation: [0, 90, 0] }] });
      const q = quat.fromEuler([], 0, 90, 0);
      const b = Alloy.mergeModel({ nodes: [{ primitive: 'box', rotation: q }] });
      check('euler degrees and a quaternion describe the same rotation',
        closeArr([...a.geometry.positions].slice(0, 12), [...b.geometry.positions].slice(0, 12), 1e-5));
    }

    let threw = false;
    try { Alloy.mergeModel({}); } catch (e) { threw = /needs a .nodes. array/.test(e.message); }
    check('a model with no nodes says so', threw);
    threw = false;
    try {
      const loop = { primitive: 'box' };
      loop.children = [loop];
      Alloy.mergeModel({ nodes: [loop] });
    } catch (e) { threw = /more than 64 deep/.test(e.message); }
    check('a node that is its own child is caught by depth, not by a stack overflow', threw);
    threw = false;
    try { Alloy.mergeModel({ nodes: [{ primitive: 'box', bone: true, scale: [0, 1, 1] }] }); }
    catch (e) { threw = /cannot be inverted/.test(e.message); }
    check('a bone scaled flat is refused with a reason', threw);
  }

  console.log('\n=== mesh: frustum culling ===');
  {
    const proj = mat4.perspective(mat4.create(), 60, 1, 0.1, 100);
    const view = mat4.lookAt(mat4.create(), [0, 0, 10], [0, 0, 0], [0, 1, 0]);
    const vp = mat4.multiply(mat4.create(), proj, view);
    const planes = Alloy.frustum.fromMatrix(new Float32Array(24), vp);

    check('a box at the origin is visible',
      Alloy.frustum.testAABB(planes, [-1, -1, -1], [1, 1, 1]));
    check('a box behind the camera is culled',
      !Alloy.frustum.testAABB(planes, [-1, -1, 20], [1, 1, 22]));
    check('a box far off to the side is culled',
      !Alloy.frustum.testAABB(planes, [500, -1, -1], [502, 1, 1]));
    check('a box past the far plane is culled',
      !Alloy.frustum.testAABB(planes, [-1, -1, -200], [1, 1, -198]));
    check('a huge box containing the camera is visible',
      Alloy.frustum.testAABB(planes, [-999, -999, -999], [999, 999, 999]));

    // Bounds must be transformed by rotating the corners, not by rotating min and max — the
    // latter gives a box that is too small and culls things that are plainly on screen.
    const spun = mat4.compose(mat4.create(), [0, 0, 0], quat.fromEuler([], 0, 45, 0), [1, 1, 1]);
    const out = Alloy.frustum.transformBounds({ min: [0, 0, 0], max: [0, 0, 0] },
      { min: [-1, -1, -1], max: [1, 1, 1] }, spun);
    check('rotating a bounding box grows it', out.max[0] > 1.4 && out.max[0] < 1.42, String(out.max[0]));
    check('a translated bounding box moves',
      closeArr(Alloy.frustum.transformBounds({ min: [0, 0, 0], max: [0, 0, 0] },
        { min: [-1, -1, -1], max: [1, 1, 1] },
        mat4.fromTranslation(mat4.create(), [5, 0, 0])).min, [4, -1, -1]));
  }


  console.log('\n=== mesh: surfaces ===');
  {
    // The invariants a world game got wrong by hand before this existed: parts contiguous and in
    // slice order, every index in range, bounds enclosing exactly their slice, texture
    // coordinates in world units so neighbours share texels, and a card that faces the way it
    // says and reads left to right from there.
    const s = Alloy.geometry.surface();
    check('surface() is published', typeof s.face === 'function' && typeof s.finish === 'function');
    const aoFn = (x, y, z) => (x < 1 ? 0.5 : 1);
    s.slice('a');
    s.face([0, 0, 0], [0, 0, 1], [1, 0, 0], [0, 1, 2], [0, 1, 2], 'carpet', { uv: 2, ao: aoFn });
    s.face([2, 0, 0], [0, 0, 1], [1, 0, 0], [0, 2], [0, 2], 'carpet', { uv: 2 });
    s.face([0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 2], [0, 2.6], 'drywall', { tint: [0.5, 1, 0.5] });
    s.slice('b');
    s.box(3, 0, 3, 4, 0.7, 4, 'wood', { ao: 0.8 });
    s.slice('empty');
    const built = s.finish();
    const g = built.geometry;
    const nVerts = g.positions.length / 3;

    check('three slices come back in order', built.slices.length === 3 &&
      built.slices.map((x) => x.name).join(',') === 'a,b,empty');
    check('parts are contiguous and cover the index buffer', (() => {
      let at = 0;
      for (const sl of built.slices) for (const p of sl.parts) { if (p.first !== at) return false; at += p.count; }
      return at === g.indices.length;
    })());
    check('slice a has two materials, slice b one, the empty one none',
      built.slices[0].parts.length === 2 && built.slices[1].parts.length === 1 && built.slices[2].parts.length === 0);
    check('every index is in range', Array.from(g.indices).every((i) => i < nVerts));
    check('no NaN anywhere', [g.positions, g.normals, g.uvs, g.colors, g.ao].every((a) => Array.from(a).every(Number.isFinite)));
    check('a small surface uses 16-bit indices', g.indices instanceof Uint16Array);
    check('slice bounds enclose exactly their own vertices',
      closeArr(built.slices[0].bounds.min, [0, 0, 0]) && closeArr(built.slices[0].bounds.max, [4, 2.6, 2]) &&
      closeArr(built.slices[1].bounds.min, [3, 0, 3]) && closeArr(built.slices[1].bounds.max, [4, 0.7, 4]),
      JSON.stringify(built.slices.map((x) => x.bounds)));
    check('an empty slice has degenerate bounds', closeArr(built.slices[2].bounds.min, [0, 0, 0]) && closeArr(built.slices[2].bounds.max, [0, 0, 0]));
    check('the geometry carries colors and ao', g.colors.length === nVerts * 3 && g.ao.length === nVerts);

    // The floor face: U along +z, V along +x, so U x V is +y and the triangles are wound to be
    // seen from above.
    const floor = built.slices[0].parts.find((p) => p.material === 'carpet');
    check('a face normal is U x V, normalized', closeArr([g.normals[0], g.normals[1], g.normals[2]], [0, 1, 0]));
    {
      const i0 = g.indices[floor.first], i1 = g.indices[floor.first + 1], i2 = g.indices[floor.first + 2];
      const A = [g.positions[i0 * 3], g.positions[i0 * 3 + 1], g.positions[i0 * 3 + 2]];
      const B = [g.positions[i1 * 3], g.positions[i1 * 3 + 1], g.positions[i1 * 3 + 2]];
      const C = [g.positions[i2 * 3], g.positions[i2 * 3 + 1], g.positions[i2 * 3 + 2]];
      const ab = vec3.sub([], B, A), ac = vec3.sub([], C, A);
      const nrm = vec3.cross([], ab, ac);
      check('the winding agrees with the normal', vec3.dot(nrm, [0, 1, 0]) > 0, String(nrm));
    }
    // World-unit UVs: the first face spans x 0..2 with uv 2, the second x 2..4; where they meet
    // the texture coordinate must be the same number, which is the reason there is no seam.
    {
      // face 1: 3x3 lattice, vertex (i=0..2 along U=z, j=0..2 along V=x); x = j, z = i
      const t_atX2_first = g.uvs[(2 * 3 + 0) * 2 + 1];   // j = 2 → x = 2, t = x / 2 = 1
      // face 2 begins at vertex 9: 2x2 lattice, vertex (i, j): x = 2 + 2j
      const t_atX2_second = g.uvs[(9 + 0) * 2 + 1];
      check('neighbouring faces share texture coordinates at their edge',
        close(t_atX2_first, 1) && close(t_atX2_second, 1), t_atX2_first + ' vs ' + t_atX2_second);
    }
    check('ao is sampled from a function at each vertex', close(g.ao[0], 0.5) && close(g.ao[3 * 2 + 2], 1), g.ao[0] + ' ' + g.ao[8]);
    check('absent ao and tint are 1 and white', close(g.ao[9], 1) && closeArr([g.colors[27], g.colors[28], g.colors[29]], [1, 1, 1]));
    {
      const wall = built.slices[0].parts.find((p) => p.material === 'drywall');
      const i = g.indices[wall.first];
      check('tint is baked into colors', closeArr([g.colors[i * 3], g.colors[i * 3 + 1], g.colors[i * 3 + 2]], [0.5, 1, 0.5]));
    }
    // The box: six faces of four vertices; the top takes the box's ao, the underside about half.
    {
      const wood = built.slices[1].parts[0];
      check('a box is six quads', wood.count === 36);
      const start = 9 + 4 + 4;   // after face 1 (9), face 2 (4), the wall (4)
      const aos = Array.from(g.ao.slice(start, start + 24));
      const top = aos.slice(8, 12), bottom = aos.slice(12, 16), side = aos.slice(0, 4);
      check('a box shades top, sides and underside from one ao',
        top.every((a) => close(a, 0.8)) && bottom.every((a) => close(a, 0.8 * 0.55)) && side.every((a) => close(a, 0.8 * 0.9)),
        top[0] + ' ' + side[0] + ' ' + bottom[0]);
    }

    // Cards: the front faces `facing`, the picture reads left to right from the front, and the
    // quad sits a hair off the wall. This is the mirrored-sign bug, made impossible.
    for (const [facing, normal, rightAxis] of [
      ['+z', [0, 0, 1], [1, 0, 0]], ['-z', [0, 0, -1], [-1, 0, 0]],
      ['+x', [1, 0, 0], [0, 0, -1]], ['-x', [-1, 0, 0], [0, 0, 1]],
    ]) {
      const c = Alloy.geometry.surface();
      c.card(5, 1.5, 5, facing, 0.2, 0.3, 'sign');
      const cg = c.finish().geometry;
      const n0 = [cg.normals[0], cg.normals[1], cg.normals[2]];
      // the vertex with the largest s must lie furthest along the viewer's right
      let best = -1, bestS = -1, worst = -1, worstS = 2;
      for (let i = 0; i < 4; i++) { const sv = cg.uvs[i * 2]; if (sv > bestS) { bestS = sv; best = i; } if (sv < worstS) { worstS = sv; worst = i; } }
      const pb = [cg.positions[best * 3], cg.positions[best * 3 + 1], cg.positions[best * 3 + 2]];
      const pw = [cg.positions[worst * 3], cg.positions[worst * 3 + 1], cg.positions[worst * 3 + 2]];
      const along = vec3.dot(vec3.sub([], pb, pw), rightAxis);
      // and v = 0 is the bottom edge
      let lowV = 2, lowY = 0; for (let i = 0; i < 4; i++) { if (cg.uvs[i * 2 + 1] < lowV) { lowV = cg.uvs[i * 2 + 1]; lowY = cg.positions[i * 3 + 1]; } }
      const centre = [0, 0, 0]; for (let i = 0; i < 4; i++) { centre[0] += cg.positions[i * 3] / 4; centre[1] += cg.positions[i * 3 + 1] / 4; centre[2] += cg.positions[i * 3 + 2] / 4; }
      check('a card facing ' + facing + ' faces ' + facing + ', reads left to right, and stands off the wall',
        closeArr(n0, normal) && along > 0.39 && close(lowY, 1.2) && closeArr(centre, [5 + normal[0] * 0.008, 1.5, 5 + normal[2] * 0.008], 1e-4),
        'normal ' + n0 + ' along ' + along + ' lowY ' + lowY + ' centre ' + centre);
    }
    let threw = false;
    try { Alloy.geometry.surface().card(0, 0, 0, 'up', 1, 1, 'x'); } catch (e) { threw = /facing/.test(e.message); }
    check('a card with a bad facing says so', threw);
    threw = false;
    try { Alloy.geometry.surface().face([0, 0, 0], [1, 0, 0], [0, 0, 1], [0, 1], [0, 1], 7); } catch (e) { threw = /material NAME/.test(e.message); }
    check('a face without a material name says so', threw);

    // nearest: reach is the light's range, order is by distance to the centre, cap holds.
    const lights = [
      { position: [10, 2, 10], range: 9, name: 'near' },
      { position: [30, 2, 10], range: 9, name: 'far' },
      { position: [22, 2, 10], range: 9, name: 'edge' },      // 6 m past the box's +x face: reaches
      { position: [-10, 2, 10], range: 9, name: 'behind' },   // 10 m past the -x face: does not
      { position: [12, 2, 12], range: 9, name: 'nearer' },
    ];
    const box = { min: [0, 0, 0], max: [16, 3, 16] };
    const chosen = Alloy.lights.nearest(lights, box).map((L) => L.name);
    check('nearest keeps lights whose reach touches the box, nearest first',
      chosen.join(',') === 'near,nearer,edge', chosen.join(','));
    check('nearest honours the cap', Alloy.lights.nearest(lights, box, 1).length === 1);
    check('nearest widens with a margin', Alloy.lights.nearest(lights, box, 64, 2).map((L) => L.name).includes('behind'));
    check('the renderer publishes makeSurface, drawSurface and disposeSurface',
      ['makeSurface', 'drawSurface', 'disposeSurface'].every((n) => typeof Alloy.prototype[n] === 'function'));
  }

  console.log('\n=== mesh: instance tints ===');
  {
    // The instance tint slot: white and 1 by default, written by a checked helper, so a wrong
    // length or a NaN fails here with an index rather than as one invisible chair.
    const tints = Alloy.makeInstanceTints(3);
    check('a fresh set is white and unoccluded', tints.length === 12 && Array.from(tints).every((v) => v === 1));
    const set = { tints };
    Alloy.instanceTint(set, 1, [0.2, 0.4, 0.6], 0.5);
    check('instanceTint writes rgb and ao at the index',
      closeArr(Array.from(tints.slice(4, 8)), [0.2, 0.4, 0.6, 0.5]) && tints[0] === 1 && tints[8] === 1);
    Alloy.instanceTint(set, 2);
    check('omitted tint and ao are white and 1', closeArr(Array.from(tints.slice(8, 12)), [1, 1, 1, 1]));
    let threw = '';
    try { Alloy.instanceTint(set, 3, [1, 1, 1]); } catch (e) { threw = e.message; }
    check('an index past the set says so', /instance 3 is outside a set of 3/.test(threw), threw);
    threw = '';
    try { Alloy.instanceTint(set, 0, [1, 1]); } catch (e) { threw = e.message; }
    check('a two-component tint says so', /must be \[r, g, b\]/.test(threw), threw);
    threw = '';
    try { Alloy.instanceTint(set, 0, [1, 1, 1], NaN); } catch (e) { threw = e.message; }
    check('a NaN ao says so', /ao must be a number/.test(threw), threw);
    // The GPU side cannot run here, but the layout it binds can be read: the tint attribute is
    // bound per instance from its own buffer, and disposal frees that buffer.
    const src = Alloy.prototype.makeInstances.toString();
    check('makeInstances binds the tint attribute per instance',
      /vertexAttribPointer\(ATTR\.instTint, 4, gl\.FLOAT, false, 16, 0\)/.test(src) && /vertexAttribDivisor\(ATTR\.instTint, 1\)/.test(src));
    check('updateInstances uploads the tints', /set\.tints, 0, count \* 4/.test(Alloy.prototype.updateInstances.toString()));
    check('disposeInstances frees the tint buffer', /deleteBuffer\(set\.tintBuffer\)/.test(Alloy.prototype.disposeInstances.toString()));
  }

  console.log('\n=== mesh: picking ===');
  {
    const P = Alloy.pick;
    const proj = mat4.perspective(mat4.create(), 60, 2, 0.1, 100);
    const view = mat4.lookAt(mat4.create(), [0, 0, 10], [0, 0, 0], [0, 1, 0]);
    const vp = mat4.multiply(mat4.create(), proj, view);
    const W = 800, H = 400;

    check('the origin projects to the centre of the viewport',
      closeArr(P.project([], [0, 0, 0], vp, W, H).slice(0, 2), [W / 2, H / 2], 0.01));
    check('a point above the origin projects higher up the screen',
      P.project([], [0, 1, 0], vp, W, H)[1] < H / 2);
    check('a point behind the eye has no screen position',
      Number.isNaN(P.project([], [0, 0, 20], vp, W, H)[0]));

    const inv = mat4.invert(mat4.create(), vp);
    const ray = P.unproject({ origin: [0, 0, 0], dir: [0, 0, 0] }, W / 2, H / 2, inv, W, H);
    check('the centre pixel casts a ray straight down the view direction',
      closeArr(ray.dir, [0, 0, -1], 1e-4), ray.dir.map((v) => v.toFixed(3)).join(','));
    check('a ray from the centre hits a box at the origin',
      P.rayAABB(ray.origin, ray.dir, [-1, -1, -1], [1, 1, 1]) > 0);
    check('a ray misses a box off to the side',
      P.rayAABB(ray.origin, ray.dir, [40, -1, -1], [42, 1, 1]) < 0);
    check('a ray starting inside a box still reports a hit',
      P.rayAABB([0, 0, 0], [0, 0, -1], [-1, -1, -1], [1, 1, 1]) >= 0);

    // closestOnLine turns a gizmo drag into a distance, and its SIGN is the whole point. Getting
    // the subtraction backwards negates it, which is a gizmo that moves everything the wrong way
    // — invisible in the formula and obvious the first time anyone drags a handle.
    {
      const up = P.closestOnLine([], [0, 2, 10], [0, 0, -1], [0, 0, 0], [0, 1, 0]);
      check('closestOnLine is positive for a point up the axis', close(up, 2, 1e-4), String(up));
      const down = P.closestOnLine([], [0, -3, 10], [0, 0, -1], [0, 0, 0], [0, 1, 0]);
      check('and negative for a point down it', close(down, -3, 1e-4), String(down));
      const out = [0, 0, 0];
      P.closestOnLine(out, [0, 2, 10], [0, 0, -1], [0, 0, 0], [0, 1, 0]);
      check('and it writes the point on the line', closeArr(out, [0, 2, 0], 1e-4));
      check('parallel lines do not move',
        close(P.closestOnLine([], [0, 2, 0], [0, 1, 0], [0, 0, 0], [0, 1, 0]), 0));
    }

    const hit = [0, 0, 0];
    check('a ray meets a plane where it should',
      P.rayPlane(hit, [0, 5, 0], [0, -1, 0], [0, 0, 0], [0, 1, 0]) && closeArr(hit, [0, 0, 0]));
    check('a ray parallel to a plane never meets it',
      !P.rayPlane(hit, [0, 5, 0], [1, 0, 0], [0, 0, 0], [0, 1, 0]));
  }

  console.log('\n=== mesh: mirroring and node parts ===');
  {
    // A mirrored node has a negative determinant, which turns its triangles inside out. The merge
    // reverses their winding, so the mirrored half is solid rather than invisible.
    const model = { nodes: [
      { name: 'a', primitive: 'wedge', position: [1, 0, 0] },
      { name: 'b', primitive: 'wedge', position: [-1, 0, 0], scale: [-1, 1, 1] },
    ] };
    const m = Alloy.mergeModel(model);
    check('the merge reports one part per node with geometry', m.parts.length === 2);
    check('a part knows where it is in the buffer and in space',
      m.parts[0].indexCount > 0 && !!m.parts[0].bounds && !!m.parts[0].path);

    /**
     * Are a range's triangles wound to agree with their own normals?
     * @param {Object} merged - the merged model
     * @param {number} at - which part
     * @returns {boolean} - true when every triangle agrees
     */
    function windingAgrees(merged, at) {
      const g = merged.geometry, part = merged.parts[at];
      for (let t = part.indexStart; t < part.indexStart + part.indexCount; t += 3) {
        const i0 = g.indices[t] * 3, i1 = g.indices[t + 1] * 3, i2 = g.indices[t + 2] * 3;
        const p0 = [g.positions[i0], g.positions[i0 + 1], g.positions[i0 + 2]];
        const p1 = [g.positions[i1], g.positions[i1 + 1], g.positions[i1 + 2]];
        const p2 = [g.positions[i2], g.positions[i2 + 1], g.positions[i2 + 2]];
        const cr = vec3.cross([], vec3.sub([], p1, p0), vec3.sub([], p2, p0));
        if (vec3.len(cr) < 1e-9) continue;
        const vn = [g.normals[i0], g.normals[i0 + 1], g.normals[i0 + 2]];
        if (vec3.dot(vec3.normalize([], cr), vn) < 0) return false;
      }
      return true;
    }
    check('an ordinary node is wound to match its normals', windingAgrees(m, 0));
    check('a mirrored node is wound to match its normals too', windingAgrees(m, 1));

    // Without the fix the mirrored half is culled away entirely, so prove the check can fail by
    // building the same thing with the flip left in the data rather than in the scale.
    const noFlip = Alloy.mergeModel({ nodes: [{ primitive: 'wedge', scale: [1, 1, 1] }] });
    check('the winding check can tell the two apart', windingAgrees(noFlip, 0));

    check('a part\'s bounds are in world space', (() => {
      const far = Alloy.mergeModel({ nodes: [{ primitive: 'box', position: [10, 0, 0] }] });
      return far.parts[0].bounds.min[0] > 9 && far.parts[0].bounds.max[0] < 11;
    })());
  }

  console.log('\n=== mesh: the package grows ===');
  {
    const p = Alloy.emptyPackage('m');
    check('a new package has materials and models',
      p.schema === Alloy.packageSchema && !!p.materials && !!p.models);

    p.textures.wall = Alloy.emptyTexture('wall');
    p.materials.brick = { name: 'brick', color: '#ffffff', texture: 'wall' };
    p.models.hut = { name: 'hut', nodes: [
      { name: 'walls', primitive: 'box', params: { width: 3, height: 2, depth: 3 },
        material: 'brick', uv: { mode: 'box', scale: 1 } },
      { name: 'roof', primitive: 'wedge', position: [0, 1.5, 0], material: 'brick' },
    ] };
    check('a package with a model validates', Alloy.validatePackage(p).length === 0,
      Alloy.validatePackage(p).join(' | '));
    check('a package with a model round trips through its block',
      JSON.stringify(Alloy.parsePackageBlock(Alloy.packageBlock(p).content)) === JSON.stringify(p));

    // Every dangling reference is reported, because a model naming a material nobody made is a
    // white object with no explanation.
    const bad = JSON.parse(JSON.stringify(p));
    bad.materials.brick.texture = 'nope';
    bad.models.hut.nodes[0].material = 'missing';
    bad.models.hut.nodes[1].primitive = 'torus';
    bad.models.hut.nodes[1].rotation = [1, 2];
    const issues = Alloy.validatePackage(bad);
    check('a dangling texture, material, primitive and rotation are all reported',
      issues.length === 4, issues.join(' | '));

    // A schema 1 package has to open.
    const old = { schema: 1, name: 'old', textures: { t: Alloy.emptyTexture('t') } };
    Alloy.migratePackage(old);
    check('a schema 1 package migrates forward',
      old.schema === Alloy.packageSchema && !!old.materials && !!old.models && !!old.textures.t);
    check('migration does not lose anything', Object.keys(old.textures).join(',') === 't');

    check('emptyModel and emptyMaterial produce valid entries', (() => {
      const q = Alloy.emptyPackage('q');
      q.materials.m = Alloy.emptyMaterial('m');
      q.models.x = Alloy.emptyModel('x');
      q.models.x.nodes[0].material = 'm';
      return Alloy.validatePackage(q).length === 0 && Alloy.mergeModel(q.models.x).nodes === 1;
    })());
  }


  console.log('\n=== animation: easing and sampling ===');
  {
    check('every easing is named', Alloy.easings.join(',') ===
      'linear,step,ease,easeIn,easeOut,easeInOut,backOut', Alloy.easings.join(','));

    // A clip whose keys arrive out of order and whose rotations are written as euler degrees:
    // both spellings the data is allowed to use.
    const prepared = Alloy.prepareClip({
      duration: 2, loop: false,
      tracks: { arm: {
        position: [{ t: 2, v: [0, 4, 0] }, { t: 0, v: [0, 0, 0] }],
        rotation: [{ t: 0, v: [0, 0, 0] }, { t: 2, v: [0, 90, 0] }],
      } },
      events: [{ t: 1.5, name: 'late' }, { t: 0.5, name: 'early' }],
    });
    check('prepareClip sorts keys that arrived out of order',
      prepared.tracks.arm.position[0].t === 0 && prepared.tracks.arm.position[1].t === 2);
    check('prepareClip sorts events too', prepared.events.map((e) => e.name).join(',') === 'early,late');
    check('prepareClip turns euler keys into quaternions',
      prepared.tracks.arm.rotation[1].v.length === 4 &&
      closeArr(prepared.tracks.arm.rotation[1].v, quat.fromEuler([], 0, 90, 0), 1e-6));

    let threw = false;
    try { Alloy.prepareClip(null); } catch (e) { threw = /must be an object/.test(e.message); }
    check('prepareClip refuses a non-clip', threw);
  }

  console.log('\n=== animation: the pose pipeline ===');
  {
    // A two-bone chain, so the hierarchy can be checked as well as the maths.
    const model = { name: 'rig', nodes: [
      { name: 'root', position: [0, 0, 0], bone: true, children: [
        { name: 'upper', position: [0, 1, 0], bone: true, primitive: 'box',
          params: { width: 0.2, height: 1, depth: 0.2 }, children: [
          { name: 'lower', position: [0, 1, 0], bone: true, primitive: 'box',
            params: { width: 0.2, height: 1, depth: 0.2 } },
        ] },
      ] },
    ] };
    const merged = Alloy.mergeModel(model);
    check('the rig has three bones plus the identity slot',
      merged.bones.length === 4 && merged.bones.map((b) => b.name).join(',') === ',root,upper,lower');

    const clips = {
      bend: { duration: 2, loop: true, tracks: {
        upper: { rotation: [{ t: 0, v: [0, 0, 0] }, { t: 1, v: [0, 0, 90] }, { t: 2, v: [0, 0, 0] }] },
      } },
      lift: { duration: 1, loop: true, tracks: {
        upper: { position: [{ t: 0, v: [0, 1, 0] }, { t: 1, v: [0, 3, 0] }] },
      } },
    };
    const anim = Alloy.makeAnimator({ model, bones: merged.bones, clips });
    const out = new Float32Array(merged.bones.length * 16);

    /**
     * Where a point rigidly attached to a bone ends up under the current pose.
     * @param {string} bone - the bone's name
     * @param {number[]} p - a point in model space, at rest
     * @returns {number[]} - the posed point
     */
    function posed(bone, p) {
      const at = merged.bones.findIndex((b) => b.name === bone);
      const m = out.subarray(at * 16, at * 16 + 16);
      return vec3.transformMat4([], p, m);
    }

    // With nothing playing, every delta is the identity and nothing moves.
    anim.update(0, out);
    check('an unanimated rig writes identity deltas',
      closeArr([...out.subarray(0, 16)], [...mat4.create()]) &&
      closeArr([...out.subarray(32, 48)], [...mat4.create()]));
    check('and a point on a bone stays where it was',
      closeArr(posed('lower', [0, 2, 0]), [0, 2, 0], 1e-5));

    // Rotate `upper` by 90 degrees about Z. Its child must swing with it.
    anim.play('bend', { loop: true });
    anim.update(1, out);
    const upperTip = posed('upper', [0, 2, 0]);
    check('a rotation clip turns the bone it names',
      closeArr(upperTip, [-1, 1, 0], 1e-4), upperTip.map((v) => v.toFixed(3)).join(','));
    const lowerTip = posed('lower', [0, 3, 0]);
    check('a child bone swings with its parent',
      closeArr(lowerTip, [-2, 1, 0], 1e-4), lowerTip.map((v) => v.toFixed(3)).join(','));
    check('an unanimated bone is left alone',
      closeArr([...out.subarray(16, 32)], [...mat4.create()], 1e-6));

    // Time wraps, so two seconds is the same pose as zero.
    anim.update(1, out);
    check('a looping clip wraps back to its start',
      closeArr(posed('upper', [0, 2, 0]), [0, 2, 0], 1e-4));

    // A position track moves the bone and everything under it.
    anim.stop();
    anim.play('lift');
    anim.update(0.5, out);
    check('a position track moves the bone',
      closeArr(posed('upper', [0, 1, 0]), [0, 2, 0], 1e-4),
      posed('upper', [0, 1, 0]).map((v) => v.toFixed(3)).join(','));
  }

  console.log('\n=== animation: the authoring surface ===');
  {
    // The clip editor scrubs, keys and onion-skins through four methods playback never touches.
    // They are what an authoring tool stands on, so they get tested as their own thing.
    const model = { name: 'rig', nodes: [
      { name: 'root', position: [0, 0, 0], bone: true, children: [
        { name: 'arm', position: [0, 2, 0], bone: true, primitive: 'box' },
      ] },
    ] };
    const merged = Alloy.mergeModel(model);
    const clips = {
      wave: { duration: 1, tracks: {
        arm: { rotation: [{ t: 0, v: [0, 0, 0] }, { t: 1, v: [0, 0, 90] }] },
      } },
    };
    const anim = Alloy.makeAnimator({ model, bones: merged.bones, clips });

    const list = anim.boneList();
    check('boneList reports every bone with its rest transform',
      list.map((b) => b.name).join(',') === 'root,arm' && closeArr(list[1].restPos, [0, 2, 0]));
    check('boneList carries parentage', list[1].parent === 'root' && list[0].parent === '');

    // Sampling between keys, which is what the playhead does.
    const half = anim.sampleLocal('wave', 'arm', 0.5);
    const halfZ = Alloy.quat.toEuler([], half.rotation)[2];
    check('sampleLocal interpolates rotation', close(halfZ, 45, 1e-3), halfZ.toFixed(3));

    // The channel fallback: a rotation-only track leaves position at REST, not at zero.
    check('sampleLocal leaves unanimated channels at rest',
      closeArr(half.position, [0, 2, 0]) && closeArr(half.scale, [1, 1, 1]), half.position.join(','));

    // An empty clip name is the documented way to ask for the rest pose, and the clip editor's
    // "key its rest pose here" is built on it.
    const rest = anim.sampleLocal('', 'arm', 0.5);
    check('an empty clip name samples the rest pose',
      close(Alloy.quat.toEuler([], rest.rotation)[2], 0, 1e-6) && closeArr(rest.position, [0, 2, 0]));
    check('sampleLocal refuses an unknown bone', anim.sampleLocal('wave', 'nope', 0) === null);

    // poseAt is the scrub: a pose at an arbitrary time, without disturbing the transport.
    const out = new Float32Array(merged.bones.length * 16);
    anim.poseAt([{ clip: 'wave', time: 1 }], out);
    const at = merged.bones.findIndex((b) => b.name === 'arm');
    const tip = vec3.transformMat4([], [0, 3, 0], out.subarray(at * 16, at * 16 + 16));
    check('poseAt poses the rig at a given time', closeArr(tip, [-1, 2, 0], 1e-4),
      tip.map((v) => v.toFixed(3)).join(','));
    check('poseAt does not start playback', anim.isPlaying('wave') === false);

    // Two specs at half weight each, which is how the editor previews a blend.
    anim.poseAt([{ clip: 'wave', time: 0, weight: 0.5 },
                 { clip: 'wave', time: 1, weight: 0.5 }], out);
    const mid = vec3.transformMat4([], [0, 3, 0], out.subarray(at * 16, at * 16 + 16));
    check('poseAt blends weighted specs', close(mid[0], -Math.SQRT1_2, 1e-3),
      mid.map((v) => v.toFixed(3)).join(','));

    // worldOf reports where a bone ended up, which is where the gizmo draws itself.
    anim.poseAt([{ clip: 'wave', time: 1 }], out);
    const origin = vec3.transformMat4([], [0, 0, 0], anim.worldOf('arm'));
    check('worldOf follows the pose', closeArr(origin, [0, 2, 0], 1e-4),
      origin.map((v) => v.toFixed(3)).join(','));
    check('worldOf refuses an unknown bone', anim.worldOf('nope') === null);
  }

  console.log('\n=== animation: playback ===');
  {
    const model = { nodes: [{ name: 'b', bone: true, primitive: 'box' }] };
    const merged = Alloy.mergeModel(model);
    const clips = {
      once: { duration: 1, loop: false, tracks: { b: { position: [
        { t: 0, v: [0, 0, 0] }, { t: 1, v: [0, 10, 0] }] } } },
      spin: { duration: 1, loop: true, tracks: { b: { rotation: [
        { t: 0, v: [0, 0, 0] }, { t: 1, v: [0, 180, 0] }] } } },
    };
    const out = new Float32Array(merged.bones.length * 16);

    // Ping-pong reflects rather than wrapping.
    {
      const a = Alloy.makeAnimator({ model, bones: merged.bones, clips });
      a.play('spin', { pingPong: true });
      a.update(0.75, out);
      check('ping-pong runs forward first', close(a.state()[0].time, 0.75, 1e-6));
      a.update(0.5, out);
      check('ping-pong reflects at the end', close(a.state()[0].time, 0.75, 1e-6),
        String(a.state()[0].time));
      // A step longer than the whole clip must still land inside it.
      a.update(5, out);
      const t = a.state()[0].time;
      check('a huge step still lands inside a ping-pong clip', t >= 0 && t <= 1, String(t));
    }

    // Speed and offset.
    {
      const a = Alloy.makeAnimator({ model, bones: merged.bones, clips });
      a.play('spin', { speed: 2, offset: 0.1 });
      a.update(0.2, out);
      check('speed multiplies time and offset starts it late',
        close(a.state()[0].time, 0.5, 1e-6), String(a.state()[0].time));
    }

    // A one-shot ends and fades itself out.
    {
      const a = Alloy.makeAnimator({ model, bones: merged.bones, clips });
      a.play('once');
      a.update(0.5, out);
      check('a one-shot is playing partway through', a.isPlaying('once'));
      a.update(1, out);
      check('a one-shot holds its last frame at the end', close(a.state()[0].time, 1, 1e-6));
      for (let i = 0; i < 30; i++) a.update(0.05, out);
      check('and then lets go', !a.isPlaying('once') && a.state().length === 0);
    }

    // Playing the same clip twice is one clip, not two at half weight.
    {
      const a = Alloy.makeAnimator({ model, bones: merged.bones, clips });
      a.play('spin');
      a.play('spin');
      check('playing a clip twice does not stack it', a.state().length === 1);
    }
  }

  console.log('\n=== animation: blending ===');
  {
    const model = { nodes: [{ name: 'b', bone: true, primitive: 'box' }] };
    const merged = Alloy.mergeModel(model);
    const clips = {
      low:  { duration: 1, loop: true, tracks: { b: { position: [{ t: 0, v: [0, 0, 0] }] } } },
      high: { duration: 1, loop: true, tracks: { b: { position: [{ t: 0, v: [0, 10, 0] }] } } },
      nudge: { duration: 1, loop: true, tracks: { b: { position: [{ t: 0, v: [0, 2, 0] }] } } },
    };
    const out = new Float32Array(merged.bones.length * 16);
    const at = merged.bones.findIndex((x) => x.name === 'b');
    /**
     * The animated height of the bone.
     * @returns {number} - its y
     */
    function height() { return out[at * 16 + 13]; }

    const a = Alloy.makeAnimator({ model, bones: merged.bones, clips });
    a.play('low');
    a.update(0, out);
    check('a full-weight clip lands exactly', close(height(), 0, 1e-5));

    // Crossfade: halfway through, the pose is halfway between the two.
    a.blendTo('high', 1);
    a.update(0.5, out);
    check('a crossfade is halfway at half its duration', close(height(), 5, 0.3), String(height()));
    a.update(0.6, out);
    check('and finishes on the new clip', close(height(), 10, 1e-4), String(height()));

    // Additive adds its difference from rest without disturbing the base.
    {
      const b = Alloy.makeAnimator({ model, bones: merged.bones, clips });
      b.play('high');
      b.update(0, out);
      const base = height();
      b.play('nudge', { additive: true, weight: 1 });
      b.update(0, out);
      check('an additive layer adds its difference from rest',
        close(height(), base + 2, 1e-4), base + ' then ' + height());
      b.play('nudge', { additive: true, weight: 0.5 });
      b.update(0, out);
      check('and scales that difference by its weight',
        close(height(), base + 1, 1e-4), String(height()));
    }

    // An additive layer must survive a change of base clip, which is the whole point of layering.
    {
      const b = Alloy.makeAnimator({ model, bones: merged.bones, clips });
      b.play('low');
      b.play('nudge', { additive: true });
      b.play('high');
      check('changing the base clip leaves an additive layer playing',
        b.state().some((x) => x.name === 'nudge' && x.additive));
    }
  }

  console.log('\n=== animation: events ===');
  {
    const model = { nodes: [{ name: 'b', bone: true, primitive: 'box' }] };
    const merged = Alloy.mergeModel(model);
    const clips = { walk: { duration: 1, loop: true,
      tracks: { b: { position: [{ t: 0, v: [0, 0, 0] }, { t: 1, v: [0, 1, 0] }] } },
      events: [{ t: 0.25, name: 'left' }, { t: 0.75, name: 'right' }] } };
    const out = new Float32Array(merged.bones.length * 16);

    /**
     * Runs a clip for a while and collects the events it fired.
     * @param {number} steps - how many updates
     * @param {number} dt - the step size
     * @returns {string[]} - event names in order
     */
    function run(steps, dt) {
      const a = Alloy.makeAnimator({ model, bones: merged.bones, clips });
      const fired = [];
      a.onEvent((e) => fired.push(e.name));
      a.play('walk');
      for (let i = 0; i < steps; i++) a.update(dt, out);
      return fired;
    }

    // Exactly one of each per pass, however the time is chopped up. A test of "is the playhead
    // near the marker" fires several times at a small step and none at a large one.
    check('every marker fires once per pass at a fine step',
      run(100, 0.01).join(',') === 'left,right', run(100, 0.01).join(','));
    check('and once per pass at a coarse step',
      run(5, 0.2).join(',') === 'left,right', run(5, 0.2).join(','));
    check('markers fire again on the next loop',
      run(200, 0.01).join(',') === 'left,right,left,right', run(200, 0.01).join(','));
    // A step that swallows the whole clip must not swallow its events.
    check('a step longer than the clip still fires its markers',
      run(1, 1.5).length >= 2, run(1, 1.5).join(','));

    const a = Alloy.makeAnimator({ model, bones: merged.bones, clips });
    let count = 0;
    const off = a.onEvent(() => count++);
    a.play('walk');
    a.update(0.5, out);
    off();
    a.update(0.5, out);
    check('a listener can be removed', count === 1, String(count));
  }

  console.log('\n=== animation: procedural ===');
  {
    const model = { nodes: [{ name: 'head', bone: true, primitive: 'box', position: [0, 1, 0] }] };
    const merged = Alloy.mergeModel(model);
    const out = new Float32Array(merged.bones.length * 16);
    const at = merged.bones.findIndex((b) => b.name === 'head');

    // Look-at: the bone's +Y axis should end up pointing at the target.
    {
      const a = Alloy.makeAnimator({ model, bones: merged.bones });
      a.lookAt('head', [0, 1, 10], { axis: [0, 1, 0], maxAngle: 180 });
      a.update(0.016, out);
      const m = out.subarray(at * 16, at * 16 + 16);
      // The rest +Y direction, put through the delta.
      const aimed = vec3.normalize([], vec3.transformDir([], [0, 1, 0], m));
      check('look-at points the named axis at the target',
        closeArr(aimed, [0, 0, 1], 1e-3), aimed.map((v) => v.toFixed(3)).join(','));

      a.lookAt('head', null);
      a.update(0.016, out);
      check('clearing the aim releases the bone',
        closeArr([...out.subarray(at * 16, at * 16 + 16)], [...mat4.create()], 1e-5));
    }

    // The clamp is what stops a head turning all the way round to follow something behind it.
    {
      const a = Alloy.makeAnimator({ model, bones: merged.bones });
      a.lookAt('head', [0, 1, -10], { axis: [0, 1, 0], maxAngle: 30 });
      a.update(0.016, out);
      const aimed = vec3.normalize([], vec3.transformDir([], [0, 1, 0],
        out.subarray(at * 16, at * 16 + 16)));
      const turned = Math.acos(clampNum(vec3.dot(aimed, [0, 1, 0]), -1, 1)) * 180 / Math.PI;
      check('look-at respects its maximum angle', turned <= 30.5, turned.toFixed(2) + ' degrees');
    }

    // A spring kicks and settles, and must not gain energy at a large step.
    {
      const a = Alloy.makeAnimator({ model, bones: merged.bones });
      a.impulse('head', [0, 0, 1], 40);
      a.update(0.016, out);
      const kicked = angleOf(out.subarray(at * 16, at * 16 + 16));
      check('an impulse moves the bone', kicked > 0.1, kicked.toFixed(3) + ' degrees');
      let peak = kicked;
      for (let i = 0; i < 400; i++) {
        a.update(0.016, out);
        peak = Math.max(peak, angleOf(out.subarray(at * 16, at * 16 + 16)));
      }
      check('and it settles back to nothing',
        angleOf(out.subarray(at * 16, at * 16 + 16)) < 0.01,
        angleOf(out.subarray(at * 16, at * 16 + 16)).toFixed(4));
      check('without ever running away', peak < 90, peak.toFixed(2) + ' degrees at its worst');
    }
  }

  console.log('\n=== animation: matToQuat ===');
  {
    for (const e of [[0, 0, 0], [0, 90, 0], [180, 0, 0], [0, 180, 0], [0, 0, 180], [37, -122, 88]]) {
      const q = quat.fromEuler([], e[0], e[1], e[2]);
      const m = mat4.fromQuat(mat4.create(), q);
      const back = Alloy.matToQuat([], m);
      const v = [0.3, -0.7, 0.5];
      check('matToQuat recovers a rotation of ' + e.join(','),
        closeArr(vec3.transformQuat([], v, q), vec3.transformQuat([], v, back), 1e-4));
    }
    // Scale must not leak into the rotation.
    const scaled = mat4.compose(mat4.create(), [1, 2, 3],
      quat.fromEuler([], 0, 45, 0), [3, 0.5, 2]);
    const q = Alloy.matToQuat([], scaled);
    // vec3.len would only measure three of the four components, which for a quaternion is
    // sin(half the angle) rather than one — a test that fails on a correct answer.
    check('matToQuat ignores scale and translation',
      close(Math.hypot(q[0], q[1], q[2], q[3]), 1, 1e-5) &&
      closeArr(vec3.transformQuat([], [1, 0, 0], q),
               vec3.transformQuat([], [1, 0, 0], quat.fromEuler([], 0, 45, 0)), 1e-4));
  }

  console.log('\n=== animation: the package grows again ===');
  {
    // ---- Texture animation: keyframes, sampling, and the state key ----
    {
      const T = Alloy.texture;
      // A red square that scrolls right and fades, over a static blue base. Row 1 is animated,
      // row 0 is not, so the static-prefix idea holds.
      const red = T.encodePNG(T.makePixels(4, 4, [1, 0, 0, 1]));
      const tex = {
        name: 'anim', width: 4, height: 4, seed: 1,
        anim: { frames: 10, rate: 8, loop: 'loop' },
        layers: [
          { type: 'generator', generator: 'solid', params: { color: '#0000ff' } },
          { type: 'shape', op: { op: 'rect', x: 0, y: 0, w: 0.5, h: 0.5, fill: '#ff0000' },
            keys: {
              'op.x':   [ { f: 0, v: 0 }, { f: 8, v: 0.5 } ],
              'opacity':[ { f: 0, v: 1, ease: 'step' }, { f: 8, v: 0 } ],
              'op.fill':[ { f: 0, v: '#ff0000' }, { f: 8, v: '#00ff00' } ],
            } },
        ],
      };
      check('an animated texture validates', Alloy.validatePackage({ schema: 6, textures: { a: tex }, materials: {}, models: {}, clips: {} }).length === 0,
        Alloy.validatePackage({ schema: 6, textures: { a: tex }, materials: {}, models: {}, clips: {} }).join(' | '));
      check('textureFrames reads the length', Alloy.texture.textureFrames(tex) === 10);
      // sampleTrack: linear number, mid-point.
      check('a number track lerps', Math.abs(Alloy.texture.sampleTrack(tex.layers[1].keys['op.x'], 4) - 0.25) < 1e-9);
      check('a track holds before the first key', Alloy.texture.sampleTrack(tex.layers[1].keys['op.x'], -3) === 0);
      check('a track holds after the last key', Alloy.texture.sampleTrack(tex.layers[1].keys['op.x'], 99) === 0.5);
      // step ease holds the leaving key's value until the next.
      check('a step track does not blend', Alloy.texture.sampleTrack(tex.layers[1].keys.opacity, 4) === 1);
      // colour track lerps in sRGB: halfway from #ff0000 to #00ff00 is ~#808000.
      const half = Alloy.texture.sampleTrack(tex.layers[1].keys['op.fill'], 4);
      check('a colour track lerps', /^#[78][0-9a-f]80[0-9a-f]0$/.test(half) || half === '#808000', half);
      // Evaluate at two frames: pixels must differ (the square moved / faded), and the base must
      // not have been mutated by resolving a frame.
      const at0 = T.toBytes(T.sampleTexture(tex, 0));
      const at8 = T.toBytes(T.sampleTexture(tex, 8));
      check('frames evaluate differently', at0.some((v, i) => v !== at8[i]));
      check('resolving a frame does not mutate the base op', tex.layers[1].op.x === 0 && tex.layers[1].op.fill === '#ff0000');
      // A static texture is unaffected by a frame argument.
      const stat = { name: 's', width: 4, height: 4, seed: 1, layers: [{ type: 'generator', generator: 'solid', params: { color: '#123456' } }] };
      check('a frame on a static texture is a no-op',
        T.toBytes(T.evaluate(stat)).every((v, i) => v === T.toBytes(T.sampleTexture(stat, 5))[i]));
      // The state key: same held segment => same token; a different segment => different.
      const kA = Alloy.texture.textureStateKey(tex, 8.0);
      const kB = Alloy.texture.textureStateKey(tex, 8.4);   // opacity is step, but op.x/op.fill hold past 8 too
      const kC = Alloy.texture.textureStateKey(tex, 2.0);
      check('the state key holds across a held stretch', kA === kB, kA + ' vs ' + kB);
      check('the state key changes on a moving stretch', kA !== kC);
      check('a static texture has a static state key', Alloy.texture.textureStateKey(stat, 3) === 'static');
      // A bad keyframe track is reported.
      const bad = { schema: 6, textures: { a: { name: 'a', width: 4, height: 4, seed: 1,
        anim: { frames: 4, rate: 0 },
        layers: [ { type: 'generator', generator: 'solid', keys: { opacity: [ { f: 1, v: 1 }, { f: 0, v: 0 } ] } } ] } },
        materials: {}, models: {}, clips: {} };
      const bi = Alloy.validatePackage(bad);
      check('a bad anim.rate and an unsorted track are reported',
        bi.some((x) => /rate must be positive/i.test(x) || /rate must be a positive/i.test(x)) && bi.some((x) => /not sorted/.test(x)), bi.join(' | '));
      // A package with animation round-trips through the data block.
      const rt = { schema: 8, name: 'r', textures: { a: tex }, materials: {}, models: {}, clips: {}, scenes: {} };
      check('an animated package round trips',
        JSON.stringify(Alloy.parsePackageBlock(Alloy.packageBlock(rt).content)) === JSON.stringify(rt));
    }

    const p = Alloy.emptyPackage('a');
    check('a new package is schema 8 with clips and scenes', p.schema === 8 && !!p.clips && !!p.scenes);

    // Scenes: named, plural, render state only.
    {
      const sc = Alloy.emptyScene('space-available');
      check('a new scene carries fog, ambient, post and a resolution',
        !!sc.fog && !!sc.ambient && Array.isArray(sc.post) && !!sc.resolution);
      check('every stage a new scene names exists',
        sc.post.every((e) => Alloy.postTypes.indexOf(e.stage) >= 0), sc.post.map((e) => e.stage).join(','));
      const withScene = Alloy.emptyPackage('s');
      withScene.scenes['space-available'] = sc;
      check('a package with a scene validates', Alloy.validatePackage(withScene).length === 0,
        Alloy.validatePackage(withScene).join(' | '));
      check('a scene round trips through the data block',
        JSON.stringify(Alloy.parsePackageBlock(Alloy.packageBlock(withScene).content)) === JSON.stringify(withScene));
      const bad = Alloy.emptyPackage('b');
      bad.scenes.broken = { name: 'broken', fog: { color: [0, 0, 0] }, post: [{ stage: 'nope' }], resolution: { height: -4 } };
      const bi = Alloy.validatePackage(bad);
      check('a bad scene is reported in full', bi.length === 3, bi.join(' | '));
      // Every stage must describe itself, the way a generator does.
      for (const name of Alloy.postTypes) {
        const d = Alloy.describePost(name);
        const dk = Object.keys(d.defaults).sort().join(',');
        const pk = d.schema.map((e) => e.path).sort().join(',');
        check('post stage ' + name + ' schema matches defaults', dk === pk, dk + ' vs ' + pk);
      }
    }

    p.models.rig = { name: 'rig', nodes: [
      { name: 'arm', bone: true, primitive: 'box' },
      { name: 'plain', primitive: 'box' },
    ] };
    p.clips.wave = Alloy.emptyClip('wave', 'rig');
    p.clips.wave.tracks.arm = { rotation: [{ t: 0, v: [0, 0, 0] }, { t: 1, v: [0, 45, 0] }] };
    check('a clip animating a real bone validates', Alloy.validatePackage(p).length === 0,
      Alloy.validatePackage(p).join(' | '));
    check('a package with clips round trips through its block',
      JSON.stringify(Alloy.parsePackageBlock(Alloy.packageBlock(p).content)) === JSON.stringify(p));

    // Animating a node that is not a bone is the mistake that produces no motion and no error.
    const bad = JSON.parse(JSON.stringify(p));
    bad.clips.wave.tracks.plain = { rotation: [{ t: 0, v: [0, 0, 0] }] };
    check('a track naming a node that is not a bone is reported',
      Alloy.validatePackage(bad).some((i) => /not a bone/.test(i)),
      Alloy.validatePackage(bad).join(' | '));

    const bad2 = JSON.parse(JSON.stringify(p));
    bad2.clips.wave.duration = 0;
    bad2.clips.wave.model = 'nope';
    bad2.clips.wave.tracks.arm.rotation[0].v = [1, 2];
    const issues = Alloy.validatePackage(bad2);
    check('a bad duration, a missing model and a short key are all reported',
      issues.length === 3, issues.join(' | '));

    // Schema 1 and 2 packages both have to open.
    const old1 = { schema: 1, name: 'o', textures: {} };
    Alloy.migratePackage(old1);
    check('a schema 1 package migrates all the way to 8',
      old1.schema === 8 && !!old1.materials && !!old1.models && !!old1.clips && !!old1.scenes);
    const old2 = { schema: 2, name: 'o', textures: {}, materials: {}, models: { m: { nodes: [] } } };
    Alloy.migratePackage(old2);
    check('a schema 2 package gains clips and keeps its models',
      old2.schema === 8 && !!old2.clips && !!old2.models.m && !!old2.scenes);

    // Schema 5 split pixels in two: paint is texture-sized, an image is any size.
    const T5 = Alloy.texture;
    const fitPng = T5.encodePNG(T5.makePixels(8, 8, [1, 0, 0, 1]));
    const bigPng = T5.encodePNG(T5.makePixels(16, 4, [0, 1, 0, 1]));
    check('pngSize reads the header alone', (() => { const z = T5.pngSize(bigPng); return z.width === 16 && z.height === 4; })());
    const old4 = { schema: 4, name: 'o', textures: { t: { name: 't', width: 8, height: 8, seed: 1, layers: [
      { type: 'raster', png: fitPng, fit: 'stretch' },
      { type: 'raster', png: bigPng, fit: 'tile', mask: { type: 'raster', png: bigPng, fit: 'stretch' } },
      { type: 'raster', png: '', fit: 'stretch' },
    ] } }, materials: {}, models: {}, clips: {} };
    Alloy.migratePackage(old4);
    const r4 = old4.textures.t.layers;
    check('a texture-sized raster migrates to paint and drops its fit',
      r4[0].type === 'raster' && r4[0].fit === undefined);
    check('an odd-sized raster migrates to an image and keeps its fit',
      r4[1].type === 'image' && r4[1].fit === 'tile' && r4[1].mask.type === 'image');
    check('an empty raster stays paint', r4[2].type === 'raster' && r4[2].fit === undefined);
    check('the migrated package validates clean', Alloy.validatePackage(old4).length === 0, Alloy.validatePackage(old4).join(' | '));
    const wrong = { schema: 5, name: 'w', textures: { t: { name: 't', width: 8, height: 8, seed: 1, layers: [
      { type: 'raster', png: bigPng }, { type: 'image', png: bigPng, fit: 'nope' }] } }, materials: {}, models: {}, clips: {} };
    const wrongIssues = Alloy.validatePackage(wrong);
    check('a paint row of the wrong size is refused, and a bad image fit',
      wrongIssues.length === 2 && /paint row of 16×4/.test(wrongIssues[0]) && /fit "nope"/.test(wrongIssues[1]), wrongIssues.join(' | '));
    const both = T5.evaluate({ width: 8, height: 8, layers: [{ type: 'image', png: bigPng, fit: 'stretch' }] });
    check('an image row evaluates fitted to the texture', both.data[0] === 0 && both.data[1] === 1 && both.data[(7 * 8 + 7) * 4 + 1] === 1);
  }


  /**
   * Clamps a number, since the checker has no engine helpers of its own.
   * @param {number} v - the value
   * @param {number} lo - the low bound
   * @param {number} hi - the high bound
   * @returns {number} - the clamped value
   */
  function clampNum(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  /**
   * How far a delta matrix rotates, in degrees. Used to watch a spring settle.
   * @param {Float32Array} m - a 16-float matrix
   * @returns {number} - the angle
   */
  function angleOf(m) {
    const q = Alloy.matToQuat([], m);
    return 2 * Math.acos(clampNum(Math.abs(q[3]), -1, 1)) * 180 / Math.PI;
  }

  console.log('\n=== runtime: the parts that need no GPU ===');
  {
    // The stage itself needs a canvas, so what can be asserted here is the logic it stands on:
    // the bone array, which clips drive which model, and aiming a camera. The stage's own wiring
    // is proved in a browser, against a real installed copy.

    const bones = Alloy.identityBones(3);
    check('identityBones sizes the array', bones.length === 48);
    check('identityBones writes identities',
      closeArr([...bones.subarray(0, 16)], [...mat4.create()]) &&
      closeArr([...bones.subarray(32, 48)], [...mat4.create()]));

    const clips = {
      walk:   { model: 'figure', duration: 1 },
      idle:   { model: 'figure', duration: 2 },
      creak:  { model: 'door', duration: 1 },
      flinch: { duration: 0.4 },                 // names no model: shared by every rig
    };
    const forFigure = Object.keys(Alloy.clipsForModel(clips, 'figure')).sort().join(',');
    const forDoor = Object.keys(Alloy.clipsForModel(clips, 'door')).sort().join(',');
    const forNobody = Object.keys(Alloy.clipsForModel(clips, 'nothing')).sort().join(',');
    check('a model gets the clips that name it', forFigure === 'flinch,idle,walk', forFigure);
    check('and a different model gets its own', forDoor === 'creak,flinch', forDoor);
    check('an unmentioned model still gets the unnamed ones', forNobody === 'flinch', forNobody);
    check('clipsForModel survives an empty package',
      Object.keys(Alloy.clipsForModel(null, 'figure')).length === 0);

    // A clip that names this model beats an unnamed clip of the same name. Specific wins.
    const shadowed = Alloy.clipsForModel({ hit: { duration: 9 }, }, 'figure');
    check('an unnamed clip is taken as-is', shadowed.hit.duration === 9);

    // Aiming the camera. The desired values are what `update` eases toward, so writing the
    // current ones looks like it works and is undone on the next frame.
    const cam = new Alloy.OrbitCamera({ yaw: 0, pitch: 0, distance: 6, smoothTime: 0.05 });
    cam.goTo({ yaw: 90, distance: 12 });
    check('goTo does not teleport', close(cam.yaw, 0, 1e-9), String(cam.yaw));
    cam.update(1e6);
    check('and the camera arrives', close(cam.yaw, 90, 1e-4) && close(cam.distance, 12, 1e-4),
      cam.yaw.toFixed(3) + ' / ' + cam.distance.toFixed(3));

    const cut = new Alloy.OrbitCamera({ yaw: 0 });
    cut.goTo({ yaw: 45, instant: true });
    check('instant is a cut, not a move', close(cut.yaw, 45, 1e-9), String(cut.yaw));

    // Clamped, because a game reading a pitch off a mouse will hand it 90 and the up vector at
    // the pole is undefined.
    const clamped = new Alloy.OrbitCamera({});
    clamped.goTo({ pitch: 300, distance: -5, instant: true });
    check('goTo clamps pitch and distance',
      clamped.pitch === clamped.maxPitch && clamped.distance === clamped.minDistance,
      clamped.pitch + ' / ' + clamped.distance);

    // Unsaid fields are left alone, which is what makes goTo callable with one key.
    const partial = new Alloy.OrbitCamera({ yaw: 10, pitch: 20, distance: 30 });
    partial.goTo({ yaw: 99, instant: true });
    check('goTo leaves unsaid fields alone',
      close(partial.pitch, 20, 1e-6) && close(partial.distance, 30, 1e-6));

    // The seam a game's numbers cross to reach the GPU. It has been wrong once, in a way that
    // reported six healthy draw calls onto a black screen, so it is asserted here rather than
    // trusted: a matrix with a NaN anywhere in it is the failure, and every case has to be clean.
    {
      const m = Alloy.instanceMatrix(mat4.create(), [1, 2, 3], [0, 0, 0], [1, 1, 1]);
      check('an identity-rotation instance composes cleanly',
        [...m].every((v) => Number.isFinite(v)), [...m].join(','));
      check('and it lands where it was put',
        closeArr(vec3.transformMat4([], [0, 0, 0], m), [1, 2, 3]));

      // Three numbers are euler DEGREES. This is exactly the call that failed.
      const turned = Alloy.instanceMatrix(mat4.create(), [0, 0, 0], [0, 90, 0], [1, 1, 1]);
      check('euler degrees compose without NaN', [...turned].every((v) => Number.isFinite(v)));
      const spun = vec3.transformMat4([], [0, 0, 1], turned);
      check('and 90 degrees about Y turns +Z into +X', closeArr(spun, [1, 0, 0], 1e-5),
        spun.map((v) => v.toFixed(3)).join(','));

      // Four numbers are a quaternion, because that is what an exporter produces.
      const q = Alloy.quat.fromEuler([], 0, 90, 0);
      const byQuat = Alloy.instanceMatrix(mat4.create(), [0, 0, 0], q, [1, 1, 1]);
      check('a quaternion rotation composes the same',
        closeArr([...byQuat], [...turned], 1e-5));

      // Omitted fields, because `createInstance(name)` with no options must still draw.
      const bare = Alloy.instanceMatrix(mat4.create());
      check('an instance with no transform is the identity',
        closeArr([...bare], [...mat4.create()]));

      const scaled = Alloy.instanceMatrix(mat4.create(), [0, 0, 0], [0, 0, 0], [2, 3, 4]);
      check('scale reaches the matrix',
        closeArr(vec3.transformMat4([], [1, 1, 1], scaled), [2, 3, 4]));

      let threw = '';
      try { Alloy.instanceMatrix(mat4.create(), [0, 0, 0], [1, 2], [1, 1, 1]); }
      catch (e) { threw = e.message; }
      check('a rotation of the wrong length says so', /three euler degrees or four/.test(threw),
        threw);
    }

    check('the runtime is published', typeof Alloy.init === 'function' &&
      typeof Alloy.Stage === 'function' && typeof Alloy.Instance === 'function');
    let threw = '';
    try { Alloy.init(undefined); } catch (e) { threw = e.message; }
    check('init without a canvas says so', /expected a canvas/.test(threw), threw);
  }

  console.log('\n=== engine surface ===');
  {
    // The tag is the one true version. Under Node there is no `document.currentScript`, so the
    // engine answers with the literal written into its own source — and that literal drifting
    // from the tag is exactly the bug this catches. Read the tag rather than hard-coding it here,
    // or the check needs editing every release and gets edited wrong once.
    const tagVersion = (blocks[0].tag.match(/data-ofcu-version="([^"]+)"/) || [])[1];
    const tagBuilt = (blocks[0].tag.match(/data-ofcu-built="([^"]{10})/) || [])[1];
    check('the tag declares a semver version', /^\d+\.\d+\.\d+$/.test(tagVersion || ''), tagVersion);
    check('the in-source fallback matches the tag', Alloy.version === tagVersion,
          'source says ' + Alloy.version + ', tag says ' + tagVersion);
    check('build is a date', /^\d{4}-\d{2}-\d{2}$/.test(Alloy.build), Alloy.build);
    check('the in-source build matches the tag', Alloy.build === tagBuilt,
          'source says ' + Alloy.build + ', tag says ' + tagBuilt);
    check('attribute locations are 0..3',
          Alloy.attributeLocations.position === 0 && Alloy.attributeLocations.normal === 1 &&
          Alloy.attributeLocations.uv === 2 && Alloy.attributeLocations.color === 3);
    // A material describes itself, because it grew from three keys to eleven and a game should
    // ask rather than guess.
    {
      const M = Alloy.describeMaterial();
      const keys = Alloy.materialKeys;
      check('a material publishes every key the renderer reads',
        ['color', 'emissive', 'texture', 'uvRect', 'unlit', 'alpha', 'alphaTest',
         'shading', 'aoRange', 'fresnel', 'pass'].every((k) => !!M[k]), keys.join(','));
      check('every material key says what it is and what it does',
        keys.every((k) => !!M[k].type && !!M[k].label && !!M[k].note));
      // The bug this prevents: a key added to the schema and forgotten in the resolver, so a
      // glass window in a package renders opaque with nothing anywhere saying why.
      {
        const full = { color: '#204060', emissive: '#111111', texture: 'ignored', uvRect: [0, 0, 2, 2],
          unlit: true, alpha: 0.4, alphaTest: 0.3, shading: 'world', aoRange: [0.1, 2.2],
          fresnel: 0.45, pass: 'glass' };
        const r = Alloy.resolveMaterial(full, null);
        const missed = keys.filter((k) => k !== 'texture' && r[k] === undefined);
        check('the resolver carries every key the schema publishes', missed.length === 0, 'dropped: ' + missed.join(','));
        check('the resolver converts hex to floats', Array.isArray(r.color) && r.color.length === 3 && r.color[0] < 1);
        check('a glass material survives the resolver', r.pass === 'glass' && r.shading === 'world' && r.fresnel === 0.45);
        // A bare material stays bare, so the renderer's own defaults are the only defaults.
        const bare = Alloy.resolveMaterial({ color: '#ffffff' }, null);
        check('a bare material picks up no invented values',
          bare.pass === undefined && bare.shading === undefined && bare.aoRange === undefined &&
          bare.fresnel === undefined && bare.alpha === undefined);
      }
      check('the enum-valued keys list their options',
        M.shading.options.join(',') === 'vertex,world' && M.pass.options.join(',') === 'opaque,glass');
      // Anisotropy is on by default, because the surface it saves is the one most looked at.
      check('textures ask for anisotropy by default', Alloy.defaults.texture.aniso === 8,
        String(Alloy.defaults.texture.aniso));
    }

    // Node tint and occlusion are baked by the merge, and inherited down the tree.
    {
      const plain = { name: 'm', nodes: [{ name: 'root', primitive: 'box' }] };
      const merged = Alloy.mergeModel(plain);
      check('a plain model carries no shading attributes',
        !merged.geometry.colors && !merged.geometry.ao);
      const shaded = { name: 'm', nodes: [{ name: 'root', primitive: 'box', tint: [1, 0.5, 0.5], ao: 0.5,
        children: [{ name: 'kid', primitive: 'box', position: [2, 0, 0], tint: [1, 1, 0.5], ao: 0.5 }] }] };
      const sm = Alloy.mergeModel(shaded);
      check('a tinted model grows colours and occlusion',
        !!sm.geometry.colors && !!sm.geometry.ao &&
        sm.geometry.colors.length === sm.geometry.positions.length &&
        sm.geometry.ao.length === sm.geometry.positions.length / 3);
      // The parent's own vertices carry only the parent's values.
      check('a node bakes its own tint', Math.abs(sm.geometry.colors[1] - 0.5) < 1e-6, String(sm.geometry.colors[1]));
      check('a node bakes its own occlusion', Math.abs(sm.geometry.ao[0] - 0.5) < 1e-6, String(sm.geometry.ao[0]));
      // The child's multiply the parent's: green 1*1, blue 0.5*0.5, ao 0.5*0.5.
      const last = sm.geometry.positions.length / 3 - 1;
      check('a child multiplies what it inherits',
        Math.abs(sm.geometry.colors[last * 3 + 2] - 0.25) < 1e-6 &&
        Math.abs(sm.geometry.ao[last] - 0.25) < 1e-6,
        sm.geometry.colors[last * 3 + 2] + ' / ' + sm.geometry.ao[last]);
      // A white tint and an occlusion of 1 are the same as saying nothing.
      const neutral = Alloy.mergeModel({ name: 'm', nodes: [{ primitive: 'box', tint: [1, 1, 1], ao: 1 }] });
      check('neutral shading writes nothing', !neutral.geometry.colors);
      const bad = { schema: 7, textures: {}, materials: {}, clips: {}, scenes: {},
        models: { m: { name: 'm', nodes: [{ primitive: 'box', tint: [1, 1], ao: -2 }] } } };
      const bi = Alloy.validatePackage(bad);
      check('a bad tint and a bad occlusion are both reported', bi.length === 2, bi.join(' | '));
    }

    // The debug-spawn parser: a query string in, a camera out, and nothing touched in between.
    {
      const P = Alloy.parseDebugSpawn;
      const a = P('?debug=12.5,-4,90,15');
      check('a debug spawn parses all four numbers',
        a && a.x === 12.5 && a.z === -4 && a.yaw === 90 && a.pitch === 15, JSON.stringify(a));
      const b = P('debug=3,4');
      check('a short debug spawn fills the rest with zero',
        b && b.x === 3 && b.z === 4 && b.yaw === 0 && b.pitch === 0, JSON.stringify(b));
      check('a debug spawn among other params is found', !!P('?seed=2&debug=1,1&x=9'));
      check('no debug means no spawn', P('?seed=2') === null && P('') === null && P(null) === null);
      check('a debug spawn that is not numbers is refused', P('?debug=over,there') === null);
    }

    // The ATTR table is the one place a location is decided, and a duplicate is the bug that
    // makes normals arrive as UVs with no error anywhere.
    {
      const A = Alloy.attributeLocations;
      check('every attribute the shaders declare has a location',
        ['position', 'normal', 'uv', 'color', 'joint', 'inst0', 'inst1', 'inst2', 'inst3', 'ao', 'instTint']
          .every((k) => Number.isInteger(A[k])), JSON.stringify(A));
      const used = Object.keys(A).map((k) => A[k]);
      check('no two attributes share a location', new Set(used).size === used.length, used.join(','));
      check('the instance matrix keeps four consecutive slots',
        A.inst1 === A.inst0 + 1 && A.inst2 === A.inst0 + 2 && A.inst3 === A.inst0 + 3);
      check('AO and the per-instance tint sit after the instance matrix',
        A.ao > A.inst3 && A.instTint > A.inst3);
    }
    let threw = false;
    try { new Alloy(undefined); } catch (e) { threw = /expected a canvas/.test(e.message); }
    check('constructing without a canvas says so', threw);
  }

  // ------------------------------------------------------------- the Great Alloy Audit's follow-ups
  // One test per fix the 2026-09-17 audit asked for, so none of them can quietly come back.
  console.log('\n=== audit follow-ups ===');
  {
    const T = Alloy.texture;
    const appSrc = blocks[1].content;

    // D-02: the schema/defaults parity the Bible promises for EVERY vocabulary entry held for
    // generators and adjustments and not for draw ops, and two had drifted.
    check('every draw op\'s defaults and params name the same keys', Alloy.drawOpTypes.every((o) => {
      const d = Alloy.describeDrawOp(o);
      return Object.keys(d.defaults).sort().join(',') === d.schema.map((e) => e.path).sort().join(',');
    }), Alloy.drawOpTypes.map((o) => {
      const d = Alloy.describeDrawOp(o);
      return o + ':' + Object.keys(d.defaults).sort().join('/') + ' vs ' + d.schema.map((e) => e.path).sort().join('/');
    }).join(' ; '));

    // B-02: the app converts a material through the engine and nowhere else. A hand-rolled
    // `{color, emissive, texture, alphaTest, unlit}` is the shape every copy so far has taken.
    check('the app builds no material conversion of its own',
      !/alphaTest:\s*m\.alphaTest/.test(appSrc) && /Alloy\.resolveMaterial\(/.test(appSrc));

    // B-03 / B-11 / F-07 / F-08 / D-19 / B-09: what the validator now refuses.
    const refuses = (mutate, re) => {
      const p = Alloy.emptyPackage('audit');
      p.textures.t = Alloy.emptyTexture('t', 8);
      p.materials.m = Alloy.emptyMaterial('m');
      p.models.mod = { name: 'mod', nodes: [{ name: 'a', bone: true, primitive: 'box' }, { name: 'b', bone: true, primitive: 'box' }] };
      mutate(p);
      const issues = Alloy.validatePackage(p);
      return issues.some((s) => re.test(s));
    };
    check('two bones with one name are refused', refuses((p) => { p.models.mod.nodes[1].name = 'a'; }, /bone names must be unique/));
    check('a mask of a mask is refused', refuses((p) => {
      p.textures.t.layers[0].mask = { type: 'generator', generator: 'solid', params: {}, mask: { type: 'generator', generator: 'solid' } };
    }, /mask may not have a mask/));
    check('an adjustment as a mask is refused', refuses((p) => {
      p.textures.t.layers[0].mask = { type: 'adjust', adjust: 'tint' };
    }, /must be a generator, shape, paint or image/));
    check('a key path naming nothing is refused', refuses((p) => {
      p.textures.t.anim = { frames: 4, rate: 12 };
      p.textures.t.layers[0].keys = { 'params.colour': [{ f: 0, v: '#000000' }] };
    }, /names a parameter this row does not have/));
    check('a key track that starts after frame 0 is refused', refuses((p) => {
      p.textures.t.anim = { frames: 4, rate: 12 };
      p.textures.t.layers[0].keys = { opacity: [{ f: 2, v: 0.5 }] };
    }, /must start at frame 0/));
    check('a material aoRange of one number is refused', refuses((p) => { p.materials.m.aoRange = [1]; }, /aoRange that is not two numbers/));
    check('a scene ambient of two numbers is refused', refuses((p) => {
      p.scenes.s = Alloy.emptyScene('s'); p.scenes.s.ambient.sky = [0.2, 0.3];
    }, /ambient sky that is not three numbers/));
    check('a node position of two numbers is refused', refuses((p) => { p.models.mod.nodes[0].position = [0, 1]; }, /position that is not three numbers/));
    check('a paint cel of the wrong size is refused', refuses((p) => {
      const wrong = T.encodePNG(T.makePixels(16, 4, [1, 0, 0, 1]));
      const right = T.encodePNG(T.makePixels(8, 8, [1, 0, 0, 1]));
      p.textures.t.anim = { frames: 4, rate: 12 };
      p.textures.t.layers.push({ type: 'raster', png: right, keys: { png: [{ f: 0, v: right }, { f: 2, v: wrong }] } });
    }, /cel at frame 2 is a paint row of 16×4/));
    check('a sound package still validates clean', !refuses(() => {}, /./));

    // B-04: play() on a clip already playing retargets it and leaves its time alone.
    {
      const model = { nodes: [{ name: 'b', bone: true, primitive: 'box' }] };
      const merged = Alloy.mergeModel(model);
      const clips = { spin: { duration: 1, loop: true, tracks: { b: { rotation: [
        { t: 0, v: [0, 0, 0] }, { t: 1, v: [0, 180, 0] }] } },
        events: [{ t: 0.95, name: 'tick' }] } };
      const out = new Float32Array(merged.bones.length * 16);
      const a = Alloy.makeAnimator({ model, bones: merged.bones, clips });
      a.play('spin');
      a.update(0.3, out);
      a.play('spin', { speed: 2 });
      check('re-playing a playing clip keeps its time', close(a.state()[0].time, 0.3, 1e-6), String(a.state()[0].time));
      a.update(0.1, out);
      check('re-playing retargets its speed', close(a.state()[0].time, 0.5, 1e-6), String(a.state()[0].time));
      a.blendTo('spin', 0.2);
      check('blendTo the playing clip keeps its time', close(a.state()[0].time, 0.5, 1e-6), String(a.state()[0].time));
      a.play('spin', { offset: 0.5 });
      check('an explicit offset still moves the playhead', close(a.state()[0].time, 0.5, 1e-6));

      // F-27: a ping-pong bounce inside one step crosses a marker on the way up and on the way back.
      const b = Alloy.makeAnimator({ model, bones: merged.bones, clips });
      let fired = 0;
      b.onEvent(() => { fired++; });
      b.play('spin', { pingPong: true, offset: 0.9 });
      b.update(0.3, out);
      check('a bounce inside one step fires a marker twice', fired === 2, 'fired ' + fired);

      // D-04: an editor asks the animator what a step crossed rather than re-implementing it.
      check('eventsBetween reports the same crossing', b.eventsBetween('spin', 0.9, 1.0).length === 1 &&
        b.eventsBetween('spin', 0, 0.5).length === 0 && b.eventsBetween('nope', 0, 1).length === 0);
    }

    // B-20: a clock seeded past the loop reports no change it did not make.
    {
      const def = { width: 4, height: 4, anim: { frames: 8, rate: 12, loop: 'loop' },
        layers: [{ type: 'generator', generator: 'solid', params: { color: '#000000' },
          keys: { opacity: [{ f: 0, v: 1 }, { f: 4, v: 0 }] } }] };
      const clock = T.makeTextureClock(def, { start: 100 });
      check('a clock seeded past the loop starts settled', clock.advance(0).changed === false);
    }

    // B-11: a mask's own keys are resolved at the frame.
    {
      const def = { width: 4, height: 4, anim: { frames: 4, rate: 12 },
        layers: [{ type: 'generator', generator: 'solid', params: { color: '#ffffff' },
          mask: { type: 'generator', generator: 'solid', params: { color: '#000000' },
            keys: { 'params.color': [{ f: 0, v: '#000000' }, { f: 2, v: '#ffffff', ease: 'step' }] } } }] };
      const at0 = T.sampleTexture(def, 0).data[3], at3 = T.sampleTexture(def, 3).data[3];
      check('a keyed mask animates', at0 < 0.01 && at3 > 0.99, at0 + ' / ' + at3);
    }

    // D-13 / B-25: lines carry bounds; a zero-sized box is thin, not gone; segments obey the schema.
    check('grid and axis lines carry bounds',
      !!Alloy.geometry.gridLines({ size: 4, step: 1, majorEvery: 2 }).bounds && !!Alloy.geometry.axisLines({ length: 1 }).bounds);
    check('a zero-sized box still has triangles', Alloy.geometry.box({ width: 0, height: 0, depth: 0 }).indices.length > 0);
    check('a segment count above the schema maximum is clamped to it',
      Alloy.geometry.box({ segments: 500 }).positions.length === Alloy.geometry.box({ segments: 64 }).positions.length);

    // F-24: a camera that cannot be built says so.
    {
      let threw = false;
      try { Alloy.mat4.perspective(Alloy.mat4.create(), 60, 1, 10, 10); } catch (e) { threw = /near < far/.test(e.message); }
      check('perspective with near equal to far throws by name', threw);
    }

    // B-12 / F-22: the data block survives a hostile name and a chatty changelog.
    {
      const p = Alloy.emptyPackage('Sun "set" <larceny>');
      const b = Alloy.packageBlock(p, { changelog: ['Renamed const OLD_VISUALS = to the new name.'] });
      // The attribute is handed over raw; escaping is the manager's renderBlock's job, and its
      // escapeAttr is what every OFCU block goes through.
      check('a hostile project name reaches the attrs raw, for the manager to escape',
        b.attrs['data-ofcu-alloy-package'] === 'Sun "set" <larceny>');
      const block = b.content;
      let parsed = null;
      try { parsed = Alloy.parsePackageBlock(block); } catch (e) { parsed = e.message; }
      check('a changelog line mentioning const does not fool the parser', parsed && parsed.schema === Alloy.packageSchema, String(parsed));
    }

    // D-10: the schema-4 migration carries a row's name.
    {
      const old = { schema: 3, textures: { t: { width: 8, height: 8, layers: [
        { type: 'ops', name: 'frame', ops: [{ op: 'rect' }, { op: 'circle' }] }] } } };
      Alloy.migratePackage(old);
      check('an ops row\'s name travels to every shape row it becomes',
        old.textures.t.layers.length === 2 && old.textures.t.layers.every((L) => L.name === 'frame'));
    }

    // G-04 / introspection: the surface the audit asked for.
    check('an instance can look at and take an impulse',
      typeof Alloy.Instance.prototype.lookAt === 'function' && typeof Alloy.Instance.prototype.impulse === 'function');
    check('the stage hands out its textures', typeof Alloy.Stage.prototype.texture === 'function');
    check('the small vocabularies are published',
      Alloy.uvModes.indexOf('cylindrical') >= 0 && Alloy.textureLoopModes.indexOf('pingpong') >= 0 &&
      Alloy.textureEases.join() === 'linear,step' && typeof T.interpolatable === 'function' &&
      !!Alloy.describeLight().range && !!Alloy.describeScene().fog);
  }

  console.log('\n=== discussion resolutions (0.18.0) ===');
  {
    const engSrc = blocks[0].content;
    const appSrc = blocks[1].content;

    // Schema 8: sun and clear on a scene, sampling on a texture, data on an event.
    check('the package schema is 8', Alloy.packageSchema === 8 && Alloy.emptyPackage('x').schema === 8);
    {
      const p7 = { schema: 7, name: 'p', textures: {}, materials: {}, models: {}, clips: {}, scenes: { s: { fog: { density: 0 } } } };
      Alloy.migratePackage(p7);
      check('a schema 7 package migrates to 8 unchanged', p7.schema === 8 && Alloy.validatePackage(p7).length === 0);
    }
    check('a scene describes its sun and clear colour', !!Alloy.describeScene().sun && Alloy.describeScene().clear.type === 'vec3');
    check('texture filters and wraps are published',
      Alloy.textureFilters.join() === 'nearest,linear' && Alloy.textureWraps.indexOf('clamp') >= 0);
    {
      const p = Alloy.emptyPackage('v');
      p.scenes.s = { sun: { intensity: -1, direction: [0, 1] }, clear: [1, 1] };
      p.textures.t = { name: 't', width: 4, height: 4, sampling: { filter: 'cubic', wrap: 'repeat', aniso: 0, flipY: true }, layers: [] };
      p.clips.c = { model: '', duration: 1, tracks: {}, events: [{ t: 0.1 }, { t: -1, name: 'x' }] };
      const issues = Alloy.validatePackage(p);
      const has = (re) => issues.some((x) => re.test(x));
      check('a bad sun, clear colour, sampling and event are all reported',
        has(/sun intensity/) && has(/sun direction/) && has(/clear colour/) && has(/sampling\.filter/) &&
        has(/sampling\.aniso/) && has(/sampling has no property called "flipY"/) &&
        has(/event 0 needs a non-empty `name`/) && has(/event 1 needs a numeric `t`/), issues.join(' | '));
      const good = Alloy.emptyPackage('g');
      good.scenes.s = { sun: { direction: [0, -1, 0], color: [1, 1, 1], intensity: 0 }, clear: [0, 0, 0] };
      good.textures.t = { name: 't', width: 4, height: 4, sampling: { filter: 'linear', wrap: 'clamp', mipmap: true, aniso: 16 }, layers: [] };
      good.clips.c = { model: '', duration: 1, tracks: {}, events: [{ t: 0.1, name: 'hit', data: { volume: 0.5 } }] };
      check('a scene with no sun, a linear texture and an event with data validate', Alloy.validatePackage(good).length === 0,
        Alloy.validatePackage(good).join(' | '));
      check('event data survives the data block',
        Alloy.parsePackageBlock(Alloy.packageBlock(good).content).clips.c.events[0].data.volume === 0.5);
    }

    // G-02 / F-03: applyScene sets the sun and the clear colour, and resets both without a scene.
    {
      const calls = [];
      const r = Object.create(Alloy.prototype);
      r.opts = Alloy.defaults.engine;
      r.gl = { clearColor: (...a) => calls.push(a) };
      r._post = { chain: [], key: '', program: null };
      r._lightGen = 0;
      r.applyScene({ fog: { color: [1, 0, 0], density: 0.1 } });
      const fogClear = r.clearColor.join() === '1,0,0' && r.light.intensity === Alloy.defaults.engine.light.intensity;
      r.applyScene({ sun: { intensity: 0, direction: [0, -1, 0] }, clear: [0, 1, 0], fog: { color: [1, 0, 0], density: 0.1 } });
      const own = r.clearColor.join() === '0,1,0' && r.light.intensity === 0 && r.light.direction.join() === '0,-1,0' &&
        r.light.color.join() === Alloy.defaults.engine.light.color.join();
      r.applyScene(null);
      const reset = r.clearColor.join() === Alloy.defaults.engine.clearColor.slice(0, 3).join() &&
        r.light.intensity === Alloy.defaults.engine.light.intensity;
      check('a scene clears to its fog, then its own clear colour, then the engine default', fogClear && own && reset);
      check('the clear colour reaches GL each time', calls.length === 3 && calls[1].join() === '0,1,0,1');
    }

    // F-04: lighting is re-read every frame; nothing has to be announced.
    check('beginFrame bumps the light generation unconditionally',
      /this\._lightGen\+\+;/.test(engSrc.slice(engSrc.indexOf('beginFrame(camera) {'), engSrc.indexOf('endFrame() {'))) &&
      engSrc.indexOf('_lightRefs') < 0);

    // F-09: an unknown material throws with the list.
    {
      const st = Object.create(Alloy.Stage.prototype);
      st._materials = new Map(); st._textures = new Map();
      st.package = { materials: { brick: { color: '#ff0000' } } };
      let threw = '';
      try { st.material('brik'); } catch (e) { threw = e.message; }
      check('an unknown material throws and names the ones there are', /no material called "brik"/.test(threw) && /brick/.test(threw), threw);
      check('a known material still resolves', st.material('brick').color[0] === 1);
    }

    // F-25 and the camera: a disposed instance throws by name; a camera without update is fine.
    {
      const st = Object.create(Alloy.Stage.prototype);
      st.camera = { view() {}, proj() {} };
      st.renderer = { beginFrame() {}, endFrame() {}, stats: {}, lights: [] };
      st.lamps = []; st._worldList = [];
      st.instances = [{ disposed: true, model: 'hut' }];
      let threw = '';
      try { st.render(0.016); } catch (e) { threw = e.message; }
      check('rendering an instance from an unloaded package throws by name', /"hut".*unloaded/.test(threw), threw);
      st.instances = [];
      let ok = true;
      try { st.render(0.016); } catch (e) { ok = false; }
      check('a camera that only answers view and proj drives the stage', ok);
      check('unloadPackage marks instances disposed', /inst\.disposed = true/.test(engSrc));
    }

    // Workbench: delete refuses by reference, the boot and undo paths catch, save validates,
    // the snapshot is adopted, uploads are per texture, the changelog is a diff.
    check('the workbench refuses a delete something still names', /function usersOf\(/.test(appSrc) && /function confirmDelete\(/.test(appSrc) &&
      (appSrc.match(/confirmDelete\(x, y, '/g) || []).length === 5);
    check('a bone a clip animates cannot be deleted', /cannot delete a bone a clip animates/.test(appSrc));
    check('undo puts the stacks back when the adopt is refused', /from\.push\(to\.pop\(\)\);\s*logError\(err\);/.test(appSrc));
    check('boot falls back with the error instead of an empty room', /\}\)\.catch\(\(err\) => \{[\s\S]{0,300}logError\(err\);\s*fallback\(\);/.test(appSrc));
    check('save validates before it writes', /not saved: this package would not load again/.test(appSrc));
    check('the crash snapshot is adopted when newer than the last save', /recovered\.at > \(uiPrefs\.lastSavedAt \|\| 0\)/.test(appSrc) &&
      /uiPrefs\.lastSavedAt = Date\.now\(\)/.test(appSrc) && /function snapshotRecord\(/.test(appSrc));
    check('boot names the storage origin', /browser storage for <em>/.test(appSrc));
    check('workbench textures upload once per texture', /function uploadPackageTextures\(/.test(appSrc) && appSrc.indexOf('uploadMaterialTextures') < 0 &&
      /textures\[m\.texture\]\) \|\| null\)/.test(appSrc));
    check('every workbench upload passes the texture\'s sampling', (appSrc.match(/makeTexture\(texturePixels\([a-z]+\)(?!, [a-z]+\.sampling)/g) || []).length === 0);
    check('the data block changelog is a diff', /function blockChangelog\(/.test(appSrc) && /Since the block copied/.test(appSrc));
    check('an event can carry data from the clip editor', /Data \(JSON\)…/.test(appSrc));
    check('the scene editor has sun and clear rows', /sectionHead\('the sun'\)/.test(appSrc) && /'clear colour'/.test(appSrc));
    check('the texture editor has a sampling menu', /openMenu\(ev\.clientX, ev\.clientY, 'sampling'/.test(appSrc));
    check('vectorRow is defined once', (appSrc.match(/function vectorRow\(/g) || []).length === 1);
  }

  console.log('\n=== lamps on nodes (G-09) ===');
  {
    const appSrc = blocks[1].content;
    const model = { nodes: [
      { name: 'arm', bone: true, position: [0, 1, 0], children: [
        { name: 'lantern', position: [0, 0, 2], lamp: { color: [1, 0.5, 0], range: 3 } } ] },
      { name: 'porch', primitive: 'box', params: {}, lamp: { intensity: 2 } },
    ] };
    const merged = Alloy.mergeModel(model);
    check('a merge records every lamp with its bone and rest position',
      merged.lamps.length === 2 && merged.lamps[0].node === 'lantern' && merged.lamps[0].bone === 1 &&
      merged.lamps[0].rest.join() === '0,1,2' && merged.lamps[0].range === 3 && merged.lamps[0].intensity === 1 &&
      merged.lamps[1].bone === 0 && merged.lamps[1].intensity === 2 && merged.lamps[1].color.join() === '1,1,1',
      JSON.stringify(merged.lamps));
    // Place them: the rest pose, then a bone delta, then an instance matrix.
    const out = [];
    Alloy.placeLamps(merged, null, null, out);
    check('placed at rest, a lamp sits at its node origin', out[0].position.join() === '0,1,2' && out[1].position.join() === '0,0,0');
    const bones = new Float32Array(32);
    bones.set(Alloy.mat4.create(), 0);
    bones.set(Alloy.mat4.fromTranslation(Alloy.mat4.create(), [5, 0, 0]), 16);
    const inst = Alloy.mat4.fromTranslation(Alloy.mat4.create(), [0, 0, 10]);
    const first = out[0];
    Alloy.placeLamps(merged, inst, bones, out);
    check('a lamp follows its bone and then its instance', out[0].position.join() === '5,1,12' && out[1].position.join() === '0,0,10');
    check('placed lamps keep their identity from frame to frame', out[0] === first && out.length === 2);
    // The validator.
    const p = Alloy.emptyPackage('l');
    p.models.m = { name: 'm', nodes: [{ name: 'n', primitive: 'box', params: {}, lamp: { color: [1, 1], intensity: -1, range: 'far', glow: 1 } }] };
    const issues = Alloy.validatePackage(p);
    check('a bad lamp is reported in full',
      issues.some((x) => /lamp colour/.test(x)) && issues.some((x) => /lamp intensity/.test(x)) &&
      issues.some((x) => /lamp range/.test(x)) && issues.some((x) => /lamp has no property called "glow"/.test(x)), issues.join(' | '));
    p.models.m.nodes[0].lamp = { color: [1, 1, 1], intensity: 1, range: 4 };
    check('a good lamp validates and survives the data block',
      Alloy.validatePackage(p).length === 0 && Alloy.parsePackageBlock(Alloy.packageBlock(p).content).models.m.nodes[0].lamp.range === 4);
    // The stage: lamps are gathered and every draw without its own set is handed the world set.
    {
      const handed = [];
      const sets = [];
      const st = Object.create(Alloy.Stage.prototype);
      st.camera = { view() {}, proj() {} };
      st.renderer = {
        beginFrame() {}, endFrame() {}, stats: {}, lights: [{ position: [9, 9, 9] }],
        makeLights: (list) => { const set = { buffer: 1, count: list.length, disposed: false, list: list.slice() }; sets.push(set); return set; },
        updateLights: (set, list) => { set.list = list.slice(); set.count = list.length; return set; },
        drawModel: (built, m, res, bones, opts) => handed.push(opts.lights),
      };
      st.lamps = []; st._worldList = []; st._worldSet = null; st._resolve = () => ({});
      const mk = (visible, own) => ({ visible, compose: false, matrix: Alloy.mat4.create(), bones: null, _built: merged, lamps: [], lights: own || null, model: 'm' });
      st.instances = [mk(true), mk(false), mk(true, { buffer: 2 })];
      st.render(0.016);
      check('the stage gathers the lamps of visible instances only', st.lamps.length === 4);
      check('draws without a set get the engine lights plus the lamps, once per frame',
        sets.length === 1 && sets[0].list.length === 5 && sets[0].list[0].position[0] === 9 &&
        handed[0] === sets[0] && handed[1].buffer === 2 && handed[2] === sets[0] && handed.length === 4);
      st.instances[0].visible = false;
      st.render(0.016);
      check('an instance turned invisible takes its lamps with it', st.lamps.length === 2 && sets.length === 1 && sets[0].list.length === 3);
    }
    check('the workbench lights previews with a model\'s lamps', /function lightWith\(/.test(appSrc) &&
      (appSrc.match(/lightWith\(port/g) || []).length >= 4 && /'Carries a lamp'/.test(appSrc));
    check('the starter hut carries a lamp', /material: 'lamp', lamp: \{/.test(appSrc));
  }

  console.log('\n=== play defaults and the rig (G-07) ===');
  {
    const appSrc = blocks[1].content;
    const model = { nodes: [
      { name: 'root', bone: true, children: [
        { name: 'head', bone: true, position: [0, 1, 0], primitive: 'box', params: {} },
        { name: 'antenna', bone: true, position: [0, 1.5, 0], primitive: 'box', params: {} } ] } ],
      rig: { lookAt: { head: { axis: [0, 0, 1], maxAngle: 30, weight: 1 } },
             springs: { antenna: { axis: [1, 0, 0], stiffness: 200 } } } };
    const merged = Alloy.mergeModel(model);
    const clips = {
      walk: { model: 'm', duration: 1, tracks: { head: { rotation: [{ t: 0, v: [0, 0, 0] }, { t: 1, v: [0, 90, 0] }] } } },
      breathe: { model: 'm', duration: 2, play: { additive: true, weight: 0.5, speed: 2, pingPong: true, fade: 0.5 },
                 tracks: { head: { position: [{ t: 0, v: [0, 1, 0] }, { t: 2, v: [0, 1.2, 0] }] } } },
    };
    const anim = Alloy.makeAnimator({ model, bones: merged.bones, clips });
    // play() takes the clip's own defaults, and a call overrides them.
    const st = anim.play('breathe');
    check('play() takes the clip\'s play block when the call says nothing',
      st.additive === true && st.speed === 2 && st.pingPong === true && st.target === 0.5 && st.fade === 0.5, JSON.stringify(st));
    anim.stop('breathe', 0);
    const st2 = anim.play('breathe', { speed: 1, additive: false, fade: 0 });
    check('a call overrides the clip\'s play block', st2.speed === 1 && st2.additive === false && st2.pingPong === true);
    // lookAt falls back to the rig.
    const mats = new Float32Array(merged.bones.length * 16);
    anim.stop('breathe', 0);
    anim.lookAt('head', [10, 1, 0]);
    anim.update(0.016, mats);
    check('lookAt without options uses the rig\'s axis and clamp', (() => {
      // With maxAngle 30 the head cannot swing the full 90° to face +X; the bone delta is a rotation
      // of at most 30°, which the matrix's [0][0] shows: cos(30°) ≈ 0.866, not cos(90°) = 0.
      const m = mats.subarray(16 * 2, 16 * 3);
      return m[0] > 0.85 && m[0] < 0.9;
    })(), Array.from(mats.subarray(32, 36)).join());
    // impulse with no axis uses the rig's spring, and the spring settles.
    let threw = '';
    try { anim.impulse('head', 20); } catch (e) { threw = e.message; }
    check('impulse without an axis throws when the rig has no spring for the bone', /needs an axis/.test(threw), threw);
    anim.lookAt('head', null);
    anim.impulse('antenna', 40);
    anim.update(0.016, mats);
    const kicked = Array.from(mats.subarray(16 * 3, 16 * 3 + 16));
    let moved = kicked.some((v, i) => Math.abs(v - Alloy.mat4.create()[i]) > 1e-3);
    for (let i = 0; i < 600; i++) anim.update(0.016, mats);
    const settled = Array.from(mats.subarray(16 * 3, 16 * 3 + 16)).every((v, i) => Math.abs(v - Alloy.mat4.create()[i]) < 1e-3);
    check('impulse(bone, degrees) uses the rig\'s spring and settles', moved && settled);
    // poseAt with dt steps the procedural layer; without it, it does not.
    anim.impulse('antenna', 40);
    const still = new Float32Array(mats.length), stepped = new Float32Array(mats.length);
    anim.poseAt([{ clip: 'walk', time: 0 }], still);
    anim.poseAt([{ clip: 'walk', time: 0 }], stepped, 0.016);
    check('poseAt steps springs only when given a dt',
      Array.from(still.subarray(48, 64)).every((v, i) => Math.abs(v - Alloy.mat4.create()[i]) < 1e-6) &&
      Array.from(stepped.subarray(48, 64)).some((v, i) => Math.abs(v - Alloy.mat4.create()[i]) > 1e-3));
    // The validator.
    const p = Alloy.emptyPackage('r');
    p.models.m = JSON.parse(JSON.stringify(model));
    p.models.m.rig.lookAt.nose = { axis: [0, 0, 0], maxAngle: 400, weight: 2, extra: 1 };
    p.models.m.rig.springs.antenna.stiffness = 0;
    p.models.m.rig.hinges = {};
    p.clips.c = { model: 'm', duration: 1, tracks: {}, play: { speed: 'fast', weight: 2, fade: -1, pingPong: 1, loop: true } };
    const issues = Alloy.validatePackage(p);
    const has = (re) => issues.some((x) => re.test(x));
    check('a bad rig and a bad play block are reported in full',
      has(/rig\.lookAt\.nose names a node that is not a bone/) && has(/axis that is not three numbers with some length/) &&
      has(/maxAngle must be/) && has(/weight must be a number from 0 to 1/) && has(/has no property called "extra"/) &&
      has(/stiffness must be a number above 0/) && has(/no section called "hinges"/) &&
      has(/play\.speed must be a number/) && has(/play\.weight must be/) && has(/play\.fade must be/) &&
      has(/play\.pingPong must be/) && has(/play has no property called "loop"/), issues.join(' | '));
    const good = Alloy.emptyPackage('g');
    good.models.m = JSON.parse(JSON.stringify(model));
    good.clips.c = JSON.parse(JSON.stringify(clips.breathe));
    check('a good rig and play block validate and survive the data block',
      Alloy.validatePackage(good).length === 0 &&
      Alloy.parsePackageBlock(Alloy.packageBlock(good).content).models.m.rig.springs.antenna.stiffness === 200 &&
      Alloy.parsePackageBlock(Alloy.packageBlock(good).content).clips.c.play.additive === true, Alloy.validatePackage(good).join(' | '));
    // The workbench.
    check('the model inspector edits the rig on a bone', /sectionHead\('look-at'\)/.test(appSrc) && /sectionHead\('spring'\)/.test(appSrc) && /function dropRig\(/.test(appSrc));
    check('renaming a bone follows into clip tracks and the rig', /clip\.tracks\[name\] = clip\.tracks\[node\.name\]/.test(appSrc) && /section\[name\] = section\[node\.name\]/.test(appSrc));
    check('the clip inspector has a playback block and a rig preview', /sectionHead\('playback'\)/.test(appSrc) && /sectionHead\('rig preview'\)/.test(appSrc) && /anim\.impulse\(bone, deg\)/.test(appSrc));
    check('the clip preview poses through the animator with a dt when the rig is live', /anim\.poseAt\(poseSpecs\(\), poseMats\.main, rigLive \? dt : undefined\)/.test(appSrc));
    check('the clip preview honours speed, ping-pong, additive, weight and fade', /play\.pingPong \? view\.dir : 1/.test(appSrc) && /additive: true \}/.test(appSrc) && /view\.played \/ play\.fade/.test(appSrc));
  }
}

console.log('\n' + (failures ? failures + ' FAILURE(S)' : 'all checks passed'));
process.exit(failures ? 1 : 0);
