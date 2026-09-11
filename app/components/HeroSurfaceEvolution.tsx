"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";

export type SurfaceMode = 0 | 1 | 2 | 3 | null;
type Props = { className?: string; mode: SurfaceMode };
type StageRig = { root: THREE.Group; update: (time: number, focus: number) => void };
type SurfaceSample = { point: THREE.Vector3; normal: THREE.Vector3 };
type CellBatch = { mesh: THREE.InstancedMesh; material: THREE.MeshPhysicalMaterial; total: number };

const CROWN_URL = "/models/demo.stl";
const AQUA = new THREE.Color(0x32bda9);
const AQUA_PALE = new THREE.Color(0xc9fff4);
const SIGNAL = new THREE.Color(0xff684c);
const PORCELAIN = new THREE.Color(0xf5f5ed);
const STAGE_X = [-4.58, -1.53, 1.53, 4.58];
const TEXTURE_COLORS = [0x36b8a5, 0xe46d57, 0xd0a641, 0x6f82bf, 0x579eaf];

function prepareCrownGeometry(source: THREE.BufferGeometry) {
  const geometry = source.clone();
  geometry.computeVertexNormals();
  geometry.center();
  geometry.computeBoundingBox();
  const size = new THREE.Vector3();
  geometry.boundingBox?.getSize(size);
  const scale = 1.82 / Math.max(size.x, size.y, size.z, 0.001);
  geometry.scale(scale, scale, scale);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function createPorcelainMaterial(opacity = 1) {
  return new THREE.MeshPhysicalMaterial({
    color: PORCELAIN,
    roughness: 0.21,
    metalness: 0.012,
    clearcoat: 0.92,
    clearcoatRoughness: 0.15,
    sheen: 0.14,
    sheenColor: new THREE.Color(0xc9efe5),
    transparent: opacity < 1,
    opacity,
    side: THREE.DoubleSide,
  });
}

function createMetal(color: number, roughness = 0.23) {
  return new THREE.MeshPhysicalMaterial({ color, roughness, metalness: 0.7, clearcoat: 0.38, clearcoatRoughness: 0.2 });
}

function createPointGeometry(source: THREE.BufferGeometry, target = 6200) {
  const position = source.getAttribute("position") as THREE.BufferAttribute;
  const stride = Math.max(1, Math.floor(position.count / target));
  const values: number[] = [];
  for (let index = 0; index < position.count; index += stride) values.push(position.getX(index), position.getY(index), position.getZ(index));
  return new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute(values, 3));
}

function orientToNormal(object: THREE.Object3D, normal: THREE.Vector3, localAxis = new THREE.Vector3(0, 0, 1)) {
  object.quaternion.setFromUnitVectors(localAxis, normal.clone().normalize());
}

function createCrownSampler(geometry: THREE.BufferGeometry) {
  const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  const helper = new THREE.Mesh(geometry, material);
  helper.updateMatrixWorld(true);
  const bounds = geometry.boundingBox ?? new THREE.Box3().setFromBufferAttribute(geometry.getAttribute("position") as THREE.BufferAttribute);
  const center = new THREE.Vector3();
  const size = new THREE.Vector3();
  bounds.getCenter(center);
  bounds.getSize(size);
  const raycaster = new THREE.Raycaster();
  const resolve = (origin: THREE.Vector3, direction: THREE.Vector3, fallback: THREE.Vector3): SurfaceSample => {
    raycaster.set(origin, direction.clone().normalize());
    const hit = raycaster.intersectObject(helper, false)[0];
    if (!hit) return { point: fallback, normal: direction.clone().negate().normalize() };
    return { point: hit.point.clone(), normal: hit.face?.normal.clone().normalize() ?? direction.clone().negate().normalize() };
  };
  return {
    bounds,
    center,
    size,
    top(u: number, v: number, lift = 0) {
      const x = center.x + u * size.x * 0.43;
      const z = center.z + v * size.z * 0.42;
      const sample = resolve(new THREE.Vector3(x, bounds.max.y + size.y, z), new THREE.Vector3(0, -1, 0), new THREE.Vector3(x, bounds.max.y, z));
      sample.point.addScaledVector(sample.normal, lift);
      return sample;
    },
    side(angle: number, height: number, lift = 0) {
      const y = THREE.MathUtils.lerp(bounds.min.y + size.y * 0.38, bounds.max.y - size.y * 0.1, height);
      const radius = Math.max(size.x, size.z) * 1.15;
      const radial = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle));
      const sample = resolve(
        new THREE.Vector3(center.x + radial.x * radius, y, center.z + radial.z * radius),
        radial.clone().negate(),
        new THREE.Vector3(center.x + radial.x * size.x * 0.43, y, center.z + radial.z * size.z * 0.43),
      );
      sample.point.addScaledVector(sample.normal, lift);
      return sample;
    },
    dispose() { material.dispose(); },
  };
}

function createTube(samples: SurfaceSample[], material: THREE.Material, radius = 0.01) {
  const curve = new THREE.CatmullRomCurve3(samples.map((sample) => sample.point), false, "centripetal", 0.24);
  return { curve, mesh: new THREE.Mesh(new THREE.TubeGeometry(curve, Math.max(18, samples.length * 7), radius, 7, false), material) };
}

function createReliefMaterial(color: number) {
  return new THREE.ShaderMaterial({
    uniforms: { uGrow: { value: 0 }, uFocus: { value: 0 }, uColor: { value: new THREE.Color(color) } },
    transparent: true,
    depthWrite: true,
    side: THREE.DoubleSide,
    vertexShader: `varying vec2 vUv;varying vec3 vNormal;varying vec3 vView;void main(){vUv=uv;vNormal=normalize(normalMatrix*normal);vec4 view=modelViewMatrix*vec4(position,1.0);vView=view.xyz;gl_Position=projectionMatrix*view;}`,
    fragmentShader: `
      uniform float uGrow;uniform float uFocus;uniform vec3 uColor;varying vec2 vUv;varying vec3 vNormal;varying vec3 vView;
      void main(){if(vUv.x>uGrow)discard;vec3 lightDir=normalize(vec3(-0.35,0.75,0.8));float diffuse=0.5+max(dot(normalize(vNormal),lightDir),0.0)*0.5;float edge=pow(1.0-max(dot(normalize(vNormal),normalize(-vView)),0.0),2.2);gl_FragColor=vec4(uColor*(diffuse+edge*0.22),0.76+uFocus*0.22);#include <tonemapping_fragment>#include <colorspace_fragment>}
    `,
  });
}

