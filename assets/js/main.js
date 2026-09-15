import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Octree } from 'three/addons/math/Octree.js';
import { Capsule } from 'three/addons/math/Capsule.js';
import RAPIER from 'https://cdn.skypack.dev/@dimforge/rapier3d-compat';

await RAPIER.init();

/* =========================================================
   INTERFAZ DE USUARIO (HUD) - ESQUINA INFERIOR IZQUIERDA
========================================================= */
const hudContainer = document.createElement('div');
hudContainer.style.position = 'absolute';
hudContainer.style.bottom = '20px';
hudContainer.style.left = '20px';
hudContainer.style.color = '#ffffff';
hudContainer.style.fontFamily = 'Consolas, monospace, sans-serif';
hudContainer.style.fontSize = '18px';
hudContainer.style.fontWeight = 'bold';
hudContainer.style.background = 'rgba(15, 23, 42, 0.75)';
hudContainer.style.padding = '12px 20px';
hudContainer.style.borderRadius = '8px';
hudContainer.style.border = '2px solid rgba(255, 255, 255, 0.1)';
hudContainer.style.boxShadow = '0 4px 12px rgba(0,0,0,0.5)';
hudContainer.style.pointerEvents = 'none';
hudContainer.style.zIndex = '100';
hudContainer.innerHTML = `
    <div style="margin-bottom: 4px;">VIDA: <span id="health-val" style="color: #4ade80;">100</span></div>
    <div style="margin-bottom: 4px;">KILLS: <span id="kills-val" style="color: #facc15;">0</span></div>
    <div>MUERTES: <span id="deaths-val" style="color: #ef4444;">0</span></div>
`;
document.body.appendChild(hudContainer);

let killCount = 0;
let deathCount = 0;
let playerHealth = 100;

function updateHUD() {
    const hpElem = document.getElementById('health-val');
    const killElem = document.getElementById('kills-val');
    const deathElem = document.getElementById('deaths-val');
    if (hpElem) {
        hpElem.innerText = playerHealth;
        hpElem.style.color = playerHealth > 30 ? '#4ade80' : '#ef4444';
    }
    if (killElem) killElem.innerText = killCount;
    if (deathElem) deathElem.innerText = deathCount;
}

/* =========================================================
   ESCENA Y RENDERER
========================================================= */
const container = document.getElementById('scene-container');
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x07111f);
scene.fog = new THREE.Fog(0x07111f, 18, 65);

const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.rotation.order = 'YXZ';
scene.add(camera);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
container.appendChild(renderer.domElement);

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
   ARMAS JUGADOR
========================================================= */
const gunContainer = new THREE.Group();
gunContainer.position.set(0.28, -0.22, -0.45);
camera.add(gunContainer);

const flashLight = new THREE.PointLight(0xffa500, 0, 4);
flashLight.position.set(0.28, -0.17, -0.7);
camera.add(flashLight);

const darkMetal = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.3, metalness: 0.8 });
const lightMetal = new THREE.MeshStandardMaterial({ color: 0x64748b, roughness: 0.2, metalness: 0.9 });
const woodMat = new THREE.MeshStandardMaterial({ color: 0x78350f, roughness: 0.7 });
const gripMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.9 });

const weapons = {
    1: { name: 'Pistola', force: 15, damage: 25, speed: 80, cooldown: 0.25, bulletsPerShot: 1, spread: 0.01, recoilForce: 0.6, color: 0xf59e0b, mesh: createPistolMesh() },
    2: { name: 'Escopeta', force: 22, damage: 12, speed: 65, cooldown: 0.8, bulletsPerShot: 8, spread: 0.09, recoilForce: 1.6, color: 0xeab308, mesh: createShotgunMesh() },
    3: { name: 'Subfusil', force: 8, damage: 10, speed: 85, cooldown: 0.09, bulletsPerShot: 1, spread: 0.035, recoilForce: 0.3, color: 0x38bdf8, mesh: createSMGMesh() },
    4: { name: 'Sniper', force: 85, damage: 100, speed: 150, cooldown: 1.2, bulletsPerShot: 1, spread: 0.001, recoilForce: 2.2, color: 0xef4444, mesh: createSniperMesh() },
    5: { name: 'Lanzagranadas', force: 120, damage: 80, speed: 40, cooldown: 1.0, bulletsPerShot: 1, spread: 0.01, recoilForce: 2.0, color: 0x22c55e, mesh: createLauncherMesh() }
};

