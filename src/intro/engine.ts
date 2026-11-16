import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

import {
  CRYSTAL_COUNT,
  T_BOOM,
  T_LOGO,
  VIDEO_SOURCES,
} from "./config";
import { DEG, clamp, lerp, smoothstep, easeInOutCubic, mulberry32 } from "./math";
import { cameraAt, cameraAngle, ringCrossing } from "./timeline";
import {
  SCREEN_SHAPES,
  buildCrystal,
  buildDebrisGeometry,
  buildScreen,
  buildTerrain,
  buildWorldStructures,
  terrainSafeHeight,
} from "./geometry";
import {
  FinalShader,
  G,
  makeBaseGlowMaterial,
  makeBeamMaterial,
  makeBurst,
  makeCharge,
  makeCoreMaterial,
  makeEmbers,
  makeGlowTexture,
  makeGold,
  makeLogoMaterial,
  makeRaysMaterial,
  makeRingMaterial,
  makeScreenMaterial,
  makeShellMaterial,
  makeSky,
} from "./shaders";
import { buildLogo } from "./logo";
import { makePlaceholderTexture, makeVideoTexture } from "./placeholder";

const CORE_Y = 4.3;
const BASE_Y = -0.2;

interface CrystalObj {
  group: THREE.Group;
  px: number;
  pz: number;
  ry: number;
  H: number;
  riseT: number;
  screenT: number;
  out: THREE.Vector2;
  spin: THREE.Vector3;
  gold: { uReveal: { value: number }; uBaseGlow: { value: number } };
  screen: { uOn: { value: number }; uFlick: { value: number } };
  beam: THREE.Mesh;
  beamU: { uPower: { value: number } };
  glow: THREE.Mesh;
  glowU: { uPower: { value: number } };
  video?: HTMLVideoElement;
  videoStarted?: boolean;
}

export class IntroEngine {
  private renderer!: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(46, 1, 0.15, 2600);
  private composer!: EffectComposer;
  private bloom!: UnrealBloomPass;
  private finalPass!: ShaderPass;
  private raf = 0;
  private t = 0;
  private last = 0;
  private startAt: number;
  private disposed = false;
  private pix = 1;

  private sky!: ReturnType<typeof makeSky>;
  private skyMesh!: THREE.Mesh;
  private crystals: CrystalObj[] = [];
  private embers!: THREE.Points;
  private chargePts!: THREE.Points;
  private burst!: ReturnType<typeof makeBurst>;
  private burstPts!: THREE.Points;
  private core!: ReturnType<typeof makeCoreMaterial>;
  private coreMesh!: THREE.Mesh;
  private coreSprite!: THREE.Sprite;
  private shell!: ReturnType<typeof makeShellMaterial>;
  private shellMesh!: THREE.Mesh;
  private rings: { mesh: THREE.Mesh; m: ReturnType<typeof makeRingMaterial>; delay: number }[] = [];
  private debris!: THREE.InstancedMesh;
  private debrisData: { dir: THREE.Vector3; speed: number; spin: THREE.Vector3; rate: number; s: number }[] = [];
  private logo!: THREE.Group;
  private logoMat!: ReturnType<typeof makeLogoMaterial>;
  private logoArc!: ReturnType<typeof buildLogo>["arcU"];
  private raysMesh!: THREE.Mesh;
  private rays!: ReturnType<typeof makeRaysMaterial>;
  private logoGlow!: THREE.Sprite;
  private pointLight!: THREE.PointLight;
  private disposables: { dispose(): void }[] = [];
  private worldMats: { mat: THREE.MeshStandardMaterial; base: number }[] = [];
  private onTime?: (t: number) => void;
  private dummy = new THREE.Object3D();
  private resizeHandler = () => this.resize();
  private container: HTMLElement;

  constructor(container: HTMLElement, opts: { startAt?: number; onTime?: (t: number) => void } = {}) {
    this.container = container;
    this.startAt = opts.startAt ?? 0;
    this.t = this.startAt;
    this.onTime = opts.onTime;

    this.renderer = new THREE.WebGLRenderer({
      antialias: false,
      powerPreference: "high-performance",
      alpha: false,
    });
    this.pix = Math.min(window.devicePixelRatio || 1, 1.75);
    this.renderer.setPixelRatio(this.pix);
    this.renderer.setClearColor(0x000000, 1);
    this.renderer.toneMapping = THREE.NoToneMapping;
    container.appendChild(this.renderer.domElement);
    this.renderer.domElement.style.display = "block";
    this.renderer.domElement.style.width = "100%";
    this.renderer.domElement.style.height = "100%";

    const env = this.buildEnvironment();
    this.buildScene(env);
    this.buildPost();
    this.resize();
    window.addEventListener("resize", this.resizeHandler);

    this.last = performance.now();
    this.update(this.t);
    this.loop();
  }

