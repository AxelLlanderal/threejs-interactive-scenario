import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Octree } from 'three/addons/math/Octree.js';
import { Capsule } from 'three/addons/math/Capsule.js';
import RAPIER from 'https://cdn.skypack.dev/@dimforge/rapier3d-compat';

/* =========================================================
   INICIAR RAPIER
========================================================= */
await RAPIER.init();

/* =========================================================
   ESCENA Y RENDERER
========================================================= */
const container = document.getElementById('scene-container');
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x07111f);
scene.fog = new THREE.Fog(0x07111f, 18, 65);

const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.rotation.order = 'YXZ';
scene.add(camera); // Importante agregar la cámara a la escena para llevar objetos hijos (el arma)

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
container.appendChild(renderer.domElement);

/* =========================================================
   LUCES Y TIMER
========================================================= */
scene.add(new THREE.HemisphereLight(0xbfe3ff, 0x182030, 1.8));

const sun = new THREE.DirectionalLight(0xffffff, 3);
sun.position.set(-5, 18, 6);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
scene.add(sun);

const clock = new THREE.Clock();

/* =========================================================
   OCTREE Y JUGADOR
========================================================= */
const worldOctree = new Octree();
const playerCollider = new Capsule(
    new THREE.Vector3(0, 0.35, 0),
    new THREE.Vector3(0, 1, 0),
    0.35
);
const playerVelocity = new THREE.Vector3();
const playerDirection = new THREE.Vector3();
const keyStates = {};
let playerOnFloor = false;

/* =========================================================
   MODELO 3D DEL ARMA EN MANO Y EFECTOS
========================================================= */
const gunGroup = new THREE.Group();

// Materiales del arma
const metalMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.3, metalness: 0.8 });
const gripMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.8 });

// Cañón / Cuerpo principal
const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.1, 0.45), metalMat);
barrel.position.set(0, 0, -0.2);

// Empuñadura / Mango
const grip = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.18, 0.08), gripMat);
grip.position.set(0, -0.1, -0.05);
grip.rotation.x = -0.2;

gunGroup.add(barrel);
gunGroup.add(grip);

// Posicionar el arma abajo a la derecha de la vista (pantalla)
gunGroup.position.set(0.28, -0.22, -0.45);
camera.add(gunGroup); // Unir el arma a la cámara

// Chispazo del cañón (Muzzle Flash)
const flashLight = new THREE.PointLight(0xffa500, 0, 3);
flashLight.position.set(0.28, -0.17, -0.7);
camera.add(flashLight);

// Variables para el efecto de retroceso (Recoil)
const defaultGunPos = new THREE.Vector3(0.28, -0.22, -0.45);
let recoilAmount = 0;

/* =========================================================
   MUNDO FÍSICO RAPIER
========================================================= */
const physicsWorld = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
const physicalObjects = [];
const bullets = [];

/* =========================================================
   RAYCASTER PARA BUSCAR EL SUELO
========================================================= */
const groundRaycaster = new THREE.Raycaster();
const rayOrigin = new THREE.Vector3();
const downDirection = new THREE.Vector3(0, -1, 0);
let scenarioMeshes = [];

/* =========================================================
   COLORES ALEATORIOS
========================================================= */
const cubeColors = [0x22d3ee, 0x38bdf8, 0xa78bfa, 0xf472b6, 0xfacc15, 0x4ade80, 0xfb923c, 0xe2e8f0];
function getRandomColor() {
    return cubeColors[Math.floor(Math.random() * cubeColors.length)];
}