function createScannerPod(scale = 1) {
  const group = new THREE.Group();
  const shell = createMetal(0x203d38, 0.17);
  const trim = createMetal(0x8ca9a3, 0.14);
  const lens = new THREE.MeshPhysicalMaterial({ color: 0xbffff2, roughness: 0.04, transmission: 0.55, thickness: 0.08, transparent: true, opacity: 0.76, emissive: 0x40bfae, emissiveIntensity: 0.42 });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.09, 0.17, 7, 18), shell);
  body.rotation.x = Math.PI / 2;
  const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.084, 0.066, 0.07, 24), trim);
  collar.rotation.x = Math.PI / 2;
  collar.position.z = 0.145;
  const optic = new THREE.Mesh(new THREE.SphereGeometry(0.054, 24, 16), lens);
  optic.scale.z = 0.4;
  optic.position.z = 0.19;
  group.add(body, collar, optic);
  group.scale.setScalar(scale);
  return group;
}

function createCrownScanMaterials(bounds: THREE.Box3) {
  const size = new THREE.Vector3();
  bounds.getSize(size);
  const surface = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uSweep: { value: 0 }, uFocus: { value: 0 }, uMin: { value: bounds.min.clone() }, uSize: { value: size }, uAqua: { value: AQUA_PALE } },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    vertexShader: `varying vec3 vPos;void main(){vPos=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position+normal*0.004,1.0);}`,
    fragmentShader: `
      uniform float uTime;uniform float uSweep;uniform float uFocus;uniform vec3 uMin;uniform vec3 uSize;uniform vec3 uAqua;varying vec3 vPos;
      void main(){vec3 p=(vPos-uMin)/max(uSize,vec3(0.0001));float warped=p.y+sin(p.x*18.0+p.z*9.0+uTime*0.75)*0.018;float core=1.0-smoothstep(0.008,0.028,abs(warped-uSweep));float halo=1.0-smoothstep(0.025,0.12,abs(warped-uSweep));float fringe=0.45+0.55*sin(p.x*54.0+p.z*13.0-uTime*1.4);float acquired=1.0-smoothstep(uSweep-0.1,uSweep+0.04,warped);float alpha=(core*0.75+halo*0.23+acquired*fringe*0.075)*(0.55+uFocus*0.45);gl_FragColor=vec4(mix(uAqua,vec3(1.0),core*0.6),alpha);}
    `,
  });
  const points = new THREE.ShaderMaterial({
    uniforms: { uSweep: { value: 0 }, uFocus: { value: 0 }, uMin: { value: bounds.min.clone() }, uSize: { value: size }, uAqua: { value: AQUA } },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: `uniform float uSweep;uniform float uFocus;uniform vec3 uMin;uniform vec3 uSize;varying float vAlpha;void main(){vec3 p=(position-uMin)/max(uSize,vec3(0.0001));float acquired=1.0-smoothstep(uSweep-0.08,uSweep+0.035,p.y);float front=1.0-smoothstep(0.0,0.075,abs(p.y-uSweep));vAlpha=(acquired*0.22+front*0.95)*(0.5+uFocus*0.5);vec4 mv=modelViewMatrix*vec4(position,1.0);gl_PointSize=(1.05+front*2.7+uFocus*0.45)*(4.4/max(1.0,-mv.z));gl_Position=projectionMatrix*mv;}`,
    fragmentShader: `uniform vec3 uAqua;varying float vAlpha;void main(){float d=1.0-smoothstep(0.1,0.5,length(gl_PointCoord-0.5));gl_FragColor=vec4(uAqua,d*vAlpha);}`,
  });
  return { surface, points };
}

