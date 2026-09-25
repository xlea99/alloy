# The Alloy Bible

*Generated from the `law` block in `alloy/alloy.html`. Edit the block, not this file; the manager's checker refuses a file that drifts from its source.*

The law of Alloy: what it is for, what its conventions mean, and which of them may never quietly
change. Read this before changing anything in `alloy.html`.

It sits on top of the OFCU Bible, which still governs everything here: one file, no delimiters,
block types and ordering, the code style, the voice. This document adds only what is specific to
Alloy. Where the two could seem to disagree, the OFCU Bible wins and this one has a bug.

Webposium has a bible of the same shape for the audio side. Alloy is its counterpart, and where the
two solve the same problem they should solve it the same way — not because symmetry is pretty, but
because a person who has learned one tool has then learned half of the other.

**This document grows with the project.** It is written phase by phase, and it records only what has
actually been decided and built. A rule that is merely planned lives in *In Flight* at the bottom
until the code that proves it exists. That now means conventions, boundaries, the texture law
(including the one list, the two kinds of pixels, and textures that move), the shell, the mesh law,
the workbench law, the animation law, the clip editor and the law of shipping.

The renderer spec The Levels asked for (`workspace/alloy_renderer_spec.md`) has landed in full; see
*The Phases* for what each engine version added. What is still only planned lives in *In Flight*.

---

## Part One — What Alloy Is

**Alloy is the visual engine of the OFCU, and its workbench.** A game carries a visual package;
Alloy lets you author it, look at it, and put it where it lives. Three deliverables, and any of them
can be the whole job:

| deliverable | what a game does with it | phase |
|---|---|---|
| **textures** | procedural layer stacks evaluated to pixels, no image files; optionally a sequence of frames | 1 and 2 **done** |
| **models** | node trees of parameterized primitives, with materials | 3 and 4 **done** |
| **clips** | named animations over a bone tree, blended at runtime | 5 and 6 **done** |

Phase 7 is how all three get out: the stage a game stands them on, and the three blocks of text that
carry them. See *Part Four and three quarters*.

Every design question is settled by one test: **does this help someone author a texture, a model or
an animation, see it, and save it into a game?** A surface that only makes sense for a general 3D
editor, or only made sense for demonstrating the renderer, fails the test and does not ship.

This is a hobby project. The goal is a capable, coherent, genuinely fun tool, not production
software.

### Two things in one trenchcoat

> rule `alloy.two-things-in-one-trenchcoat` · not mechanically checked

`alloy.html` is two script blocks. The `exportable` block is the **engine**: math, geometry,
shaders, the GL plumbing, the camera, the renderer. It is copied into games by OFCU Manager and must
work there unchanged. The `app` block is the **workbench**: everything visual. Nothing in the app
block is ever exported, and nothing in the engine block knows the app exists.

The app talks to the engine only through its public surface: `new Alloy(canvas, opts)` and its
methods, and the `Alloy.*` statics (`vec3`, `mat3`, `mat4`, `quat`, `geometry`, `geometryTypes`,
`describeGeometry`, `texture`, `generatorTypes`, `describeGenerator`, `drawOpTypes`,
`describeDrawOp`, `adjustmentTypes`, `describeAdjustment`, `layerTypes`, `blendModes`, `font`,
`mergeModel`, `countNodes`, `primitiveTypes`, `defaultMaterial`, `frustum`, `lights`, `instanceTint`,
`makeInstanceTints`, `emptyPackage`,
`emptyTexture`, `emptyModel`, `emptyMaterial`, `emptyClip`, `packageBlock`, `parsePackageBlock`,
`migratePackage`, `validatePackage`, `packageSchema`, `pick`, `makeAnimator`, `prepareClip`,
`easings`, `matToQuat`, `collectBoneNames`, `OrbitCamera`, `defaults`, `attributeLocations`,
`version`, `build`, the material and scene surface: `describeMaterial`, `materialKeys`,
`resolveMaterial`, `postTypes`, `describePost`, `describeLight`, `describeScene`, `emptyScene`,
`uvModes`, `textureLoopModes`, `textureEases`, `textureFilters`, `textureWraps`, `placeLamps`, `packageIdent`, `parseDebugSpawn`, and the runtime:
`init`, `Stage`, `Instance`, `identityBones`, `clipsForModel`, `instanceMatrix`, `nodeRotation`).
`Alloy.texture` carries the whole pixel surface: `evaluate`, `bake`, `packAtlas`, the pixel buffers
(`makePixels`, `clonePixels`, `fillPixels`, `toBytes`, `fromBytes`), the PNG codec (`decodePNG`,
`encodePNG`, `pngSize`, `base64Encode`, `base64Decode`), `color`, and the animation helpers
`sampleTexture`, `sampleTrack`, `textureStateKey`, `textureFrames`, `makeTextureClock` and
`interpolatable`. The list above is the whole list; when a static is added, it is added here too.
**The app never reaches into the engine's internals**, and the checker enforces it by name. When the app needs something the engine does not offer,
the engine grows a method, its version bumps, and the block is restamped.

### The aesthetic target

> rule `alloy.the-aesthetic-target` · not mechanically checked

Chunky, low-poly, PS1 and N64 era. Models are assembled from geometric primitives. Joints are rigid,
with visible overlap, and the era-appropriate dodges — a sphere at the joint, slight
interpenetration, conservative rotation limits — are the intended solution, not a compromise to be
engineered away.

This is not a limitation being worked around. It is the look, and several rules below exist to
protect it from being politely improved into something else.

---

## Part Two — Hard Constraints

- **Single file.** One `.html`. All CSS and JS inline. Zero external dependencies of any kind.
- **All data is JSON.** No binary asset formats — no `.glb`, no `.obj`. Base64 PNG is permitted
  *inside* JSON as a raster texture layer, and nowhere else. Geometry, skeletons and animation are
  always plain readable JSON.
- **No functions in data.** The OFCU Bible allows function literals in a `managed-data` block and
  then explains at length why Webposium refuses them anyway. Alloy sidesteps the argument entirely:
  a texture layer, a primitive and a keyframe are all parameters, never code. A procedural texture
  is a named generator plus its numbers, not a lambda.
- **No yoinked assets.** Nothing downloaded from the internet gets embedded. Hand-authored raster
  art is fine — the constraint is provenance, not bytes.
- **Portable engine.** It works identically in the workbench and pasted into a game.
- **The style reference is `crucible.html`.** JSDoc on every function, banner hierarchy, regions
  everywhere, comments that explain why.

### Explicitly cut

> rule `alloy.explicitly-cut` · not mechanically checked

Considered and rejected. Do not build them. Do not quietly reintroduce them.

| cut | why |
|---|---|
| Boolean / CSG operations | robustness nightmare; even Blender's is flaky |
| Automatic UV unwrapping | box, planar and cylindrical projection is enough for boxy geometry |
| Sculpting / dynamic topology | wrong tool for this aesthetic entirely |
| Inverse kinematics | forward kinematics on a node tree is enough |
| Vertex-level mesh editing | primitive composition is the modeling paradigm |
| Linear blend skinning | cut from the MVP, possibly one day — see below |

**On skinning.** The runtime is architected as *bone matrices transforming vertices*, where rigid
animation is the case where every vertex has exactly one bone at weight 1.0. That costs nothing now
and means skinning can be added later by building only the weight-painting UI, without redesigning
the runtime. **Build the door; do not walk through it.** A weight path that is removed from the data
model to simplify it is a door bricked up.

---

## Part Three — The Engine Boundary

### The renderer owns no scene

> rule `alloy.the-renderer-owns-no-scene` · not mechanically checked

**Alloy renders; the game owns the world.** The renderer holds a context, its programs and the
current camera matrices. You hand it a mesh, a model matrix and a material, and it issues a draw. It
has never heard of a node tree, an instance or a level.

Phase 3's node tree is a layer on top of `drawMesh`. Phase 7's retained API (`createInstance`,
`play`, `blendTo`) is a layer on top of that. Both are additions, and the immediate-mode calls stay
callable underneath them, because the moment a renderer starts owning a scene it starts having
opinions about how a game stores one.

### The math conventions, which may never quietly change

> rule `alloy.the-math-conventions-which-may-never` · not mechanically checked

A model authored under one convention and loaded under another is subtly, unfixably crooked, and
nothing reports it. So these are law:

- **Matrices are column-major `Float32Array(16)`.** Translation lives in elements 12, 13 and 14.
  WebGL2 rejects `transpose = true`, so any other layout costs a transpose on every upload forever.
- **Vectors and quaternions are plain arrays.** Model data is JSON: `[0, 1.5, 0]` goes straight into
  `vec3.add` and back out through `JSON.stringify` unchanged. A `Float32Array` serializes as
  `{"0":0,"1":1.5,"2":0}` and poisons every saved model.
- **Every math function takes its destination first, and `out` may alias any input.** Read inputs
  into locals before writing a single element of `out`. This is what lets a render loop allocate
  nothing, and `mat4.multiply(m, m, t)` is written constantly.
- **Euler angles are DEGREES, composed as `qz * qy * qx`** — Blender's default XYZ, where X is
  applied to the model first. **A quaternion is the value; euler angles are a spelling.** Storage and
  interpolation are quaternions; the conversion happens at the very edge, in the UI.
- **`mat4.compose` is T * R * S.** Scale is applied in the node's own space so a stretched arm
  stretches along the arm.
- **A light's `direction` is the direction the light travels**, not the direction toward it. The
  shader negates it. Written the way the sun works.

**Every one of these has a property test in the checker, and a new math function needs one before it
lands.** Not a test of a value somebody typed in from a calculator — a test of a *property*:
`invert(m) * m` is the identity, `fromEuler` equals an independently built `qz * qy * qx`, a normal
stays perpendicular to two tangents under non-uniform scale. The inverse-transpose in
`mat3.normalFromMat4` shipped as a plain inverse and looked entirely reasonable; the perpendicularity
test caught it in the first run. A value test would have been written from the same wrong assumption
as the code.

### Attribute locations live in JavaScript

> rule `alloy.attribute-locations-live-in-javascript` · not mechanically checked

`ATTR` is the one place vertex attribute locations are decided — position 0, normal 1, uv 2, color 3
— bound with `bindAttribLocation` **before** linking, in every program. That is what lets one mesh's
vertex array object feed any program.

**Shaders may not use `layout(location = ...)` qualifiers.** They would win over the table silently
and put the decision in two places, and the day the two disagree, normals arrive as UVs with no
error anywhere.

### Lighting is per vertex, on purpose

> rule `alloy.lighting-is-per-vertex-on-purpose` · not mechanically checked

