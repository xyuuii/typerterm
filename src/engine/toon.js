// Cel-shading ("三渲二") toolkit: banded toon materials with stepped specular
// and rim light, plus a post pipeline that draws warm ink outlines from a
// normal/depth pre-pass, a restrained bloom and a lofi colour grade.
import * as THREE from 'three';
import {EffectComposer} from 'three/examples/jsm/postprocessing/EffectComposer.js';
import {RenderPass} from 'three/examples/jsm/postprocessing/RenderPass.js';
import {ShaderPass} from 'three/examples/jsm/postprocessing/ShaderPass.js';
import {UnrealBloomPass} from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import {OutputPass} from 'three/examples/jsm/postprocessing/OutputPass.js';
import {Pass, FullScreenQuad} from 'three/examples/jsm/postprocessing/Pass.js';

// Objects on this layer only are drawn in colour but skipped by the outline
// pre-pass (light shafts, dust, sky, glass, steam).
export const NO_OUTLINE_LAYER = 1;

let sharedRamp = null;
export function toonRamp() {
  if (sharedRamp) return sharedRamp;
  // Coordinate is N·L*0.5+0.5. Shadow side, a soft terminator band, lit side.
  const data = new Uint8Array([118, 118, 128, 168, 226, 255, 255, 255]);
  sharedRamp = new THREE.DataTexture(data, data.length, 1, THREE.RedFormat);
  sharedRamp.minFilter = sharedRamp.magFilter = THREE.NearestFilter;
  sharedRamp.generateMipmaps = false;
  sharedRamp.needsUpdate = true;
  return sharedRamp;
}

const toonPars = /* glsl */`
varying vec3 vViewPosition;
uniform float toonSpec;
uniform float toonShine;
struct ToonMaterial { vec3 diffuseColor; };
void RE_Direct_Toon( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in ToonMaterial material, inout ReflectedLight reflectedLight ) {
  vec3 irradiance = getGradientIrradiance( geometryNormal, directLight.direction ) * directLight.color;
  reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
  if ( toonSpec > 0.0 ) {
    vec3 h = normalize( directLight.direction + geometryViewDir );
    float s = pow( max( dot( geometryNormal, h ), 0.0 ), toonShine );
    s = smoothstep( 0.42, 0.5, s );
    reflectedLight.directDiffuse += directLight.color * s * toonSpec * 0.32;
  }
}
void RE_IndirectDiffuse_Toon( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in ToonMaterial material, inout ReflectedLight reflectedLight ) {
  reflectedLight.indirectDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
#define RE_Direct RE_Direct_Toon
#define RE_IndirectDiffuse RE_IndirectDiffuse_Toon
`;

/**
 * Toon material with optional stepped specular (metal/lacquer) and rim light.
 * spec: 0..1 strength of a hard-edged highlight; shine: highlight tightness.
 * rim: strength of a back-lit edge band; rimColor tints it.
 */
export function toon(color, {spec = 0, shine = 40, rim = 0.18, rimColor = 0xfff1d6, map = null, emissiveMap = null, side = THREE.FrontSide, transparent = false, opacity = 1, emissive = 0x000000, emissiveIntensity = 1, vertexColors = false} = {}) {
  const material = new THREE.MeshToonMaterial({color, gradientMap: toonRamp(), map, emissiveMap, side, transparent, opacity, emissive, emissiveIntensity, vertexColors});
  material.userData.toon = {spec, shine, rim};
  const uniforms = {
    toonSpec: {value: spec},
    toonShine: {value: shine},
    toonRim: {value: rim},
    toonRimColor: {value: new THREE.Color(rimColor)},
  };
  material.userData.uniforms = uniforms;
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, uniforms);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <lights_toon_pars_fragment>', toonPars)
      .replace('void main() {', 'uniform float toonRim;\nuniform vec3 toonRimColor;\nvoid main() {')
      .replace('#include <aomap_fragment>', `#include <aomap_fragment>
  {
    float facing = saturate( dot( normal, normalize( vViewPosition ) ) );
    float rimBand = smoothstep( 0.68, 0.74, 1.0 - facing );
    float lit = clamp( dot( reflectedLight.directDiffuse, vec3( 0.333 ) ) * 1.6, 0.0, 1.0 );
    totalEmissiveRadiance += toonRimColor * rimBand * toonRim * ( 0.35 + 0.65 * lit );
  }`);
  };
  material.customProgramCacheKey = () => 'ink-toon-v1';
  return material;
}