function createCrownScanner(geometry: THREE.BufferGeometry): StageRig {
  const root = new THREE.Group();
  const machine = new THREE.Group();
  root.add(machine);
  const graphite = createMetal(0x213a35, 0.23);
  const alloy = createMetal(0x8da39e, 0.15);
  const pale = createMetal(0xcbd9d5, 0.18);
  const base = new THREE.Mesh(new THREE.BoxGeometry(1.75, 0.16, 1.18), graphite);
  base.position.y = -1;
  base.rotation.y = -0.08;
  const inset = new THREE.Mesh(new THREE.BoxGeometry(1.45, 0.035, 0.92), alloy);
  inset.position.y = -0.9;
  machine.add(base, inset);
  const turntable = new THREE.Group();
  const platter = new THREE.Mesh(new THREE.CylinderGeometry(0.54, 0.58, 0.11, 56), pale);
  platter.position.y = -0.82;
  const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.34, 0.2, 42), graphite);
  pedestal.position.y = -0.71;
  turntable.add(platter, pedestal);
  machine.add(turntable);
  const crownRig = new THREE.Group();
  crownRig.rotation.set(0.08, 0.42, -0.02);
  crownRig.position.y = 0.01;
  turntable.add(crownRig);
  const crown = new THREE.Mesh(geometry, createPorcelainMaterial());
  crown.castShadow = true;
  crownRig.add(crown);
  const scanMaterials = createCrownScanMaterials(geometry.boundingBox!);
  const scanSurface = new THREE.Mesh(geometry, scanMaterials.surface);
  scanSurface.renderOrder = 7;
  const pointCloud = new THREE.Points(createPointGeometry(geometry, 6800), scanMaterials.points);
  pointCloud.scale.setScalar(1.004);
  pointCloud.renderOrder = 8;
  crownRig.add(scanSurface, pointCloud);

  const gantry = new THREE.Group();
  const arch = new THREE.Mesh(new THREE.TorusGeometry(1.02, 0.07, 14, 72, Math.PI), graphite);
  arch.position.y = 0.03;
  gantry.add(arch);
  [-1, 1].forEach((side) => {
    const column = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.98, 0.16), graphite);
    column.position.set(side * 1.02, -0.44, 0);
    const joint = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.2, 24), alloy);
    joint.position.set(side * 1.02, -0.75, 0);
    joint.rotation.x = Math.PI / 2;
    gantry.add(column, joint);
  });
  gantry.position.set(0, 0.52, -0.18);
  machine.add(gantry);
  const carriage = new THREE.Group();
  carriage.add(new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.15, 0.18), graphite));
  const projector = createScannerPod(0.88);
  projector.rotation.x = Math.PI * 0.5;
  projector.position.set(0, -0.18, 0.04);
  carriage.add(projector);
  [-1, 1].forEach((side) => {
    const camera = createScannerPod(0.62);
    camera.position.set(side * 0.2, -0.14, 0.04);
    camera.rotation.set(Math.PI * 0.48, side * 0.15, 0);
    carriage.add(camera);
  });
  carriage.position.set(0, 1.38, 0.48);
  machine.add(carriage);
  const volumeMaterial = new THREE.MeshBasicMaterial({ color: 0x90eee0, transparent: true, opacity: 0.055, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending });
  const scanVolume = new THREE.Mesh(new THREE.ConeGeometry(0.64, 1.34, 4, 1, true), volumeMaterial);
  scanVolume.position.set(0, 0.64, 0.25);
  scanVolume.rotation.y = Math.PI / 4;
  machine.add(scanVolume);
  const planeMaterial = new THREE.MeshBasicMaterial({ color: 0xd7fff7, transparent: true, opacity: 0.28, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending });
  const scanPlane = new THREE.Mesh(new THREE.PlaneGeometry(1.55, 1.16), planeMaterial);
  scanPlane.rotation.x = -Math.PI / 2;
  machine.add(scanPlane);
  const beamLines = new THREE.Group();
  for (let index = -2; index <= 2; index++) {
    const beam = new THREE.Mesh(new THREE.BoxGeometry(1.35, 0.004, 0.008), new THREE.MeshBasicMaterial({ color: index === 0 ? 0xffffff : 0x9ff3e4, transparent: true, opacity: index === 0 ? 0.52 : 0.18, depthWrite: false, blending: THREE.AdditiveBlending }));
    beam.position.z = index * 0.09;
    beamLines.add(beam);
  }
  scanPlane.add(beamLines);
  const bounds = geometry.boundingBox!;
  const size = new THREE.Vector3();
  bounds.getSize(size);
  return {
    root,
    update(time, focus) {
      const sweep = 0.5 + 0.5 * Math.sin(time * (0.55 + focus * 0.23));
      scanMaterials.surface.uniforms.uTime.value = time;
      scanMaterials.surface.uniforms.uSweep.value = sweep;
      scanMaterials.surface.uniforms.uFocus.value = focus;
      scanMaterials.points.uniforms.uSweep.value = sweep;
      scanMaterials.points.uniforms.uFocus.value = focus;
      scanPlane.position.y = bounds.min.y + sweep * size.y + crownRig.position.y;
      planeMaterial.opacity = 0.12 + focus * 0.28 + Math.sin(time * 3.4) * 0.035;
      volumeMaterial.opacity = 0.025 + focus * 0.085;
      carriage.position.x = Math.sin(time * 0.44) * (0.12 + focus * 0.17);
      carriage.rotation.z = Math.sin(time * 0.33) * 0.045;
      turntable.rotation.y = time * (0.055 + focus * 0.09);
      gantry.rotation.y = Math.sin(time * 0.24) * (0.035 + focus * 0.045);
      machine.rotation.y = -0.1 + Math.sin(time * 0.17) * 0.025;
    },
  };
}

function crownDefectShader() {
  return `
    float ellipse2(vec2 p,vec2 c,vec2 r){vec2 q=(p-c)/r;return 1.0-smoothstep(0.72,1.03,dot(q,q)+sin(p.x*41.0+p.y*27.0)*0.07);}
    void defects(vec3 p,float progress,out float a,out float b,out float c,out float ha,out float hb,out float hc){
      a=ellipse2(p.xy,vec2(0.27,0.35),vec2(0.13,0.12))*smoothstep(0.48,0.66,p.z);
      b=ellipse2(p.xy,vec2(0.68,0.58),vec2(0.12,0.11))*smoothstep(0.42,0.62,p.z);
      c=ellipse2(p.zy,vec2(0.37,0.78),vec2(0.14,0.12))*smoothstep(0.57,0.74,p.x);
      ha=smoothstep(0.03,0.34,progress);hb=smoothstep(0.35,0.68,progress);hc=smoothstep(0.69,0.98,progress);
    }
  `;
}