The fragment shader interpolates a colour and writes it. This is not a corner cut on the way to
something better: per-vertex lighting is what the hardware this look imitates actually did, and it is
why low-poly geometry from that era reads as faceted and solid. Chunky geometry with per-pixel
lighting looks like a mistake; chunky geometry with per-vertex lighting looks like a decision.

A per-pixel path may exist as an *option* a package selects. **It does not become the default.**

That option now exists and is called **world** shading. A material with `shading: 'world'` is drawn
by a second program that lights per fragment; everything else is drawn by the vertex-lit one, which
is still the default and still the look Alloy is for. The two are separate programs rather than one
with a branch, so neither pays for the other.

**The two falloffs live side by side in one shared GLSL string**, and that is deliberate: the vertex
path keeps the windowed inverse-linear that reaches exactly zero at a light's range, and the world
path uses the inverse square with a wrapped n-dot-l and a bias toward light from above that The
Levels was prototyped with. Written apart, they would drift, and the drift would show up as
furniture lit differently from the room it stands in.

### A draw carries its own lights

> rule `alloy.a-draw-carries-its-own-lights` · not mechanically checked

**Lights belong to the draw, not to the scene.** `drawMesh`, `drawModel` and `drawInstances` each
take an options object with a `lights` entry, and all three honour it — because props are drawn
separately from the world mesh, and a chair lit by a different set than the room it sits in is the
bug this prevents.

- **Sixty-four per draw**, in a **uniform block**, not uniform arrays. std140 pads a `vec3` to
  sixteen bytes whatever you do, so a light is two `vec4`s: position with intensity, colour with the
  range **squared** (every use of it in the shader compares against a squared distance). Sixty-four
  of them is 2048 bytes, already a multiple of the 256-byte offset alignment `bindBufferRange`
  demands. A block also costs nothing from the fragment shader's uniform budget, which WebGL2 only
  guarantees 224 vectors of.
- **`makeLights(list)` is the unit of lighting for a world.** A game builds one per chunk as the
  chunk streams in and hands it to every draw inside that chunk, so sixty-four lights cost one
  upload when the parcel loads rather than one per frame. Handing a draw a plain array instead works
  and re-uploads every time; that is the convenient path and the slow one, and it says so at the
  function rather than in a profiler.
- **Choosing which sixty-four is the caller's job**, because only the caller knows where the camera
  is. The engine takes the first sixty-four it is given.
- The engine's own `lights` array still works and is what a draw gets when it asks for nothing, so
  everything written before this kept working unchanged.
- **Lighting is re-read every frame.** The sun, the ambient pair, the fog and the engine's own
  `lights` are uploaded once per program per frame, whatever changed, so `engine.lights[i].intensity
  = flicker` and `engine.fog.density = x` simply work. That is a handful of uniforms and one buffer
  write of at most three kilobytes, and it replaced a heuristic that noticed a reassigned array and
  missed an edit in place — which is how a flickering lamp stayed lit. `touchLights()` remains as a
  no-op for code written against it. A light *set* from `makeLights` is the opposite contract: it is
  uploaded when it is made and when `updateLights` is called, never by itself.
- **A prop brings its own lamp.** A model node may carry `lamp: {color, intensity, range}`, and the
  lamp sits at that node's origin and moves with the bone above it, exactly as the node's vertices
  would. This is the one place a light lives in the package, and it lives on a *thing*, not in a
  scene: a desk lamp is furniture the game places, so its light is placed with it. The merge
  records the lamps (`built.lamps`), `placeLamps` turns them into world-space lights against an
  instance matrix and a pose without allocating, and the stage does that every frame for every
  visible instance, publishing the result as `stage.lamps` and handing every draw that has no light
  set of its own the engine's lights *plus* the lamps, uploaded once per frame. The footgun is
  stated at the field: a lamp only reaches the draws whose light list contains it, so a game on
  chunk light sets folds `stage.lamps` into the chunk each prop stands in, or the lamp lights
  nothing but its own shade. The cap is still sixty-four and the first sixty-four still win. An
  invisible instance's lamps are off. Emissive is a separate knob: the bulb glows because its
  material says so, the porch is lit because the node carries a lamp.

### Occlusion and tint are vertex attributes

> rule `alloy.occlusion-and-tint-are-vertex-attributes` · not mechanically checked

**Baked AO is a float per vertex and tint is a `vec3`**, both read by the lit and world programs,
both neutral when absent through the generic attribute values. Absent means 1.0, so a primitive that
has never heard of either is unaffected.

- AO **multiplies the lit result**. Tint **multiplies albedo**. Per-vertex and per-instance values
  compose by multiplication, so a dark corner of a mesh and a dimmed instance of it agree rather
  than fight.
- **An unlit surface still takes occlusion, through a range.** `material.aoRange` is a pair, and an
  unlit surface is `albedo · mix(lo, hi, ao)`. With `[0.10, 2.2]`, a lens panel whose AO is 1 blows
  past white and one whose AO is 0 is a dark rectangle — the same attribute doubling as the tube's
  on and off. That is what puts a visible light source in the ceiling above the pool of light it
  casts, and without it a room reads as lit by nothing. Absent, an unlit surface ignores AO, which
  is what it always did.
- **An instance carries its own tint and occlusion.** `set.tints` is four floats per placement, white
  and 1 until written (`Alloy.instanceTint(set, i, rgb, ao)`), uploaded with the matrices. Forty
  chairs in five colours are one set and one draw; a chair in a dark corner is darker than its twin
  by the window. It is a second buffer beside the matrices, not a wider stride, so the matrix layout
  every caller knows is untouched. The slot was built as a door in 0.12 and opened in 0.20 when The
  Levels was found holding five instance sets and a tinted-material cache to get around it.

### Fog is engine state

> rule `alloy.fog-is-engine-state` · not mechanically checked

`fog` is a colour and a density, and `1 - exp(-(d·k)²)` is applied **after lighting** in both
programs, so a bright thing far away fades like a dim one. Density 0 disables it and is the default.

Distance comes from the view-space position, interpolated per fragment, which costs one float
across the boundary and is exact enough that nothing has ever been able to tell.

### Geometry is a pure function from parameters to arrays

> rule `alloy.geometry-is-a-pure-function-from` · not mechanically checked

A primitive is not an object that knows how to draw itself. It is a builder taking parameters and
returning typed arrays, and nothing in the geometry section has ever heard of WebGL. That is what
lets geometry be generated, diffed and tested in Node, and it is what makes model data possible:
a node names a primitive and its parameters, and never holds a builder.

**Every primitive publishes a schema next to its builder** — parameter names, types, ranges,
defaults — in one table with its `defaults`. The workbench builds its inspector from the schema, so a
new primitive arrives with a full editor for free, and an AI authoring model JSON asks the engine
what a box takes instead of guessing. A parameter in the builder and not in the schema has no editor
and no documentation; a parameter in the schema the builder ignores is a control that does nothing.

### Fail loudly, fail usefully

> rule `alloy.fail-loudly-fail-usefully` · not mechanically checked

WebGL fails silently by design: a shader that does not compile links to nothing, a misspelled uniform
returns a null location that `uniform3fv` accepts without complaint, a bad index is undefined
behaviour. The answer to every one of those is a blank screen and an empty console.

So: shader compile errors carry the **line-numbered source**. Uniform locations are gathered by
**asking the program what it has**, never by looking names up on faith. Geometry is **validated
before it reaches the GPU**, where a normals array one vertex short is invisible forever. Anything
added here that can fail must say so, name the thing that failed, and say what was expected.

Which means **`beginFrame` can throw** — an offscreen target the driver refuses, a renderer that
was disposed — and a render loop shaped `render(); requestAnimationFrame(loop)` then never
schedules its next frame. A game keeps scheduling whatever the frame did; the engine will not
swallow the error to spare it that line.

### Versioning

> rule `alloy.versioning` · not mechanically checked

The engine is versioned; the app is not. `data-ofcu-version` on the tag is the only version the file
has, and it moves when the **engine** changes. A UI-only commit does not bump it.

When the engine does change: bump `data-ofcu-version` and `data-ofcu-built`, keep `ALLOY_VERSION`'s
fallback in step, and restamp the hash **through OFCU Manager's own lifecycle** —
`OFCU.stamp('alloy', { dir, sourceFile: 'alloy.html' })` from Node. A hand-edited hash is a lie
waiting to be believed.

---

## Part Three and a Half — Textures

A texture is **not an image**. It is an ordered stack of layers, a recipe, and the pixels are what you
get when you run it. There is no separate "static texture" type: a hand-painted poster is a stack with
one raster layer and goes through the same evaluator as a procedural brick wall.

That is what makes the no-asset-files rule survivable. A game carries a few hundred bytes of JSON and
computes a wall on load. It also means a texture stays **editable forever**: nothing is flattened
behind your back, so the seed that made a wall is still there when the wall needs to change.

### One list, and two kinds of pixels

> rule `alloy.one-list-and-two-kinds-of` · not mechanically checked

**A texture is ONE list.** Every row is one source — a generator, a shape, paint, an image, an
adjustment — and how it lands: blend, opacity, a region. **No row holds a list of its own.** An `ops`
row carrying several shapes is still evaluated for hand-written data and is migrated into one shape
row each on load. **Folders fold rows together in a list and mean nothing to the engine**; no
behaviour may ever hang off a folder name.

A row may carry a `name`. It is optional, and a row without one labels itself by what it is, so
naming is something you do to the five rows that matter rather than a chore on all forty.

Pixels come in two kinds, and the difference between them is a **promise about size**:

- **paint** (`raster`) is texture-sized, texel for texel, and the validator refuses one that is not.
  It has no `fit`. It is what the painter writes into.
- **image** is a picture from outside, at any size, kept as it came and fitted at evaluation with
  `stretch` or `tile`.

Keeping them apart is what lets paint promise its size — so the painter never resamples behind your
back — while an import keeps its full detail for a texture that may grow later. Converting an image
to paint resamples it at the texture's size, and is a deliberate, undoable act with its cost shown
before it happens.

### Textures move

> rule `alloy.textures-move` · not mechanically checked

A texture may be a sequence of **frames**, and the whole law of that sequence is one sentence:
**frames are unitless ordered states, and the consumer drives the playhead.**

- **A texture carries no seconds.** `anim` holds a frame count, a **default rate** and a loop mode,
  and the rate is a hint a consumer may override — a recommendation, never the asset's truth.
- **The playhead is a float the consumer moves**: play, pause, hold, loop, ping-pong, scrub, or bind
  it to game state. Frame equals damage; frame equals a dial's fill. That second use is only
  available because time was kept out of the asset.
- **Any property keyframes.** `keys` maps a dot path on a layer to sorted `{f, v, ease}`.
  **Interpolate only where it means something**: numbers and hex colours blend, while enums, seeds,
  pixels and mismatched point arrays step. A key's `ease` governs the segment **leaving** it.
