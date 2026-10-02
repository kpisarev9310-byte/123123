import { useRef, useState, useEffect, useCallback } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

// ============================================================
// КОНСТАНТЫ ДВИГАТЕЛЯ BMW M20 Inline-6
// ============================================================
const NUM_CYLINDERS = 6;
const CRANK_RADIUS = 0.6;
const ROD_LENGTH = 2.5;
const CYLINDER_SPACING = 1.4;
const BORE_RADIUS = 0.4;
const BLOCK_LENGTH = NUM_CYLINDERS * CYLINDER_SPACING + 1.0;

// Смещения фаз коленвала для каждого цилиндра (в градусах)
// Для плоского коленвала I6:
// Цилиндры 1 и 6: 0°, Цилиндры 3 и 5: 120°, Цилиндры 2 и 4: 240°
const CRANK_OFFSETS = [0, 240, 120, 0, 120, 240];

// Порядок зажигания BMW Inline-6: 1-5-3-6-2-4
const FIRING_ORDER = [1, 5, 3, 6, 2, 4];
const FIRE_OFFSETS: number[] = [];
for (let i = 0; i < NUM_CYLINDERS; i++) {
  const cylNum = i + 1;
  const firePos = FIRING_ORDER.indexOf(cylNum);
  FIRE_OFFSETS.push(firePos * 120);
}

// ============================================================
// КИНЕМАТИКА КШМ
// ============================================================
/**
 * Вычисляет положение поршня по углу поворота коленвала.
 * Формула: y = r·cos(θ) + √(l² - r²·sin²(θ))
 * где r - радиус кривошипа, l - длина шатуна, θ - угол поворота
 */
function pistonPosition(crankAngleDeg: number): number {
  const theta = (crankAngleDeg * Math.PI) / 180;
  const cosT = Math.cos(theta);
  const sinT = Math.sin(theta);
  return CRANK_RADIUS * cosT + Math.sqrt(ROD_LENGTH * ROD_LENGTH - CRANK_RADIUS * CRANK_RADIUS * sinT * sinT);
}

/**
 * Определяет текущий такт цилиндра
 */
function getStrokePhase(crankAngleDeg: number): number {
  const angle = ((crankAngleDeg % 720) + 720) % 720;
  if (angle < 180) return 0; // Впуск
  if (angle < 360) return 1; // Сжатие
  if (angle < 540) return 2; // Рабочий ход
  return 3; // Выпуск
}

function getPhaseName(phase: number): string {
  switch (phase) {
    case 0: return 'ВПУСК';
    case 1: return 'СЖАТИЕ';
    case 2: return 'РАБ.ХОД';
    case 3: return 'ВЫПУСК';
    default: return '---';
  }
}

function getPhaseColor(phase: number): string {
  switch (phase) {
    case 0: return '#4488ff';
    case 1: return '#aaaaaa';
    case 2: return '#ff4422';
    case 3: return '#888888';
    default: return '#888888';
  }
}

// ============================================================
// ПОСТРОЕНИЕ 3D СЦЕНЫ
// ============================================================
function createEngineScene() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a0a14);
  scene.fog = new THREE.Fog(0x0a0a14, 15, 35);

  // Освещение
  const ambient = new THREE.AmbientLight(0xffffff, 0.4);
  scene.add(ambient);

  const dirLight1 = new THREE.DirectionalLight(0xffffff, 1.2);
  dirLight1.position.set(10, 10, 5);
  dirLight1.castShadow = true;
  scene.add(dirLight1);

  const dirLight2 = new THREE.DirectionalLight(0xaaccff, 0.4);
  dirLight2.position.set(-5, 5, -5);
  scene.add(dirLight2);

  const pointLight = new THREE.PointLight(0xaaccff, 0.6, 20);
  pointLight.position.set(0, 6, 0);
  scene.add(pointLight);

  const warmLight = new THREE.PointLight(0xffaa44, 0.3, 15);
  warmLight.position.set(0, -2, 3);
  scene.add(warmLight);

  // Пол
  const gridHelper = new THREE.GridHelper(30, 30, 0x1a1a2a, 0x111118);
  gridHelper.position.y = -3;
  scene.add(gridHelper);

  const floorGeo = new THREE.PlaneGeometry(30, 30);
  const floorMat = new THREE.MeshStandardMaterial({ color: 0x0a0a12, metalness: 0.5, roughness: 0.8 });
  const floor = new THREE.Mesh(floorGeo, floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -3.01;
  floor.receiveShadow = true;
  scene.add(floor);

  return scene;
}