function createReconstructionMaterials(bounds: THREE.Box3) {
  const size = new THREE.Vector3();
  bounds.getSize(size);
  const shared = {
    uProgress: { value: 0 }, uFocus: { value: 0 }, uMin: { value: bounds.min.clone() }, uSize: { value: size },
    uPorcelain: { value: PORCELAIN }, uSignal: { value: SIGNAL }, uAqua: { value: AQUA },
  };
  const shell = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.clone(shared),
    side: THREE.DoubleSide,
    vertexShader: `varying vec3 vPos;varying vec3 vNormal;void main(){vPos=position;vNormal=normalize(normalMatrix*normal);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
    fragmentShader: `
      uniform float uProgress;uniform float uFocus;uniform vec3 uMin;uniform vec3 uSize;uniform vec3 uPorcelain;uniform vec3 uSignal;uniform vec3 uAqua;varying vec3 vPos;varying vec3 vNormal;
      ${crownDefectShader()}
      void main(){
        vec3 p=(vPos-uMin)/max(uSize,vec3(0.0001));float scan=clamp(uProgress/0.31,0.0,1.0);float repair=clamp((uProgress-0.3)/0.49,0.0,1.0);float validation=smoothstep(0.8,0.98,uProgress);
        float a,b,c,ha,hb,hc;defects(p,repair,a,b,c,ha,hb,hc);float open=max(a*(1.0-ha),max(b*(1.0-hb),c*(1.0-hc)));if(open>0.38)discard;
        float lit=0.53+max(dot(normalize(vNormal),normalize(vec3(-0.35,0.78,0.72))),0.0)*0.47;float scanned=1.0-smoothstep(scan-0.02,scan+0.08,p.y);vec3 base=mix(vec3(0.28,0.31,0.3),uPorcelain,scanned);
        float active=max(a*(1.0-abs(ha-0.5)*1.65),max(b*(1.0-abs(hb-0.5)*1.65),c*(1.0-abs(hc-0.5)*1.65)));vec3 color=mix(base*lit,uSignal,active*(0.34+uFocus*0.34));
        float verified=(0.5+0.5*sin(p.y*28.0-uProgress*38.0))*validation*0.12;color=mix(color,uAqua,(a*ha+b*hb+c*hc)*0.16+verified);gl_FragColor=vec4(color,1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
  const patch = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.clone(shared),
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    wireframe: true,
    side: THREE.DoubleSide,
    vertexShader: `varying vec3 vPos;void main(){vPos=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position+normal*0.008,1.0);}`,
    fragmentShader: `uniform float uProgress;uniform vec3 uMin;uniform vec3 uSize;uniform vec3 uAqua;varying vec3 vPos;${crownDefectShader()}void main(){vec3 p=(vPos-uMin)/max(uSize,vec3(0.0001));float repair=clamp((uProgress-0.3)/0.49,0.0,1.0);float a,b,c,ha,hb,hc;defects(p,repair,a,b,c,ha,hb,hc);float fill=max(a*ha,max(b*hb,c*hc));if(fill<0.08)discard;gl_FragColor=vec4(uAqua,fill*0.84);}`,
  });
  return { shell, patch };
}

function createReconstructionStage(geometry: THREE.BufferGeometry): StageRig {
  const root = new THREE.Group();
  const model = new THREE.Group();
  model.rotation.set(0.08, 0.5, -0.025);
  root.add(model);
  const backing = new THREE.Mesh(geometry, new THREE.MeshPhysicalMaterial({ color: 0x333b39, roughness: 0.75, metalness: 0.02, side: THREE.DoubleSide }));
  backing.scale.setScalar(0.992);
  model.add(backing);
  const materials = createReconstructionMaterials(geometry.boundingBox!);
  const shell = new THREE.Mesh(geometry, materials.shell);
  shell.castShadow = true;
  const patch = new THREE.Mesh(geometry, materials.patch);
  patch.scale.setScalar(1.004);
  model.add(shell, patch);
  const pointsMaterial = new THREE.PointsMaterial({ color: 0xbefcec, size: 0.011, transparent: true, opacity: 0.13, depthWrite: false, blending: THREE.AdditiveBlending });
  const points = new THREE.Points(createPointGeometry(geometry, 5000), pointsMaterial);
  points.scale.setScalar(1.006);
  model.add(points);
  const sampler = createCrownSampler(geometry);
  const defectSamples = [sampler.side(Math.PI * 0.1, 0.24, 0.025), sampler.side(Math.PI * 0.85, 0.52, 0.025), sampler.top(0.35, -0.22, 0.028)];
  sampler.dispose();
  const markers = defectSamples.map((sample) => {
    const material = new THREE.MeshBasicMaterial({ color: SIGNAL, transparent: true, opacity: 0.58, depthWrite: false, blending: THREE.AdditiveBlending });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.095, 0.006, 6, 42), material);
    ring.position.copy(sample.point);
    orientToNormal(ring, sample.normal);
    model.add(ring);
    return ring;
  });
  const scanMaterial = new THREE.MeshBasicMaterial({ color: 0xcafff5, transparent: true, opacity: 0.32, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending });
  const scanPlane = new THREE.Mesh(new THREE.PlaneGeometry(1.65, 1.35), scanMaterial);
  scanPlane.rotation.x = -Math.PI / 2;
  model.add(scanPlane);
  const validationMaterial = new THREE.MeshBasicMaterial({ color: AQUA_PALE, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
  const validationRings = [0.25, 0.41, 0.57].map((radius) => {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.007, 7, 72), validationMaterial);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.32;
    model.add(ring);
    return ring;
  });
  const bounds = geometry.boundingBox!;
  const size = new THREE.Vector3();
  bounds.getSize(size);
  return {
    root,
    update(time, focus) {
      const progress = (time * (0.095 + focus * 0.018)) % 1;
      materials.shell.uniforms.uProgress.value = progress;
      materials.shell.uniforms.uFocus.value = focus;
      materials.patch.uniforms.uProgress.value = progress;
      pointsMaterial.opacity = progress < 0.32 ? 0.08 + focus * 0.18 : 0.035 + focus * 0.07;
      scanPlane.visible = progress < 0.34;
      scanPlane.position.y = bounds.min.y + Math.min(progress / 0.31, 1) * size.y;
      scanMaterial.opacity = 0.14 + focus * 0.28 + Math.sin(time * 4) * 0.03;
      const repair = THREE.MathUtils.clamp((progress - 0.3) / 0.49, 0, 1);
      markers.forEach((marker, index) => {
        const local = THREE.MathUtils.clamp(repair * 3 - index, 0, 1);
        marker.visible = repair > index / 3 && local < 0.96;
        marker.scale.setScalar(0.72 + Math.sin(time * 5.2 + index) * 0.08 + local * 0.42);
        (marker.material as THREE.MeshBasicMaterial).opacity = (1 - local) * (0.34 + focus * 0.45);
      });
      const validation = THREE.MathUtils.smoothstep(progress, 0.8, 0.98);
      validationMaterial.opacity = validation * (1 - validation * 0.48) * (0.16 + focus * 0.42);
      validationRings.forEach((ring, index) => {
        ring.scale.setScalar(0.72 + validation * (0.4 + index * 0.13));
        ring.rotation.z = time * (0.12 + index * 0.03) * (index % 2 ? -1 : 1);
      });
      model.rotation.y = 0.5 + Math.sin(time * 0.24) * (0.035 + focus * 0.08);
    },
  };
}