- **The base field stays the frame-0 value**, and is the still that any consumer ignoring animation
  shows. That is what keeps an animated texture legible to something that has never heard of frames.
- **Paint animates by stepping between drawn cels.** There is no blending two arbitrary rasters. A
  paint row with no cels costs nothing extra; cels cost real bytes, only for the frames actually
  drawn, and the size readout says so at the moment you are deciding.
- **Static until it isn't.** A layer with no keys is never resampled; a held stretch produces the
  same state key as the frame before it, and a consumer that keys its uploads on the state key
  (the workbench does) uploads nothing. The whole stack is still *evaluated* every frame that
  changes; a static-prefix cache — the rows below the lowest animated one evaluated once — is the
  obvious optimisation and is **not built**, because no profile has asked for it yet. It is on the
  In Flight list, not in the code, and this sentence used to claim otherwise.

**The one working buffer, admitted.** The clip editor has no working pose on purpose, and the texture
painter cannot make the same promise: a stroke has to accumulate in decoded pixels before it can
become a PNG. So the buffer belongs to **the cel the playhead is on**, is committed at the end of
every action, and is dropped the moment the playhead moves. That is the narrowest form of the
exception, and it is written down here so that it stays narrow.

### The two promises

> rule `alloy.the-two-promises` · not mechanically checked

**Determinism.** The same JSON produces the same pixels, on every machine, always. So randomness is a
hash of coordinates and a seed, never a stateful generator whose output depends on how many times it
has been called. Insert a layer that consumes one extra number and a stateful design reshuffles
everything below it, which an author experiences as "I nudged the mortar and the whole wall changed".
Nothing reads a clock. The evaluation path avoids transcendental functions, which are the part of
IEEE-754 that implementations may disagree about; the one exception is `Math.pow` behind the levels
gamma, and it is documented at the line.

**No canvas.** Evaluation is pure JavaScript over a `Float32Array`. It never touches
`CanvasRenderingContext2D`, which would tie textures to a browser, make output depend on somebody's
antialiasing, and put a whole category of bug beyond the reach of a test. The consequence is that the
engine carries **its own rasterizer, its own font and its own PNG codec**, about six hundred lines to
avoid one dependency. Under the OFCU rules that is not a trade, it is the point.

### What is law

> rule `alloy.textures-what-is-law` · not mechanically checked

- **Buffers are `Float32Array` RGBA in 0..1 with straight alpha**, converted to bytes only at the end.
  Twelve layers of 8-bit rounding is visible banding.
- **Row 0 is the top**, which is what every drawing tool means by the top. The GL upload flips it.
- **Layer 0 is the bottom of the stack.** The data has to be readable by hand, so the data wins; a
  workbench may display it upside down the way every image editor does.
- **Every noise tiles, and wraps each axis at its own period.** A texture goes on a model and wraps;
  noise that does not tile puts a seam down every wall in the game. Each octave doubles its period
  along with its frequency, or the sum seams on its own.
- **Blending and compositing are two steps.** The W3C rule is
  `blended = (1 - backdropAlpha) * source + backdropAlpha * B(backdrop, source)`. A blend mode only
  applies where there is something to blend with. Drop that term and every antialiased shape drawn
  over empty space grows a dark fringe nobody can find.
- **Every shape is a signed distance function.** Fill, stroke and analytic antialiasing all fall out
  of one number, so a new shape arrives with all three already working.
- **Op coordinates are normalized**; lengths are in units of the shorter axis, which is what keeps a
  circle round on a texture that is not square.
- **An adjustment layer rewrites the accumulator.** It affects everything below it and nothing above.
  That asymmetry is what makes a masked adjustment a local correction.
- **A mask is a layer, and may not have a mask of its own.** One level of nesting is expressive;
  arbitrary levels is a tree that has to be drawn, cached and explained.
- **The font is data in the file**, 5 by 7, blitted at whole-number scales, never antialiased. A pixel
  font with soft edges is a blurry pixel font. `fillText` was refused because it makes output depend
  on a platform's font stack, and an embedded TrueType would be an asset.
- **`packAtlas` returns rects in texture coordinates** (`rects`) and in image pixels (`pixelRects`).
  The first accounts for the upload's vertical flip. This has already cost one bug: an atlas rect in
  image space samples the empty half of the atlas and the object renders black, which looks exactly
  like a lighting problem and is not one.
- **An atlased texture cannot tile.** Sampling past a rect's edge lands in a neighbour. Entries are
  padded with their own edge pixels so filtering cannot reach into one.
- **Baking is lossy in the way that matters.** The recipe is gone and with it the seed. Bake to save
  load time, never to save space, and keep the original.

### Adding to the vocabulary

> rule `alloy.adding-to-the-vocabulary` · not mechanically checked

A generator, a draw op or an adjustment is **one function plus one schema entry in the same table**.
The schema is where the workbench gets its inspector and where an AI writing a layer stack reads what
is available. A parameter in the builder and not in the schema has no editor; one in the schema the
builder ignores is a control that does nothing. The checker asserts the two match for every entry.

---

## Part Three and three quarters — Meshes

**A model is a node tree and nothing else.** Each node has a transform, optionally a primitive with
its parameters, optionally a material, and children. There is no mesh in the data; a mesh is what you
get when you build one. A phone booth is four boxes and a cylinder, and the file that says so is a
few hundred bytes of readable JSON.

### What is law

> rule `alloy.meshes-what-is-law` · not mechanically checked

- **Six primitives**: box, plane, cylinder, cone, sphere, wedge. A primitive is a **loop over a
  parameter grid**, which is what makes segment counts possible and keeps the winding in one place.
- **`cross(u, v) === n` for every face**, and a face's normal is **derived from its corners** rather
  than passed alongside them. A face wound the other way is invisible under backface culling, which
  reads as a hole in the model, and the first instinct is always to blame the culling.
- **Flat or smooth is a topology decision**, not a shading flag: a lattice point emitted once is
  smooth, emitted per face is flat. A box emits per face, a sphere shares.
- **Zero-area triangles are dropped at build time**, filtered by area rather than by repeated
  indices — a cone's tip vertices are distinct indices at the same position because each carries its
  own texture coordinate.
- **Every geometry carries bounds.** The renderer culls with them, the camera frames with them, and
  computing them once at build time costs a pass nobody notices.
- **UV projection decides UVs from POSITION, in world units per repeat.** A primitive's own UVs give
  every face a full unit square, which is exactly wrong for a world of stretched boxes: a wall three
  units long gets the same texture as the crate beside it, so its bricks are three times as wide.
  Setting the scale to 1 makes every texel the same size on everything. This is the fix the earlier
  phases deferred and it is not to be worked around anywhere else.
- **Cylindrical projection mends its own seam.** Going round, u climbs to 1 and drops to 0; the
  triangles across that drop run the whole texture backwards in one column. They get their own
  copies of the low vertices at u + 1. A surface **on** the axis — a cylinder's cap — has no angle,
  and that is a property of the projection rather than a bug.
- **Subdivision welds first, and carries UVs per face corner.** A primitive has no topology: a box
  arrives as six unconnected islands, and smoothing them face by face rounds each into nothing.
  Welding merges the very corners that carry three different UVs, so UVs travel with faces and never
  with vertices. **The builder's quads are kept alongside its triangles** for the same reason:
  subdividing a triangulated quad treats the diagonal as a real edge and makes a symmetric box
  lopsided. Boundaries get their own rule, or an open mesh shrinks at every level.

### Merging, and the bone door

> rule `alloy.merging-and-the-bone-door` · not mechanically checked

**Merging is what makes a node tree fast.** Forty nodes drawn one at a time is forty draw calls; the
same tree flattened into one buffer, sorted by material, is **one draw call per material**. Each
node's rest transform is baked into its vertices, so the GPU never sees the tree.

Normals go through a **normal matrix**, not the world matrix, or a non-uniformly scaled node lights
as though it had not been.

**Tint and occlusion are baked into vertices by the merge, and they are inherited.** A node may carry
`tint` and `ao`; a node inside a dimmed arm is dimmed too, and a node stating its own **multiplies**
what it inherited rather than replacing it. That is what makes tinting a whole limb one edit instead
of one per node, and it is how a prop carries occlusion the way a world mesh does — a chair's
underside darker than its seat, with no second material.

- **Neutral is tested by value, not identity.** White and 1 mean nothing was said, so the attributes
  are not allocated at all and a model of plain nodes is byte for byte what it always was. The
  inspector deletes the field rather than storing white, and the merge agrees with it. Testing by
  object identity looked equivalent and was not: a node that explicitly wrote white allocated two
  attributes for nothing, and a test caught it on the first run.
- **The node's values multiply whatever the geometry already carried**, so a generator that paints
  its own vertices and a node that dims the whole part compose instead of fighting.

**The bone path is built even though nothing animates yet.** Every vertex carries a bone index; every
bone carries the inverse of its rest transform; the shader multiplies by `uBones[index]`. Bone slot 0
is **always the identity**, so a vertex governed by nothing needs no special case anywhere. For a
static model every matrix is the identity and the whole thing costs one uniform upload.

When Phase 5 animates a node it writes `animatedWorld * inverseRest` into that slot and the vertices
follow — no change to the merge, the buffer layout or the shader. Rigid animation is therefore the
case where every vertex has one bone at weight 1.0, which is exactly what the plan asked for.
Skinning later means letting a vertex name a second bone and a weight: a change to the merge and the
shader, and to nothing else.

The bone count is **asked of the device**, not assumed. WebGL2 guarantees 256 vertex uniform vectors,
which is 52 bones once everything else has its share.

### Drawing

> rule `alloy.drawing` · not mechanically checked

- **One shader, three paths.** A per-instance matrix arrives as four vec4 attributes; a plain mesh
  gets the identity from the **generic attribute values**, which are context state and therefore set
  once. Without them an instanced attribute defaults to `(0, 0, 0, 1)`, which builds a matrix that
  collapses every vertex onto the origin — a model that renders as nothing.
- **Culling is a comparison, not an optimization for later.** Six planes come out of the
  view-projection matrix, extracted from its **rows**; reading columns gives a frustum rotated ninety
  degrees, which culls correctly right up until you turn. Bounds are transformed by rotating the
  **eight corners**, never by rotating min and max.
- **Instance sets are culled whole, never per member.** Testing a thousand boxes on the CPU to skip
  some of them costs more than drawing them.
- **Point lights use a windowed falloff**, reaching exactly zero at their range, so a light can be
  switched off at its edge with no visible step. Inverse square never quite reaches zero and every
  cut-off is a seam.

### One blended pass, and the caller owns the order

> rule `alloy.one-blended-pass-and-the-caller` · not mechanically checked