let currentWeaponKey = 1;
let lastShotTime = 0;
let recoilAmount = 0;
const defaultGunPos = new THREE.Vector3(0.28, -0.22, -0.45);

function createPistolMesh() {
    const group = new THREE.Group();
    const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.1, 0.4), darkMetal);
    barrel.position.set(0, 0, -0.15);
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.18, 0.08), gripMat);
    grip.position.set(0, -0.1, -0.02);
    grip.rotation.x = -0.2;
    group.add(barrel, grip);
    return group;
}

function createShotgunMesh() {
    const group = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.12, 0.4), darkMetal);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.6, 12), lightMetal);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0.02, -0.35);
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.12, 0.3), woodMat);
    stock.position.set(0, -0.04, 0.15);
    group.add(body, barrel, stock);
    return group;
}

function createSMGMesh() {
    const group = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.14, 0.35), darkMetal);
    const mag = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.25, 0.07), lightMetal);
    mag.position.set(0, -0.15, -0.05);
    mag.rotation.x = 0.2;
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.25, 10), lightMetal);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0.03, -0.28);
    group.add(body, mag, barrel);
    return group;
}

function createSniperMesh() {
    const group = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.1, 0.5), darkMetal);
    const longBarrel = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.85, 12), lightMetal);
    longBarrel.rotation.x = Math.PI / 2;
    longBarrel.position.set(0, 0.02, -0.5);
    const scope = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.25, 12), darkMetal);
    scope.rotation.x = Math.PI / 2;
    scope.position.set(0, 0.09, -0.1);
    group.add(body, longBarrel, scope);
    return group;
}

function createLauncherMesh() {
    const group = new THREE.Group();
    const bigBarrel = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.65, 16), darkMetal);
    bigBarrel.rotation.x = Math.PI / 2;
    bigBarrel.position.set(0, 0.02, -0.25);
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.18, 0.08), gripMat);
    grip.position.set(0, -0.12, -0.05);
    group.add(bigBarrel, grip);
    return group;
}

Object.keys(weapons).forEach(key => {
    gunContainer.add(weapons[key].mesh);
    weapons[key].mesh.visible = (key == currentWeaponKey);
});

function switchWeapon(key) {
    if (!weapons[key] || key == currentWeaponKey) return;
    weapons[currentWeaponKey].mesh.visible = false;
    currentWeaponKey = key;
    weapons[currentWeaponKey].mesh.visible = true;
}

/* =========================================================
   FÍSICAS Y ARRAYS
========================================================= */
const physicsWorld = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
const physicalObjects = [];
const playerBullets = [];
const enemyBullets = [];

/* =========================================================
   ENEMIGO Y MOVIMIENTO
========================================================= */
let enemy = null;

function createEnemy(x, y, z) {
    const group = new THREE.Group();

    const bodyGeo = new THREE.CapsuleGeometry(0.4, 1.2, 8, 16);
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0xd97706, roughness: 0.4 });
    const mesh = new THREE.Mesh(bodyGeo, bodyMat);
    mesh.castShadow = true;
    group.add(mesh);

    const eyeGeo = new THREE.BoxGeometry(0.3, 0.12, 0.2);
    const eyeMat = new THREE.MeshStandardMaterial({ color: 0xef4444, emissive: 0xef4444, emissiveIntensity: 2 });
    const eye = new THREE.Mesh(eyeGeo, eyeMat);
    eye.position.set(0, 0.4, -0.3);
    group.add(eye);

    group.position.set(x, y, z);
    scene.add(group);

    const bodyDesc = RAPIER.RigidBodyDesc.dynamic().setTranslation(x, y, z).lockRotations();
    const body = physicsWorld.createRigidBody(bodyDesc);
    const colliderDesc = RAPIER.ColliderDesc.capsule(0.6, 0.4).setFriction(0.8);
    physicsWorld.createCollider(colliderDesc, body);

    enemy = {
        mesh: group,
        body: body,
        health: 100,
        lastShot: 0,
        fireRate: 1.1,
        alive: true,
        moveSpeed: 3.5
    };
}