function createZoneMaterial(bounds: THREE.Box3) {
  const size = new THREE.Vector3();
  bounds.getSize(size);
  return new THREE.ShaderMaterial({
    uniforms: { uOpacity: { value: 0.1 }, uMin: { value: bounds.min.clone() }, uSize: { value: size } },
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    vertexShader: `varying vec3 vPos;varying vec3 vNormal;void main(){vPos=position;vNormal=normal;gl_Position=projectionMatrix*modelViewMatrix*vec4(position+normal*0.011,1.0);}`,
    fragmentShader: `uniform float uOpacity;uniform vec3 uMin;uniform vec3 uSize;varying vec3 vPos;varying vec3 vNormal;void main(){vec3 p=(vPos-uMin)/max(uSize,vec3(0.0001));if(p.y<0.38)discard;vec3 n=normalize(vNormal);vec3 color;if(p.y>0.72)color=vec3(0.82,0.65,0.28);else if(abs(n.x)>abs(n.z))color=n.x>0.0?vec3(0.9,0.41,0.32):vec3(0.26,0.68,0.62);else color=n.z>0.0?vec3(0.42,0.5,0.75):vec3(0.32,0.63,0.69);gl_FragColor=vec4(color,uOpacity);}`,
  });
}

function createTopologyBatch(samples: SurfaceSample[], sides: number, color: number, radius = 0.038) {
  const geometry = new THREE.TorusGeometry(radius, 0.0075, 5, sides);
  const material = new THREE.MeshPhysicalMaterial({ color, roughness: 0.28, metalness: 0.06, clearcoat: 0.62, clearcoatRoughness: 0.18, emissive: color, emissiveIntensity: 0.08, transparent: true, opacity: 0.92 });
  const mesh = new THREE.InstancedMesh(geometry, material, samples.length);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  const matrix = new THREE.Matrix4();
  const rotation = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const axis = new THREE.Vector3(0, 0, 1);
  samples.forEach((sample, index) => {
    rotation.setFromUnitVectors(axis, sample.normal.clone().normalize());
    const variation = 0.86 + (index % 4) * 0.045;
    scale.set(variation, variation, 0.85);
    matrix.compose(sample.point, rotation, scale);
    mesh.setMatrixAt(index, matrix);
  });
  mesh.count = 0;
  return { mesh, material, total: samples.length } satisfies CellBatch;
}

function createMicrotextureRig(geometry: THREE.BufferGeometry) {
  const sampler = createCrownSampler(geometry);
  const group = new THREE.Group();
  const batches: CellBatch[] = [];
  const topCells: SurfaceSample[] = [];
  for (let row = -3; row <= 3; row++) {
    for (let column = -3; column <= 3; column++) {
      const u = column * 0.205 + (row % 2) * 0.09;
      const v = row * 0.19;
      if (u * u + v * v < 0.62) topCells.push(sampler.top(u, v, 0.022));
    }
  }
  batches.push(createTopologyBatch(topCells, 6, TEXTURE_COLORS[2], 0.041));
  const zoneSettings = [
    { angle: 0, sides: 3, color: TEXTURE_COLORS[1] },
    { angle: Math.PI / 2, sides: 4, color: TEXTURE_COLORS[0] },
    { angle: Math.PI, sides: 5, color: TEXTURE_COLORS[3] },
    { angle: Math.PI * 1.5, sides: 6, color: TEXTURE_COLORS[4] },
  ];
  zoneSettings.forEach((zone, zoneIndex) => {
    const samples: SurfaceSample[] = [];
    for (let row = 0; row < 6; row++) {
      for (let column = -2; column <= 2; column++) {
        if (zoneIndex === 3 && (row + column + 2) % 3 === 0) continue;
        samples.push(sampler.side(zone.angle + column * 0.09 + (row % 2) * 0.03, 0.12 + row * 0.125, 0.018));
      }
    }
    batches.push(createTopologyBatch(samples, zone.sides, zone.color, 0.034 + zoneIndex * 0.0015));
  });
  batches.forEach((batch) => group.add(batch.mesh));
  const topSamples = [[-0.44, -0.18], [0, -0.08], [0.41, 0.14], [-0.16, 0.42], [0.28, -0.4]].map(([u, v]) => sampler.top(u, v, 0.055));
  sampler.dispose();
  return { group, batches, topSamples };
}

function createSimulationRig(geometry: THREE.BufferGeometry, contacts: SurfaceSample[]) {
  const group = new THREE.Group();
  const mechanics = new THREE.Group();
  const pressureMaterial = new THREE.MeshPhysicalMaterial({ color: SIGNAL, roughness: 0.18, transmission: 0.24, transparent: true, opacity: 0.22, emissive: SIGNAL, emissiveIntensity: 0.09 });
  contacts.forEach((sample, index) => {
    const field = new THREE.Mesh(new THREE.SphereGeometry(0.09, 20, 12), pressureMaterial);
    field.scale.set(1.15, 0.42, 1.15);
    field.position.copy(sample.point).addScaledVector(sample.normal, 0.15 + index * 0.012);
    orientToNormal(field, sample.normal, new THREE.Vector3(0, 1, 0));
    mechanics.add(field);
  });
  const bounds = geometry.boundingBox!;
  const size = new THREE.Vector3();
  bounds.getSize(size);
  const filmMaterial = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uOpacity: { value: 0 }, uMin: { value: bounds.min.clone() }, uSize: { value: size }, uAqua: { value: AQUA_PALE } },
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    vertexShader: `uniform float uTime;uniform vec3 uMin;uniform vec3 uSize;varying vec3 vPos;varying float vWave;void main(){vec3 p=(position-uMin)/max(uSize,vec3(0.0001));float wave=0.5+0.5*sin(p.x*18.0+p.z*13.0-uTime*2.2);vec3 transformed=position+normal*(0.026+wave*0.018);vPos=p;vWave=wave;gl_Position=projectionMatrix*modelViewMatrix*vec4(transformed,1.0);}`,
    fragmentShader: `uniform float uOpacity;uniform vec3 uAqua;varying vec3 vPos;varying float vWave;void main(){if(vPos.y<0.61)discard;float edge=smoothstep(0.58,0.75,vPos.y);gl_FragColor=vec4(uAqua,uOpacity*edge*(0.3+vWave*0.7));}`,
  });
  const film = new THREE.Mesh(geometry, filmMaterial);
  const bio = new THREE.Group();
  const bioMaterial = new THREE.MeshPhysicalMaterial({ color: 0xd4b255, roughness: 0.34, transparent: true, opacity: 0.35, emissive: 0x806521, emissiveIntensity: 0.08 });
  contacts.forEach((sample, index) => {
    for (let node = 0; node < 3; node++) {
      const colony = new THREE.Mesh(new THREE.IcosahedronGeometry(0.024 + node * 0.005, 1), bioMaterial);
      colony.position.copy(sample.point).add(new THREE.Vector3(Math.sin(index * 2 + node) * 0.065, 0.055 + node * 0.018, Math.cos(index * 1.7 + node) * 0.06));
      colony.userData.phase = index * 0.7 + node;
      bio.add(colony);
    }
  });
  group.add(mechanics, film, bio);
  return { group, mechanics, film, bio, pressureMaterial, filmMaterial, bioMaterial };
}