A material whose `pass` is `'glass'` is **blended over what is already there and does not write
depth**, so a pane cannot hide the pane behind it. `fresnel` adds Schlick's term to its alpha, which
is why a window seen head-on is nearly invisible and the same window seen along its edge is nearly a
mirror.

**Fresnel is computed per vertex on the default program and per fragment on the world program, and
it does not matter.** The audit flagged it (F-01): a two-triangle pane under vertex shading gets the
term at four corners and a linear blend across the middle, which is not Schlick's curve. Alex A/B
tested it on 2026-09-18 — two identical upright panes side by side, one on each program, assorted
things behind them, every camera angle he could find — and could not tell them apart. So glass is
fine on either program, the material window does not warn, and nothing is promoted automatically.
If a pane ever does look wrong, `shading: 'world'` on that material is the switch, and the starter
glass uses it.

**A plane has one visible side**, because backface culling is on for everything and a plane is the
one primitive that is not a closed solid. From behind it is not transparent, it is simply not drawn.
A pane you must see from both sides is a thin box, which is also the right shape for glass: the
fresnel term wants a face that points at the camera, and a box always has one. A two-sided plane
was considered and not built; for glass it would blend both faces over each other and get the back
face's fresnel wrong.

**There is no sorting anywhere in the renderer and there is not going to be.** The caller draws its
glass after its opaque work, because this renderer owns no scene and therefore has nothing to sort.
One pass is what the look needs; sorted transparency stays cut.

Blend and the depth mask are **set and restored around the draw**, so an opaque draw after a glass
one is opaque. Leaving GL state on for the next caller is the bug that makes a bug appear somewhere
unrelated three functions later.

### A draw may be a slice of a mesh, and brings its own bounds

> rule `alloy.a-draw-may-be-a-slice` · not mechanically checked

`drawMesh(mesh, model, material, {first, count, bounds, lights})`. One parcel is uploaded as a single
vertex array and its nine chunks are drawn out of it by index offset, each with its own light set.

**A sub-range draw must bring its own bounds**, and that is not optional: a mesh's bounds cover every
chunk in the buffer, so culling by them keeps all nine on screen the moment one of them is. Passing
`bounds` is how a chunk gets culled as a chunk.

### Validation is the default and the opt-out is spelled out

> rule `alloy.validation-is-the-default-and-the` · not mechanically checked

`validateGeometry` walks every index looking for one out of range, which is exactly the check a
hand-written geometry needs and exactly the cost a streaming world cannot pay ten times a second.
`makeMesh(geometry, { validate: false })` is the opt-out, for a generator that has already been
proved. It still refuses a geometry with no positions, because that one is not a cost, it is a typo.

### A surface is a world's faces in one buffer, with a table of contents

> rule `alloy.a-surface-is-a-world-s` · not mechanically checked

**A model is a tree; a world is a list.** A game that walks through a building decides on faces one
at a time — this wall, that floor, the lens over a tube — and wants them in ONE vertex buffer drawn
in PIECES: a chunk at a time, a material at a time, each piece with its own bounds and its own
lights. `Alloy.geometry.surface()` is the builder for that. It is the primitive builder grown three
ways: an **AO and a tint per vertex**, a **material name per face**, and **named slices**. `face`
(a subdivided quad), `box` and `card` are its vocabulary; `finish()` lays the slices out back to
back and reports where each slice's materials begin and end. `renderer.makeSurface` uploads it
once and `renderer.drawSurface` draws a slice as a handful of ranged draws, culled by the slice's
bounds, with the lights the caller hands in. `Alloy.lights.nearest` picks those lights.

**What a surface never knows is the point.** It has never heard of a wall, a room, a door or a
light. The game decides which faces exist and supplies the occlusion as a number or as a function
sampled at every vertex; the builder bakes what it is told. A surface holds **no transform, no
object and no callback the renderer will ever call**: after `finish()` it is plain arrays and a
table. That is what keeps it a shape tool rather than a level editor, and it is why there is no
surface window in the workbench and never will be — a surface is generated, not authored, and the
only way to look at one is to open the game.

Conventions that are settled here so no game settles them again, each pinned by the checker:

- **Texture coordinates are world units per repeat along the face's own axes**, so two faces that
  share an edge share their texels and a floor of two-metre cells tiles with no seam.
- **A card's front is the side its `facing` names, and the picture reads left to right and bottom
  to top from there.** The prototype The Levels was ported from had every sign in the building
  mirrored, and nobody could see it until the GPU drew it.
- **AO multiplies the lit result and tint multiplies albedo**, exactly as the merge bakes them for
  a model, so a prop and the floor it stands on agree.
- **A box shades itself**: top, sides and underside take one `ao` times 1, 0.9 and 0.55, because a
  box on a floor is darker under than over and that is a property of boxes.
- **Index width follows the vertex count** and **`makeSurface` skips validation** by default: the
  builder already guarantees every index is in range, and a streaming world cannot pay for the
  walk ten times a second. Pass `{ validate: true }` for a surface assembled some other way.

---

## Part Three and fifteen sixteenths — Scenes and Post

**A scene is how a level LOOKS, and nothing about what is in it.** The sun, fog, ambient, the clear
colour, the post chain, the resolution the world is drawn at. That is the whole list, and the
boundary is the point: the moment a
scene can hold objects, a game's level data starts migrating into Alloy and the scene graph this
renderer refuses has been built by accident. What is *in* a level belongs to the game.

**Scenes are named and plural**, `scenes: { "space-available": {...} }`, and a game picks one by
name. This is deliberately the shape Webposium already uses — many `arrangements`, and
`playArrangement(name)` to choose — because The Levels is levels: one package, one game, amber fog
on floor zero and something else on floor one. A singleton settings block would have been a
migration waiting to happen.

`applyScene(sc)` is the whole API. It sets the sun, fog, ambient and clear colour, hands the chain to
`setPost`, and the height to `setResolution`. **A package with no scenes renders exactly as it always
did**, because no scene applied is the same as the defaults the renderer starts with, and every field
a scene does not carry is reset to that default rather than left over from the last scene.

Two of those fields arrived with schema 8 and have rules worth stating. **`sun` is
`{direction, color, intensity}`** and absent means the engine's default sun; **intensity 0 is how a
scene says "no sun"**, which is what a room lit by its lamps wants and what The Levels has. The
direction is the way the light *travels*, so pointing down is a negative Y, the same convention the
engine defaults use. **`clear` is the colour the canvas clears to**, and when a scene does not say,
it is the fog's colour — the void then reads as distance rather than as the engine's own dark blue
behind an amber haze. The camera's field of view is deliberately *not* scene state: a scene is how
a level looks, and where you stand in it is the game's.

### The post chain is a list of named stages with parameters

> rule `alloy.the-post-chain-is-a-list` · not mechanically checked

Which is to say: **it is shaped exactly like a texture's layer stack**, and on purpose. It is data,
it lives in the package, and the workbench builds its editor from the same schema the shader is
generated from — so a new stage arrives with a full set of controls and never describes itself twice.
`Alloy.postTypes` and `describePost(name)` are the registry, and the checker asserts every stage's
schema matches its defaults, the same test generators and adjustments already pass.

- **The whole chain compiles to ONE fragment shader.** A pass per stage would want a framebuffer per
  stage and would round to eight bits between every one of them; concatenating their bodies keeps the
  chain in float and costs one draw. The program is cached by the stages it names, so changing a
  parameter is free and changing the shape of the chain costs one compile.
- **A stage's parameters are rewritten to its own uniforms** when the chain is generated, so two
  vignettes in a row are two independent stages rather than one fighting itself.
- **Order is the meaning.** Gamma after tonemap is a picture; gamma before it is a mistake. So
  reordering is an edit like any other, and the editor gives every stage a pair of arrows.
- **An empty chain turns the offscreen pass off entirely** and the world draws straight to the
  canvas, which is what every viewport did before any of this existed.

### Internal resolution is a look and a budget at once

> rule `alloy.internal-resolution-is-a-look-and` · not mechanically checked

`setResolution(height)` draws the world that many lines tall and upscales it in the post pass. Zero
means the canvas's own size. It is capped at the canvas: upscaling is the point, and rendering MORE
than the canvas can show would be paying twice for nothing.

The offscreen target is **linear-filtered** because it exists to be stretched, and **clamped** because
a chromatic offset at the edge would otherwise wrap a smear in from the opposite side.

One workbench note learned immediately: **a resolution is a number box and a row of presets, never a
slider.** The slider helper slides a soft range around the current value, which is right for a
texture size that starts at 128 and useless for a height that starts at 0 and wants to reach 540 in
one gesture.

### The scene window is the workbench telling the truth

> rule `alloy.the-scene-window-is-the-workbench` · not mechanically checked

Every other 3D window shows a thing. The scene window shows **the same thing every other window
shows, through this scene** — the first model in the package, or a cube, with the scene applied. That
is what stops Alloy previewing a world the game will never render, and it is why the scene editor
exists at all rather than the chain being typed into JSON.

---

## Part Three and seven eighths — Animation

**Animation writes into the bone array Phase 3 already built, and nothing else changes.** The merge
baked every node's rest transform into the vertices and gave each one a bone index; the shader has
always multiplied by `uBones[index]`. All that was missing was something other than the identity in
those slots. That is what the door being open was for.

What goes in a slot is a **delta**, not a transform:

    uBones[i] = animatedWorld(i) * inverseRestWorld(i)

A vertex is already at its rest position in model space, so the delta undoes the rest pose and
applies the animated one. A bone that has not moved gets the identity, which is why a static model
costs nothing and a clip animating one arm leaves the rest alone without saying so.

### The pose pipeline, and its order

> rule `alloy.the-pose-pipeline-and-its-order` · not mechanically checked

1. every node starts at its **rest** local transform
2. each playing clip is **sampled and blended** in by weight
3. **additive** layers add their difference from rest on top
4. **procedural** overrides compose over the result
5. the tree is walked **once** for world matrices
6. each bone's **delta** is written out

Procedural comes after clips deliberately. A head watching you should keep doing so while the walk
plays underneath; a look-at that ran first would be overwritten by the next keyframe and twitch.

### What is law

> rule `alloy.animation-what-is-law` · not mechanically checked

- **Rotations blend as quaternions, always.** Euler degrees are accepted in the data because nobody
  should have to type a quaternion, and are converted once when the clip is prepared. Interpolating
  degrees takes the long way round between keys more than 180 apart and locks near the poles.
- **A clip is prepared once, not per frame.** Keys are sorted then, so an author may write them in
  any order; an unsorted track samples nonsense with no error anywhere.
- **Blending is an incremental weighted mean**, each contribution landing at its share of the total
  so far. That gives the same answer as normalizing at the end without a second pass.
- **Additive means the difference from rest**, scaled by weight and applied after the base pose. An
  additive layer survives a change of base clip, which is the entire point of layering one.
