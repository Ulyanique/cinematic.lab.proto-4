import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

import {
  CRYSTAL_COUNT,
  T_BOOM,
  VIDEO_SOURCES,
} from "./config";
import { DEG, clamp, smoothstep, mulberry32 } from "./math";
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
  makeFinalShader,
  G,
  makeBaseGlowMaterial,
  makeBeamMaterial,
  makeBurst,
  makeCharge,
  makeCoreMaterial,
  makeEmbers,
  makeGlowTexture,
  makeGold,
  makeRingMaterial,
  makeScreenMaterial,
  makeShellMaterial,
  makeSky,
} from "./shaders";
import { LogoInstance } from "./logoLayer";
import type { Config, Layer, LayerTypeId, Settings } from "./schema";
import { Pass } from "three/examples/jsm/postprocessing/Pass.js";
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
  rank: number;
  screenBase: number;
  screenMesh: THREE.Mesh;
  screenMat: THREE.ShaderMaterial;
  aspect: number;
  shape: [number, number][];
  src: string | null;
}

export class IntroEngine {
  private renderer!: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(46, 1, 0.5, 2600);
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
  private pointLight!: THREE.PointLight;
  private disposables: { dispose(): void }[] = [];
  private worldMats: { mat: THREE.MeshStandardMaterial; base: number }[] = [];
  private onTime?: (t: number, playing: boolean) => void;
  private dummy = new THREE.Object3D();
  private resizeHandler = () => this.resize();
  private container: HTMLElement;

  private getCfg: () => Config;
  private lastCfg: Config | null = null;
  private layerMap: Partial<Record<LayerTypeId, Layer>> = {};
  private groups: Record<"world" | "crystals" | "particles" | "explosion", THREE.Group> = {
    world: new THREE.Group(),
    crystals: new THREE.Group(),
    particles: new THREE.Group(),
    explosion: new THREE.Group(),
  };
  private logos = new Map<string, { inst: LogoInstance; grp: THREE.Group; layer: Layer }>();
  private worldMeshes: THREE.Mesh[] = [];
  private env!: THREE.Texture;
  private glowTex!: THREE.Texture;
  private fin!: ReturnType<typeof makeFinalShader>;
  private fogColorKey = "";
  private videosKey = "\u0000";
  private dprCap = 1.75;
  private paused = false;
  private ended = false;
  private resizeDirty = true;
  onEnd?: () => void;

