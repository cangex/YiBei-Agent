"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";

export type ReconstructionAnomalyKind = "margin" | "topology" | "hole" | "fissure";

type Props = {
  kind: ReconstructionAnomalyKind;
  progress: number;
};

type PatchRig = {
  group: THREE.Group;
  update: (progress: number, elapsed: number, reducedMotion: boolean) => void;
};

const CYAN = new THREE.Color(0x24b7c7);
const DEEP = new THREE.Color(0x123f45);
const PALE = new THREE.Color(0xd8f8fb);
const ALERT = new THREE.Color(0xff725e);
const VERIFIED = new THREE.Color(0x61d6b4);

function clamp01(value: number) {
  return THREE.MathUtils.clamp(value, 0, 1);
}

function ease(value: number) {
  const clamped = clamp01(value);
  return clamped * clamped * (3 - 2 * clamped);
}

function phaseProgress(progress: number, start: number, end: number) {
  return ease((progress - start) / Math.max(0.0001, end - start));
}

function makeLine(
  points: THREE.Vector3[],
  color = CYAN,
  opacity = 1,
) {
  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  const material = new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false });
  const line = new THREE.Line(geometry, material);
  geometry.setDrawRange(0, 0);
  return line;
}

function setLineReveal(line: THREE.Line, reveal: number) {
  const count = line.geometry.getAttribute("position").count;
  line.geometry.setDrawRange(0, Math.max(0, Math.floor(count * clamp01(reveal))));
}