- **Clips are keyed by BONE NAME.** One clip drives any model whose skeleton uses the same names.
  Two bones sharing a name is a model whose clips cannot say which they mean, so the first wins.
- **A clip carries its own play defaults.** `play: {speed, pingPong, additive, weight, fade}` on
  the clip is what `play()` uses for anything a call does not say. A breathing clip is *always*
  additive, and this is where it says so — not in every call site that plays it, one of which
  will forget. Absent keys mean the engine defaults, and the clip window deletes a key at its
  default so a clip that never asked stays byte for byte what it was.
- **A model carries its rig.** `rig.lookAt[bone] = {axis, maxAngle, weight}` and
  `rig.springs[bone] = {axis, stiffness, damping}` are the numbers `lookAt` and `impulse` fall back
  to, so a game says `lookAt('head', point)` and `impulse('antenna', 40)` and the character turns
  and wobbles the way its author tuned it. The rig is read live off the model, never copied, and a
  rig entry on a node that is not a bone is refused by the validator, because it would move
  nothing and say nothing. The reason both of these are data: the workbench previews runtime
  behaviour through the same animator a game runs, and a preview of numbers the package cannot
  store is a preview of a lie.
- **Events fire on crossing, not proximity.** A marker at 0.25s fires exactly once per pass however
  fast the clip runs; asking "is the playhead near 0.25" fires several times slowly and never
  quickly. A step that swallows the whole clip fires each marker **once**, not once per lap: a frame
  that took a second is a stall, and eleven footstep sounds is worse than one.
- **A step longer than the clip cannot be detected from the wrapped time.** 1.5 seconds into a
  one-second clip ends at 0.5, which looks exactly like a step that never reached the end. The
  un-wrapped end is what says whether it lapped.
- **Springs are integrated semi-implicitly** — velocity first, then position — and critically damped
  by default. The explicit form gains energy at large steps and a recoil that should settle instead
  grows until the arm spins.
- **`matToQuat` uses Shepperd's method.** The naive formula divides by something near zero at about
  180 degrees and produces infinities: a limb that vanishes at exactly one angle.
- **A clip track naming a node that is not a bone is reported.** It is the one mistake that produces
  no motion and no error, because the merge baked that node into an ancestor.
- **`isPlaying` means contributing or fading in**, not weight above zero this instant. A clip that
  has just begun a crossfade has zero weight for one frame, and a button that fails to light up when
  you press it is the visible form of getting this wrong.

### While a clip plays

> rule `alloy.while-a-clip-plays` · not mechanically checked

The selection outline and the gizmo are **hidden**. They refer to the rest pose, and drawing a handle
where the thing it moves is not is a lie. Editing the rest pose while watching an animation is a real
workflow; a gizmo in the wrong place is not part of it.

---

## Part Four — The Shell

Three layers of chrome, never more: the **header**, the **desk** with its **windows**, and the
**status bar**. Plus the **rail** at the left, summonable and free when hidden. Nothing in the shell
is a mode.

This is Webposium's shell, on purpose. Where the two tools solve the same problem they solve it the
same way, so that a person who has learned one has learned half of the other — and so that the audit
that produced that shell does not have to be paid for twice.

### The header

> rule `alloy.the-header` · not mechanically checked

Left: the package's title bar. The unsaved **dot**, the package **name** (a button; it opens the
Projects menu), the **home**, **Save**, and **Save as**. Right: the 3D view, the window menu, the
rail. That is the whole header. Anything else that wants to live here has to displace something and
say why.

### The desk and its windows

> rule `alloy.the-desk-and-its-windows` · not mechanically checked

The desk is a **surface**, not an editor. Every editor floats over it in a window you place
yourself, and a maximised window is the desk of whatever you are doing.

A window is an **instance**: a **kind** and a **subject**. `texture:brick` and `texture:tiles` are
two windows with their own selection, scroll and preview, and neither knows the other exists. Kinds
register with `defineWindowKind(kind, {title, w, h, exists, make})`. The editor `make` returns keeps
its state **in its own closure** and finds its controls by `data-ui` **inside its own root** — never
by id, because there can be two of it.

What the window system guarantees, and what any change must keep:

- geometry is remembered per window id and restored on the next visit
- a window can never leave the desk, so it can never become unreachable
- edges **snap** to the desk and to other windows; double-clicking the bar **maximises**
- a new window is placed where it **overlaps the open ones least**, not on a blind cascade
- the window menu lists everything open, so nothing can be lost
- windows live in a z-index **band** (10 to 400) that is renumbered when it runs out, so **shell
  chrome always stacks above every window, without exception**. The band is declared in the CSS
  stacking table and is the only place a z-index is decided.

### The rail

> rule `alloy.the-rail` · not mechanically checked

The rail is the **package**: every row is one thing the package will save. Click selects,
double-click opens the thing's window, right-click is its menu, and **every create, duplicate,
rename, delete, import and export lives in those menus and nowhere else** — not in a toolbar, not
inside a window. That rule is what stops the same four buttons appearing in six places and drifting
apart, and it means a person only learns one gesture.

The rail is **rebuilt from the package, never patched**, so it cannot disagree with what is loaded.
It is a rail rather than a window by decision: it is a table of contents, it edits nothing, it costs
nothing when hidden, and a table of contents wants to be in the same place every time.

The corollary, and it has already cost one bug: **an element captured before a rebuild is detached
after it.** Look up a row's label at the moment it is needed, never when the menu was built.

### Menus and asking

> rule `alloy.menus-and-asking` · not mechanically checked

There is **one menu**, `openMenu(x, y, title, items)`, and every surface uses it. There is **one way
to ask**: a name that already exists is edited **in place**, an input laid exactly over the label it
replaces (`editInPlace`); a name that does not exist yet is asked for on a small card at the pointer
(`askText`); a destruction is confirmed on the same card (`askConfirm`). **`window.prompt` and
`window.confirm` are never used**, for anything: they block, they cannot be dismissed by clicking
away, and in a tool that asks for a name twenty times an hour they are unbearable.

### The status bar

> rule `alloy.the-status-bar` · not mechanically checked

The log's last line and the counters. **The log is the tool's one voice and its one error channel**:
everything the engine refuses arrives there, at the moment it happens, in a sentence a person can
act on. No `console.log` in a shipped path — a message nobody sees is a message nobody acts on.

### Direct manipulation

> rule `alloy.direct-manipulation` · not mechanically checked

A shape is dragged by handles drawn over the preview. One rule, learned the hard way: **never
replace the handle elements while a drag is live.** Rebuilding removes the element holding the
pointer capture, which ends the gesture silently — the shape jumps once, the rest of the drag goes
nowhere, `pointerup` never fires, and the edit never reaches the undo history. The guard lives
inside the redraw itself rather than at its call sites, because there are several and the one added
later is the one that would forget.

Dragged values are **rounded to four decimals**, which is a tenth of a pixel on the largest texture
this engine will build. That is not cosmetic: the block serializer trims floats to six decimals for
readability, so an untrimmed value in memory is a package that does not survive its own round trip.

### Viewports

> rule `alloy.viewports` · not mechanically checked

**Every 3D window owns its own renderer.** Not one shared canvas moved between windows: two windows
cannot both hold the same canvas, and swapping it on focus blanks whichever one you are not looking
at. The cost is a WebGL context and a second copy of what that viewport uploaded; a browser allows
around sixteen contexts and a model is a few thousand vertices, so the ceiling is far above anything
a person will open.

**One animation-frame loop drives all of them.** A loop per viewport wakes the compositor once per
viewport for no reason and gives no way to order the draws. A closed viewport is not in the set and
costs exactly nothing.

A texture is uploaded **once per texture**, however many materials name it — the same rule the
stage follows, and the rule the workbench used to break: keyed by material, two materials on one
animated brick were two uploads with two clocks that could drift a frame apart. One upload, one
clock, one `alloyKey`.

**Minification is filtered anisotropically**, to the device's limit, capped by `aniso` in the
texture defaults. Mipmaps stop a minified texture crawling, but they pick one level for the whole
fragment, so a floor seen at a grazing angle is filtered as hard along the corridor as across it and
turns to mud a few metres out. A carpet stretching away from the camera is the most-looked-at surface
in a game like this. The extension is absent on some machines, and its absence is **silently no
anisotropy** rather than an error — the one place this engine does not shout, because the picture is
still correct without it.

**A material describes itself.** It grew from three keys to eleven across four versions, so
`Alloy.describeMaterial()` publishes every key, its type and what it does, for the same reason a
generator publishes its schema: the one call a game makes should be askable rather than guessable.

**And one function converts a material, for everybody.** `Alloy.resolveMaterial(m, texture)` turns
the hex a package stores into the floats a draw call takes. The stage and the workbench each used to
have their own copy, both written when a material had five keys, and when it grew to eleven **both
silently dropped `shading`, `pass`, `fresnel`, `aoRange`, `alpha` and `uvRect`** — a glass window in
a package rendered opaque and a world-shaded wall rendered vertex-lit, with nothing anywhere saying
why. A second copy of a rule the engine already states is on the forbidden list for exactly this —
and there was a third copy, in the material window itself, found by the audit a version later. The
checker now reads the app block for the shape of one.

**One preview scene, shared by every 3D window.** The point of judging a material against fog and a
tonemap is judging it against the *same* fog and tonemap the model window is using, so the choice is
one control repeated in each toolbar rather than one setting per window. It is **UI state, not
package data** — which scene you happen to be previewing is not a fact about the package — so it
lives in the preferences beside the window geometry.

The scene window is the one exception and ignores it, because that window exists to show one
particular scene and would be lying if it showed another.

### Gizmos

> rule `alloy.gizmos` · not mechanically checked

**Hit-tested in screen space, applied in world space**, and keeping those apart is what makes a
gizmo feel right. A ray against arrow geometry is exact and horrible: the handles are thin, so you
miss them, and an axis pointing at the camera becomes unclickable. Asking which handle the pointer
landed nearest to *in pixels* is the better question. Applying in world space is the other half: a
drag along X is the closest point between the pointer's ray and the world X line through the pivot,
not a screen delta, which would move near and far objects at different speeds.

**The axes are the node's PARENT's axes, not the world's.** A node inside a rotated arm moves along
the arm, because that is the space its numbers are written in. A gizmo that moves along world X
while the inspector shows local X is a gizmo that lies about what it edits.

**A drag is measured from where it began**, never accumulated frame to frame: accumulating drifts,
and a snapping drag would ratchet. **Scale is a ratio**, not a difference, or a small node explodes
and a large one barely moves. **Rotation is wrapped into plus or minus 180**, or dragging past the
seam spins the node the long way round.

`closestOnLine` subtracts **line origin from ray origin**, in that order. The other way negates the
result, which is a gizmo that moves everything backwards — invisible in the formula and obvious the
first time anyone drags a handle. It shipped that way and a real drag caught it.