function updateEnemy(now, delta) {
    if (!enemy || !enemy.alive) return;

    const pos = enemy.body.translation();
    enemy.mesh.position.set(pos.x, pos.y, pos.z);

    const playerPos = camera.position.clone();
    playerPos.y = pos.y;
    enemy.mesh.lookAt(playerPos);

    const enemyPos = new THREE.Vector3(pos.x, pos.y, pos.z);
    const distToPlayer = enemyPos.distanceTo(camera.position);

    // LÓGICA DE MOVIMIENTO DEL ENEMIGO
    if (distToPlayer > 3 && distToPlayer < 30) {
        const moveDir = camera.position.clone().sub(enemyPos);
        moveDir.y = 0;
        moveDir.normalize();

        const currentVel = enemy.body.linvel();
        enemy.body.setLinvel({
            x: moveDir.x * enemy.moveSpeed,
            y: currentVel.y,
            z: moveDir.z * enemy.moveSpeed
        }, true);
    }

    // DISPARAR AL JUGADOR
    const muzzlePos = new THREE.Vector3(pos.x, pos.y + 0.4, pos.z);
    if (distToPlayer < 25 && now - enemy.lastShot > enemy.fireRate) {
        enemy.lastShot = now;
        shootEnemyBullet(muzzlePos);
    }
}

function shootEnemyBullet(fromPosition) {
    const direction = camera.position.clone().sub(fromPosition).normalize();
    direction.x += (Math.random() - 0.5) * 0.08;
    direction.y += (Math.random() - 0.5) * 0.08;
    direction.z += (Math.random() - 0.5) * 0.08;
    direction.normalize();

    const geometry = new THREE.SphereGeometry(0.12, 10, 10);
    const material = new THREE.MeshStandardMaterial({
        color: 0xef4444,
        emissive: 0xd97706,
        emissiveIntensity: 2
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.copy(fromPosition);
    scene.add(mesh);

    enemyBullets.push({
        mesh: mesh,
        direction: direction,
        speed: 35,
        life: 2.0
    });
}

function damageEnemy(amount) {
    if (!enemy || !enemy.alive) return;

    enemy.health -= amount;

    enemy.mesh.children[0].material.color.setHex(0xffffff);
    setTimeout(() => {
        if (enemy && enemy.alive) enemy.mesh.children[0].material.color.setHex(0xd97706);
    }, 100);

    if (enemy.health <= 0) {
        enemy.alive = false;
        killCount++;
        updateHUD();

        enemy.mesh.visible = false;
        enemy.body.setTranslation({ x: 0, y: -100, z: 0 }, true);

        setTimeout(() => {
            if (enemy) {
                enemy.health = 100;
                enemy.alive = true;
                enemy.mesh.visible = true;
                enemy.body.setTranslation({ x: 0, y: 4, z: -10 }, true);
                enemy.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
            }
        }, 3000);
    }
}

function damagePlayer(amount) {
    playerHealth = Math.max(0, playerHealth - amount);
    updateHUD();

    if (playerHealth <= 0) {
        deathCount++;
        playerHealth = 100;
        updateHUD();
        playerCollider.start.set(0, 0.35, 0);
        playerCollider.end.set(0, 1, 0);
        playerVelocity.set(0, 0, 0);
    }
}

/* =========================================================
   ESCENARIO Y BLOQUES
========================================================= */
const groundRaycaster = new THREE.Raycaster();
const rayOrigin = new THREE.Vector3();
const downDirection = new THREE.Vector3(0, -1, 0);
let scenarioMeshes = [];

const cubeColors = [0x22d3ee, 0x38bdf8, 0xa78bfa, 0xf472b6, 0xfacc15, 0x4ade80, 0xfb923c, 0xe2e8f0];
function getRandomColor() {
    return cubeColors[Math.floor(Math.random() * cubeColors.length)];
}

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

    const material = new THREE.MeshStandardMaterial({ color: color, roughness: 0.65, metalness: 0.08 });
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

    physicalObjects.push({ mesh, body, size: new THREE.Vector3(sx, sy, sz), radius: radius || size / 2 });
    return { mesh, body };
}

function findGroundHeight(x, z) {
    rayOrigin.set(x, 50, z);
    groundRaycaster.set(rayOrigin, downDirection);
    groundRaycaster.far = 100;
    const intersections = groundRaycaster.intersectObjects(scenarioMeshes, false);
    if (intersections.length === 0) return null;
    return intersections[0].point.y;
}

function isPositionAvailable(x, y, z, size) {
    const margin = 0.3;
    for (const item of physicalObjects) {
        const p = item.body.translation();
        const dist = Math.hypot(x - p.x, y - p.y, z - p.z);
        if (dist < (size / 2 + item.size.x / 2 + margin)) return false;
    }
    return true;
}

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
    createEnemy(0, 4, -8);
});