// ============================================================
// СОЗДАНИЕ КОМПОНЕНТОВ ДВИГАТЕЛЯ
// ============================================================
interface EngineParts {
  pistons: THREE.Group[];
  pistonIndicators: THREE.Mesh[];
  rods: THREE.Group[];
  rodBodies: THREE.Mesh[];
  crankGroup: THREE.Group;
  blockGroup: THREE.Group;
}

function createEngineParts(scene: THREE.Scene): EngineParts {
  const pistons: THREE.Group[] = [];
  const pistonIndicators: THREE.Mesh[] = [];
  const rods: THREE.Group[] = [];
  const rodBodies: THREE.Mesh[] = [];

  // ---- БЛОК ЦИЛИНДРОВ ----
  const blockGroup = new THREE.Group();

  // Основной блок - полупрозрачный
  const blockGeo = new THREE.BoxGeometry(1.8, 5, BLOCK_LENGTH);
  const blockMat = new THREE.MeshStandardMaterial({
    color: 0x2a4a6a,
    transparent: true,
    opacity: 0.1,
    metalness: 0.3,
    roughness: 0.5,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const block = new THREE.Mesh(blockGeo, blockMat);
  block.position.set(0, 1, 0);
  blockGroup.add(block);

  // Поддон картера
  const panGeo = new THREE.BoxGeometry(1.6, 0.8, BLOCK_LENGTH * 0.95);
  const panMat = new THREE.MeshStandardMaterial({
    color: 0x1a1a2a,
    transparent: true,
    opacity: 0.2,
    metalness: 0.3,
    roughness: 0.6,
    depthWrite: false,
  });
  const pan = new THREE.Mesh(panGeo, panMat);
  pan.position.set(0, -2.2, 0);
  blockGroup.add(pan);

  // Масло в поддоне
  const oilGeo = new THREE.BoxGeometry(1.4, 0.3, BLOCK_LENGTH * 0.9);
  const oilMat = new THREE.MeshStandardMaterial({
    color: 0xcc8800,
    transparent: true,
    opacity: 0.35,
    metalness: 0.2,
    roughness: 0.8,
  });
  const oil = new THREE.Mesh(oilGeo, oilMat);
  oil.position.set(0, -2.4, 0);
  blockGroup.add(oil);

  // Головка блока
  const headGeo = new THREE.BoxGeometry(1.9, 0.8, BLOCK_LENGTH * 1.02);
  const headMat = new THREE.MeshStandardMaterial({
    color: 0x4a4a5a,
    transparent: true,
    opacity: 0.12,
    metalness: 0.5,
    roughness: 0.4,
    depthWrite: false,
  });
  const head = new THREE.Mesh(headGeo, headMat);
  head.position.set(0, 3.9, 0);
  blockGroup.add(head);

  // Клапанная крышка
  const coverGeo = new THREE.BoxGeometry(1.6, 0.4, BLOCK_LENGTH * 0.98);
  const coverMat = new THREE.MeshStandardMaterial({
    color: 0x222233,
    transparent: true,
    opacity: 0.2,
    metalness: 0.6,
    roughness: 0.3,
    depthWrite: false,
  });
  const cover = new THREE.Mesh(coverGeo, coverMat);
  cover.position.set(0, 4.5, 0);
  blockGroup.add(cover);

  // Гильзы цилиндров
  for (let i = 0; i < NUM_CYLINDERS; i++) {
    const z = -BLOCK_LENGTH / 2 + 1.0 + i * CYLINDER_SPACING;
    const boreGeo = new THREE.CylinderGeometry(BORE_RADIUS, BORE_RADIUS, 4.5, 32, 1, true);
    const boreMat = new THREE.MeshStandardMaterial({
      color: 0x3a6a9a,
      transparent: true,
      opacity: 0.06,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const bore = new THREE.Mesh(boreGeo, boreMat);
    bore.position.set(0, 1.5, z);
    blockGroup.add(bore);
  }

  scene.add(blockGroup);

  // ---- КОЛЕНВАЛ ----
  const crankGroup = new THREE.Group();

  // Материал для коленвала
  const crankMat = new THREE.MeshStandardMaterial({ color: 0x4a4a4a, metalness: 0.9, roughness: 0.2 });
  const webMat = new THREE.MeshStandardMaterial({ color: 0x3a3a3a, metalness: 0.8, roughness: 0.3 });

  // Коренные шейки
  for (let i = 0; i <= NUM_CYLINDERS; i++) {
    const z = -BLOCK_LENGTH / 2 + 0.5 + i * (BLOCK_LENGTH - 1) / NUM_CYLINDERS;
    const journalGeo = new THREE.CylinderGeometry(0.18, 0.18, 0.4, 16);
    const journal = new THREE.Mesh(journalGeo, crankMat);
    journal.rotation.x = Math.PI / 2;
    journal.position.set(0, 0, z);
    crankGroup.add(journal);
  }

  // Шатунные шейки и щёки
  for (let i = 0; i < NUM_CYLINDERS; i++) {
    const z = -BLOCK_LENGTH / 2 + 1.0 + i * CYLINDER_SPACING;
    const angle = (CRANK_OFFSETS[i] * Math.PI) / 180;
    const pinX = CRANK_RADIUS * Math.cos(angle);
    const pinY = CRANK_RADIUS * Math.sin(angle);

    // Шатунная шейка
    const pinGeo = new THREE.CylinderGeometry(0.12, 0.12, 0.3, 16);
    const pin = new THREE.Mesh(pinGeo, new THREE.MeshStandardMaterial({ color: 0x5a5a5a, metalness: 0.9, roughness: 0.2 }));
    pin.rotation.x = Math.PI / 2;
    pin.position.set(pinX, pinY, z);
    crankGroup.add(pin);

    // Щёки коленвала
    const webGeo = new THREE.BoxGeometry(0.15, CRANK_RADIUS + 0.15, 0.2);
    const web1 = new THREE.Mesh(webGeo, webMat);
    web1.position.set(pinX / 2, pinY / 2, z - 0.2);
    crankGroup.add(web1);

    const web2 = new THREE.Mesh(webGeo, webMat);
    web2.position.set(pinX / 2, pinY / 2, z + 0.2);
    crankGroup.add(web2);

    // Противовес
    const cwGeo = new THREE.CylinderGeometry(0.22, 0.18, 0.12, 16, 1, false, 0, Math.PI);
    const cw = new THREE.Mesh(cwGeo, webMat);
    cw.position.set(-pinX * 0.6, -pinY * 0.6, z);
    cw.rotation.z = angle + Math.PI;
    crankGroup.add(cw);
  }

  // Шкив
  const pulleyGeo = new THREE.CylinderGeometry(0.4, 0.4, 0.15, 32);
  const pulleyMat = new THREE.MeshStandardMaterial({ color: 0x222222, metalness: 0.6, roughness: 0.5 });
  const pulley = new THREE.Mesh(pulleyGeo, pulleyMat);
  pulley.rotation.x = Math.PI / 2;
  pulley.position.set(0, 0, -BLOCK_LENGTH / 2 - 0.7);
  crankGroup.add(pulley);

  // Маховик
  const flywheelGeo = new THREE.CylinderGeometry(0.6, 0.6, 0.2, 32);
  const flywheelMat = new THREE.MeshStandardMaterial({ color: 0x2a2a2a, metalness: 0.7, roughness: 0.4 });
  const flywheel = new THREE.Mesh(flywheelGeo, flywheelMat);
  flywheel.rotation.x = Math.PI / 2;
  flywheel.position.set(0, 0, BLOCK_LENGTH / 2 + 0.4);
  crankGroup.add(flywheel);

  scene.add(crankGroup);

  // ---- ПОРШНИ И ШАТУНЫ ----
  for (let i = 0; i < NUM_CYLINDERS; i++) {
    const z = -BLOCK_LENGTH / 2 + 1.0 + i * CYLINDER_SPACING;

    // Поршень
    const pistonGroup = new THREE.Group();

    // Тело поршня
    const pistonGeo = new THREE.CylinderGeometry(BORE_RADIUS * 0.9, BORE_RADIUS * 0.9, 0.5, 24);
    const pistonMat = new THREE.MeshStandardMaterial({ color: 0xc0c0c0, metalness: 0.8, roughness: 0.3 });
    const pistonBody = new THREE.Mesh(pistonGeo, pistonMat);
    pistonBody.rotation.x = Math.PI / 2;
    pistonGroup.add(pistonBody);

    // Юбка поршня
    const skirtGeo = new THREE.CylinderGeometry(BORE_RADIUS * 0.88, BORE_RADIUS * 0.84, 0.3, 24);
    const skirtMat = new THREE.MeshStandardMaterial({ color: 0xa8a8a8, metalness: 0.7, roughness: 0.4 });
    const skirt = new THREE.Mesh(skirtGeo, skirtMat);
    skirt.rotation.x = Math.PI / 2;
    skirt.position.set(0, -0.35, 0);
    pistonGroup.add(skirt);

    // Поршневые кольца
    const ringMat = new THREE.MeshStandardMaterial({ color: 0x333333, metalness: 0.9, roughness: 0.2 });
    [0.15, 0.05, -0.05].forEach((offset) => {
      const ringGeo = new THREE.TorusGeometry(BORE_RADIUS * 0.9, 0.02, 8, 32);
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.position.set(0, 0, offset);
      pistonGroup.add(ring);
    });

    // Индикатор такта (сфера)
    const indicatorGeo = new THREE.SphereGeometry(0.08, 12, 12);
    const indicatorMat = new THREE.MeshStandardMaterial({
      color: 0x888888,
      emissive: 0x000000,
      emissiveIntensity: 0,
    });
    const indicator = new THREE.Mesh(indicatorGeo, indicatorMat);
    indicator.position.set(0, 0, 0.35);
    pistonGroup.add(indicator);

    pistonGroup.position.set(0, 0, z);
    scene.add(pistonGroup);
    pistons.push(pistonGroup);
    pistonIndicators.push(indicator);

    // Шатун
    const rodGroup = new THREE.Group();

    // Тело шатуна
    const rodGeo = new THREE.BoxGeometry(0.12, 0.08, ROD_LENGTH);
    const rodMat = new THREE.MeshStandardMaterial({ color: 0x707070, metalness: 0.8, roughness: 0.3 });
    const rodBody = new THREE.Mesh(rodGeo, rodMat);
    rodGroup.add(rodBody);
    rodBodies.push(rodBody);

    // Двутавр
    const flangeGeo = new THREE.BoxGeometry(0.18, 0.03, ROD_LENGTH * 0.85);
    const flangeMat = new THREE.MeshStandardMaterial({ color: 0x606060, metalness: 0.7, roughness: 0.4 });
    const flange = new THREE.Mesh(flangeGeo, flangeMat);
    rodGroup.add(flange);

    // Нижняя головка
    const bigEndGeo = new THREE.TorusGeometry(0.12, 0.05, 8, 16);
    const bigEndMat = new THREE.MeshStandardMaterial({ color: 0x555555, metalness: 0.8, roughness: 0.3 });
    const bigEnd = new THREE.Mesh(bigEndGeo, bigEndMat);
    bigEnd.position.set(0, 0, -ROD_LENGTH / 2);
    rodGroup.add(bigEnd);

    // Верхняя головка
    const smallEndGeo = new THREE.TorusGeometry(0.07, 0.03, 8, 16);
    const smallEnd = new THREE.Mesh(smallEndGeo, bigEndMat);
    smallEnd.position.set(0, 0, ROD_LENGTH / 2);
    rodGroup.add(smallEnd);

    rodGroup.position.set(0, 0, z);
    scene.add(rodGroup);
    rods.push(rodGroup);
  }

  return { pistons, pistonIndicators, rods, rodBodies, crankGroup, blockGroup };
}

// ============================================================
// ОБНОВЛЕНИЕ ПОЗИЦИЙ НА КАЖДОМ КАДРЕ
// ============================================================
function updateEngine(
  parts: EngineParts,
  crankAngle: number
) {
  // Вращаем коленвал вокруг оси Z
  parts.crankGroup.rotation.z = (crankAngle * Math.PI) / 180;

  for (let i = 0; i < NUM_CYLINDERS; i++) {
    const effectiveAngle = crankAngle + CRANK_OFFSETS[i];
    const theta = (effectiveAngle * Math.PI) / 180;

    // Позиция поршня по оси Y (вверх от коленвала)
    const posY = pistonPosition(effectiveAngle);

    // Позиция шатунной шейки коленвала
    const crankPinX = CRANK_RADIUS * Math.cos(theta);
    const crankPinY = CRANK_RADIUS * Math.sin(theta);

    // Обновляем поршень
    parts.pistons[i].position.set(0, posY, parts.pistons[i].position.z);

    // Обновляем индикатор такта
    const phase = getStrokePhase(effectiveAngle + FIRE_OFFSETS[i]);
    const color = getPhaseColor(phase);
    const indicator = parts.pistonIndicators[i];
    (indicator.material as THREE.MeshStandardMaterial).color.set(color);
    if (phase === 2) {
      (indicator.material as THREE.MeshStandardMaterial).emissive.set(color);
      (indicator.material as THREE.MeshStandardMaterial).emissiveIntensity = 3;
    } else {
      (indicator.material as THREE.MeshStandardMaterial).emissive.set(0x000000);
      (indicator.material as THREE.MeshStandardMaterial).emissiveIntensity = 0;
    }

    // Обновляем шатун
    const rod = parts.rods[i];
    // Центр шатуна
    const centerX = crankPinX / 2;
    const centerY = (posY + crankPinY) / 2;
    rod.position.set(centerX, centerY, rod.position.z);

    // Угол шатуна
    const dx = -crankPinX;
    const dy = posY - crankPinY;
    const rodAngle = Math.atan2(dx, dy);
    rod.rotation.z = -rodAngle;
  }
}

// ============================================================
// ГЛАВНЫЙ КОМПОНЕНТ ПРИЛОЖЕНИЯ
// ============================================================
export default function App() {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const partsRef = useRef<EngineParts | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const animRef = useRef<number>(0);
  const crankAngleRef = useRef(0);
  const lastTimeRef = useRef(0);

  const [rpm, setRpm] = useState(1200);
  const [paused, setPaused] = useState(false);
  const [displayAngle, setDisplayAngle] = useState(0);
  const [phases, setPhases] = useState<{ name: string; color: string }[]>([]);

  const rpmRef = useRef(rpm);
  const pausedRef = useRef(paused);

  useEffect(() => {
    rpmRef.current = rpm;
  }, [rpm]);

  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  const initScene = useCallback(() => {
    if (!containerRef.current) return;

    // Создаём сцену
    const scene = createEngineScene();
    sceneRef.current = scene;

    // Камера
    const camera = new THREE.PerspectiveCamera(
      45,
      containerRef.current.clientWidth / containerRef.current.clientHeight,
      0.1,
      100
    );
    camera.position.set(8, 5, 8);
    camera.lookAt(0, 1, 0);
    cameraRef.current = camera;

    // Рендерер
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(containerRef.current.clientWidth, containerRef.current.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    containerRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // Управление камерой
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.minDistance = 4;
    controls.maxDistance = 25;
    controls.target.set(0, 1, 0);
    controlsRef.current = controls;

    // Создаём части двигателя
    const parts = createEngineParts(scene);
    partsRef.current = parts;

    // Цикл анимации
    const animate = (time: number) => {
      animRef.current = requestAnimationFrame(animate);

      const delta = lastTimeRef.current ? (time - lastTimeRef.current) / 1000 : 0;
      lastTimeRef.current = time;

      if (!pausedRef.current && partsRef.current) {
        // rpm * 360 / 60 = rpm * 6 градусов в секунду
        const degreesPerSecond = rpmRef.current * 6;
        crankAngleRef.current += degreesPerSecond * delta;
        if (crankAngleRef.current >= 720) {
          crankAngleRef.current -= 720;
        }

        updateEngine(partsRef.current, crankAngleRef.current);

        // Обновляем UI
        setDisplayAngle(Math.round(crankAngleRef.current));
        const newPhases = Array.from({ length: NUM_CYLINDERS }).map((_, i) => {
          const effectiveAngle = crankAngleRef.current + CRANK_OFFSETS[i];
          const phase = getStrokePhase(effectiveAngle + FIRE_OFFSETS[i]);
          return { name: getPhaseName(phase), color: getPhaseColor(phase) };
        });
        setPhases(newPhases);
      }

      controls.update();
      renderer.render(scene, camera);
    };

    animRef.current = requestAnimationFrame(animate);

    // Обработка ресайза
    const handleResize = () => {
      if (!containerRef.current || !cameraRef.current || !rendererRef.current) return;
      const w = containerRef.current.clientWidth;
      const h = containerRef.current.clientHeight;
      cameraRef.current.aspect = w / h;
      cameraRef.current.updateProjectionMatrix();
      rendererRef.current.setSize(w, h);
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      cancelAnimationFrame(animRef.current);
      renderer.dispose();
      if (containerRef.current && renderer.domElement.parentNode === containerRef.current) {
        containerRef.current.removeChild(renderer.domElement);
      }
    };
  }, []);

  useEffect(() => {
    const cleanup = initScene();
    return cleanup;
  }, [initScene]);

  return (
    <div className="w-full h-screen bg-gradient-to-b from-gray-900 via-gray-800 to-black relative overflow-hidden">
      {/* Заголовок */}
      <div className="absolute top-0 left-0 right-0 text-center py-2 z-10 pointer-events-none">
        <h1 className="text-xl md:text-2xl font-bold text-white/90 tracking-wider">
          BMW M20 — Рядный 6-цилиндровый двигатель
        </h1>
        <p className="text-xs text-gray-400 mt-0.5">Интерактивная 3D-визуализация кривошипно-шатунного механизма</p>
      </div>

      {/* 3D Контейнер */}
      <div ref={containerRef} className="w-full h-full" />

      {/* Информационная панель */}
      <div className="absolute top-14 left-4 bg-black/80 backdrop-blur-sm rounded-xl p-4 text-white font-mono text-sm border border-gray-700/50" style={{ maxWidth: '280px' }}>
        <h2 className="text-base font-bold mb-2 text-blue-400 flex items-center gap-2">
          <span className="text-xl">⚙️</span> BMW M20B25
        </h2>
        <div className="space-y-1 text-xs">
          <p>Тип: <span className="text-gray-300">Рядный 6-цил. (I6)</span></p>
          <p>Обороты: <span className="text-green-400 font-bold">{rpm} RPM</span></p>
          <p>Угол КВ: <span className="text-yellow-400">{displayAngle}°</span></p>
          <p>Порядок: <span className="text-orange-400">1-5-3-6-2-4</span></p>
        </div>
        <div className="mt-3 pt-2 border-t border-gray-700">
          <p className="text-xs text-gray-400 mb-2">Состояние цилиндров:</p>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1">
            {phases.map((p, i) => (
              <div key={i} className="flex items-center gap-1">
                <span className="text-xs text-gray-400">Ц{i + 1}:</span>
                <span className="text-xs font-bold" style={{ color: p.color }}>
                  {p.name}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Легенда */}
      <div className="absolute top-14 right-4 bg-black/80 backdrop-blur-sm rounded-xl p-3 text-white font-mono text-xs border border-gray-700/50">
        <h3 className="text-xs font-bold mb-2 text-gray-300">Такты 4-тактного ДВС:</h3>
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-blue-500 shadow-sm shadow-blue-500/50"></div>
            <span>Впуск (смесь)</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-gray-400"></div>
            <span>Сжатие</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-red-500 shadow-sm shadow-red-500/50"></div>
            <span>Рабочий ход 🔥</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-gray-600"></div>
            <span>Выпуск</span>
          </div>
        </div>
        <div className="mt-3 pt-2 border-t border-gray-700">
          <p className="text-gray-500">🖱 ЛКМ — вращение</p>
          <p className="text-gray-500">🔍 Колёсико — зум</p>
          <p className="text-gray-500">↔ ПКМ — сдвиг</p>
        </div>
      </div>

      {/* Панель управления */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-black/80 backdrop-blur-sm rounded-xl p-3 px-5 text-white border border-gray-700/50 flex items-center gap-4 flex-wrap justify-center">
        <button
          onClick={() => setPaused(!paused)}
          className={`px-4 py-2 rounded-lg font-bold text-sm transition-all ${
            paused
              ? 'bg-green-600 hover:bg-green-500 shadow-lg shadow-green-900/30'
              : 'bg-red-600 hover:bg-red-500 shadow-lg shadow-red-900/30'
          }`}
        >
          {paused ? '▶ ПУСК' : '⏸ СТОП'}
        </button>

        <div className="flex items-center gap-2">
          <label className="text-xs text-gray-300">RPM:</label>
          <input
            type="range"
            min={200}
            max={7000}
            step={100}
            value={rpm}
            onChange={(e) => setRpm(Number(e.target.value))}
            className="w-32 accent-blue-500"
          />
          <span className="text-xs font-mono text-blue-400 w-12 text-right">{rpm}</span>
        </div>

        <div className="flex gap-1">
          {[
            { label: 'ХХ', val: 800 },
            { label: '2K', val: 2000 },
            { label: '4K', val: 4000 },
            { label: '6K', val: 6000 },
          ].map((preset) => (
            <button
              key={preset.val}
              onClick={() => setRpm(preset.val)}
              className={`px-2 py-1 rounded text-xs transition-colors ${
                rpm === preset.val ? 'bg-blue-600' : 'bg-gray-700 hover:bg-gray-600'
              }`}
            >
              {preset.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