function makeTube(
  points: THREE.Vector3[],
  radius: number,
  color = CYAN,
  opacity = 1,
) {
  const curve = new THREE.CatmullRomCurve3(points);
  const geometry = new THREE.TubeGeometry(curve, 72, radius, 7, false);
  const material = new THREE.MeshPhysicalMaterial({
    color,
    emissive: color,
    emissiveIntensity: 0.18,
    roughness: 0.28,
    metalness: 0,
    transparent: true,
    opacity,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geometry, material);
  geometry.setDrawRange(0, 0);
  return mesh;
}

function setMeshReveal(mesh: THREE.Mesh, reveal: number) {
  const count = mesh.geometry.index?.count ?? mesh.geometry.getAttribute("position").count;
  mesh.geometry.setDrawRange(0, Math.floor(count * clamp01(reveal)));
}

function surfaceHeight(x: number, y: number, kind: ReconstructionAnomalyKind) {
  const crown = 0.1 * Math.cos(x * 1.15) + 0.065 * Math.cos(y * 1.8) - 0.025 * x * y;
  if (kind === "fissure") {
    const fissureY = 0.18 * Math.sin(x * 1.45) - 0.08;
    return crown - Math.exp(-Math.pow((y - fissureY) * 8.2, 2)) * 0.075;
  }
  if (kind === "margin") return crown + y * 0.035;
  if (kind === "topology") return crown + Math.sin(x * 2.8 + y * 2.2) * 0.018;
  return crown;
}

function createSurfaceGeometry(kind: ReconstructionAnomalyKind, repaired = false) {
  const columns = 28;
  const rows = 20;
  const positions: number[] = [];
  const indices: number[] = [];
  for (let row = 0; row <= rows; row += 1) {
    for (let column = 0; column <= columns; column += 1) {
      const x = THREE.MathUtils.lerp(-2.2, 2.2, column / columns);
      const y = THREE.MathUtils.lerp(-1.35, 1.35, row / rows);
      positions.push(x, y, surfaceHeight(x, y, kind));
    }
  }
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const centerX = THREE.MathUtils.lerp(-2.2, 2.2, (column + 0.5) / columns);
      const centerY = THREE.MathUtils.lerp(-1.35, 1.35, (row + 0.5) / rows);
      if (kind === "hole" && !repaired) {
        const radius = Math.pow(centerX / 0.62, 2) + Math.pow((centerY + 0.02) / 0.5, 2);
        if (radius < 1) continue;
      }
      if (kind === "margin" && !repaired && Math.abs(centerX) < 0.42 && Math.abs(centerY + 0.42) < 0.18) continue;
      if (kind === "topology" && !repaired && Math.abs(centerX - 0.15) < 0.55 && Math.abs(centerY + 0.04) < 0.48) continue;
      if (kind === "fissure" && !repaired && Math.abs(centerX) < 0.45 && Math.abs(centerY + 0.08) < 0.24) continue;
      const a = row * (columns + 1) + column;
      const b = a + 1;
      const c = a + columns + 1;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function createSurfaceApronGeometry(kind: ReconstructionAnomalyKind) {
  const boundary: Array<[number, number]> = [];
  const horizontalSegments = 28;
  const verticalSegments = 18;
  for (let index = 0; index <= horizontalSegments; index += 1) boundary.push([THREE.MathUtils.lerp(-2.2, 2.2, index / horizontalSegments), -1.35]);
  for (let index = 1; index <= verticalSegments; index += 1) boundary.push([2.2, THREE.MathUtils.lerp(-1.35, 1.35, index / verticalSegments)]);
  for (let index = 1; index <= horizontalSegments; index += 1) boundary.push([THREE.MathUtils.lerp(2.2, -2.2, index / horizontalSegments), 1.35]);
  for (let index = 1; index < verticalSegments; index += 1) boundary.push([-2.2, THREE.MathUtils.lerp(1.35, -1.35, index / verticalSegments)]);
  const positions: number[] = [];
  const indices: number[] = [];
  boundary.forEach(([x, y]) => {
    const top = surfaceHeight(x, y, kind);
    positions.push(x, y, top, x, y, -0.3 + top * 0.08);
  });
  boundary.forEach((_, index) => {
    const next = (index + 1) % boundary.length;
    const top = index * 2;
    const bottom = top + 1;
    const nextTop = next * 2;
    const nextBottom = nextTop + 1;
    indices.push(top, bottom, nextTop, nextTop, bottom, nextBottom);
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function createHoleWallGeometry() {
  const ring = irregularRingPoints(0.67, 0.54, 0.13, 56);
  const positions: number[] = [];
  const indices: number[] = [];
  ring.slice(0, -1).forEach((point) => {
    positions.push(point.x, point.y, point.z, point.x * 0.86, point.y * 0.86, -0.22);
  });
  const count = ring.length - 1;
  for (let index = 0; index < count; index += 1) {
    const next = (index + 1) % count;
    const top = index * 2;
    const bottom = top + 1;
    const nextTop = next * 2;
    const nextBottom = nextTop + 1;
    indices.push(top, nextTop, bottom, nextTop, nextBottom, bottom);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function createSurfaceRig(kind: ReconstructionAnomalyKind) {
  const group = new THREE.Group();
  const sourceGeometry = createSurfaceGeometry(kind, false);
  const sourceMaterial = new THREE.MeshPhysicalMaterial({
    color: 0xbfe6e7,
    roughness: 0.62,
    transparent: true,
    opacity: 0.7,
    side: THREE.DoubleSide,
  });
  const surface = new THREE.Mesh(sourceGeometry, sourceMaterial);
  surface.castShadow = true;
  surface.receiveShadow = true;
  group.add(surface);
  const wireMaterial = new THREE.LineBasicMaterial({ color: 0x328b94, transparent: true, opacity: 0.25 });
  const wire = new THREE.LineSegments(new THREE.WireframeGeometry(sourceGeometry), wireMaterial);
  wire.position.z = 0.004;
  group.add(wire);
  const volumeMaterial = new THREE.MeshPhysicalMaterial({
    color: 0x729aa0,
    roughness: 0.76,
    clearcoat: 0.08,
    transparent: true,
    opacity: 0.82,
    side: THREE.DoubleSide,
  });
  const apron = new THREE.Mesh(createSurfaceApronGeometry(kind), volumeMaterial);
  apron.castShadow = true;
  apron.receiveShadow = true;
  group.add(apron);
  const underside = new THREE.Mesh(
    new THREE.PlaneGeometry(4.4, 2.7),
    new THREE.MeshPhysicalMaterial({ color: 0x456a70, roughness: 0.88, transparent: true, opacity: 0.72, side: THREE.DoubleSide }),
  );
  underside.position.z = -0.3;
  underside.receiveShadow = true;
  group.add(underside);
  let anomalyWall: THREE.Mesh | null = null;
  if (kind === "hole") {
    anomalyWall = new THREE.Mesh(
      createHoleWallGeometry(),
      new THREE.MeshPhysicalMaterial({ color: 0x345d63, roughness: 0.72, transparent: true, opacity: 0.92, side: THREE.DoubleSide }),
    );
    anomalyWall.castShadow = true;
    group.add(anomalyWall);
  }
  return { group, surface, wire, apron, underside, anomalyWall };
}

function sampleCurve(points: THREE.Vector3[], count = 64) {
  return new THREE.CatmullRomCurve3(points).getPoints(count);
}

function createMarginRig(): PatchRig {
  const { group, surface, wire } = createSurfaceRig("margin");
  const left = sampleCurve([
    new THREE.Vector3(-1.8, -0.48, 0.09),
    new THREE.Vector3(-1.15, -0.38, 0.12),
    new THREE.Vector3(-0.42, -0.46, 0.14),
  ], 34);
  const right = sampleCurve([
    new THREE.Vector3(0.42, -0.43, 0.14),
    new THREE.Vector3(1.1, -0.31, 0.11),
    new THREE.Vector3(1.8, -0.44, 0.08),
  ], 34);
  const edgeLeft = makeTube(left, 0.018, ALERT, 0.82);
  const edgeRight = makeTube(right, 0.018, ALERT, 0.82);
  group.add(edgeLeft, edgeRight);

  const candidates = [-0.17, 0, 0.16].map((offset, index) => {
    const points = sampleCurve([
      new THREE.Vector3(-0.48, -0.45, 0.145),
      new THREE.Vector3(-0.18, -0.43 + offset, 0.19 + Math.abs(offset) * 0.1),
      new THREE.Vector3(0.17, -0.4 - offset * 0.5, 0.185 + Math.abs(offset) * 0.08),
      new THREE.Vector3(0.48, -0.42, 0.145),
    ], 42);
    const tube = makeTube(points, index === 1 ? 0.024 : 0.012, index === 1 ? CYAN : DEEP, 0);
    tube.userData.baseOffset = offset;
    group.add(tube);
    return tube;
  });

  const endpointMaterial = new THREE.MeshBasicMaterial({ color: ALERT, transparent: true, opacity: 0 });
  const endpoints = [new THREE.Vector3(-0.42, -0.46, 0.15), new THREE.Vector3(0.42, -0.43, 0.15)].map((position) => {
    const node = new THREE.Mesh(new THREE.SphereGeometry(0.055, 16, 12), endpointMaterial.clone());
    node.position.copy(position);
    group.add(node);
    return node;
  });
  const tangents = [
    new THREE.ArrowHelper(new THREE.Vector3(1, 0.14, 0.04).normalize(), endpoints[0].position, 0.55, 0x24b7c7, 0.11, 0.055),
    new THREE.ArrowHelper(new THREE.Vector3(-1, -0.08, 0.03).normalize(), endpoints[1].position, 0.55, 0x24b7c7, 0.11, 0.055),
  ];
  tangents.forEach((arrow) => {
    const lineMaterial = arrow.line.material as THREE.LineBasicMaterial;
    const coneMaterial = arrow.cone.material as THREE.MeshBasicMaterial;
    lineMaterial.transparent = true;
    lineMaterial.opacity = 0;
    coneMaterial.transparent = true;
    coneMaterial.opacity = 0;
    group.add(arrow);
  });

  const stitches = Array.from({ length: 9 }, (_, index) => {
    const x = THREE.MathUtils.lerp(-0.37, 0.37, index / 8);
    const y = -0.43 + Math.sin(index * 0.66) * 0.018;
    const line = makeLine([
      new THREE.Vector3(x, y - 0.09, 0.14),
      new THREE.Vector3(x, y + 0.09, 0.19),
    ], VERIFIED, 0);
    group.add(line);
    return line;
  });
  const bridgeFaces = Array.from({ length: 10 }, (_, index) => {
    const x0 = THREE.MathUtils.lerp(-0.42, 0.42, index / 10);
    const x1 = THREE.MathUtils.lerp(-0.42, 0.42, (index + 1) / 10);
    const y0 = -0.54 + Math.sin(index * 0.47) * 0.012;
    const y1 = -0.32 + Math.cos(index * 0.39) * 0.012;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute([
      x0, y0, surfaceHeight(x0, y0, "margin") + 0.008,
      x1, y0, surfaceHeight(x1, y0, "margin") + 0.008,
      x0, y1, surfaceHeight(x0, y1, "margin") + 0.008,
      x1, y0, surfaceHeight(x1, y0, "margin") + 0.008,
      x1, y1, surfaceHeight(x1, y1, "margin") + 0.008,
      x0, y1, surfaceHeight(x0, y1, "margin") + 0.008,
    ], 3));
    geometry.computeVertexNormals();
    const face = new THREE.Mesh(
      geometry,
      new THREE.MeshPhysicalMaterial({ color: PALE, emissive: VERIFIED, emissiveIntensity: 0.08, roughness: 0.3, transparent: true, opacity: 0, side: THREE.DoubleSide }),
    );
    face.scale.y = 0.05;
    face.position.y = -0.41;
    group.add(face);
    return face;
  });

  return {
    group,
    update(progress, elapsed, reducedMotion) {
      const reveal = phaseProgress(progress, 0.08, 0.3);
      const candidate = phaseProgress(progress, 0.3, 0.55);
      const converge = phaseProgress(progress, 0.5, 0.72);
      const stitch = phaseProgress(progress, 0.67, 0.86);
      const verify = phaseProgress(progress, 0.86, 1);
      setMeshReveal(edgeLeft, reveal);
      setMeshReveal(edgeRight, reveal);
      endpoints.forEach((node, index) => {
        const material = node.material as THREE.MeshBasicMaterial;
        material.opacity = reveal * (0.68 + (reducedMotion ? 0 : Math.sin(elapsed * 5 + index) * 0.24));
        node.scale.setScalar(0.82 + reveal * 0.28);
      });
      tangents.forEach((arrow) => {
        (arrow.line.material as THREE.LineBasicMaterial).opacity = reveal * 0.68;
        (arrow.cone.material as THREE.MeshBasicMaterial).opacity = reveal * 0.76;
      });
      candidates.forEach((tube, index) => {
        const material = tube.material as THREE.MeshPhysicalMaterial;
        const selected = index === 1;
        material.opacity = candidate * (selected ? 0.96 : 0.34 * (1 - converge));
        tube.position.y = Number(tube.userData.baseOffset) * (1 - converge);
        setMeshReveal(tube, candidate);
      });
      stitches.forEach((line, index) => {
        const local = clamp01(stitch * stitches.length - index);
        setLineReveal(line, local);
        (line.material as THREE.LineBasicMaterial).opacity = local * (0.52 + verify * 0.35);
      });
      bridgeFaces.forEach((face, index) => {
        const local = ease(stitch * bridgeFaces.length - index * 0.72);
        face.scale.y = 0.05 + local * 0.95;
        face.position.y = -0.41 * (1 - face.scale.y);
        (face.material as THREE.MeshPhysicalMaterial).opacity = local * (0.7 + verify * 0.18);
      });
      (wire.material as THREE.LineBasicMaterial).opacity = 0.25 * (1 - stitch * 0.45);
      (surface.material as THREE.MeshPhysicalMaterial).color.copy(PALE).lerp(VERIFIED, verify * 0.12);
    },
  };
}

function createTopologyRig(): PatchRig {
  const { group, surface, wire } = createSurfaceRig("topology");
  const noisePositions = Array.from({ length: 13 }, (_, index) => {
    const angle = index * 2.17;
    const radius = 0.18 + (index % 5) * 0.09;
    return new THREE.Vector3(
      0.12 + Math.cos(angle) * radius,
      -0.02 + Math.sin(angle) * radius * 0.78,
      0.25 + Math.sin(index * 1.7) * 0.2,
    );
  });
  const invalidNodes = noisePositions.map((position, index) => {
    const material = new THREE.MeshBasicMaterial({ color: index % 3 === 0 ? ALERT : 0x476d73, transparent: true, opacity: 0 });
    const mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(0.045 + (index % 3) * 0.009, 1), material);
    mesh.position.copy(position);
    mesh.userData.origin = position.clone();
    mesh.userData.direction = position.clone().sub(new THREE.Vector3(0.12, -0.02, 0.08)).normalize();
    group.add(mesh);
    return mesh;
  });
  const chaoticEdges = Array.from({ length: 11 }, (_, index) => {
    const start = noisePositions[index];
    const end = noisePositions[(index * 5 + 3) % noisePositions.length];
    const edge = makeLine([start, end], ALERT, 0);
    group.add(edge);
    return edge;
  });
  const normalLines = noisePositions.slice(0, 9).map((position, index) => {
    const chaotic = new THREE.Vector3(Math.sin(index * 1.9), Math.cos(index * 1.3), 0.25 + Math.sin(index) * 0.7).normalize();
    const line = makeLine([position, position.clone().addScaledVector(chaotic, 0.32)], CYAN, 0);
    line.userData.origin = position.clone();
    line.userData.chaotic = chaotic;
    group.add(line);
    return line;
  });

  const repairedGeometry = createSurfaceGeometry("topology", true);
  const repairedMaterial = new THREE.MeshPhysicalMaterial({ color: PALE, roughness: 0.34, transparent: true, opacity: 0, side: THREE.DoubleSide });
  const repairedSurface = new THREE.Mesh(repairedGeometry, repairedMaterial);
  group.add(repairedSurface);
  const relink = new THREE.LineSegments(
    new THREE.WireframeGeometry(repairedGeometry),
    new THREE.LineBasicMaterial({ color: VERIFIED, transparent: true, opacity: 0 }),
  );
  relink.position.z = 0.009;
  group.add(relink);

  return {
    group,
    update(progress, elapsed, reducedMotion) {
      const audit = phaseProgress(progress, 0.08, 0.3);
      const release = phaseProgress(progress, 0.3, 0.54);
      const reconnect = phaseProgress(progress, 0.5, 0.84);
      const verify = phaseProgress(progress, 0.84, 1);
      invalidNodes.forEach((node, index) => {
        const material = node.material as THREE.MeshBasicMaterial;
        const direction = node.userData.direction as THREE.Vector3;
        const origin = node.userData.origin as THREE.Vector3;
        node.position.copy(origin).addScaledVector(direction, release * (0.55 + index * 0.018));
        material.opacity = audit * (1 - release) * (0.65 + (reducedMotion ? 0 : Math.sin(elapsed * 4.5 + index) * 0.22));
      });
      chaoticEdges.forEach((edge, index) => {
        setLineReveal(edge, audit);
        (edge.material as THREE.LineBasicMaterial).opacity = audit * (1 - release) * (index % 2 ? 0.34 : 0.58);
      });
      normalLines.forEach((line, index) => {
        const origin = line.userData.origin as THREE.Vector3;
        const chaotic = line.userData.chaotic as THREE.Vector3;
        const aligned = chaotic.clone().lerp(new THREE.Vector3(0, 0, 1), reconnect).normalize();
        const position = line.geometry.getAttribute("position") as THREE.BufferAttribute;
        position.setXYZ(0, origin.x, origin.y, origin.z);
        position.setXYZ(1, origin.x + aligned.x * 0.32, origin.y + aligned.y * 0.32, origin.z + aligned.z * 0.32);
        position.needsUpdate = true;
        setLineReveal(line, audit);
        (line.material as THREE.LineBasicMaterial).opacity = audit * (0.26 + reconnect * 0.5) * (index % 2 ? 0.8 : 1);
      });
      repairedMaterial.opacity = reconnect * 0.8;
      (relink.material as THREE.LineBasicMaterial).opacity = reconnect * (0.24 + verify * 0.28);
      relink.scale.setScalar(0.985 + reconnect * 0.015);
      (surface.material as THREE.MeshPhysicalMaterial).opacity = 0.7 * (1 - reconnect * 0.75);
      (wire.material as THREE.LineBasicMaterial).opacity = 0.25 * (1 - reconnect * 0.7);
      relink.position.z = 0.009 + (reducedMotion ? 0 : Math.sin(elapsed * 4) * verify * 0.006);
    },
  };
}

function irregularRingPoints(radiusX: number, radiusY: number, z: number, count = 72) {
  return Array.from({ length: count + 1 }, (_, index) => {
    const angle = index / count * Math.PI * 2;
    const modulation = 1 + Math.sin(angle * 3 + 0.7) * 0.07 + Math.sin(angle * 5 - 0.4) * 0.035;
    return new THREE.Vector3(Math.cos(angle) * radiusX * modulation, Math.sin(angle) * radiusY * modulation, z);
  });
}

function createHoleRig(): PatchRig {
  const { group, surface, wire, anomalyWall } = createSurfaceRig("hole");
  const boundaryPoints = irregularRingPoints(0.67, 0.54, 0.13);
  const boundary = makeTube(boundaryPoints, 0.018, ALERT, 0.86);
  group.add(boundary);
  const membraneMaterial = new THREE.MeshPhysicalMaterial({
    color: CYAN,
    emissive: CYAN,
    emissiveIntensity: 0.1,
    transmission: 0.25,
    roughness: 0.16,
    transparent: true,
    opacity: 0,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const membrane = new THREE.Mesh(new THREE.CircleGeometry(0.63, 64), membraneMaterial);
  membrane.scale.y = 0.8;
  membrane.position.z = 0.12;
  group.add(membrane);
  const fanMaterial = new THREE.MeshPhysicalMaterial({ color: PALE, roughness: 0.28, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false });
  const fanTriangles = Array.from({ length: 24 }, (_, index) => {
    const p0 = boundaryPoints[Math.floor(index / 24 * 72)];
    const p1 = boundaryPoints[Math.floor((index + 1) / 24 * 72)];
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute([
      0, 0, 0.145,
      p0.x, p0.y, p0.z,
      p1.x, p1.y, p1.z,
    ], 3));
    geometry.computeVertexNormals();
    const triangle = new THREE.Mesh(geometry, fanMaterial.clone());
    triangle.scale.setScalar(0.02);
    group.add(triangle);
    return triangle;
  });
  const relaxationRings = [0.78, 0.96, 1.13].map((scale) => {
    const ring = makeTube(irregularRingPoints(0.67 * scale, 0.54 * scale, 0.15, 72), 0.009, VERIFIED, 0);
    group.add(ring);
    return ring;
  });

  return {
    group,
    update(progress, elapsed, reducedMotion) {
      const boundaryReveal = phaseProgress(progress, 0.08, 0.3);
      const membraneGrow = phaseProgress(progress, 0.3, 0.55);
      const tessellate = phaseProgress(progress, 0.5, 0.84);
      const relax = phaseProgress(progress, 0.84, 1);
      setMeshReveal(boundary, boundaryReveal);
      (boundary.material as THREE.MeshPhysicalMaterial).opacity = boundaryReveal * (0.72 + (reducedMotion ? 0 : Math.sin(elapsed * 4) * 0.15));
      membrane.scale.x = 0.05 + membraneGrow * 0.95;
      membrane.scale.y = (0.05 + membraneGrow * 0.95) * 0.8;
      membraneMaterial.opacity = membraneGrow * (1 - tessellate * 0.62) * 0.36;
      membrane.position.z = 0.12 + (reducedMotion ? 0 : Math.sin(elapsed * 3.4) * membraneGrow * 0.025);
      fanTriangles.forEach((triangle, index) => {
        const local = ease(tessellate * fanTriangles.length - index);
        triangle.scale.setScalar(0.02 + local * 0.98);
        (triangle.material as THREE.MeshPhysicalMaterial).opacity = local * 0.72;
      });
      if (anomalyWall) (anomalyWall.material as THREE.MeshPhysicalMaterial).opacity = 0.92 * (1 - tessellate * 0.78);
      relaxationRings.forEach((ring, index) => {
        const local = clamp01(relax * 1.8 - index * 0.22);
        setMeshReveal(ring, local);
        (ring.material as THREE.MeshPhysicalMaterial).opacity = local * (1 - relax) * 0.56;
        ring.scale.setScalar(0.92 + local * 0.12);
      });
      (surface.material as THREE.MeshPhysicalMaterial).opacity = 0.7 + relax * 0.08;
      (wire.material as THREE.LineBasicMaterial).opacity = 0.25 * (1 - relax * 0.38);
    },
  };
}

function fissurePath(offset = 0, z = 0.145) {
  return sampleCurve([
    new THREE.Vector3(-1.75, -0.12 + offset, z),
    new THREE.Vector3(-1.05, 0.05 + offset * 0.6, z + 0.02),
    new THREE.Vector3(-0.4, -0.16 - offset * 0.35, z + 0.035),
    new THREE.Vector3(0.28, 0.1 + offset * 0.3, z + 0.02),
    new THREE.Vector3(0.95, -0.04 - offset * 0.5, z),
    new THREE.Vector3(1.72, 0.12 + offset, z - 0.015),
  ], 80);
}

function createFissureRig(): PatchRig {
  const { group, surface, wire } = createSurfaceRig("fissure");
  const leftTrace = makeTube(fissurePath(0).slice(0, 35), 0.016, ALERT, 0.8);
  const rightTrace = makeTube(fissurePath(0).slice(47), 0.016, ALERT, 0.8);
  group.add(leftTrace, rightTrace);
  const contourLines = [-0.42, -0.28, 0.28, 0.42].map((offset) => {
    const line = makeLine(fissurePath(offset, 0.12), DEEP, 0);
    group.add(line);
    return line;
  });
  const candidates = [-0.2, 0, 0.18].map((offset, index) => {
    const path = makeTube(fissurePath(offset, 0.18), index === 1 ? 0.025 : 0.012, index === 1 ? CYAN : DEEP, 0);
    path.userData.offset = offset;
    group.add(path);
    return path;
  });
  const groove = makeTube(fissurePath(0, 0.105), 0.036, new THREE.Color(0x176e77), 0);
  group.add(groove);
  const sculptedGeometry = createSurfaceGeometry("fissure", true);
  const sculptedMaterial = new THREE.MeshPhysicalMaterial({ color: PALE, roughness: 0.26, clearcoat: 0.34, transparent: true, opacity: 0, side: THREE.DoubleSide });
  const sculptedSurface = new THREE.Mesh(sculptedGeometry, sculptedMaterial);
  sculptedSurface.scale.setScalar(1.001);
  group.add(sculptedSurface);
  const flowNodes = Array.from({ length: 7 }, (_, index) => {
    const material = new THREE.MeshBasicMaterial({ color: VERIFIED, transparent: true, opacity: 0 });
    const node = new THREE.Mesh(new THREE.SphereGeometry(0.034, 12, 10), material);
    node.userData.offset = index / 7;
    group.add(node);
    return node;
  });
  const flowCurve = new THREE.CatmullRomCurve3(fissurePath(0, 0.09));

  return {
    group,
    update(progress, elapsed, reducedMotion) {
      const trace = phaseProgress(progress, 0.08, 0.3);
      const predict = phaseProgress(progress, 0.3, 0.55);
      const sculpt = phaseProgress(progress, 0.5, 0.86);
      const verify = phaseProgress(progress, 0.86, 1);
      setMeshReveal(leftTrace, trace);
      setMeshReveal(rightTrace, trace);
      contourLines.forEach((line, index) => {
        setLineReveal(line, trace);
        (line.material as THREE.LineBasicMaterial).opacity = trace * (0.16 + index % 2 * 0.08);
      });
      candidates.forEach((candidate, index) => {
        const material = candidate.material as THREE.MeshPhysicalMaterial;
        const selected = index === 1;
        material.opacity = predict * (selected ? 0.92 : 0.3 * (1 - sculpt));
        candidate.position.y = Number(candidate.userData.offset) * (1 - sculpt);
        candidate.position.z = -sculpt * (selected ? 0.07 : 0.015);
        setMeshReveal(candidate, predict);
      });
      setMeshReveal(groove, sculpt);
      (groove.material as THREE.MeshPhysicalMaterial).opacity = sculpt * 0.78;
      groove.scale.set(1, 0.55 + sculpt * 0.45, 0.7 + sculpt * 0.3);
      sculptedMaterial.opacity = sculpt * 0.68;
      flowNodes.forEach((node) => {
        const offset = Number(node.userData.offset);
        const motion = reducedMotion ? offset : (elapsed * 0.22 + offset) % 1;
        node.position.copy(flowCurve.getPointAt(motion));
        (node.material as THREE.MeshBasicMaterial).opacity = verify * (0.45 + Math.sin(motion * Math.PI) * 0.45);
        node.scale.setScalar(0.7 + Math.sin(motion * Math.PI) * 0.45);
      });
      (surface.material as THREE.MeshPhysicalMaterial).color.copy(PALE).lerp(VERIFIED, verify * 0.1);
      (wire.material as THREE.LineBasicMaterial).opacity = 0.25 * (1 - sculpt * 0.48);
    },
  };
}

function createPatchRig(kind: ReconstructionAnomalyKind) {
  if (kind === "margin") return createMarginRig();
  if (kind === "topology") return createTopologyRig();
  if (kind === "hole") return createHoleRig();
  return createFissureRig();
}

function disposeObject(root: THREE.Object3D) {
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    if (!mesh.material) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    materials.forEach((material) => material.dispose());
  });
}

export function ReconstructionPatchScene({ kind, progress }: Props) {
  const mountRef = useRef<HTMLDivElement>(null);
  const progressRef = useRef(progress);

  useEffect(() => {
    progressRef.current = progress;
  }, [progress]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 30);
    camera.position.set(0.15, 0.22, 5.3);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, window.innerWidth < 780 ? 1.1 : 1.35));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.VSMShadowMap;
    renderer.shadowMap.autoUpdate = false;
    renderer.shadowMap.needsUpdate = true;
    renderer.setClearColor(0x000000, 0);
    mount.appendChild(renderer.domElement);
    mount.dataset.patchRenderer = "webgl-ready";

    scene.add(new THREE.HemisphereLight(0xf4ffff, 0x31565a, 2.35));
    const key = new THREE.DirectionalLight(0xffffff, 4.2);
    key.position.set(-2.5, 3.5, 4);
    key.castShadow = true;
    key.shadow.mapSize.set(512, 512);
    key.shadow.camera.near = 0.1;
    key.shadow.camera.far = 12;
    key.shadow.camera.left = -3;
    key.shadow.camera.right = 3;
    key.shadow.camera.top = 2.4;
    key.shadow.camera.bottom = -2.4;
    scene.add(key);
    const rim = new THREE.DirectionalLight(0x24b7c7, 2.4);
    rim.position.set(3, -1.5, 2.5);
    scene.add(rim);

    const rig = createPatchRig(kind);
    rig.group.rotation.x = -0.54;
    rig.group.rotation.z = kind === "margin" ? -0.04 : kind === "topology" ? 0.08 : kind === "hole" ? -0.08 : 0.03;
    rig.group.scale.setScalar(kind === "hole" ? 0.94 : 0.9);
    scene.add(rig.group);

    const scannerMaterial = new THREE.MeshBasicMaterial({ color: 0xbffaff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const scanner = new THREE.Mesh(new THREE.PlaneGeometry(4.5, 0.055), scannerMaterial);
    scanner.position.z = 0.43;
    rig.group.add(scanner);
    const lockRing = new THREE.Mesh(
      new THREE.RingGeometry(0.56, 0.59, 64),
      new THREE.MeshBasicMaterial({ color: ALERT, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }),
    );
    lockRing.scale.y = kind === "margin" ? 0.45 : kind === "topology" ? 0.72 : kind === "hole" ? 0.82 : 0.5;
    lockRing.position.set(kind === "topology" ? 0.12 : 0, kind === "margin" ? -0.42 : kind === "fissure" ? -0.04 : 0, 0.34);
    rig.group.add(lockRing);

    const resize = () => {
      const width = Math.max(1, mount.clientWidth);
      const height = Math.max(1, mount.clientHeight);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(mount);
    resize();

    let frame = 0;
    const clock = new THREE.Clock();
    let elapsed = 0;
    let lastRenderedAt = 0;
    let shadowPhase = -1;
    let sceneInViewport = true;
    let pageVisible = document.visibilityState !== "hidden";
    const render = (timestamp = performance.now()) => {
      frame = requestAnimationFrame(render);
      if (!pageVisible || !sceneInViewport) {
        clock.getDelta();
        return;
      }
      if (timestamp - lastRenderedAt < 1000 / 30) return;
      lastRenderedAt = timestamp;
      const delta = Math.min(clock.getDelta(), 0.05);
      if (!reducedMotion) elapsed += delta;
      const currentProgress = clamp01(progressRef.current);
      const search = phaseProgress(currentProgress, 0, 0.15);
      const reveal = phaseProgress(currentProgress, 0.15, 0.3);
      scanner.position.y = THREE.MathUtils.lerp(-1.22, 1.18, search);
      scannerMaterial.opacity = Math.sin(search * Math.PI) * 0.88;
      const lockMaterial = lockRing.material as THREE.MeshBasicMaterial;
      lockMaterial.opacity = reveal * (1 - phaseProgress(currentProgress, 0.3, 0.42)) * (0.68 + (reducedMotion ? 0 : Math.sin(elapsed * 5) * 0.22));
      lockRing.scale.x = 0.72 + reveal * 0.28;
      rig.update(currentProgress, elapsed, reducedMotion);
      const nextShadowPhase = currentProgress < 0.3 ? 0 : currentProgress < 0.86 ? 1 : 2;
      if (nextShadowPhase !== shadowPhase) {
        shadowPhase = nextShadowPhase;
        renderer.shadowMap.needsUpdate = true;
      }
      const approach = phaseProgress(currentProgress, 0, 0.18);
      const repair = phaseProgress(currentProgress, 0.3, 0.86);
      const verify = phaseProgress(currentProgress, 0.86, 1);
      const sideYaw = kind === "margin" ? -0.36 : kind === "topology" ? 0.42 : kind === "hole" ? -0.46 : 0.28;
      const targetYaw = sideYaw * (0.35 + repair * 0.65) * (1 - verify * 0.72);
      const targetPitch = kind === "hole" ? -0.7 : kind === "margin" ? -0.64 : kind === "topology" ? -0.58 : -0.48;
      rig.group.rotation.x = reducedMotion ? targetPitch : THREE.MathUtils.damp(rig.group.rotation.x, targetPitch, 3.1, delta);
      rig.group.rotation.y = reducedMotion ? targetYaw : THREE.MathUtils.damp(rig.group.rotation.y, targetYaw, 3.1, delta);
      const targetRoll = kind === "fissure" ? -0.08 + repair * 0.06 : kind === "topology" ? 0.08 : -0.035;
      rig.group.rotation.z = reducedMotion ? targetRoll : THREE.MathUtils.damp(rig.group.rotation.z, targetRoll, 3.1, delta);
      rig.group.position.y = reducedMotion ? 0 : Math.sin(elapsed * 0.5) * 0.012;
      const cameraX = sideYaw * 1.28 * repair;
      const cameraY = (kind === "margin" ? -0.18 : kind === "fissure" ? 0.34 : 0.18) + approach * 0.09;
      const cameraZ = 5.75 - approach * 0.72 + verify * 0.38;
      camera.position.x = reducedMotion ? cameraX : THREE.MathUtils.damp(camera.position.x, cameraX, 2.8, delta);
      camera.position.y = reducedMotion ? cameraY : THREE.MathUtils.damp(camera.position.y, cameraY, 2.8, delta);
      camera.position.z = reducedMotion ? cameraZ : THREE.MathUtils.damp(camera.position.z, cameraZ, 2.8, delta);
      camera.lookAt(0, kind === "margin" ? -0.24 : 0, -0.04);
      renderer.render(scene, camera);
    };
    const viewportObserver = new IntersectionObserver((entries) => {
      sceneInViewport = entries[0]?.isIntersecting ?? true;
      if (sceneInViewport) clock.getDelta();
    }, { rootMargin: "80px" });
    viewportObserver.observe(mount);
    const handleVisibilityChange = () => {
      pageVisible = document.visibilityState !== "hidden";
      if (pageVisible) clock.getDelta();
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    render();

    return () => {
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      viewportObserver.disconnect();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      disposeObject(scene);
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    };
  }, [kind]);

  return <div ref={mountRef} className="reconstruction-patch-webgl" aria-hidden="true" />;
}