  constructor(
    container: HTMLElement,
    opts: { startAt?: number; getCfg: () => Config; onTime?: (t: number, playing: boolean) => void; paused?: boolean }
  ) {
    this.container = container;
    this.getCfg = opts.getCfg;
    const g0 = this.getCfg().g;
    this.startAt = opts.startAt ?? g0.startAt ?? 0;
    this.t = this.startAt;
    this.onTime = opts.onTime;
    this.paused = opts.paused ?? !g0.autoplay;

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: "high-performance",
      alpha: false,
    });
    this.dprCap = g0.pixelRatio;
    this.pix = Math.min(window.devicePixelRatio || 1, this.dprCap);
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
    // утилизируем временную сцену окружения (купол + 9 панелей)
    s.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.geometry.dispose();
        const mat = m.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mat)) mat.forEach((x) => (x as any).dispose());
        else (mat as any)?.dispose();
      }
    });
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
    this.worldMeshes.push(tm);

    // башни и осколки
    const cross = ringCrossing(15.5);
    const { towers, shards } = buildWorldStructures(cross.angle);
    const towerMat = makeGold("sink", env, { baseGlow: 0.55, roughness: 0.26, envI: 0.9 });
    this.worldMats.push({ mat: towerMat.mat, base: towerMat.mat.envMapIntensity });
    const towerMesh = new THREE.Mesh(towers, towerMat.mat);
    towerMesh.frustumCulled = false;
    scene.add(towerMesh);
    this.worldMeshes.push(towerMesh);
    const shardMat = makeGold("sink", env, { baseGlow: 0.9, roughness: 0.28, envI: 0.9 });
    this.worldMats.push({ mat: shardMat.mat, base: shardMat.mat.envMapIntensity });
    const shardMesh = new THREE.Mesh(shards, shardMat.mat);
    shardMesh.frustumCulled = false;
    scene.add(shardMesh);
    this.worldMeshes.push(shardMesh);

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
      glow.position.set(px, 0.15, pz);
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

      this.crystals.push({
        group,
        px,
        pz,
        ry,
        H,
        riseT,
        screenT: screenT,
        screenBase: screenT,
        rank: rankOf[i],
        screenMesh,
        screenMat: sm.mat,
        aspect: scr.aspect,
        shape,
        src: src,
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
    this.env = env;
    this.glowTex = makeGlowTexture();
    this.disposables.push(this.glowTex);
    this.assignGroups();
  }

  // ───────────────────────────── слои ─────────────────────────────
  private assignGroups() {
    const G3 = this.groups;
    this.scene.add(G3.world, G3.crystals, G3.particles, G3.explosion);
    G3.world.add(this.skyMesh, ...this.worldMeshes);
    this.crystals.forEach((c) => G3.crystals.add(c.group, c.beam, c.glow));
    G3.particles.add(this.embers, this.chargePts);
    G3.explosion.add(this.coreMesh, this.coreSprite, this.shellMesh, ...this.rings.map((r) => r.mesh), this.burstPts, this.debris);
    Object.values(G3).forEach((g) => (g.userData = { on: false, overlay: false }));
  }

  private tag(grp: THREE.Group, order: number) {
    grp.traverse((o) => {
      o.renderOrder = order;
    });
  }

  private sets(type: LayerTypeId): Settings | null {
    const l = this.layerMap[type];
    return l && l.on ? l.s : null;
  }

  private index(cfg: Config) {
    this.lastCfg = cfg;
    this.layerMap = {};
    (Object.values(this.groups) as THREE.Group[]).forEach((g) => (g.userData = { on: false, overlay: false }));
    const N = cfg.layers.length;
    const seen = new Set<string>();
    cfg.layers.forEach((L, i) => {
      const order = (N - i) * 10 + (L.s.overlay ? 10000 : 0);
      if (L.type === "logo") {
        seen.add(L.id);
        let e = this.logos.get(L.id);
        if (!e) {
          const inst = new LogoInstance(this.env, this.glowTex);
          const grp = new THREE.Group();
          grp.add(inst.root);
          this.scene.add(grp);
          e = { inst, grp, layer: L };
          this.logos.set(L.id, e);
        }
        e.layer = L;
        e.grp.userData = { on: L.on, overlay: !!L.s.overlay };
        this.tag(e.grp, order);
      } else if (L.type in this.groups && !this.layerMap[L.type]) {
        this.layerMap[L.type] = L;
        const grp = this.groups[L.type as keyof typeof this.groups];
        grp.userData = { on: L.on, overlay: !!L.s.overlay };
        this.tag(grp, order);
      }
    });
    for (const [id, e] of this.logos) {
      if (!seen.has(id)) {
        this.scene.remove(e.grp);
        e.inst.dispose();
        this.logos.delete(id);
      }
    }
  }

  /** Рендер стека 3D-слоёв: один проход, порядок через renderOrder (overlay-слои — выше) */
  renderStack(renderer: THREE.WebGLRenderer, target: THREE.WebGLRenderTarget) {
    const ac = renderer.autoClear;
    renderer.autoClear = false;
    renderer.setRenderTarget(target);
    renderer.setClearColor(0x000000, 1);
    renderer.clear(true, true, true);
    const all: THREE.Group[] = [...Object.values(this.groups), ...[...this.logos.values()].map((e) => e.grp)];
    for (const g of all) g.visible = !!g.userData.on;
    renderer.render(this.scene, this.camera);
    renderer.autoClear = ac;
  }

  // ───────────────────────────── пост-процесс ─────────────────────────────
  private buildPost() {
    const rt = new THREE.WebGLRenderTarget(4, 4, {
      type: THREE.HalfFloatType,
    });
    this.composer = new EffectComposer(this.renderer, rt);
    this.composer.addPass(new StackPass(this));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.5, 0.6, 1.0);
    this.composer.addPass(this.bloom);
    this.fin = makeFinalShader();
    this.finalPass = new ShaderPass(
      new THREE.ShaderMaterial({
        uniforms: this.fin.uniforms,
        vertexShader: this.fin.vertexShader,
        fragmentShader: this.fin.fragmentShader,
      })
    );
    this.composer.addPass(this.finalPass);
  }

  private applyPix() {
    this.pix = Math.min(window.devicePixelRatio || 1, this.dprCap);
    this.renderer.setPixelRatio(this.pix);
    [this.embers.material, this.chargePts.material, this.burst.mat].forEach((m) => {
      const u = (m as THREE.ShaderMaterial).uniforms;
      if (u.uPix) u.uPix.value = this.pix;
    });
    this.resize();
  }

  private resize() {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.composer.setPixelRatio(this.pix);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.fin.uniforms.uRes.value.set(w * this.pix, h * this.pix);
    this.resizeDirty = true;
  }

  // ───────────────────────────── кадр / время ─────────────────────────────
  private lastT = -1;
  private lastRenderedCfg: Config | null = null;

  private loop = () => {
    if (this.disposed) return;
    const now = performance.now();
    const rdt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    const cfg = this.getCfg();
    if (!this.paused) {
      this.t += rdt * cfg.g.speed;
      if (cfg.g.loop && this.t >= cfg.g.duration) this.seek(cfg.g.startAt);
      if (!this.ended && this.t >= cfg.g.duration) {
        this.ended = true;
        this.onEnd?.();
      }
    }
    if (!this.paused || cfg !== this.lastRenderedCfg || this.t !== this.lastT || this.resizeDirty) {
      this.lastRenderedCfg = cfg;
      this.lastT = this.t;
      this.resizeDirty = false;
      this.update(this.t);
      this.composer.render();
      this.onTime?.(this.t, !this.paused);
    }
    this.raf = requestAnimationFrame(this.loop);
  };

  seek(t: number) {
    this.t = Math.max(0, t);
    this.ended = false;
    this.crystals.forEach((c) => {
      c.videoStarted = false;
      if (c.video) c.video.pause();
    });
  }

  restart() {
    this.seek(this.getCfg().g.startAt);
    this.paused = false;
  }

  play() {
    this.paused = false;
  }
  pause() {
    this.paused = true;
    this.crystals.forEach((c) => c.video?.pause());
    this.crystals.forEach((c) => (c.videoStarted = false));
  }
  toggle() {
    if (this.paused) this.play();
    else this.pause();
  }

  get time() {
    return this.t;
  }
  get playing() {
    return !this.paused;
  }

  private applyVideos(text: string) {
    const lines = text.split(/\r?\n/).map((l) => l.trim());
    const aniso = this.renderer.capabilities.getMaxAnisotropy();
    this.crystals.forEach((c, i) => {
      const url = lines[i] || null;
      if (url === c.src) return;
      c.video?.pause();
      c.video?.remove();
      c.video = undefined;
      // утилизируем старую текстуру экрана
      const oldTex = c.screenMat.uniforms.uTex.value;
      if (oldTex && oldTex.isTexture) oldTex.dispose();
      let tex: THREE.Texture;
      if (url) {
        const v = makeVideoTexture(url, aniso);
        tex = v.tex;
        c.video = v.video;
      } else {
        tex = makePlaceholderTexture(i, c.aspect, c.shape, aniso);
      }
      this.disposables.push(tex);
      c.screenMat.uniforms.uTex.value = tex;
      c.screenMat.uniforms.uVideo.value = url ? 1 : 0;
      c.videoStarted = false;
      c.src = url;
    });
  }

  private update(t: number) {
    const cfg = this.getCfg();
    if (cfg !== this.lastCfg) this.index(cfg);
    const g = cfg.g;
    const W = this.sets("world");
    const CR = this.sets("crystals");
    const PA = this.sets("particles");
    const EX = this.sets("explosion");
    const exOn = !!EX;
    if (g.pixelRatio !== this.dprCap) {
      this.dprCap = g.pixelRatio;
      this.applyPix();
    }

    const q = t - T_BOOM;
    const qc = exOn ? q : Math.min(q, 0);
    G.uTime.value = t;

    // ─── камера ───
    const cs = cameraAt(t);
    let [px, py, pz] = cs.p;
    const safe = terrainSafeHeight(px, pz);
    py = Math.max(Math.max(py, safe + 1.8) + g.heightAdd, safe + 0.9);
    const shakeAmp =
      (0.035 + 0.05 * smoothstep(25, T_BOOM, t) + (q > 0 && EX ? 0.9 * Math.exp(-q * 2.6) * EX.camShake : 0)) * g.shake;
    const sx = Math.sin(t * 13.1) * 0.6 + Math.sin(t * 31.7 + 1.3) * 0.4;
    const sy = Math.sin(t * 11.3 + 2.0) * 0.6 + Math.sin(t * 27.9) * 0.4;
    const sz = Math.sin(t * 9.7 + 4.0) * 0.6 + Math.sin(t * 23.3 + 0.6) * 0.4;
    const nfov = clamp(cs.fov + g.fovAdd, 8, 130);
    if (this.camera.fov !== nfov) {
      this.camera.fov = nfov;
      this.camera.updateProjectionMatrix();
    }
    this.camera.position.set(px + sx * shakeAmp * 0.6, py + sy * shakeAmp * 0.6, pz + sz * shakeAmp * 0.6);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(cs.l[0], cs.l[1], cs.l[2]);
    this.camera.rotateZ(cs.roll * g.roll + sz * shakeAmp * 0.012);
    this.camera.rotateX(sy * shakeAmp * 0.006);
    this.skyMesh.position.copy(this.camera.position);

    // ─── мир ───
    if (W) {
      const fog = this.scene.fog as THREE.FogExp2;
      fog.density = W.fogDensity;
      if (this.fogColorKey !== W.fogColor) {
        this.fogColorKey = W.fogColor;
        fog.color.set(W.fogColor);
      }
    }
    this.sky.u.uBright.value = W ? W.skyBright : 1;

    // ─── фазы взрыва ───
    const charge = q < 0 ? smoothstep(22.5, T_BOOM - 0.2, t) : 0;
    const flash = EX ? (q < 0 ? smoothstep(-0.5, 0, q) * 0.92 : Math.exp(-q * 3.6)) * EX.flash : 0;
    G.uCharge.value = charge;
    G.uShockR.value = q > 0 ? q * 50 : 0;
    G.uShockA.value = (q > 0 && exOn ? 2.6 * Math.exp(-q * 0.55) : 0) * (W ? W.shock : 1);
    G.uEdge.value =
      (0.2 + 0.8 * smoothstep(0, 5.5, t)) * (qc > 0 ? 1 - 0.7 * smoothstep(0.8, 4.0, qc) : 1) *
      (1 + (q < 0 ? charge * 0.6 : 0)) * (W ? W.edge : 1);
    this.sky.u.uBoom.value = exOn ? (q < 0 ? charge * 0.25 : 1.2 * Math.exp(-q * 1.5)) : 0;

    // ─── кристаллы ───
    if (CR && CR.videos !== this.videosKey) {
      this.videosKey = CR.videos;
      this.applyVideos(CR.videos);
    }
    const pulse = 0.5 + 0.5 * Math.sin(t * 2.2);
    if (CR) {
      for (let i = 0; i < this.crystals.length; i++) {
        const c = this.crystals[i];
        const riseT = 7.2 + c.rank * CR.riseGap + CR.riseShift;
        const screenT = Math.max(c.screenBase + CR.riseShift, riseT + CR.riseDur + 0.4);
        const p = clamp((t - riseT) / CR.riseDur);
        const visible = p > 0 && !(qc > 7);
        c.group.visible = visible;
        c.beam.visible = visible;
        c.glow.visible = visible;
        c.screenMesh.visible = !!CR.screens;
        if (!visible) continue;
        const e = 1 - Math.pow(2, -9 * p);
        const y = BASE_Y - (c.H + 2.5) * (1 - e);
        c.group.rotation.set(0, c.ry + (1 - e) * 0.7, 0);
        c.group.position.set(c.px, y, c.pz);
        c.group.scale.setScalar(CR.scale);
        c.gold.uReveal.value = smoothstep(0.0, 0.9, p);
        c.gold.uBaseGlow.value = smoothstep(0.05, 0.6, p) * (0.85 + 0.3 * pulse) * (1 + charge * 1.4) * CR.baseGlow;
        const flare = Math.exp(-Math.pow((t - riseT - 0.8) / 0.55, 2)) * 2.2;
        let glowP = smoothstep(0, 0.4, p) * (0.8 + flare) * (1 + charge * 1.2) * CR.glow;
        let beamP = smoothstep(0.25, 1, p) * (0.8 + charge * 1.0) * (0.7 + 0.3 * pulse) * CR.beam;
        c.screen.uOn.value = clamp((t - screenT) / 1.15);
        c.screen.uFlick.value = (0.95 + 0.05 * Math.sin(t * 40 + i * 3)) * (1 + charge * 0.6) * CR.screenBright;

        if (qc > 0) {
          const ease = 1 - Math.exp(-qc * 1.5);
          const dist = 34 + i * 2.5;
          c.group.position.set(
            c.px + c.out.x * ease * dist,
            y + ease * (9 + i * 0.9) - 2.2 * qc * qc,
            c.pz + c.out.y * ease * dist
          );
          c.group.rotation.set(qc * c.spin.x, c.ry + qc * c.spin.y, qc * c.spin.z);
          c.group.scale.setScalar(Math.max(0.001, 1 - Math.max(0, qc - 1.2) * 0.32) * CR.scale);
          c.screen.uOn.value = clamp(1 - qc * 2.4);
          c.screen.uFlick.value = (1 + 3 * Math.exp(-qc * 8)) * CR.screenBright;
          const f = Math.exp(-qc * 2.6);
          glowP *= f;
          beamP *= f;
        }
        c.glowU.uPower.value = glowP;
        c.beamU.uPower.value = beamP;

        if (c.video && !c.videoStarted && c.screen.uOn.value > 0.01 && !this.paused) {
          c.videoStarted = true;
          c.video.currentTime = 0;
          c.video.play().catch(() => undefined);
        }
      }
    }

    // ─── затемнение мира после взрыва ───
    const dim = q > 0 && exOn ? smoothstep(0.4, 3.5, q) : 0;
    const envK = W ? W.env : 1;
    this.worldMats.forEach((w) => (w.mat.envMapIntensity = w.base * envK * (1 - 0.7 * dim)));

    // ─── частицы ───
    const embU = (this.embers.material as THREE.ShaderMaterial).uniforms;
    embU.uInt.value = PA ? smoothstep(0, 3, t) * (1 + (q > 0 ? 0.8 * Math.exp(-q * 0.4) : 0)) * PA.embers : 0;
    embU.uSize.value = PA ? PA.emberSize : 70;
    (this.chargePts.material as THREE.ShaderMaterial).uniforms.uInt.value = PA ? PA.charge : 0;

    // ─── взрыв ───
    const ex = EX ?? { core: 1, light: 0, wave: 0, sparks: 0, debris: false, debrisSize: 1, zoomBlur: 1 };
    const coreOn = exOn && t > 24.2 && q < 3.2;
    this.coreMesh.visible = coreOn;
    this.coreSprite.visible = exOn && t > 24.2 && q < 4.5;
    if (coreOn) {
      if (q < 0) {
        const k = smoothstep(24.2, T_BOOM, t);
        this.coreMesh.scale.setScalar((0.05 + 1.5 * k * k) * ex.core);
        this.core.u.uPower.value = 0.2 + 1.8 * k;
      } else {
        const r = 1.55 + 16 * (1 - Math.exp(-q * 3.6));
        this.coreMesh.scale.setScalar(r * ex.core);
        this.core.u.uPower.value = 3.0 * Math.exp(-q * 2.6);
      }
    }
    if (this.coreSprite.visible) {
      const k = smoothstep(24.2, T_BOOM, t);
      const s = q < 0 ? 2 + 14 * k * k : 16 + 40 * (1 - Math.exp(-q * 2));
      this.coreSprite.scale.setScalar(s * ex.core);
      const pw = q < 0 ? 0.3 + 1.7 * k : 2.2 * Math.exp(-q * 1.6);
      this.coreSprite.material.color.setRGB(1.0 * pw, 0.72 * pw, 0.32 * pw);
    }
    this.pointLight.intensity = (q < 0 ? 900 * charge * charge : 6000 * Math.exp(-q * 2.2)) * ex.light;

    this.shellMesh.visible = exOn && q > 0 && q < 5;
    if (this.shellMesh.visible) {
      this.shellMesh.scale.setScalar(3 + 95 * (1 - Math.exp(-q * 1.35)));
      this.shell.u.uPower.value = 1.5 * Math.exp(-q * 1.4) * ex.wave;
    }
    this.rings.forEach((r) => {
      const qq = q - r.delay;
      r.mesh.visible = exOn && qq > 0 && qq < 5.2;
      if (r.mesh.visible) {
        r.m.u.uR.value = qq * 50;
        r.m.u.uPower.value = smoothstep(0, 0.06, qq) * (r.delay > 0 ? 0.6 : 1) * ex.wave;
        r.mesh.position.y = 1.3;
      }
    });

    this.burstPts.visible = exOn && q > 0 && q < 8 && ex.sparks > 0;
    this.burst.u.uT.value = q;
    this.burst.u.uInt.value = ex.sparks;

    this.debris.visible = exOn && ex.debris && q > 0 && q < 9;
    if (this.debris.visible) {
      for (let i = 0; i < this.debrisData.length; i++) {
        const d = this.debrisData[i];
        const dd = 1.1;
        const dist = (d.speed * (1 - Math.exp(-dd * q))) / dd;
        this.dummy.position.set(d.dir.x * dist, CORE_Y + d.dir.y * dist - 0.5 * 5 * q * q, d.dir.z * dist);
        this.dummy.quaternion.setFromAxisAngle(d.spin, q * d.rate);
        this.dummy.scale.setScalar(d.s * clamp(1 - (q - 3.5) / 5) * ex.debrisSize);
        this.dummy.updateMatrix();
        this.debris.setMatrixAt(i, this.dummy.matrix);
      }
      this.debris.instanceMatrix.needsUpdate = true;
    }

    // ─── логотипы ───
    for (const e of this.logos.values()) if (e.layer.on) e.inst.update(t, e.layer.s);

    // ─── финальный проход ───
    const U = this.fin.uniforms;
    const dPhase = smoothstep(26, T_BOOM, t);
    U.uFlash.value = flash;
    if (EX && this.flashKey !== EX.flashColor) {
      this.flashKey = EX.flashColor;
      const c = new THREE.Color(EX.flashColor);
      U.uFlashCol.value.set(c.r, c.g, c.b);
    }
    U.uAberr.value = (0.0007 + 0.004 * dPhase + 0.012 * flash) * g.aberration;
    U.uZoom.value = q < 0 ? 0.1 * smoothstep(27.2, T_BOOM - 0.1, t) * ex.zoomBlur : 0.28 * Math.exp(-q * 3.0) * (exOn ? ex.zoomBlur : 0);
    U.uExposure.value = (q > 0 && exOn ? 1 - 0.15 * smoothstep(0.5, 4, q) : 1) * 0.85 * g.exposure;
    const fadeOut = g.fadeOut > 0 ? 1 - smoothstep(g.duration - g.fadeOut, g.duration, t) : 1;
    U.uFade.value = Math.pow(smoothstep(0, Math.max(0.01, g.fadeIn), t), 1.4) * fadeOut;
    U.uVig.value = (0.55 + 0.15 * dPhase + 0.25 * dim) * g.vignette;
    U.uStreak.value = (0.1 + 0.4 * flash) * g.streak;
    U.uHue.value = g.hue * DEG;
    U.uSat.value = g.saturation;
    U.uContrast.value = g.contrast;
    U.uTintAmt.value = g.tintAmount;
    if (this.tintKey !== g.tint) {
      this.tintKey = g.tint;
      const c = new THREE.Color(g.tint);
      U.uTint.value.set(c.r, c.g, c.b);
    }
    U.uGrain.value = g.grain;
    this.bloom.strength = (0.42 + 1.5 * flash + 0.25 * charge) * g.bloom;
    this.bloom.radius = g.bloomRadius;
    this.bloom.threshold = g.bloomThreshold;
  }

  private flashKey = "";
  private tintKey = "";

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    window.removeEventListener("resize", this.resizeHandler);
    this.crystals.forEach((c) => c.video?.pause());
    this.logos.forEach((e) => e.inst.dispose());
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((x) => (x as any).dispose());
      else (mat as any)?.dispose();
    });
    this.disposables.forEach((d) => d.dispose());
    this.composer.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
  }
}

class StackPass extends Pass {
  private eng: IntroEngine;
  constructor(eng: IntroEngine) {
    super();
    this.eng = eng;
    this.needsSwap = false;
  }
  render(renderer: THREE.WebGLRenderer, _write: THREE.WebGLRenderTarget, read: THREE.WebGLRenderTarget) {
    this.eng.renderStack(renderer, read);
  }
}