function createDesignStage(geometry: THREE.BufferGeometry): StageRig {
  const root = new THREE.Group();
  const model = new THREE.Group();
  model.rotation.set(0.08, 0.5, -0.025);
  root.add(model);
  const shell = new THREE.Mesh(geometry, createPorcelainMaterial());
  shell.castShadow = true;
  model.add(shell);
  const zoneMaterial = createZoneMaterial(geometry.boundingBox!);
  model.add(new THREE.Mesh(geometry, zoneMaterial));
  const texture = createMicrotextureRig(geometry);
  model.add(texture.group);
  const simulation = createSimulationRig(geometry, texture.topSamples);
  model.add(simulation.group);
  return {
    root,
    update(time, focus) {
      const cycle = (time * (0.18 + focus * 0.045)) % 4;
      const field = Math.floor(cycle);
      const grow = THREE.MathUtils.clamp((time * 0.12) % 1.15, 0, 1);
      texture.batches.forEach((batch, index) => {
        batch.mesh.count = Math.max(0, Math.min(batch.total, Math.floor(batch.total * THREE.MathUtils.clamp(grow * 1.55 - index * 0.11, 0, 1))));
        batch.mesh.instanceMatrix.needsUpdate = true;
        batch.material.opacity = 0.78 + focus * 0.2;
        batch.material.emissiveIntensity = 0.05 + focus * 0.18 + Math.sin(time * 1.7 + index) * 0.025;
      });
      zoneMaterial.uniforms.uOpacity.value = 0.045 + focus * 0.1;
      simulation.mechanics.visible = field === 0 || field === 3;
      simulation.film.visible = field === 1 || field === 3;
      simulation.bio.visible = field === 2 || field === 3;
      simulation.pressureMaterial.opacity = 0.1 + focus * 0.24;
      simulation.mechanics.children.forEach((object, index) => {
        const pulse = 0.88 + Math.sin(time * 1.8 + index) * 0.11;
        object.scale.set(1.15 * pulse, 0.38 + Math.sin(time * 1.8 + index) * 0.08, 1.15 * pulse);
      });
      simulation.filmMaterial.uniforms.uTime.value = time;
      simulation.filmMaterial.uniforms.uOpacity.value = 0.1 + focus * 0.28;
      simulation.bio.children.forEach((object) => {
        const scale = 0.72 + Math.sin(time * 1.35 + Number(object.userData.phase)) * 0.2 + focus * 0.2;
        object.scale.setScalar(scale);
      });
      simulation.bioMaterial.opacity = 0.16 + focus * 0.28;
      model.rotation.y = 0.5 + Math.sin(time * 0.22) * (0.035 + focus * 0.1);
    },
  };
}

function createToolhead() {
  const group = new THREE.Group();
  const bodyMaterial = createMetal(0x203934, 0.16);
  const alloyMaterial = createMetal(0xa8bbb6, 0.12);
  const glassMaterial = new THREE.MeshPhysicalMaterial({ color: 0xbffff3, roughness: 0.05, transmission: 0.58, transparent: true, opacity: 0.55 });
  const glowMaterial = new THREE.MeshBasicMaterial({ color: SIGNAL, transparent: true, opacity: 0.42, depthWrite: false, blending: THREE.AdditiveBlending });
  const motor = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.34, 28), bodyMaterial);
  motor.position.y = 0.3;
  const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.105, 0.073, 0.12, 28), alloyMaterial);
  collar.position.y = 0.06;
  const guard = new THREE.Mesh(new THREE.CylinderGeometry(0.083, 0.054, 0.15, 28, 1, true), glassMaterial);
  guard.position.y = -0.07;
  const shank = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.018, 0.16, 18), alloyMaterial);
  shank.position.y = -0.2;
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.027, 0.12, 18), alloyMaterial);
  tip.rotation.z = Math.PI;
  tip.position.y = -0.32;
  const glow = new THREE.Mesh(new THREE.SphereGeometry(0.035, 18, 12), glowMaterial);
  glow.position.y = -0.39;
  group.add(motor, collar, guard, shank, tip, glow);
  return { group, motor, glowMaterial };
}