/* =========================================================
   CONTROLES
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

    if (recoilAmount > 0) {
        recoilAmount = Math.max(0, recoilAmount - deltaTime * 6);
        gunContainer.position.z = defaultGunPos.z + recoilAmount * 0.15;
        gunContainer.rotation.x = recoilAmount * 0.25;
    } else {
        gunContainer.position.copy(defaultGunPos);
        gunContainer.rotation.set(0, 0, 0);
    }

    if (camera.position.y < -20) {
        playerCollider.start.set(0, 0.35, 0);
        playerCollider.end.set(0, 1, 0);
        playerVelocity.set(0, 0, 0);
        camera.position.copy(playerCollider.end);
    }
}

/* =========================================================
   DISPAROS Y SISTEMA DE BALAS
========================================================= */
function shoot() {
    if (document.pointerLockElement !== renderer.domElement) return;

    const now = clock.getElapsedTime();
    const weapon = weapons[currentWeaponKey];

    if (now - lastShotTime < weapon.cooldown) return;
    lastShotTime = now;

    const baseDirection = new THREE.Vector3();
    camera.getWorldDirection(baseDirection).normalize();

    for (let i = 0; i < weapon.bulletsPerShot; i++) {
        const spreadDir = baseDirection.clone().add(new THREE.Vector3(
            (Math.random() - 0.5) * weapon.spread,
            (Math.random() - 0.5) * weapon.spread,
            (Math.random() - 0.5) * weapon.spread
        )).normalize();

        const bulletRadius = currentWeaponKey == 5 ? 0.18 : 0.06;
        const geometry = new THREE.SphereGeometry(bulletRadius, 12, 12);
        const material = new THREE.MeshStandardMaterial({
            color: weapon.color,
            roughness: 0.2,
            metalness: 0.8,
            emissive: weapon.color,
            emissiveIntensity: 0.6
        });

        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.copy(camera.position).addScaledVector(spreadDir, 0.7);
        mesh.castShadow = true;
        scene.add(mesh);

        playerBullets.push({
            mesh: mesh,
            direction: spreadDir,
            speed: weapon.speed,
            force: weapon.force,
            damage: weapon.damage,
            life: 1.2
        });
    }

    recoilAmount = weapon.recoilForce;

    flashLight.color.setHex(weapon.color);
    flashLight.intensity = 8;
    setTimeout(() => { flashLight.intensity = 0; }, 40);
}

function createImpact(position, color) {
    const flash = new THREE.PointLight(color, 6, 3, 2);
    flash.position.copy(position);
    scene.add(flash);
    setTimeout(() => scene.remove(flash), 70);
}