/* =========================================================
   CREAR OBJETOS CON DIVERSAS FORMAS DINÁMICAS
========================================================= */
function createDynamicShape(x, y, z, mass = 4, color = 0x94a3b8) {
    const shapeTypes = ['box', 'sphere', 'cylinder', 'cone'];
    const shape = shapeTypes[Math.floor(Math.random() * shapeTypes.length)];
    
    let geometry, colliderDesc, radius, height, sx, sy, sz;
    const size = THREE.MathUtils.randFloat(0.6, 1.3);

    if (shape === 'box') {
        sx = size; sy = size; sz = size;
        geometry = new THREE.BoxGeometry(sx, sy, sz);
        colliderDesc = RAPIER.ColliderDesc.cuboid(sx / 2, sy / 2, sz / 2);
    } else if (shape === 'sphere') {
        radius = size / 2;
        sx = size; sy = size; sz = size;
        geometry = new THREE.SphereGeometry(radius, 16, 16);
        colliderDesc = RAPIER.ColliderDesc.ball(radius);
    } else if (shape === 'cylinder') {
        radius = size / 2;
        height = size * 1.2;
        sx = size; sy = height; sz = size;
        geometry = new THREE.CylinderGeometry(radius, radius, height, 16);
        colliderDesc = RAPIER.ColliderDesc.cylinder(height / 2, radius);
    } else {
        radius = size / 2;
        height = size * 1.2;
        sx = size; sy = height; sz = size;
        geometry = new THREE.ConeGeometry(radius, height, 16);
        colliderDesc = RAPIER.ColliderDesc.cone(height / 2, radius);
    }

    const material = new THREE.MeshStandardMaterial({
        color: color,
        roughness: 0.65,
        metalness: 0.08
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);

    const bodyDescription = RAPIER.RigidBodyDesc.dynamic().setTranslation(x, y, z);
    const body = physicsWorld.createRigidBody(bodyDescription);
    body.enableCcd(true);

    const volume = Math.max(sx * sy * sz, 0.01);
    colliderDesc.setDensity(mass / volume).setFriction(0.8).setRestitution(0.05);
    physicsWorld.createCollider(colliderDesc, body);

    physicalObjects.push({
        mesh: mesh,
        body: body,
        size: new THREE.Vector3(sx, sy, sz),
        radius: radius || size / 2
    });

    return { mesh, body };
}

/* =========================================================
   BUSCAR ALTURA DEL SUELO
========================================================= */
function findGroundHeight(x, z) {
    rayOrigin.set(x, 50, z);
    groundRaycaster.set(rayOrigin, downDirection);
    groundRaycaster.far = 100;

    const intersections = groundRaycaster.intersectObjects(scenarioMeshes, false);
    if (intersections.length === 0) return null;
    return intersections[0].point.y;
}

/* =========================================================
   COMPROBAR POSICIÓN DISPONIBLE
========================================================= */
function isPositionAvailable(x, y, z, size) {
    const margin = 0.3;
    for (const item of physicalObjects) {
        const p = item.body.translation();
        const dist = Math.hypot(x - p.x, y - p.y, z - p.z);
        if (dist < (size / 2 + item.size.x / 2 + margin)) {
            return false;
        }
    }
    return true;
}

/* =========================================================
   GENERAR OBJETOS ALEATORIOS
========================================================= */
function generateRandomBoxes(amount = 15) {
    let created = 0;
    let attempts = 0;

    while (created < amount && attempts < 300) {
        attempts++;
        const x = THREE.MathUtils.randFloat(-10, 10);
        const z = THREE.MathUtils.randFloat(-12, 4);
        const groundY = findGroundHeight(x, z);

        if (groundY === null) continue;

        const size = 1.0;
        const y = groundY + size;

        if (!isPositionAvailable(x, y, z, size)) continue;

        createDynamicShape(x, y, z, THREE.MathUtils.randFloat(2, 8), getRandomColor());
        created++;
    }
}

/* =========================================================
   COLLISION RAPIER DEL ESCENARIO
========================================================= */
function createRapierColliderFromMesh(mesh) {
    const geometry = mesh.geometry;
    if (!geometry || !geometry.attributes.position) return;

    mesh.updateWorldMatrix(true, false);
    const positions = geometry.attributes.position;
    const vertices = new Float32Array(positions.count * 3);
    const vertex = new THREE.Vector3();

    for (let i = 0; i < positions.count; i++) {
        vertex.fromBufferAttribute(positions, i);
        vertex.applyMatrix4(mesh.matrixWorld);
        vertices[i * 3] = vertex.x;
        vertices[i * 3 + 1] = vertex.y;
        vertices[i * 3 + 2] = vertex.z;
    }

    let indices;
    if (geometry.index) {
        indices = new Uint32Array(geometry.index.count);
        for (let i = 0; i < geometry.index.count; i++) {
            indices[i] = geometry.index.getX(i);
        }
    } else {
        indices = new Uint32Array(positions.count);
        for (let i = 0; i < positions.count; i++) {
            indices[i] = i;
        }
    }

    const colliderDescription = RAPIER.ColliderDesc.trimesh(vertices, indices)
        .setFriction(0.9)
        .setRestitution(0.05);

    physicsWorld.createCollider(colliderDescription);
}

/* =========================================================
   CARGAR ESCENARIO
========================================================= */
const loader = new GLTFLoader();
loader.load('./assets/models/collision-world.glb', (gltf) => {
    const model = gltf.scene;
    model.updateMatrixWorld(true);

    model.traverse((child) => {
        if (child.isMesh) {
            child.castShadow = true;
            child.receiveShadow = true;
            if (child.material?.map) child.material.map.anisotropy = 4;
            scenarioMeshes.push(child);
        }
    });

    scene.add(model);
    worldOctree.fromGraphNode(model);

    model.traverse((child) => {
        if (child.isMesh) {
            createRapierColliderFromMesh(child);
        }
    });

    generateRandomBoxes(15);
});

/* =========================================================
   CONTROLES Y DIRECCIÓN DEL JUGADOR
========================================================= */
function getForwardVector() {
    camera.getWorldDirection(playerDirection);
    playerDirection.y = 0;
    return playerDirection.normalize();
}

function getSideVector() {
    camera.getWorldDirection(playerDirection);
    playerDirection.y = 0;
    playerDirection.normalize();
    playerDirection.cross(camera.up);
    return playerDirection;
}

function controls(deltaTime) {
    const speed = playerOnFloor ? 18 : 7;
    if (keyStates.KeyW) playerVelocity.add(getForwardVector().multiplyScalar(speed * deltaTime));
    if (keyStates.KeyS) playerVelocity.add(getForwardVector().multiplyScalar(-speed * deltaTime));
    if (keyStates.KeyA) playerVelocity.add(getSideVector().multiplyScalar(-speed * deltaTime));
    if (keyStates.KeyD) playerVelocity.add(getSideVector().multiplyScalar(speed * deltaTime));
    if (playerOnFloor && keyStates.Space) playerVelocity.y = 7;
}

/* =========================================================
   COLISIONES DEL JUGADOR CON EL ESCENARIO Y OBJETOS
========================================================= */
function playerCollisions() {
    const result = worldOctree.capsuleIntersect(playerCollider);
    playerOnFloor = false;

    if (result) {
        playerOnFloor = result.normal.y > 0;
        if (!playerOnFloor) {
            playerVelocity.addScaledVector(result.normal, -result.normal.dot(playerVelocity));
        }
        playerCollider.translate(result.normal.multiplyScalar(result.depth));
    }

    const playerCenter = playerCollider.end.clone().add(playerCollider.start).multiplyScalar(0.5);
    const playerRadius = playerCollider.radius;

    for (const item of physicalObjects) {
        const p = item.body.translation();
        const objPos = new THREE.Vector3(p.x, p.y, p.z);
        const dist = playerCenter.distanceTo(objPos);
        const minDistance = playerRadius + (item.size.x / 2);

        if (dist < minDistance) {
            const overlap = minDistance - dist;
            const pushDir = playerCenter.clone().sub(objPos).normalize();
            pushDir.y = 0;

            if (pushDir.lengthSq() > 0) {
                pushDir.normalize();
                playerCollider.translate(pushDir.multiplyScalar(overlap));
            }
        }
    }
}

/* =========================================================
   EMPUJAR OBJETOS CON EL JUGADOR
========================================================= */
function pushNearbyObjects() {
    const moving = new THREE.Vector3(playerVelocity.x, 0, playerVelocity.z);
    if (moving.lengthSq() < 0.04) return;

    for (const item of physicalObjects) {
        const p = item.body.translation();
        const dx = p.x - camera.position.x;
        const dz = p.z - camera.position.z;
        const distance = Math.hypot(dx, dz);

        if (distance < 1.15) {
            const force = 0.7 / Math.max(distance, 0.25);
            item.body.applyImpulse({ x: dx * force, y: 0.05, z: dz * force }, true);
        }
    }
}

/* =========================================================
   ACTUALIZAR JUGADOR Y EFECTO DE RETROCESO (RECOIL)
========================================================= */
function updatePlayer(deltaTime) {
    let damping = Math.exp(-4 * deltaTime) - 1;
    if (!playerOnFloor) {
        playerVelocity.y -= 25 * deltaTime;
        damping *= 0.1;
    }

    playerVelocity.addScaledVector(playerVelocity, damping);
    const movement = playerVelocity.clone().multiplyScalar(deltaTime);
    playerCollider.translate(movement);

    playerCollisions();
    camera.position.copy(playerCollider.end);
    pushNearbyObjects();

    // Actualizar animación de retroceso del arma
    if (recoilAmount > 0) {
        recoilAmount = Math.max(0, recoilAmount - deltaTime * 5);
        gunGroup.position.z = defaultGunPos.z + recoilAmount * 0.15;
        gunGroup.rotation.x = recoilAmount * 0.2;
    } else {
        gunGroup.position.copy(defaultGunPos);
        gunGroup.rotation.set(0, 0, 0);
    }

    if (camera.position.y < -20) {
        playerCollider.start.set(0, 0.35, 0);
        playerCollider.end.set(0, 1, 0);
        playerVelocity.set(0, 0, 0);
        camera.position.copy(playerCollider.end);
    }
}

/* =========================================================
   SISTEMA DE BALAS Y DISPARO
========================================================= */
function shootBullet() {
    if (document.pointerLockElement !== renderer.domElement) return;

    const direction = new THREE.Vector3();
    camera.getWorldDirection(direction).normalize();

    // Crear la bala
    const geometry = new THREE.SphereGeometry(0.06, 12, 12);
    const material = new THREE.MeshStandardMaterial({
        color: 0xf59e0b,
        roughness: 0.2,
        metalness: 0.9,
        emissive: 0xd97706,
        emissiveIntensity: 0.8
    });

    const mesh = new THREE.Mesh(geometry, material);
    
    // Nacer desde el extremo del cañón del arma
    mesh.position.copy(camera.position).addScaledVector(direction, 0.7);
    mesh.castShadow = true;
    scene.add(mesh);

    bullets.push({ 
        mesh: mesh, 
        direction: direction.clone(), 
        speed: 80, 
        life: 1.2 
    });

    // Activar retroceso de la pistola
    recoilAmount = 0.8;

    // Activar destello de fuego (Muzzle Flash)
    flashLight.intensity = 8;
    setTimeout(() => { flashLight.intensity = 0; }, 40);
}

function createImpact(position) {
    const flash = new THREE.PointLight(0xfba100, 5, 2, 2);
    flash.position.copy(position);
    scene.add(flash);
    setTimeout(() => scene.remove(flash), 60);
}

function updateBullets(deltaTime) {
    const meshes = physicalObjects.map(item => item.mesh);

    for (let i = bullets.length - 1; i >= 0; i--) {
        const bullet = bullets[i];
        const distance = bullet.speed * deltaTime;
        
        const ray = new THREE.Raycaster(bullet.mesh.position, bullet.direction, 0, distance + 0.2);
        const hit = ray.intersectObjects(meshes, false)[0];

        if (hit) {
            const item = physicalObjects.find(entry => entry.mesh === hit.object);
            if (item) {
                item.body.applyImpulseAtPoint({
                    x: bullet.direction.x * 15,
                    y: bullet.direction.y * 15 + 2,
                    z: bullet.direction.z * 15
                }, hit.point, true);
            }

            createImpact(hit.point);
            scene.remove(bullet.mesh);
            bullets.splice(i, 1);
            continue;
        }

        bullet.mesh.position.addScaledVector(bullet.direction, distance);
        bullet.life -= deltaTime;

        if (bullet.life <= 0) {
            scene.remove(bullet.mesh);
            bullets.splice(i, 1);
        }
    }
}

/* =========================================================
   SINCRONIZAR RAPIER CON THREE.JS
========================================================= */
function syncPhysics() {
    for (const item of physicalObjects) {
        const position = item.body.translation();
        const rotation = item.body.rotation();
        item.mesh.position.set(position.x, position.y, position.z);
        item.mesh.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);
    }
}

/* =========================================================
   EVENTOS
========================================================= */
document.addEventListener('keydown', (event) => { keyStates[event.code] = true; });
document.addEventListener('keyup', (event) => { keyStates[event.code] = false; });

renderer.domElement.addEventListener('click', () => {
    if (document.pointerLockElement !== renderer.domElement) {
        renderer.domElement.requestPointerLock();
    }
});

document.addEventListener('mousemove', (event) => {
    if (document.pointerLockElement !== renderer.domElement) return;
    camera.rotation.y -= event.movementX / 500;
    camera.rotation.x -= event.movementY / 500;
    camera.rotation.x = THREE.MathUtils.clamp(camera.rotation.x, -Math.PI / 2, Math.PI / 2);
});

document.addEventListener('mousedown', (event) => {
    if (event.button === 0) shootBullet();
});

/* =========================================================
   ANIMACIÓN Y RESIZE
========================================================= */
function animate() {
    const delta = Math.min(0.033, clock.getDelta());

    controls(delta);
    updatePlayer(delta);

    physicsWorld.timestep = delta;
    physicsWorld.step();
    syncPhysics();

    updateBullets(delta);
    renderer.render(scene, camera);
}

renderer.setAnimationLoop(animate);

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});