### Addressing a node

> rule `alloy.addressing-a-node` · not mechanically checked

**A node is addressed by its PATH**, an array of child indices, never by a reference to the object.
A reference survives an undo looking perfectly valid while pointing at a tree that is no longer
loaded, so a selection made before an undo would silently edit a discarded model. A path is resolved
fresh every time and resolves to nothing when the node has gone.

The model editor **re-merges the whole tree on every edit**. For tens of nodes and thousands of
triangles that is a fraction of a millisecond, and keeping a partial rebuild in step with a tree that
can be reparented is a large amount of bookkeeping to save time nobody can measure.

**Mirroring is a negative scale**, not rewritten vertices, so the copy stays a live node whose
parameters still mean something. The merge notices the negative determinant and reverses the winding.

### Persistence

> rule `alloy.persistence` · not mechanically checked

Every form of a package is the same object; only the place differs. **The last place you saved is
the home.** Browser storage (IndexedDB), a `.alloy.json` file, and a `managed-data` block are all
`JSON.stringify` of the same thing, and there is no ceremony around the file because there is no
format — it is the package.

A crash snapshot in `localStorage` is **recovery only**; the file or the storage entry remains the
truth, and the snapshot is cleared on a real save. **At boot, a snapshot newer than the last save
wins**, and says so: it is adopted, with the storage home it belonged to when it has one, and
nothing in storage is touched until the next Save. A file-homed package comes back homeless,
because a file handle does not survive JSON, and asks to be saved somewhere.

**A delete is refused while something still names the entry** — a material on a texture, a node on
a material, a clip on a model, a clip's track on a bone — and the log says who. The validator
refuses those dangling names, and every load path runs the validator: undo, redo and boot. Letting
the delete through used to mean a package that saved fine and reloaded as an empty tool. For the
same reason **Save validates before it writes**, and the boot and undo paths catch a refused package,
log why, and stand on what they had.

**Browser storage is per origin.** `file://`, `localhost` and `127.0.0.1` are three separate
shelves, and the boot log says which one this is, once, because "where did my package go" is
otherwise a real afternoon.

**The data block's changelog is a diff**, not a table of contents: every entry is fingerprinted when
a block is copied, and the next copy for the same project says which textures, materials, models,
clips and scenes were added, changed or removed since. The *why* belongs in the commit message.

Installing into a game file is deliberately absent until Phase 7: that path needs the OFCU splice
discipline (scan the target, render the block for its indentation, prove every byte outside the
range is unchanged, validate, back up, write) and it needs the package format settled first. What
exists instead is *Copy the package data block*, which produces exactly the text that path will
write.

### Undo

> rule `alloy.undo` · not mechanically checked

**Package snapshots, not a command stack**, and this is now built. The build plan called for a
command stack; Webposium
runs on snapshots and they are the reason its editors cannot drift out of step with the data. Alloy's
data is small JSON, and the one thing that is not small — a base64 raster layer — is interned by
content hash so a snapshot never copies a PNG.

The reason a snapshot wins is that a command stack has to be **exhaustive** to be correct: every
new edit path is a new command, and the one somebody forgets to write is an edit that silently
cannot be undone. A snapshot cannot be forgotten.

The rule that keeps new editors honest comes with it: an editor whose data is not in the package
does not survive an undo, and that is the check, not a bug. Edits commit on a **debounce**: any
edits within 320 ms of each other are one step. That is wall-clock, not per gesture, on purpose — it
is what makes ten arrow taps one undo — and it also means two quick paint strokes merge, which is
accepted. A snapshot identical to the one below it is **not pushed** — an undo that does nothing
once reads as a broken undo.

---

## Part Four and a Half — The Clip Editor

> **THE CLIP IS THE TRUTH AND THE PLAYHEAD IS A QUESTION PUT TO IT.**

Every other editor in the shell shows you a thing. The clip editor shows you a thing *at a time*,
and that one extra word is where animation tools go wrong. The law below exists to keep the time
from becoming a second place where the pose lives.

### There is no working pose

> rule `alloy.there-is-no-working-pose` · not mechanically checked

The viewport shows `poseAt(specs, out)`. That is the clip, sampled at the playhead, and nothing
else. There is no edit buffer holding a pose that the keys do not yet describe, and no "apply"
button to reconcile the two.

The preview honours the clip's own `play` block — its speed, its ping-pong, its additive flag and
weight on top of a base clip chosen in the window, its fade as a crossfade from that base when
Play is pressed — and it previews the model's rig by handing `poseAt` a `dt`, which steps the
look-at and the springs through the animator's own procedural pass. A bone with a look-at entry
aims at a target you type or set circling; a bone with a spring gets kick buttons. Scrubbing
passes no `dt`, so the keys are shown as authored. Nothing in this preview is a copy of runtime
code, and nothing it shows is a number the package cannot hold.

So dragging a gizmo cannot move a pose, because there is no pose to move. It writes a key. Auto-key
is not a convenience mode you can switch off; it is the only way an edit can exist at all, and the
reason previewing and editing are the same code path. What you see while scrubbing is what the
runtime will see, because it is the same function answering the same question.

The cost is real and accepted: you cannot pose a bone "just to look at it". The benefit is that a
clip can never disagree with its preview.

### Keying is per channel, and sparse

> rule `alloy.keying-is-per-channel-and-sparse` · not mechanically checked

Keying a bone writes to the channels that bone **already animates**, and to `rotation` alone when it
animates nothing yet. A rotation-only arm must not grow a position track the first time somebody
presses the key button, because a track that exists is a track that overrides the rest pose forever.

`sampleLocal` falls back to rest **per channel**, not per bone. A track that animates only rotation
leaves position and scale at rest. Per-bone fallback is the bug where a limb that should turn
collapses to the origin instead.

An empty clip name means the rest pose. That is what *Key its rest pose here* is built on, and it is
the only way to bookend a clip: keying "the current pose" of a one-key track faithfully records the
pose that one key describes, everywhere, which is a constant and not an animation.

### The timeline is one canvas

> rule `alloy.the-timeline-is-one-canvas` · not mechanically checked

Ruler, event strip, and one row per bone, drawn in a single 2D context. Not a DOM node per key.

A clip with forty bones over six seconds is thousands of keys, and thousands of absolutely
positioned divs is a layout cost paid on every scrub. Hit testing is a function of `(x, y)` — the
same arithmetic the drawing used, run backwards — and it returns what was hit rather than an
element: a key, an event, a row, the ruler.

Rotation is hit-tested before position and scale, because rotation is the channel almost every key
belongs to, and two keys at the same time on one row would otherwise be resolved by object order.

A key dragged past its neighbour has genuinely changed places, so the track is re-sorted on every
move. A track that is out of order samples nonsense.

### Time is snapped, and tidied

> rule `alloy.time-is-snapped-and-tidied` · not mechanically checked

The playhead snaps to the frame rate, which is a property of the editor and not of the clip — the
runtime samples continuously and does not know what fps you authored at. Snapped times are rounded
to four decimals before they are written, because the package serializer trims to six and a value
that survives the round trip is worth more than a value that is exact.

### Events fire on crossing, in preview too

> rule `alloy.events-fire-on-crossing-in-preview` · not mechanically checked

The editor previews events at the same *phase* the runtime would, by asking the animator rather than
by re-implementing the test. An event tested by proximity fires twice at low frame rates and never
at high ones; an event tested by crossing fires once, which is what a footstep sound needs.

### Onion skins are wireframes

> rule `alloy.onion-skins-are-wireframes` · not mechanically checked

Ghosts of the neighbouring keys, drawn as posed line meshes through the same bone uniforms as the
solid model. Not translucent copies, because there is no sorted transparency in this renderer and
there is not going to be one — see *One blended pass, and the caller owns the order*.

Which means the line shader had to learn about bones. It reads `uBones[int(aJoint)]` exactly as the
lit shader does, so a wireframe and the solid it shadows cannot drift apart. Edges are deduplicated
by sorted index pair, and carry their joint through.

### The curve panel reports, it does not edit

> rule `alloy.the-curve-panel-reports-it-does` · not mechanically checked

It draws what the channel actually does across the clip, easing included, by sampling the same
function the runtime samples. It is a mirror, not a control: easing is chosen per key from the
inspector, and there are no bezier handles to drag. A curve you can edit is a second place the
timing lives, and the timing lives in the keys.

---

## Part Four and three quarters — Shipping

> **THE ENGINE THAT SHIPS IS THE ENGINE THAT IS RUNNING.**

A game gets three blocks of text: the engine, the package, and code that uses both. There is no
bundler, no build step and no artifact, and every one of the three is something a person can read
before pasting it. This part is the law of the parts that leave the building.

### The stage is a convenience, not a layer

> rule `alloy.the-stage-is-a-convenience-not` · not mechanically checked

`Alloy.init(canvas, opts)` returns a **stage**: load a package, create instances, aim the camera,
render. It is the only part of Alloy a game has to learn.

It holds no state the renderer does not already hold, invents no format, and hides nothing.
Everything under it stays public and everything it does is available separately, in the same order,
so a game that outgrows the stage keeps its renderer and walks away rather than rewriting. It
exists only because the twenty lines between "I have a package" and "I have pixels" are the same
twenty lines every time, and a game that writes them itself will write them slightly wrong — a
texture uploaded per material rather than per texture, which is a level that hitches on entry.

If the stage ever grows a scene graph, parenting, an update callback, or a place for game logic to
live, that is this section being violated.

### A debug hook is a parser, not a feature

> rule `alloy.a-debug-hook-is-a-parser` · not mechanically checked

`Alloy.parseDebugSpawn(search)` turns `?debug=x,z,yaw,pitch` into a camera, and that is **all** it
does. It does not read `location`, does not bind a key, and does not draw an overlay, because an
engine that reaches for markup it does not own or binds a global listener is a rule this file keeps
and a convenience is not worth spending it on. A game passes its own search string in, and draws its
own F3 overlay from `stage.renderer.stats`.

Reloading straight into the corner you were looking at is how The Levels was iterated, so the *shape*
of the hook is worth keeping. Where it lives is what the boundary decides.

### The stage owns GPU resources; the game owns the world

> rule `alloy.the-stage-owns-gpu-resources-the` · not mechanically checked

The stage keeps a list of instances so that `render` has something to walk. Where an instance is,
what it is doing, and whether it still exists are the game's business — write `inst.position`
directly, every frame, from whatever the simulation says.

The instance transform is three plain arrays, not a matrix, because those are the numbers a game
reads, writes and saves, and a `Float32Array` does not survive JSON. They are recomposed into the
matrix every frame: one `mat4.compose` per instance, which is nothing beside a draw call, and it is
what makes `inst.position[1] += dt` simply work. A game whose physics hands over a transform sets
`compose` to false and writes the matrix itself.