/** Flat, unlit-looking material for painted surfaces that should stay bright. */
export function paint(color, options = {}) {
  return new THREE.MeshBasicMaterial({color, ...options});
}

// ---------------------------------------------------------------------------
// Outline pass: renders view-space normals + depth for layer 0, then darkens
// the colour buffer where depth (1/z Laplacian) or normals change sharply.
class InkOutlinePass extends Pass {
  constructor(scene, camera) {
    super();
    this.scene = scene;
    this.camera = camera;
    this.normalMaterial = new THREE.MeshNormalMaterial({side: THREE.DoubleSide});
    this.target = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.UnsignedByteType,
      depthTexture: new THREE.DepthTexture(1, 1),
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
    });
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: {value: null},
        tNormal: {value: null},
        tDepth: {value: null},
        texel: {value: new THREE.Vector2()},
        thickness: {value: 1.0},
        cameraNear: {value: 0.1},
        cameraFar: {value: 100},
        lineColor: {value: new THREE.Color(0x3a2418)},
        lineAlpha: {value: 0.78},
        fadeFar: {value: 1600},
      },
      vertexShader: /* glsl */`varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: /* glsl */`
        #include <packing>
        uniform sampler2D tDiffuse; uniform sampler2D tNormal; uniform sampler2D tDepth;
        uniform vec2 texel; uniform float thickness; uniform float cameraNear; uniform float cameraFar;
        uniform vec3 lineColor; uniform float lineAlpha; uniform float fadeFar;
        varying vec2 vUv;
        float viewZ(vec2 uv){ return -perspectiveDepthToViewZ(texture2D(tDepth, uv).x, cameraNear, cameraFar); }
        vec3 nrm(vec2 uv){ return texture2D(tNormal, uv).xyz * 2.0 - 1.0; }
        void main(){
          vec4 base = texture2D(tDiffuse, vUv);
          float raw = texture2D(tDepth, vUv).x;
          vec2 ox = vec2(texel.x * thickness, 0.0), oy = vec2(0.0, texel.y * thickness);
          float z0 = viewZ(vUv);
          float zl = viewZ(vUv - ox), zr = viewZ(vUv + ox), zd = viewZ(vUv - oy), zu = viewZ(vUv + oy);
          // 1/z is affine across planar surfaces in screen space, so its Laplacian
          // is ~0 on flat or grazing faces and large at silhouettes/creases.
          float i0 = 1.0 / z0;
          float lap = abs(1.0/zl + 1.0/zr - 2.0*i0) + abs(1.0/zd + 1.0/zu - 2.0*i0);
          float depthEdge = smoothstep(0.035, 0.09, lap / i0);
          // Silhouettes against empty space (sky / cleared pixels).
          float far0 = step(0.99999, raw);
          float farN = step(0.99999, texture2D(tDepth, vUv-ox).x) + step(0.99999, texture2D(tDepth, vUv+ox).x) + step(0.99999, texture2D(tDepth, vUv-oy).x) + step(0.99999, texture2D(tDepth, vUv+oy).x);
          float skyEdge = (1.0 - far0) * step(0.5, farN);
          vec3 n0 = nrm(vUv);
          float nd = max(max(1.0 - dot(n0, nrm(vUv-ox)), 1.0 - dot(n0, nrm(vUv+ox))), max(1.0 - dot(n0, nrm(vUv-oy)), 1.0 - dot(n0, nrm(vUv+oy))));
          float normalEdge = smoothstep(0.22, 0.42, nd) * (1.0 - far0);
          float edge = max(max(depthEdge * (1.0 - far0), normalEdge), skyEdge);
          // Lines thin out with distance: full strength in the room, light on the street, none far away.
          edge *= mix(1.0, 0.45, smoothstep(40.0, 420.0, z0)) * (1.0 - smoothstep(fadeFar * 0.6, fadeFar, z0));
          base.rgb = mix(base.rgb, lineColor * (0.55 + 0.45 * base.rgb), edge * lineAlpha);
          gl_FragColor = base;
        }`,
    });
    this.quad = new FullScreenQuad(this.material);
  }
  setSize(width, height) {
    this.target.setSize(width, height);
    this.material.uniforms.texel.value.set(1 / width, 1 / height);
  }
  render(renderer, writeBuffer, readBuffer) {
    const {scene, camera} = this;
    const previous = {
      override: scene.overrideMaterial,
      background: scene.background,
      fog: scene.fog,
      mask: camera.layers.mask,
      clear: renderer.getClearColor(new THREE.Color()),
      alpha: renderer.getClearAlpha(),
      shadow: renderer.shadowMap.autoUpdate,
    };
    scene.overrideMaterial = this.normalMaterial;
    scene.background = null;
    scene.fog = null;
    camera.layers.set(0);
    renderer.shadowMap.autoUpdate = false;
    renderer.setClearColor(0x8080ff, 1);
    renderer.setRenderTarget(this.target);
    renderer.clear();
    renderer.render(scene, camera);
    scene.overrideMaterial = previous.override;
    scene.background = previous.background;
    scene.fog = previous.fog;
    camera.layers.mask = previous.mask;
    renderer.shadowMap.autoUpdate = previous.shadow;
    renderer.setClearColor(previous.clear, previous.alpha);

    const u = this.material.uniforms;
    u.tDiffuse.value = readBuffer.texture;
    u.tNormal.value = this.target.texture;
    u.tDepth.value = this.target.depthTexture;
    u.cameraNear.value = camera.near;
    u.cameraFar.value = camera.far;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quad.render(renderer);
  }
  dispose() {
    this.target.dispose();
    this.normalMaterial.dispose();
    this.material.dispose();
    this.quad.dispose();
  }
}

const GradeShader = {
  uniforms: {
    tDiffuse: {value: null},
    time: {value: 0},
    grain: {value: 0.035},
    vignette: {value: 0.32},
    warmth: {value: 0.06},
    resolution: {value: new THREE.Vector2(1, 1)},
  },
  vertexShader: /* glsl */`varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse; uniform float time; uniform float grain; uniform float vignette; uniform float warmth; uniform vec2 resolution;
    varying vec2 vUv;
    float hash(vec2 p){ p = fract(p * vec2(443.897, 441.423)); p += dot(p, p.yx + 19.19); return fract((p.x + p.y) * p.x); }
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      // Gentle lofi grade: lifted blacks, warm highlights, slightly faded.
      c.rgb = mix(vec3(0.045, 0.035, 0.05), vec3(1.0), c.rgb);
      c.rgb += vec3(warmth, warmth * 0.45, -warmth * 0.4) * smoothstep(0.35, 1.0, dot(c.rgb, vec3(0.333)));
      vec2 q = vUv - 0.5; q.x *= resolution.x / resolution.y;
      c.rgb *= 1.0 - vignette * smoothstep(0.35, 1.05, length(q));
      float n = hash(floor(vUv * resolution / 1.5) + fract(time * 7.13) * 91.7) - 0.5;
      c.rgb += n * grain;
      gl_FragColor = vec4(clamp(c.rgb, 0.0, 1.0), 1.0);
    }`,
};

export class ToonPipeline {
  constructor(renderer, scene, camera) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const target = new THREE.WebGLRenderTarget(size.x, size.y, {type: THREE.HalfFloatType, samples: 4});
    this.composer = new EffectComposer(renderer, target);
    this.renderPass = new RenderPass(scene, camera);
    this.outline = new InkOutlinePass(scene, camera);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.38, 0.6, 1.05);
    this.output = new OutputPass();
    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.renderPass);
    this.composer.addPass(this.outline);
    this.composer.addPass(this.bloom);
    this.composer.addPass(this.output);
    this.composer.addPass(this.grade);
  }
  setSize(width, height, pixelRatio) {
    this.composer.setPixelRatio(pixelRatio);
    this.composer.setSize(width, height);
    this.grade.uniforms.resolution.value.set(width * pixelRatio, height * pixelRatio);
    this.outline.material.uniforms.thickness.value = Math.max(1, pixelRatio * 0.9);
  }
  setQuality(level) {
    this.bloom.enabled = level !== 'low';
    this.grade.uniforms.grain.value = level === 'low' ? 0 : 0.035;
  }
  setLineColor(color, alpha) {
    this.outline.material.uniforms.lineColor.value.set(color);
    if (alpha !== undefined) this.outline.material.uniforms.lineAlpha.value = alpha;
  }
  render(time) {
    this.grade.uniforms.time.value = time;
    this.composer.render();
  }
  dispose() {
    this.outline.dispose();
    this.bloom.dispose();
    this.composer.dispose();
  }
}