function createMechanicalPlatform() {
  const group = new THREE.Group();
  const graphite = createMetal(0x1f3833, 0.24);
  const alloy = createMetal(0x7f9690, 0.15);
  const pale = createMetal(0xc1d0cc, 0.18);
  const base = new THREE.Mesh(new THREE.BoxGeometry(2.15, 0.17, 1.42), graphite);
  base.position.y = -1.04;
  const bed = new THREE.Mesh(new THREE.BoxGeometry(1.72, 0.07, 1.08), alloy);
  bed.position.y = -0.91;
  group.add(base, bed);
  [-0.54, 0.54].forEach((z) => {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(1.56, 0.055, 0.07), pale);
    rail.position.set(0, -0.85, z);
    group.add(rail);
  });
  [-1, 1].forEach((side) => {
    const column = new THREE.Mesh(new THREE.BoxGeometry(0.14, 1.66, 0.17), graphite);
    column.position.set(side * 0.93, -0.12, -0.26);
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.12, 0.34), alloy);
    foot.position.set(side * 0.93, -0.85, -0.22);
    group.add(column, foot);
  });
  const crossbeam = new THREE.Mesh(new THREE.BoxGeometry(1.95, 0.16, 0.2), graphite);
  crossbeam.position.set(0, 0.68, -0.25);
  const xRail = new THREE.Mesh(new THREE.BoxGeometry(1.68, 0.05, 0.08), pale);
  xRail.position.set(0, 0.58, -0.12);
  const xCarriage = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.26, 0.24), alloy);
  xCarriage.position.set(0, 0.51, -0.08);
  const zSlide = new THREE.Mesh(new THREE.BoxGeometry(0.21, 0.62, 0.18), graphite);
  zSlide.position.set(0, 0.26, -0.02);
  group.add(crossbeam, xRail, xCarriage, zSlide);
  const rotary = new THREE.Group();
  const rotaryBase = new THREE.Mesh(new THREE.CylinderGeometry(0.52, 0.57, 0.12, 52), graphite);
  rotaryBase.position.y = -0.78;
  const rotaryTop = new THREE.Mesh(new THREE.CylinderGeometry(0.43, 0.45, 0.08, 52), pale);
  rotaryTop.position.y = -0.68;
  rotary.add(rotaryBase, rotaryTop);
  [-1, 1].forEach((side) => {
    const jaw = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.25, 0.18), alloy);
    jaw.position.set(side * 0.44, -0.54, 0);
    jaw.rotation.z = side * -0.13;
    rotary.add(jaw);
  });
  group.add(rotary);
  return { group, rotary, xCarriage, zSlide };
}

function createFabricationStage(geometry: THREE.BufferGeometry): StageRig {
  const root = new THREE.Group();
  const platform = createMechanicalPlatform();
  root.add(platform.group);
  const workCell = new THREE.Group();
  workCell.rotation.set(0.08, 0.48, -0.025);
  workCell.position.y = 0.05;
  platform.rotary.add(workCell);
  const shell = new THREE.Mesh(geometry, createPorcelainMaterial());
  shell.castShadow = true;
  workCell.add(shell);
  const sampler = createCrownSampler(geometry);
  const curves: THREE.CatmullRomCurve3[] = [];
  const grooveMaterials: THREE.ShaderMaterial[] = [];
  for (let row = 0; row < 6; row++) {
    const samples: SurfaceSample[] = [];
    for (let step = 0; step <= 16; step++) {
      const forward = row % 2 === 0 ? step : 16 - step;
      samples.push(sampler.top(-0.72 + forward / 16 * 1.44, -0.48 + row * 0.19 + Math.sin(step * 0.8) * 0.025, 0.008));
    }
    const material = createReliefMaterial(0x245e56);
    const tube = createTube(samples, material, 0.013);
    curves.push(tube.curve);
    grooveMaterials.push(material);
    workCell.add(tube.mesh);
  }
  sampler.dispose();
  const tool = createToolhead();
  workCell.add(tool.group);
  const chipMaterial = new THREE.MeshBasicMaterial({ color: 0xffa183, transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending });
  const chips = Array.from({ length: 9 }, (_, index) => {
    const chip = new THREE.Mesh(new THREE.SphereGeometry(0.008 + (index % 3) * 0.003, 8, 6), chipMaterial);
    chip.userData.phase = index / 9;
    workCell.add(chip);
    return chip;
  });
  const position = new THREE.Vector3();
  const tangent = new THREE.Vector3();
  const down = new THREE.Vector3(0, -1, 0);
  return {
    root,
    update(time, focus) {
      const total = (time * (0.21 + focus * 0.055)) % 6;
      const activeRow = Math.floor(total);
      const rowProgress = total - activeRow;
      grooveMaterials.forEach((material, index) => {
        material.uniforms.uGrow.value = index < activeRow ? 1 : index === activeRow ? rowProgress : 0;
        material.uniforms.uFocus.value = focus;
      });
      const curve = curves[activeRow];
      curve.getPointAt(rowProgress, position);
      curve.getTangentAt(rowProgress, tangent).normalize();
      const surfaceNormal = new THREE.Vector3(-tangent.z * 0.18, 1, tangent.x * 0.18).normalize();
      tool.group.position.copy(position).addScaledVector(surfaceNormal, 0.38 - focus * 0.2);
      tool.group.quaternion.setFromUnitVectors(down, surfaceNormal.clone().negate());
      tool.motor.rotation.y = time * 18;
      tool.glowMaterial.opacity = 0.12 + focus * (0.5 + Math.sin(time * 12) * 0.09);
      platform.xCarriage.position.x = THREE.MathUtils.lerp(platform.xCarriage.position.x, THREE.MathUtils.clamp(position.x, -0.66, 0.66), 0.12);
      platform.zSlide.position.x = platform.xCarriage.position.x;
      platform.zSlide.position.y = 0.23 + Math.sin(time * 0.4) * 0.035;
      platform.rotary.rotation.y = Math.sin(time * 0.18) * (0.08 + focus * 0.16);
      chips.forEach((chip, index) => {
        const phase = (time * 1.9 + Number(chip.userData.phase)) % 1;
        chip.position.copy(position).add(new THREE.Vector3(Math.sin(index * 2.1) * phase * 0.14, 0.02 + phase * 0.16, Math.cos(index * 1.7) * phase * 0.13));
        chip.scale.setScalar(1 - phase * 0.75);
      });
      chipMaterial.opacity = 0.12 + focus * 0.52;
      platform.group.rotation.y = -0.08 + Math.sin(time * 0.16) * 0.02;
    },
  };
}

function createPipeline() {
  const points = STAGE_X.map((x, index) => new THREE.Vector3(x, -1.16 + Math.sin(index * 1.1) * 0.025, -0.45));
  const curve = new THREE.CatmullRomCurve3(points, false, "centripetal", 0.2);
  const material = new THREE.MeshBasicMaterial({ color: AQUA, transparent: true, opacity: 0.11, depthWrite: false, blending: THREE.AdditiveBlending });
  const mesh = new THREE.Mesh(new THREE.TubeGeometry(curve, 180, 0.006, 5, false), material);
  const pulseMaterial = new THREE.MeshBasicMaterial({ color: AQUA_PALE, transparent: true, opacity: 0.65, depthWrite: false, blending: THREE.AdditiveBlending });
  const pulses = Array.from({ length: 3 }, () => new THREE.Mesh(new THREE.SphereGeometry(0.022, 12, 8), pulseMaterial));
  return { curve, mesh, material, pulseMaterial, pulses };
}