### What is shared, and what is not

> rule `alloy.what-is-shared-and-what-is` · not mechanically checked

Forty crates share one merged buffer and one set of GPU textures. They do not share a pose.

So models are merged once per model name and textures uploaded once per **texture** — not per
material naming one — while bone matrices are allocated **per instance**, and only for instances
that can animate at all. A bone array per crate is the cost that turns a hundred crates into ten.
That is why `drawModel` takes an optional pose: many instances, one vertex buffer, different poses.

Textures upload on `loadPackage`; models merge on first `createInstance`. A package is a library
and a scene uses part of it.

### An instance is lit by the room it stands in

> rule `alloy.an-instance-is-lit-by-the` · not mechanically checked

`inst.lights` is a light set, a plain array, or null for the engine's own, and the stage hands it to
every group that instance draws. Without it a prop takes the scene's global lights while the chunk
around it uses its own list, which is the exact bug the "lights belong to the draw" rule exists to
stop: furniture lit by a different sun than the walls behind it.

**The stage draws in two passes, opaque then glass**, because glass does not write depth and
therefore has to land on a finished picture. It is not sorting — nothing in here sorts — it is the
ordering rule every caller follows, done once so a game does not have to split its instance list.
`drawModel` and `drawInstances` take `opts.pass` to filter which groups a call draws, which is what
makes one list drawable twice.

### Animators advance whether or not the instance is drawn

> rule `alloy.animators-advance-whether-or-not-the` · not mechanically checked

Visibility and culling skip the **draw**. They never skip the clip.

A character who is invisible and whose clip stops advancing is a bug you meet three hours later,
when it pops into view mid-stride or never fires the event a door was waiting on. The saving that
matters — the GPU work — is already taken.

### One rule, asked rather than restated

> rule `alloy.one-rule-asked-rather-than-restated` · not mechanically checked

Which clips drive a model is a rule: the ones that name it, plus the ones that name nothing. It
lives in the engine as `clipsForModel`, and the workbench asks it instead of having its own copy.

It used to have its own copy, and the copy was stricter. A workbench that decides for itself which
clips belong to a rig is a workbench that previews a different set than the game plays, and that
divergence is invisible until somebody ships.

### A seam that only runs in a render loop is a seam no test can reach

> rule `alloy.a-seam-that-only-runs-in` · not mechanically checked

`instanceMatrix` is a three-line function that exists as a function because of what happened when
it was three lines inline: `quat.fromEuler` takes three **numbers**, it was handed the array, and
NaN went through the whole 3×3 basis. The translation column stayed correct. Six draw calls
reported perfect health, no GL error was raised, and the screen was black.

Three hundred and fifty checks did not catch it, because the only path to those three lines went
through a canvas. So the rule: **when a bug is only reachable through the GPU, the fix is to move
the logic somewhere Node can call it**, not to promise to look harder next time. Everything the
stage does that is arithmetic rather than GL now has a name and a test.

### The three blocks, and the starter file

> rule `alloy.the-three-blocks-and-the-starter` · not mechanically checked

Export produces exactly what OFCU Manager would write, on the clipboard rather than into a file,
because a web page cannot splice somebody else's file. The two must not drift, which is why the
engine block is emitted **verbatim**: the hash is taken over normalized content, so a verbatim copy
hashes identically to an installed one, and re-indenting would be work that only risks disagreeing
with the manager.

*Copy a whole starter file* writes a complete OFCU file — blocks in convention order, an app block
generated against the package that is open, nothing to install. Save it, open it, see the models.
The gap between "here is the API" and "here is a thing that runs" is where a toolkit loses people,
and closing it costs about sixty lines.

---

## Part Five — Before Every Commit

Run the checker (`alloy_check.js`, items 1 to 6 and the property tests), then OFCU Manager (item 7),
then the integration test (`alloy_integrate.js`, item 8). Three tools, one list:

1. Every script block parses.
2. No delimiter hazards in any block — `</` + `script`, `<` + `!--`, `--` + `>`.
3. The engine block calls no `document.getElementById`, `querySelector` or `querySelectorAll`, and
   touches `document` only through the `currentScript` guard.
4. Every `getElementById` in the app has markup, and every `dom.x` the app reads is a key of the map.
5. **The app never calls an engine-internal function by name.** The two blocks share one global
   scope but not one closure, so a bare call to an engine helper parses, ships, and throws a
   `ReferenceError` on whatever path nobody clicked. The checker lists what each block declares at
   its own indentation and reports any engine name the app reaches for without declaring its own.
   This rule exists because `clamp` did exactly that.
6. The engine evaluates in Node with no `document`, and every math property test passes.
7. `OFCU.validate('alloy.html')` is clean, and `stamp` has been run if the engine moved.
8. The integration test passes: author a package in Node, write a game file that carries it, install
   the engine into that file through `OFCU.install`, validate the result. It is the only check that
   exercises the path a consumer actually takes, and it is where an export bug surfaces before
   somebody else finds it.

Then load the file in a browser and exercise what changed. One concern per commit, in the house
voice, titled `Alloy — …` for the workbench or `Alloy vX.Y.Z — …` when the engine moved.

---

## Part Six — Not Allowed Back

Each of these is a decision, not an accident. Reversing one needs a paragraph here explaining what
changed.

- **Tabs**, or any control that is a mode you have to remember you are in.
- **A renderer that owns a scene graph.**
- **Geometry builders that know about WebGL**, or a primitive that cannot be built in Node.
- **A function inside model, texture or clip data.**
- **`layout(location = ...)` in a shader**, competing with the ATTR table.
- **Per-pixel lighting as the default look.** (World shading is an option a material selects.)
- **A light list that only `drawMesh` can take**, leaving props lit by a different set than the room.
- **A surface that holds a transform, an object, or a callback the renderer calls** — or a window
  that previews one. A surface is a geometry with a table of contents; a level editor is a different
  program.
- **Point lights in uniform arrays** rather than the uniform block, or a range stored unsquared.
- **Two copies of a falloff**, in two programs, free to drift.
- **A second euler convention**, or a rotation stored as three numbers.
- **`Float32Array` for an authored vector or quaternion.**
- **A camera that stores an eye position** instead of deriving it from target, angles and distance.
- **An engine that reaches for markup it does not own**, or binds a global listener.
- **A hand-written `data-ofcu-hash`.**
- **A vertex-weight path removed from the data model** because the MVP always writes 1.0.
- **A command stack** standing in for package snapshots.
- **`window.prompt` or `window.confirm`**, for anything.
- **A second menu implementation, a second card, a second log.**
- **Create, duplicate, rename or delete in a toolbar** or inside a window.
- **Ids inside an instanced editor**, or an editor addressing another editor's DOM.
- **A DOM node captured before a rebuild and used after one.**
- **A face normal passed in beside its corners** instead of derived from them.
- **A primitive that cannot be built in Node**, or one that knows about WebGL.
- **Subdivision that reads vertices instead of faces**, or that throws away the builder's quads.
- **Frustum planes read from a matrix's columns.**
- **A bone slot 0 that is not the identity.**
- **A vertex-weight or bone-index path removed because the MVP writes 1.0 and 0.**
- **Rebuilding a handle while it is being dragged.**
- **A z-index that is not in the stacking table.**
- **One canvas shared between windows.**
- **A node addressed by object reference** rather than by path.
- **A gizmo whose axes are the world's** when the inspector shows local numbers.
- **A drag accumulated frame to frame** instead of measured from its start.
- **Euler angles interpolated** instead of quaternions slerped.
- **A clip prepared per frame** instead of once.
- **Events tested by proximity** instead of by crossing.
- **A spring integrated explicitly**, which gains energy and runs away.
- **A gizmo drawn at the rest pose while a clip plays.**
- **`CanvasRenderingContext2D` anywhere in texture evaluation**, or `fillText` for a glyph.
- **A stateful RNG called per pixel.**
- **Noise that wraps both axes at one period**, or an octave whose period does not double.
- **A blend mode applied without the backdrop-alpha term.**
- **A texture format that is not a layer stack**, or a "static image" type beside it.
- **A row that holds a list of its own**, or behaviour hanging off a folder name.
- **A paint row that is not the texture's size**, or an image row silently resampled on import.
- **Seconds baked into a texture's frames**, or a playhead the asset drives rather than the consumer.
- **Interpolating something that cannot be blended** — an enum, a seed, two rasters.
- **A working buffer that outlives the cel it belongs to.**
- **A singleton scene block** where named scenes belong, or a scene that holds objects.
- **A post stage that describes itself twice**, or one with no schema beside its GLSL.
- **A framebuffer per post stage**, rounding to eight bits between every one of them.
- **A slider for a resolution**, where a soft range cannot climb from nothing to 540.
- **Glass that writes depth**, or GL blend state left on for whatever draws next.
- **Sorting inside the renderer.** The caller draws its glass last.
- **A sub-range draw culled by the whole mesh's bounds.**
- **An engine that reads `location`**, binds a key, or draws an overlay of its own.
- **A preview scene stored in the package**, or one chosen per window when every window should agree.
- **Node tint or occlusion that replaces what it inherits** instead of multiplying it.
- **Shading attributes allocated for a node that said white and 1.**
- **A second conversion from package material to draw material.** There is one, in the engine.
- **A material key added to the schema and not to `resolveMaterial`**, which drops it in silence.
- **Mipmaps without anisotropy** on a surface anybody will see at a grazing angle.
- **A prop drawn with the scene's lights** while the room around it uses a chunk list.
- **An atlas rect in image space handed to a material.**
- **A scene graph, parenting, or an update callback on the stage.**
- **Game logic living inside Alloy.**
- **A bone array for an instance that cannot animate.**
- **A texture uploaded per material** rather than per texture.
- **A clip frozen because its instance is invisible.**
- **A second copy of a rule the engine already states.**
- **A hand-edited `managed-package` block** in a consuming file.
- **An engine block re-indented on its way out**, which breaks its hash.
- **Arithmetic that can only be reached through a canvas.**
- **A working pose** held beside the clip, or an auto-key that can be switched off.
- **A DOM node per keyframe.**
- **A curve panel you can drag**, putting the timing in two places.
- **Onion skins drawn as translucent solids**, in a renderer with no sorted transparency.
- **A line shader that cannot read bones**, letting a wireframe drift from the solid it shadows.
- **Keying every channel** of a bone that animates one.
- **A per-bone rest fallback** where a per-channel one belongs.
- **An engine helper called bare from the app.**

---

## In Flight

Decided in principle, not yet built, and therefore not yet law in its details. Each moves up into the
law when the code that proves it exists.