function updateBullets(deltaTime) {
    const dynamicMeshes = physicalObjects.map(item => item.mesh);
    const allColliders = [...dynamicMeshes, ...scenarioMeshes];
    
    if (enemy && enemy.alive) allColliders.push(enemy.mesh.children[0]);

    // 1. BALAS DEL JUGADOR
    for (let i = playerBullets.length - 1; i >= 0; i--) {
        const bullet = playerBullets[i];
        const distance = bullet.speed * deltaTime;

        const ray = new THREE.Raycaster(bullet.mesh.position, bullet.direction, 0, distance + 0.2);
        const hit = ray.intersectObjects(allColliders, false)[0];

        if (hit) {
            if (enemy && enemy.alive && hit.object === enemy.mesh.children[0]) {
                damageEnemy(bullet.damage);
                enemy.body.applyImpulse({
                    x: bullet.direction.x * (bullet.force * 0.2),
                    y: 1.5,
                    z: bullet.direction.z * (bullet.force * 0.2)
                }, true);
            } else {
                const item = physicalObjects.find(entry => entry.mesh === hit.object);
                if (item) {
                    item.body.applyImpulseAtPoint({
                        x: bullet.direction.x * bullet.force,
                        y: bullet.direction.y * bullet.force + (bullet.force * 0.1),
                        z: bullet.direction.z * bullet.force
                    }, hit.point, true);
                }
            }

            createImpact(hit.point, bullet.mesh.material.color.getHex());
            scene.remove(bullet.mesh);
            playerBullets.splice(i, 1);
            continue;
        }

        bullet.mesh.position.addScaledVector(bullet.direction, distance);
        bullet.life -= deltaTime;

        if (bullet.life <= 0) {
            scene.remove(bullet.mesh);
            playerBullets.splice(i, 1);
        }
    }

    // 2. BALAS DEL ENEMIGO (AHORA COLISIONAN CON ESCENARIO Y BLOQUES)
    const enemyObstacles = [...dynamicMeshes, ...scenarioMeshes];

    for (let i = enemyBullets.length - 1; i >= 0; i--) {
        const bullet = enemyBullets[i];
        const distance = bullet.speed * deltaTime;

        const ray = new THREE.Raycaster(bullet.mesh.position, bullet.direction, 0, distance + 0.2);
        const hitObject = ray.intersectObjects(enemyObstacles, false)[0];

        if (hitObject) {
            // Aplicar impulso si le pega a una forma dinámica
            const item = physicalObjects.find(entry => entry.mesh === hitObject.object);
            if (item) {
                item.body.applyImpulseAtPoint({
                    x: bullet.direction.x * 4,
                    y: bullet.direction.y * 4,
                    z: bullet.direction.z * 4
                }, hitObject.point, true);
            }

            createImpact(hitObject.point, 0xef4444);
            scene.remove(bullet.mesh);
            enemyBullets.splice(i, 1);
            continue;
        }

        const distToPlayer = bullet.mesh.position.distanceTo(camera.position);
        if (distToPlayer < 0.8) {
            damagePlayer(15);
            createImpact(camera.position, 0xef4444);
            scene.remove(bullet.mesh);
            enemyBullets.splice(i, 1);
            continue;
        }

        bullet.mesh.position.addScaledVector(bullet.direction, distance);
        bullet.life -= deltaTime;

        if (bullet.life <= 0) {
            scene.remove(bullet.mesh);
            enemyBullets.splice(i, 1);
        }
    }
}

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
document.addEventListener('keydown', (event) => {
    keyStates[event.code] = true;

    if (['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5'].includes(event.code)) {
        const num = event.code.replace('Digit', '');
        switchWeapon(parseInt(num));
    }
});

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
    if (event.button === 0) shoot();
});

function animate() {
    const delta = Math.min(0.033, clock.getDelta());
    const elapsedTime = clock.getElapsedTime();

    controls(delta);
    updatePlayer(delta);
    updateEnemy(elapsedTime, delta);

    if (keyStates['Mouse0'] || keyStates['KeyE']) {
        shoot();
    }

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