function disposeScene(root: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  root.traverse((object) => {
    const drawable = object as THREE.Mesh;
    if (drawable.geometry) geometries.add(drawable.geometry);
    if (Array.isArray(drawable.material)) drawable.material.forEach((material) => materials.add(material));
    else if (drawable.material) materials.add(drawable.material);
  });
  geometries.forEach((geometry) => geometry.dispose());
  materials.forEach((material) => material.dispose());
}

export function HeroSurfaceEvolution({ className, mode }: Props) {
  const mountRef = useRef<HTMLDivElement>(null);
  const targetModeRef = useRef<SurfaceMode>(mode);
  const renderOnceRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    targetModeRef.current = mode;
    renderOnceRef.current?.();
  }, [mode]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const compact = window.matchMedia("(max-width: 780px)").matches;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(compact ? 34 : 27, 1, 0.1, 100);
    camera.position.set(0, compact ? 1.55 : 1.72, compact ? 6.1 : 12.15);
    camera.lookAt(0, 0.04, 0);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, compact ? 1.15 : 1.5));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    renderer.shadowMap.enabled = !compact;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    mount.appendChild(renderer.domElement);
    mount.dataset.surfaceState = "loading";
    scene.add(new THREE.HemisphereLight(0xf9fffc, 0x52625d, 2.25));
    const key = new THREE.DirectionalLight(0xffffff, 4.15);
    key.position.set(-4.5, 6.5, 7.5);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0x8ce8d7, 1.6);
    fill.position.set(5, 0.5, 5);
    scene.add(fill);
    const warm = new THREE.PointLight(0xffa486, 0.58, 12, 2);
    warm.position.set(-1, 2.2, 4);
    scene.add(warm);

    let disposed = false;
    let frame = 0;
    const resize = () => {
      const width = Math.max(1, mount.clientWidth);
      const height = Math.max(1, mount.clientHeight);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(mount);
    resize();

    new STLLoader().loadAsync(CROWN_URL).then((source) => {
      if (disposed) {
        source.dispose();
        return;
      }
      const crownGeometry = prepareCrownGeometry(source);
      source.dispose();
      const stages = [
        createCrownScanner(crownGeometry.clone()),
        createReconstructionStage(crownGeometry.clone()),
        createDesignStage(crownGeometry.clone()),
        createFabricationStage(crownGeometry.clone()),
      ];
      crownGeometry.dispose();
      stages.forEach((stage, index) => {
        stage.root.position.set(STAGE_X[index], 0.05, 0);
        const light = new THREE.PointLight(index === 1 || index === 3 ? 0xffb09a : 0xbafff2, 0.28, 3.1, 2);
        light.position.set(0, 0.65, 1.55);
        light.userData.stageLight = true;
        stage.root.add(light);
        scene.add(stage.root);
      });
      const pipeline = createPipeline();
      scene.add(pipeline.mesh, ...pipeline.pulses);
      const weights = [0, 0, 0, 0];
      const desired = [0, 0, 0, 0];
      const clock = new THREE.Clock();
      const point = new THREE.Vector3();
      const targetScale = new THREE.Vector3();
      mount.dataset.surfaceState = "ready";

      const render = () => {
        const time = reducedMotion ? 3.4 : clock.getElapsedTime();
        const target = targetModeRef.current ?? 0;
        desired.fill(0);
        desired[target] = 1;
        stages.forEach((stage, index) => {
          weights[index] = reducedMotion ? desired[index] : THREE.MathUtils.lerp(weights[index], desired[index], 0.072);
          const focus = weights[index];
          stage.update(time, focus);
          targetScale.setScalar(0.88 + focus * 0.14);
          stage.root.scale.lerp(targetScale, reducedMotion ? 1 : 0.09);
          const targetX = compact ? (index - target) * 2.72 : STAGE_X[index];
          stage.root.position.x = THREE.MathUtils.lerp(stage.root.position.x, targetX, reducedMotion ? 1 : 0.085);
          stage.root.position.y = THREE.MathUtils.lerp(stage.root.position.y, 0.05 + focus * 0.07 + Math.sin(time * 0.42 + index) * 0.012, 0.08);
          stage.root.position.z = THREE.MathUtils.lerp(stage.root.position.z, focus * 0.32, 0.07);
          const stageLight = stage.root.children.find((child) => child.userData.stageLight) as THREE.PointLight | undefined;
          if (stageLight) stageLight.intensity = 0.2 + focus * 1.38;
        });
        pipeline.material.opacity = compact ? 0.025 : 0.08 + weights[target] * 0.09;
        pipeline.pulses.forEach((pulse, index) => {
          pipeline.curve.getPointAt((time * 0.055 + index / 3) % 1, point);
          pulse.position.copy(point);
          pulse.scale.setScalar(0.72 + Math.sin(time * 2.2 + index) * 0.14);
        });
        pipeline.pulseMaterial.opacity = 0.4 + Math.sin(time * 1.4) * 0.1;
        mount.dataset.surfacePhase = ["capture", "reconstruct", "design", "fabricate"][target];
        renderer.render(scene, camera);
        if (!reducedMotion) frame = window.requestAnimationFrame(render);
      };
      renderOnceRef.current = render;
      render();
    }).catch(() => {
      mount.dataset.surfaceState = "error";
    });

    return () => {
      disposed = true;
      observer.disconnect();
      window.cancelAnimationFrame(frame);
      renderOnceRef.current = null;
      disposeScene(scene);
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    };
  }, []);

  return <div ref={mountRef} className={className} role="img" aria-label="同一真实STL牙冠依次经过精密扫描、异常重建、微织构数字孪生设计与机械微纳加工的四阶段三维动画" />;
}