- **Bones and mesh nodes are one tree.** A bone is a node with no primitive; a primitive's vertices
  bind to the node that holds them. Unifying is simpler than two linked trees and costs nothing that
  skinning will later want. Settled in principle at Phase 0, built in Phase 5.
- **The package** is built and at **schema 8**; it stays in this list only because the rule that
  governs its future is the thing decided here. Migrations from every earlier schema are carried
  forever, and a migration only ever ADDS; a package that loses a field on load is a package that
  loses work. Schema 4 split draw-ops rows into one shape row each, 5 split paint from image, 6 added
  texture animation, 7 added scenes and 8 added a scene's `sun` and `clear`, a texture's `sampling`
  and an event's `data`, a node's `lamp`, a clip's `play` and a model's `rig` — all additive, and 6
  through 8 are no-op migrations because absent means
  still, absent means the defaults, absent means the engine's own sampling.
- **A static-prefix cache for animated textures.** The rows below the lowest animated one could be
  evaluated once and reused; today the whole stack is evaluated on every frame that changes. Built
  when a profile of a real level says it is needed, inside `evaluateTexture` and nowhere else.
- **Per-fragment fresnel** on the default program is the one open question from the audit, awaiting
  an A/B in the browser. Lamps on nodes were the answer to "lights in the package"; a clip's `play`
  block and a model's `rig` were the answer to "the clip preview is thin". All three are built.
- **The app cannot install, only hand you the text.** OFCU Manager splices files from Node; a web
  page cannot touch somebody else's file. Export produces byte-identical text, and the integration
  test proves the two agree, but a person still moves it across.
- **A tint per instance PER MATERIAL.** An instance tint is applied to the whole copy — a rust
  chair has a rust frame — the same way a node tint reaches every node under it. Colouring only
  the fabric of one copy would mean a tint per instance per material group and a shader that
  knows which group it is drawing: a second door, not this one. Decided 2026-09-18 to wait until
  a prop turns up that genuinely needs a two-tone copy; until then a designer darkens the parts a
  tint should not move, which is what the chair's legs already do.
- **Particles.** Muzzle flash, dust, sparks. Arguably a fourth domain; mostly the instancing path
  plus a per-instance clock. A Phase 8, not a rescope.
- **Lighting's ceiling.** Directional, hemisphere ambient, and sixty-four point lights per draw all
  exist, and so do world shading, AO, tint and fog — that was the renderer spec's first bump and it
  has landed. **Shadows still wait until a game asks for them, and none has.**
- **A primitive that paints its own vertices.** Nodes carry tint and occlusion and the merge bakes
  them, but no *primitive* generates either — a box cannot darken its own inside corners. When one
  needs to, it writes `colors` and `ao` into the geometry it returns and the merge already
  multiplies them in.
- **Context restore.** Implemented for programs, meshes and textures; instance sets are dropped
  and must be rebuilt by their owner. Still untested against a real context loss.
- **Picking is against bounding boxes, not triangles.** Clicking in the viewport selects the
  nearest box, which is wrong for a node wrapped around another and is the difference between
  fifty lines and an exactness nobody would notice.
- **Multi-select edits the first node's fields.** The gizmo moves them all; the inspector shows
  one. A proper multi-edit needs a story for differing values and does not have one yet.
- **No copy, paste or mirror of keys.** A pose is authored where it is needed. Copying a key
  between bones needs a story for what "the same rotation" means across a mirrored rig, and there
  is not one yet.
- **No box-select on the timeline.** Keys move one at a time. Retiming a whole clip is a thing a
  clip editor eventually needs and this one does not have.
- **Skinning is still the door, not the room.** Every vertex has one bone at weight 1.0. Adding
  weights is a change to the merge and the shader, and to nothing else.
- **Alpha is settled.** Cutout (`alphaTest`), a material alpha, and **one** unsorted blended pass
  (`pass: 'glass'`) all exist. Sorted transparency stays cut, permanently: the caller orders its own
  draws, and nothing in here will grow a scene to sort.
- **Post is one chain, in one shader.** Which means a stage that needs its own pass — a blur wanting
  several taps at several sizes, a bloom wanting a downsample — does not fit the current design. No
  stage has needed one yet, and when one does it is a second framebuffer and a longer story.

---

## The Phases

Each ends with something that runs, renders, and can be looked at. No phase requires the next one to
exist before it is useful.

| phase | what | state |
|---|---|---|
| 0 | Foundation — WebGL2, math, camera, grid, a lit box | **done** |
| 1 | Texture engine — layer stacks, PNG codec, atlas | **done** |
| 2 | Texture workbench | **done** |
| 3 | Mesh engine — node trees, primitives, projection, culling, instancing | **done** |
| 4 | Mesh workbench | **done** |
| 5 | Animation engine — clips, blending, procedural, events | **done** |
| 6 | Animation workbench — timeline, keying, curves, onion skins | **done** |
| 7 | Export and integration — the stage, the three blocks, the starter file | **done** |

The engine half of each pair is the load-bearing work; the UI half is what makes it usable. If a
phase has to be cut short, ship the engine and hand-write JSON for a while.

All seven are done, which means the thing this was built for can start: **The Levels** can be
rebuilt on Alloy. What the next phases are is decided by what that rebuild turns out to need, not by
this table.

**Since Phase 7**, three things landed that no phase called for, because using the tool asked for
them: the texture stack became **one list** with paint and image split apart, rows gained **names**,
and textures learned to **move**. Engine 0.11.1, package schema 6.

And the rebuild has now said what it needs from the renderer. It is written up as three bumps in
`workspace/alloy_renderer_spec.md`. **Bump one is done — engine 0.12.0**: per-draw light lists of
sixty-four in a uniform block, reaching all three draw calls; world shading chosen per material;
exponential-squared fog; AO and tint attributes; AO-scaled emissive; and the per-instance tint slot
as a door. **Bump two is done — engine 0.13.0, package schema 7**: named plural scenes carrying
render state only, a post chain of named stages compiled into one shader, internal resolution, and a
scene window that previews all three. **Bump three is done — engine 0.14.0**: one blended pass with a
fresnel term, sub-range draws that bring their own bounds, a spelled-out validation opt-out for
streaming, and `parseDebugSpawn` as a parser rather than a feature.

**All three bumps of the renderer spec have landed, and so have the two things it never claimed** —
engine 0.15.0 adds one preview scene shared by every 3D window, and node `tint` and `ao` baked and
inherited through `mergeModel` so a prop can carry its own shading. Nothing in that document is
outstanding.

**Engine 0.16.1** was a review's follow-ups: anisotropy on by default (`aniso: 8` in the texture
defaults), `describeMaterial` and `materialKeys`, `inst.lights` on the stage with a two-pass render,
and `resolveMaterial` as the one conversion from package material to draw material after both the
stage and the workbench were found to have their own five-key copies.

**Engine 0.17.0** is the Great Alloy Audit's straightforward half (`workspace/The_Great_Alloy_Audit.md`,
2026-09-17): eleven read-only auditors over the whole file, arbitrated, with every accepted fix that
needed no decision applied at once. In the engine: `play()` no longer restarts a clip that is
already playing; a ping-pong bounce inside one step fires a marker on both crossings;
`eventsBetween` lets an editor ask what a step crossed; `_drawGroup` draws a non-indexed mesh with
`drawArrays` instead of silently nothing; a sub-range `first` without `count` means "to the end";
the post target's depth is 24-bit; `loadPackage` uploads before it unloads; context restore drops
light sets and remakes the post target; `applyScene(null)` resets ambient as well as fog; the
validator now reads masks, key paths, vector lengths, node fields, cel sizes, duplicate bone names
and a track's first frame; the data-block tag escapes its project name; the block parser ignores
comments; `Instance` gained `lookAt` and `impulse`, `Stage` gained `texture(name)`, the renderer
publishes `textures`; a mask's own keys animate; `perspective` refuses a degenerate frustum; and
the small vocabularies — uv modes, loop modes, texture eases, a light's shape, a scene's shape —
are published. In the workbench: the material window converts through `resolveMaterial` and
exposes all eleven keys; rename no longer strands references in undo, redo and boot;
mirror reflects rotation; shape handles follow the playhead and key the frame they are on; cels
resample with their texture; the crash snapshot is flushed on leaving and forgotten on save; the
starter export applies a scene and drives texture clocks. The checker grew a section that pins
every one of these. What the audit left for discussion is stamped so in the report.

**Engine 0.18.0, package schema 8** is the discussion, resolved. Alex chose, item by item, and the
choices were loud ones: an unknown material name **throws** with the list, the way a model always
did; an instance held across `unloadPackage` **throws by name** when drawn; a delete is **refused**
while anything names the entry; Save **validates** first; undo and boot **catch** a refused package
and say why. Lighting is **re-read every frame** and `touchLights` is a no-op. A scene carries its
**sun** and its **clear colour**, and the scene window edits both; a texture carries its
**sampling** — filter, wrap, mipmaps, anisotropy — chosen from a menu in the texture window and
handed straight to the upload, so the carpet can finally ask for linear; a clip event carries
**data**. The stage's camera is **any object that answers `view` and `proj`**, so a first-person
game hands it one. The workbench uploads **per texture**; the data block's changelog is a **diff**;
the crash snapshot is **adopted** at boot when newer than the last save; the boot log **names the
origin**. The Bible stopped claiming a static-prefix cache that was never built, and the cache went
on the In Flight list where it belongs. And **a node may carry a lamp**: the point light lives on
the prop, not in the scene, so the scene stays a set of dials and the desk lamp lights the desk
wherever the game puts it. The workbench lights its previews with a model's own lamps, falling
back to the warm preview lamp when it has none, and marks each with a small cross in its colour.
And the clip preview grew to its complete form by making the runtime's knobs *data*: a clip's
**`play` block** (speed, ping-pong, additive, weight, fade) and a model's **`rig`** (a look-at per
bone, a spring per bone), both edited in the windows that own them and both previewed in the clip
window through `poseAt` with a `dt` — the animator's own procedural pass, not a drawing of it. A
bone's rename now follows into clip tracks and the rig. The checker pins every one of these too.
Relegated for a browser A/B: per-fragment fresnel.

**The Levels was rebuilt on this** — `the_levels.html`, both engines installed through the manager,
every room of the prototype at the same coordinates. And the rebuild said what it needed next: the
port carried four hundred lines of world-mesh bookkeeping that every world game would carry again.
**Engine 0.19.0 is the surface builder**: `Alloy.geometry.surface()`, `makeSurface`,
`drawSurface`, `Alloy.lights.nearest`, and the law above. The Levels is its first consumer.
**Engine 0.20.0 opens the instance tint door**: `set.tints`, `Alloy.instanceTint`, one draw per prop
model however many colours it comes in.

Particles and weighted skinning remain likely after that, and both are still additions to a design
with room for them rather than changes to it.