  // ───────────────────────── окружение (HDR отражения) ─────────────────────────
  private buildEnvironment() {
    const pm = new THREE.PMREMGenerator(this.renderer);
    const s = new THREE.Scene();
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(60, 48, 24),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        vertexShader: `varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: `varying vec3 vP; void main(){
          float h = normalize(vP).y;
          vec3 c = mix(vec3(0.015,0.006,0.002), vec3(0.10,0.042,0.010), smoothstep(-0.3, 1.0, h));
          c += vec3(0.5,0.2,0.04) * exp(-abs(h) * 7.0) * 0.5;
          gl_FragColor = vec4(c, 1.0);
        }`,
      })
    );
    s.add(dome);
    const panel = (w: number, h: number, az: number, el: number, dist: number, rgb: number[], k: number) => {
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(w, h),
        new THREE.MeshBasicMaterial({ color: new THREE.Color(rgb[0] * k, rgb[1] * k, rgb[2] * k), side: THREE.DoubleSide })
      );
      m.position.set(
        Math.cos(az * DEG) * Math.cos(el * DEG) * dist,
        Math.sin(el * DEG) * dist,
        Math.sin(az * DEG) * Math.cos(el * DEG) * dist
      );
      m.lookAt(0, 0, 0);
      s.add(m);
    };
    panel(60, 60, 0, 88, 40, [1, 0.8, 0.5], 2.2); // верхний софтбокс
    [
      [0, 6, 7, 1.0],
      [62, 10, 2.2, 0.9],
      [118, 4, 6, 1.1],
      [190, 12, 1.8, 0.8],
      [250, 6, 4.5, 1.0],
      [310, 14, 3, 0.9],
    ].forEach(([az, el, k, w]) => panel(5 * w, 46, az, el, 42, [1, 0.72, 0.35], k));
    panel(14, 8, 215, 28, 40, [1, 0.9, 0.7], 14); // яркий «солнечный» блик
    panel(10, 6, 40, 20, 40, [1, 0.8, 0.5], 9);

    const rt = pm.fromScene(s, 0.02);
    pm.dispose();
    this.disposables.push(rt);
    return rt.texture;
  }

  // ───────────────────────────── сцена ─────────────────────────────
  private buildScene(env: THREE.Texture) {
    const scene = this.scene;
    scene.background = new THREE.Color(0x000000);
    scene.fog = new THREE.FogExp2(new THREE.Color(0.2, 0.082, 0.011), 0.0049);

    // небо
    this.sky = makeSky();
    this.skyMesh = new THREE.Mesh(new THREE.SphereGeometry(1500, 48, 24), this.sky.mat);
    this.skyMesh.renderOrder = -10;
    this.skyMesh.frustumCulled = false;
    scene.add(this.skyMesh);

    // рельеф
    const terrainGeo = buildTerrain();
    const terrain = makeGold("terrain", env, { roughness: 0.34, envI: 0.55 });
    this.worldMats.push({ mat: terrain.mat, base: terrain.mat.envMapIntensity });
    const tm = new THREE.Mesh(terrainGeo, terrain.mat);
    tm.frustumCulled = false;
    scene.add(tm);

    // башни и осколки
    const cross = ringCrossing(15.5);
    const { towers, shards } = buildWorldStructures(cross.angle);
    const towerMat = makeGold("sink", env, { baseGlow: 0.55, roughness: 0.26, envI: 0.9 });
    this.worldMats.push({ mat: towerMat.mat, base: towerMat.mat.envMapIntensity });
    const towerMesh = new THREE.Mesh(towers, towerMat.mat);
    towerMesh.frustumCulled = false;
    scene.add(towerMesh);
    const shardMat = makeGold("sink", env, { baseGlow: 0.9, roughness: 0.28, envI: 0.9 });
    this.worldMats.push({ mat: shardMat.mat, base: shardMat.mat.envMapIntensity });
    const shardMesh = new THREE.Mesh(shards, shardMat.mat);
    shardMesh.frustumCulled = false;
    scene.add(shardMesh);

    // 10 кристаллов-плейсхолдеров
    this.buildCrystals(env, cross.angle);

    // эмберы (искры в воздухе)
    this.buildEmbers();

    // ядро и взрыв
    this.buildExplosion(env);

    // логотип
    this.buildLogoScene(env);

    // свет ядра
    this.pointLight = new THREE.PointLight(0xffb040, 0, 0, 2);
    this.pointLight.position.set(0, CORE_Y, 0);
    scene.add(this.pointLight);
  }

  private buildCrystals(env: THREE.Texture, crossAngle: number) {
    const aniso = this.renderer.capabilities.getMaxAnisotropy();
    const glowGeo = new THREE.PlaneGeometry(15, 15).rotateX(-Math.PI / 2);
    const beamGeo = new THREE.CylinderGeometry(1.5, 3.7, 17, 28, 1, true).translate(0, 8.5, 0);

    // порядок «вырастания»: по углу относительно камеры в момент начала облёта
    const camStart = cameraAngle(9);
    const orders: { i: number; k: number }[] = [];
    const thetas: number[] = [];
    for (let i = 0; i < CRYSTAL_COUNT; i++) {
      const rnd = mulberry32(300 + i * 7);
      const th = crossAngle + 18 * DEG + (i * 360 * DEG) / CRYSTAL_COUNT + (rnd() - 0.5) * 5 * DEG;
      thetas.push(th);
      let d = th - camStart;
      d = ((d % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
      orders.push({ i, k: d });
    }
    orders.sort((a, b) => a.k - b.k);
    const rankOf: number[] = [];
    orders.forEach((o, rank) => (rankOf[o.i] = rank));

    for (let i = 0; i < CRYSTAL_COUNT; i++) {
      const rand = mulberry32(100 + i * 13);
      const th = thetas[i];
      const R = 15.4 + 1.1 * Math.sin(i * 2.1);
      const px = Math.cos(th) * R;
      const pz = Math.sin(th) * R;
      const H = 8.4 + rand() * 3.2;

      const main = buildCrystal(rand, {
        sides: 5 + (i % 2),
        w: 3.7 + rand() * 1.0,
        d: 2.3 + rand() * 0.8,
        h: H,
        taper: 0.56 + rand() * 0.16,
        apex: 1.3 + rand() * 1.5,
        lean: [(rand() - 0.5) * 1.2, (rand() - 0.5) * 1.2],
        apexOff: [(rand() - 0.5) * 1.4, (rand() - 0.5) * 1.4],
      });
      const parts: THREE.BufferGeometry[] = [main.geo];

      // сопутствующие кристаллы у основания (за гранью-экраном)
      const n = main.front.normal;
      const frontAng = Math.atan2(n.x, n.z);
      const sats = 3 + Math.floor(rand() * 2);
      for (let s = 0; s < sats; s++) {
        const sh = H * (0.28 + rand() * 0.38);
        const sat = buildCrystal(rand, {
          sides: 5,
          w: 1.2 + rand() * 1.1,
          d: 1.1 + rand() * 0.9,
          h: sh,
          taper: 0.3 + rand() * 0.25,
          apex: 0.8 + rand() * 1.4,
          apexOff: [(rand() - 0.5) * 0.8, (rand() - 0.5) * 0.8],
        });
        const a = frontAng + Math.PI + (rand() - 0.5) * 2.6;
        const dist = 1.9 + rand() * 1.4;
        const dx = Math.sin(a);
        const dz = Math.cos(a);
        const tilt = 0.08 + rand() * 0.22;
        const m = new THREE.Matrix4().compose(
          new THREE.Vector3(dx * dist, -0.1, dz * dist),
          new THREE.Quaternion().setFromEuler(new THREE.Euler(dz * tilt, rand() * 6.28, -dx * tilt, "YXZ")),
          new THREE.Vector3(1, 1, 1)
        );
        sat.geo.applyMatrix4(m);
        parts.push(sat.geo);
      }
      const bodyGeo = mergeGeometries(parts, false)!;
      const gold = makeGold("struct", env, { baseGlow: 0.7, roughness: 0.22, envI: 1.1 });
      const body = new THREE.Mesh(bodyGeo, gold.mat);
      body.frustumCulled = false;

      // экран
      const shape = SCREEN_SHAPES[i % SCREEN_SHAPES.length];
      const scr = buildScreen(main.front, shape);
      const src = VIDEO_SOURCES[i] ?? null;
      let tex: THREE.Texture;
      let video: HTMLVideoElement | undefined;
      if (src) {
        const v = makeVideoTexture(src, aniso);
        tex = v.tex;
        video = v.video;
      } else {
        tex = makePlaceholderTexture(i, scr.aspect, shape, aniso);
      }
      this.disposables.push(tex);
      const sm = makeScreenMaterial(tex, i, !!src);
      const screenMesh = new THREE.Mesh(scr.geo, sm.mat);
      screenMesh.frustumCulled = false;

      const group = new THREE.Group();
      group.add(body);
      group.add(screenMesh);
      group.position.set(px, BASE_Y, pz);
      const toC = Math.atan2(-px, -pz);
      const ry = toC - frontAng + (rand() - 0.5) * 0.4;
      group.rotation.y = ry;
      group.visible = false;
      this.scene.add(group);

      // свечение у основания и световой столб
      const gl = makeBaseGlowMaterial();
      const glow = new THREE.Mesh(glowGeo, gl.mat);
      glow.position.set(px, 0.08, pz);
      glow.frustumCulled = false;
      glow.visible = false;
      this.scene.add(glow);

      const bm = makeBeamMaterial();
      const beam = new THREE.Mesh(beamGeo, bm.mat);
      beam.position.set(px, 0, pz);
      beam.frustumCulled = false;
      beam.visible = false;
      this.scene.add(beam);

      // время включения экрана — когда камера подлетает к кристаллу
      let screenT = 18;
      for (let t = 16.8; t < 30; t += 0.02) {
        let d = cameraAngle(t) + 34 * DEG - th;
        d = ((d + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
        if (d >= 0) {
          screenT = t - 1.9;
          break;
        }
      }
      const riseT = 7.2 + rankOf[i] * 0.62;
      screenT = Math.max(screenT, riseT + 3.2);

      this.crystals.push({
        group,
        px,
        pz,
        ry,
        H,
        riseT,
        screenT,
        out: new THREE.Vector2(px, pz).normalize(),
        spin: new THREE.Vector3((rand() - 0.5) * 3, (rand() - 0.5) * 4, (rand() - 0.5) * 3),
        gold: gold.u,
        screen: sm.u,
        beam,
        beamU: bm.u,
        glow,
        glowU: gl.u,
        video,
      });
    }
  }

  private buildEmbers() {
    const rand = mulberry32(5);
    const count = 5200;
    const pos = new Float32Array(count * 3);
    const seed = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
      const wide = i > 2600;
      const r = (wide ? 150 : 46) * Math.sqrt(rand());
      const a = rand() * Math.PI * 2;
      pos[i * 3] = Math.cos(a) * r;
      pos[i * 3 + 1] = rand() * 46;
      pos[i * 3 + 2] = Math.sin(a) * r;
      seed[i * 4] = rand();
      seed[i * 4 + 1] = rand();
      seed[i * 4 + 2] = rand();
      seed[i * 4 + 3] = rand();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("aSeed", new THREE.BufferAttribute(seed, 4));
    this.embers = new THREE.Points(g, makeEmbers(this.pix));
    this.embers.frustumCulled = false;
    this.scene.add(this.embers);
  }

  private buildExplosion(env: THREE.Texture) {
    const rand = mulberry32(77);
    const glowTex = makeGlowTexture();
    this.disposables.push(glowTex);

    // заряд: частицы летят к центру
    {
      const count = 900;
      const pos = new Float32Array(count * 3);
      const seed = new Float32Array(count * 4);
      for (let i = 0; i < count; i++) {
        const u = rand() * 2 - 1;
        const a = rand() * Math.PI * 2;
        const s = Math.sqrt(1 - u * u);
        const r = 5 + Math.pow(rand(), 0.7) * 32;
        pos[i * 3] = Math.cos(a) * s * r;
        pos[i * 3 + 1] = u * r * 0.55;
        pos[i * 3 + 2] = Math.sin(a) * s * r;
        for (let k = 0; k < 4; k++) seed[i * 4 + k] = rand();
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      g.setAttribute("aSeed", new THREE.BufferAttribute(seed, 4));
      this.chargePts = new THREE.Points(g, makeCharge(this.pix));
      this.chargePts.frustumCulled = false;
      this.scene.add(this.chargePts);
    }

    // ядро
    this.core = makeCoreMaterial();
    this.coreMesh = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 32), this.core.mat);
    this.coreMesh.position.set(0, CORE_Y, 0);
    this.coreMesh.visible = false;
    this.scene.add(this.coreMesh);

    this.coreSprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: glowTex,
        color: new THREE.Color(1, 0.7, 0.3),
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        transparent: true,
        fog: false,
      })
    );
    this.coreSprite.position.set(0, CORE_Y, 0);
    this.coreSprite.visible = false;
    this.scene.add(this.coreSprite);

    // ударные оболочки
    this.shell = makeShellMaterial();
    this.shellMesh = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 40), this.shell.mat);
    this.shellMesh.position.set(0, CORE_Y, 0);
    this.shellMesh.visible = false;
    this.shellMesh.frustumCulled = false;
    this.scene.add(this.shellMesh);

    const ringGeo = new THREE.PlaneGeometry(440, 440).rotateX(-Math.PI / 2);
    [0, 0.38].forEach((delay) => {
      const m = makeRingMaterial();
      const mesh = new THREE.Mesh(ringGeo, m.mat);
      mesh.position.y = 1.4;
      mesh.visible = false;
      mesh.frustumCulled = false;
      this.scene.add(mesh);
      this.rings.push({ mesh, m, delay });
    });

    // искры взрыва
    {
      const count = 6500;
      const pos = new Float32Array(count * 3);
      const vel = new Float32Array(count * 3);
      const seed = new Float32Array(count * 4);
      for (let i = 0; i < count; i++) {
        const u = rand() * 2 - 1;
        const a = rand() * Math.PI * 2;
        const s = Math.sqrt(1 - u * u);
        const sp = 4 + Math.pow(rand(), 0.55) * 52;
        vel[i * 3] = Math.cos(a) * s * sp;
        vel[i * 3 + 1] = (u * 0.8 + 0.12) * sp;
        vel[i * 3 + 2] = Math.sin(a) * s * sp;
        for (let k = 0; k < 4; k++) seed[i * 4 + k] = rand();
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      g.setAttribute("aVel", new THREE.BufferAttribute(vel, 3));
      g.setAttribute("aSeed", new THREE.BufferAttribute(seed, 4));
      this.burst = makeBurst(this.pix);
      this.burstPts = new THREE.Points(g, this.burst.mat);
      this.burstPts.frustumCulled = false;
      this.burstPts.visible = false;
      this.scene.add(this.burstPts);
    }

    // осколки (физика по формуле от времени)
    {
      const count = 280;
      const mat = makeGold("struct", env, { baseGlow: 0, roughness: 0.2, envI: 2 });
      this.debris = new THREE.InstancedMesh(buildDebrisGeometry(), mat.mat, count);
      this.debris.frustumCulled = false;
      this.debris.visible = false;
      for (let i = 0; i < count; i++) {
        const u = rand() * 2 - 1;
        const a = rand() * Math.PI * 2;
        const s = Math.sqrt(1 - u * u);
        this.debrisData.push({
          dir: new THREE.Vector3(Math.cos(a) * s, u * 0.7 + 0.25, Math.sin(a) * s).normalize(),
          speed: 8 + Math.pow(rand(), 0.8) * 46,
          spin: new THREE.Vector3(rand() - 0.5, rand() - 0.5, rand() - 0.5).normalize(),
          rate: 1 + rand() * 7,
          s: 0.5 + Math.pow(rand(), 2) * 2.4,
        });
      }
      this.scene.add(this.debris);
    }
  }

  private buildLogoScene(env: THREE.Texture) {
    this.logoMat = makeLogoMaterial(env);
    const { group, arcU } = buildLogo(this.logoMat.mat);
    this.logoArc = arcU;
    this.logo = group;
    this.logo.position.set(0, 6.2, 0);
    this.logo.scale.setScalar(1.55);
    this.logo.visible = false;
    this.scene.add(this.logo);

    this.rays = makeRaysMaterial();
    this.raysMesh = new THREE.Mesh(new THREE.PlaneGeometry(34, 34), this.rays.mat);
    this.raysMesh.position.set(0, CORE_Y + 0.2, -1.4);
    this.raysMesh.visible = false;
    this.scene.add(this.raysMesh);

    const gt = makeGlowTexture();
    this.disposables.push(gt);
    this.logoGlow = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: gt,
        color: new THREE.Color(1, 0.6, 0.2),
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        transparent: true,
        fog: false,
      })
    );
    this.logoGlow.position.set(0, CORE_Y + 0.3, -1.0);
    this.logoGlow.scale.setScalar(22);
    this.logoGlow.visible = false;
    this.scene.add(this.logoGlow);
  }

  // ───────────────────────────── пост-процесс ─────────────────────────────
  private buildPost() {
    const rt = new THREE.WebGLRenderTarget(4, 4, {
      type: THREE.HalfFloatType,
      samples: 4,
    });
    this.composer = new EffectComposer(this.renderer, rt);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.5, 0.6, 1.0);
    this.composer.addPass(this.bloom);
    this.finalPass = new ShaderPass(
      new THREE.ShaderMaterial({
        uniforms: FinalShader.uniforms,
        vertexShader: FinalShader.vertexShader,
        fragmentShader: FinalShader.fragmentShader,
      })
    );
    this.composer.addPass(this.finalPass);
  }

  private resize() {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.composer.setPixelRatio(this.pix);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    FinalShader.uniforms.uRes.value.set(w * this.pix, h * this.pix);
  }

  // ───────────────────────────── кадр ─────────────────────────────
  private loop = () => {
    if (this.disposed) return;
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    this.t += dt;
    this.update(this.t);
    this.composer.render();
    this.onTime?.(this.t);
    this.raf = requestAnimationFrame(this.loop);
  };

  seek(t: number) {
    this.t = t;
    this.crystals.forEach((c) => (c.videoStarted = false));
  }

  restart() {
    this.seek(0);
  }

  get time() {
    return this.t;
  }

  private update(t: number) {
    const q = t - T_BOOM;
    G.uTime.value = t;

    // ─── камера ───
    const cs = cameraAt(t);
    let [px, py, pz] = cs.p;
    py = Math.max(py, terrainSafeHeight(px, pz) + 1.8);
    const shakeAmp =
      0.035 +
      0.05 * smoothstep(25, T_BOOM, t) +
      (q > 0 ? 0.9 * Math.exp(-q * 2.6) : 0);
    const sx = Math.sin(t * 13.1) * 0.6 + Math.sin(t * 31.7 + 1.3) * 0.4;
    const sy = Math.sin(t * 11.3 + 2.0) * 0.6 + Math.sin(t * 27.9) * 0.4;
    const sz = Math.sin(t * 9.7 + 4.0) * 0.6 + Math.sin(t * 23.3 + 0.6) * 0.4;
    this.camera.fov = cs.fov;
    this.camera.updateProjectionMatrix();
    this.camera.position.set(px + sx * shakeAmp * 0.6, py + sy * shakeAmp * 0.6, pz + sz * shakeAmp * 0.6);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(cs.l[0], cs.l[1], cs.l[2]);
    this.camera.rotateZ(cs.roll + sz * shakeAmp * 0.012);
    this.camera.rotateX(sy * shakeAmp * 0.006);
    this.skyMesh.position.copy(this.camera.position);

    // ─── фазы взрыва ───
    const charge = q < 0 ? smoothstep(22.5, T_BOOM - 0.2, t) : 0;
    const flash = q < 0 ? smoothstep(-0.5, 0, q) * 0.92 : Math.exp(-q * 3.6);
    G.uCharge.value = charge;
    G.uShockR.value = q > 0 ? q * 50 : 0;
    G.uShockA.value = q > 0 ? 2.6 * Math.exp(-q * 0.55) : 0;
    G.uEdge.value =
      (0.2 + 0.8 * smoothstep(0, 5.5, t)) * (q > 0 ? 1 - 0.7 * smoothstep(0.8, 4.0, q) : 1) *
      (1 + (q < 0 ? charge * 0.6 : 0));
    this.sky.u.uBoom.value = q < 0 ? charge * 0.25 : 1.2 * Math.exp(-q * 1.5);

    // ─── кристаллы ───
    const pulse = 0.5 + 0.5 * Math.sin(t * 2.2);
    for (let i = 0; i < this.crystals.length; i++) {
      const c = this.crystals[i];
      const p = clamp((t - c.riseT) / 2.8);
      const visible = p > 0 && !(q > 7);
      c.group.visible = visible;
      c.beam.visible = visible;
      c.glow.visible = visible;
      if (!visible) continue;
      const e = 1 - Math.pow(2, -9 * p);
      const y = BASE_Y - (c.H + 2.5) * (1 - e);
      c.group.rotation.set(0, c.ry + (1 - e) * 0.7, 0);
      c.group.position.set(c.px, y, c.pz);
      c.group.scale.setScalar(1);
      c.gold.uReveal.value = smoothstep(0.0, 0.9, p);
      c.gold.uBaseGlow.value = smoothstep(0.05, 0.6, p) * (0.85 + 0.3 * pulse) * (1 + charge * 1.4);
      const flare = Math.exp(-Math.pow((t - c.riseT - 0.8) / 0.55, 2)) * 2.2;
      let glowP = smoothstep(0, 0.4, p) * (0.8 + flare) * (1 + charge * 1.2);
      let beamP = smoothstep(0.25, 1, p) * (0.8 + charge * 1.0) * (0.7 + 0.3 * pulse);
      c.screen.uOn.value = clamp((t - c.screenT) / 1.15);
      c.screen.uFlick.value = (0.95 + 0.05 * Math.sin(t * 40 + i * 3)) * (1 + charge * 0.6);

      if (q > 0) {
        const ease = 1 - Math.exp(-q * 1.5);
        const dist = 34 + i * 2.5;
        c.group.position.set(
          c.px + c.out.x * ease * dist,
          y + ease * (9 + i * 0.9) - 2.2 * q * q,
          c.pz + c.out.y * ease * dist
        );
        c.group.rotation.set(q * c.spin.x, c.ry + q * c.spin.y, q * c.spin.z);
        c.group.scale.setScalar(Math.max(0.001, 1 - Math.max(0, q - 1.2) * 0.32));
        c.screen.uOn.value = clamp(1 - q * 2.4);
        c.screen.uFlick.value = 1 + 3 * Math.exp(-q * 8);
        const f = Math.exp(-q * 2.6);
        glowP *= f;
        beamP *= f;
      }
      c.glowU.uPower.value = glowP;
      c.beamU.uPower.value = beamP;

      if (c.video && !c.videoStarted && c.screen.uOn.value > 0.01) {
        c.videoStarted = true;
        c.video.currentTime = 0;
        c.video.play().catch(() => undefined);
      }
    }

    // ─── затемнение мира после взрыва ───
    const dim = q > 0 ? smoothstep(0.4, 3.5, q) : 0;
    this.worldMats.forEach((w) => (w.mat.envMapIntensity = w.base * (1 - 0.7 * dim)));

    // ─── эмберы ───
    (this.embers.material as THREE.ShaderMaterial).uniforms.uInt.value =
      smoothstep(0, 3, t) * (1 + (q > 0 ? 0.8 * Math.exp(-q * 0.4) : 0));

    // ─── ядро ───
    const coreOn = t > 24.2 && q < 3.2;
    this.coreMesh.visible = coreOn;
    this.coreSprite.visible = t > 24.2 && q < 4.5;
    if (coreOn) {
      if (q < 0) {
        const k = smoothstep(24.2, T_BOOM, t);
        this.coreMesh.scale.setScalar(0.05 + 1.5 * k * k);
        this.core.u.uPower.value = 0.2 + 1.8 * k;
      } else {
        const r = 1.55 + 16 * (1 - Math.exp(-q * 3.6));
        this.coreMesh.scale.setScalar(r);
        this.core.u.uPower.value = 3.0 * Math.exp(-q * 2.6);
      }
    }
    if (this.coreSprite.visible) {
      const k = smoothstep(24.2, T_BOOM, t);
      const s = q < 0 ? 2 + 14 * k * k : 16 + 40 * (1 - Math.exp(-q * 2)) ;
      this.coreSprite.scale.setScalar(s);
      const pw = q < 0 ? 0.3 + 1.7 * k : 2.2 * Math.exp(-q * 1.6);
      this.coreSprite.material.color.setRGB(1.0 * pw, 0.72 * pw, 0.32 * pw);
    }
    this.pointLight.intensity = q < 0 ? 900 * charge * charge : 6000 * Math.exp(-q * 2.2);

    // ─── ударные волны ───
    this.shellMesh.visible = q > 0 && q < 5;
    if (this.shellMesh.visible) {
      this.shellMesh.scale.setScalar(3 + 95 * (1 - Math.exp(-q * 1.35)));
      this.shell.u.uPower.value = 1.5 * Math.exp(-q * 1.4);
    }
    this.rings.forEach((r) => {
      const qq = q - r.delay;
      r.mesh.visible = qq > 0 && qq < 5.2;
      if (r.mesh.visible) {
        r.m.u.uR.value = qq * 50;
        r.m.u.uPower.value = smoothstep(0, 0.06, qq) * (r.delay > 0 ? 0.6 : 1);
        r.mesh.position.y = 1.3;
      }
    });

    // ─── искры ───
    this.burstPts.visible = q > 0 && q < 8;
    this.burst.u.uT.value = q;

    // ─── осколки ───
    this.debris.visible = q > 0 && q < 9;
    if (this.debris.visible) {
      for (let i = 0; i < this.debrisData.length; i++) {
        const d = this.debrisData[i];
        const dd = 1.1;
        const dist = d.speed * (1 - Math.exp(-dd * q)) / dd;
        this.dummy.position.set(
          d.dir.x * dist,
          CORE_Y + d.dir.y * dist - 0.5 * 5 * q * q,
          d.dir.z * dist
        );
        this.dummy.quaternion.setFromAxisAngle(d.spin, q * d.rate);
        this.dummy.scale.setScalar(d.s * clamp(1 - (q - 3.5) / 5));
        this.dummy.updateMatrix();
        this.debris.setMatrixAt(i, this.dummy.matrix);
      }
      this.debris.instanceMatrix.needsUpdate = true;
    }

    // ─── логотип ───
    const lq = t - T_LOGO;
    this.logo.visible = lq > 0;
    this.raysMesh.visible = lq > 0.3;
    this.logoGlow.visible = lq > 0.0;
    if (this.logo.visible) {
      const wp = easeInOutCubic(lq / 3.4);
      this.logoMat.u.uWipe.value = lerp(2.0, -4.4, wp);
      this.logoMat.u.uGlow.value = 0.18 + 0.1 * Math.sin(t * 1.4) + 1.2 * Math.exp(-Math.pow((lq - 3.4) / 0.5, 2));
      this.logoArc.uP.value = easeInOutCubic((lq - 1.5) / 2.6);
      const settle = smoothstep(0, 2.5, lq);
      this.logo.rotation.y = Math.sin(t * 0.55) * 0.3 * settle + (1 - settle) * 0.9;
      this.logo.rotation.x = Math.sin(t * 0.43) * 0.05 * settle;
      this.logo.scale.setScalar(1.55 * (1 + 0.1 * Math.exp(-lq * 1.8)));
      this.rays.u.uPower.value = smoothstep(0.4, 3.2, lq) * (0.55 + 0.1 * Math.sin(t * 1.2));
      const gp = smoothstep(0, 2.5, lq) * (0.38 + 0.05 * Math.sin(t * 1.7));
      this.logoGlow.material.color.setRGB(1.0 * gp, 0.6 * gp, 0.2 * gp);
    }

    // ─── финальный проход ───
    const U = FinalShader.uniforms;
    const dPhase = smoothstep(26, T_BOOM, t);
    U.uFlash.value = flash;
    U.uAberr.value = 0.0007 + 0.004 * dPhase + 0.012 * flash;
    U.uZoom.value = q < 0 ? 0.1 * smoothstep(27.2, T_BOOM - 0.1, t) : 0.28 * Math.exp(-q * 3.0);
    U.uExposure.value = (q > 0 ? 1 - 0.15 * smoothstep(0.5, 4, q) : 1) * 0.85;
    U.uFade.value = Math.pow(smoothstep(0, 2.6, t), 1.4);
    U.uVig.value = 0.55 + 0.15 * dPhase + 0.25 * dim;
    U.uStreak.value = 0.1 + 0.4 * flash;
    this.bloom.strength = 0.42 + 1.5 * flash + 0.25 * charge;
    this.bloom.radius = 0.6;
    this.bloom.threshold = 1.0;
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    window.removeEventListener("resize", this.resizeHandler);
    this.crystals.forEach((c) => c.video?.pause());
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else mat?.dispose();
    });
    this.disposables.forEach((d) => d.dispose());
    this.composer.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
