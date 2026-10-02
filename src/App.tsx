import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Text, Environment } from '@react-three/drei';
import { useRef, useState, useMemo } from 'react';
import * as THREE from 'three';

// ============================================================
// КОНСТАНТЫ ДВИГАТЕЛЯ BMW M20 Inline-6
// ============================================================
const NUM_CYLINDERS = 6;
const BORE = 0.8;
const STROKE = 1.2;
const CRANK_RADIUS = STROKE / 2;
const ROD_LENGTH = 2.5;
const CYLINDER_SPACING = 1.4;
const BLOCK_LENGTH = NUM_CYLINDERS * CYLINDER_SPACING + 1.0;
const BLOCK_HEIGHT = 4.5;
const BLOCK_WIDTH = 1.8;

// Смещения фаз коленвала для каждого цилиндра
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
function pistonPosition(crankAngle: number): number {
  const theta = (crankAngle * Math.PI) / 180;
  const cosTheta = Math.cos(theta);
  const sinTheta = Math.sin(theta);
  return CRANK_RADIUS * cosTheta + Math.sqrt(ROD_LENGTH * ROD_LENGTH - CRANK_RADIUS * CRANK_RADIUS * sinTheta * sinTheta);
}

/**
 * Определяет текущий такт цилиндра (0-впуск, 1-сжатие, 2-рабочий ход, 3-выпуск)
 */
function getStrokePhase(crankAngle: number): number {
  const angle = ((crankAngle % 720) + 720) % 720;
  if (angle < 180) return 0;
  if (angle < 360) return 1;
  if (angle < 540) return 2;
  return 3;
}

function getStrokeColor(phase: number): string {
  switch (phase) {
    case 0: return '#4488ff';
    case 1: return '#aaaaaa';
    case 2: return '#ff4422';
    case 3: return '#888888';
    default: return '#888888';
  }
}

function getStrokeName(phase: number): string {
  switch (phase) {
    case 0: return 'ВПУСК';
    case 1: return 'СЖАТИЕ';
    case 2: return 'РАБ.ХОД';
    case 3: return 'ВЫПУСК';
    default: return '---';
  }
}

// ============================================================
// КОМПОНЕНТ: ПОРШЕНЬ
// ============================================================
function Piston({ index, crankAngle, x }: { index: number; crankAngle: number; x: number }) {
  const effectiveAngle = crankAngle + CRANK_OFFSETS[index];
  const pos = pistonPosition(effectiveAngle);
  const phase = getStrokePhase(effectiveAngle + FIRE_OFFSETS[index]);
  const color = getStrokeColor(phase);
  const yPos = pos;

  return (
    <group position={[x, yPos, 0]}>
      {/* Тело поршня */}
      <mesh castShadow>
        <cylinderGeometry args={[BORE * 0.45, BORE * 0.45, 0.5, 24]} />
        <meshStandardMaterial color="#c0c0c0" metalness={0.8} roughness={0.3} />
      </mesh>
      {/* Юбка поршня */}
      <mesh position={[0, -0.35, 0]} castShadow>
        <cylinderGeometry args={[BORE * 0.44, BORE * 0.42, 0.3, 24]} />
        <meshStandardMaterial color="#a8a8a8" metalness={0.7} roughness={0.4} />
      </mesh>
      {/* Поршневые кольца */}
      {[0.15, 0.05, -0.05].map((offset, i) => (
        <mesh key={i} position={[0, offset, 0]}>
          <torusGeometry args={[BORE * 0.45, 0.02, 8, 32]} />
          <meshStandardMaterial color={i < 2 ? '#333333' : '#555555'} metalness={0.9} roughness={0.2} />
        </mesh>
      ))}
      {/* Палец поршня */}
      <mesh position={[0, -0.2, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.06, 0.06, BORE * 0.6, 12]} />
        <meshStandardMaterial color="#888888" metalness={0.9} roughness={0.2} />
      </mesh>
      {/* Индикатор такта - свечение при рабочем ходе */}
      <mesh position={[0, 0.35, 0]}>
        <sphereGeometry args={[0.08, 12, 12]} />
        <meshStandardMaterial 
          color={color} 
          emissive={phase === 2 ? color : '#000000'} 
          emissiveIntensity={phase === 2 ? 3 : 0} 
        />
      </mesh>
    </group>
  );
}

// ============================================================
// КОМПОНЕНТ: ШАТУН
// ============================================================
function ConnectingRod({ index, crankAngle, x }: { index: number; crankAngle: number; x: number }) {
  const effectiveAngle = crankAngle + CRANK_OFFSETS[index];
  const theta = (effectiveAngle * Math.PI) / 180;
  
  const pistonY = pistonPosition(effectiveAngle);
  const topY = pistonY - 0.2;
  
  const crankPinY = CRANK_RADIUS * Math.cos(theta);
  const crankPinZ = CRANK_RADIUS * Math.sin(theta);
  
  const dx = 0;
  const dy = topY - crankPinY;
  const dz = -crankPinZ;
  const length = Math.sqrt(dx * dx + dy * dy + dz * dz);
  
  const centerX = 0;
  const centerY = (topY + crankPinY) / 2;
  const centerZ = (0 + crankPinZ) / 2;
  
  // Углы для ориентации шатуна
  const angleFromVertical = Math.atan2(Math.sqrt(dx * dx + dz * dz), dy);
  const rotZ = 0;
  const rotX = Math.atan2(-dz, dy);

  return (
    <group position={[x, 0, 0]}>
      {/* Тело шатуна */}
      <group position={[centerX, centerY, centerZ]} rotation={[rotX, 0, rotZ]}>
        <mesh castShadow>
          <boxGeometry args={[0.12, length, 0.08]} />
          <meshStandardMaterial color="#707070" metalness={0.8} roughness={0.3} />
        </mesh>
        {/* Двутавровое сечение */}
        <mesh>
          <boxGeometry args={[0.18, length * 0.85, 0.03]} />
          <meshStandardMaterial color="#606060" metalness={0.7} roughness={0.4} />
        </mesh>
      </group>
      {/* Нижняя головка (на шатунной шейке) */}
      <mesh position={[0, crankPinY, crankPinZ]}>
        <torusGeometry args={[0.12, 0.05, 8, 16]} />
        <meshStandardMaterial color="#555555" metalness={0.8} roughness={0.3} />
      </mesh>
      {/* Верхняя головка (на поршневом пальце) */}
      <mesh position={[0, topY, 0]}>
        <torusGeometry args={[0.07, 0.03, 8, 16]} />
        <meshStandardMaterial color="#555555" metalness={0.8} roughness={0.3} />
      </mesh>
    </group>
  );
}

// ============================================================
// КОМПОНЕНТ: КОЛЕНВАЛ
// ============================================================
function Crankshaft({ crankAngle }: { crankAngle: number }) {
  const groupRef = useRef<THREE.Group>(null);
  
  useFrame(() => {
    if (groupRef.current) {
      // Вращение вокруг оси X (продольная ось двигателя)
      // Направление согласовано с расчётом позиций шатунов
      groupRef.current.rotation.x = (crankAngle * Math.PI) / 180;
    }
  });

  const mainJournalPositions = useMemo(() => {
    const positions: number[] = [];
    for (let i = 0; i <= NUM_CYLINDERS; i++) {
      positions.push(-BLOCK_LENGTH / 2 + 0.5 + i * (BLOCK_LENGTH - 1) / NUM_CYLINDERS);
    }
    return positions;
  }, []);

  return (
    <group ref={groupRef}>
      {/* Коренные шейки */}
      {mainJournalPositions.map((x, i) => (
        <mesh key={`mj-${i}`} position={[x, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.18, 0.18, 0.4, 16]} />
          <meshStandardMaterial color="#4a4a4a" metalness={0.9} roughness={0.2} />
        </mesh>
      ))}
      
      {/* Шатунные шейки и щёки */}
      {Array.from({ length: NUM_CYLINDERS }).map((_, i) => {
        const xPos = -BLOCK_LENGTH / 2 + 1.0 + i * CYLINDER_SPACING;
        const angle = CRANK_OFFSETS[i] * Math.PI / 180;
        const pinY = CRANK_RADIUS * Math.cos(angle);
        const pinZ = CRANK_RADIUS * Math.sin(angle);
        
        return (
          <group key={`cp-${i}`}>
            {/* Шатунная шейка */}
            <mesh position={[xPos, pinY, pinZ]} rotation={[0, 0, Math.PI / 2]}>
              <cylinderGeometry args={[0.12, 0.12, 0.3, 16]} />
              <meshStandardMaterial color="#5a5a5a" metalness={0.9} roughness={0.2} />
            </mesh>
            {/* Щёки коленвала */}
            <mesh position={[xPos - 0.2, pinY / 2, pinZ / 2]}>
              <boxGeometry args={[0.15, CRANK_RADIUS + 0.15, 0.2]} />
              <meshStandardMaterial color="#3a3a3a" metalness={0.8} roughness={0.3} />
            </mesh>
            <mesh position={[xPos + 0.2, pinY / 2, pinZ / 2]}>
              <boxGeometry args={[0.15, CRANK_RADIUS + 0.15, 0.2]} />
              <meshStandardMaterial color="#3a3a3a" metalness={0.8} roughness={0.3} />
            </mesh>
            {/* Противовес */}
            <mesh position={[xPos, -pinY * 0.6, -pinZ * 0.6]} rotation={[Math.atan2(pinZ, pinY), 0, 0]}>
              <cylinderGeometry args={[0.22, 0.18, 0.12, 16, 1, false, 0, Math.PI]} />
              <meshStandardMaterial color="#333333" metalness={0.7} roughness={0.4} />
            </mesh>
          </group>
        );
      })}
      
      {/* Носок коленвала */}
      <mesh position={[-BLOCK_LENGTH / 2 - 0.3, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.15, 0.15, 0.6, 16]} />
        <meshStandardMaterial color="#4a4a4a" metalness={0.9} roughness={0.2} />
      </mesh>
      {/* Шкив */}
      <mesh position={[-BLOCK_LENGTH / 2 - 0.7, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.4, 0.4, 0.15, 32]} />
        <meshStandardMaterial color="#222222" metalness={0.6} roughness={0.5} />
      </mesh>
      {/* Маховик */}
      <mesh position={[BLOCK_LENGTH / 2 + 0.4, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.6, 0.6, 0.2, 32]} />
        <meshStandardMaterial color="#2a2a2a" metalness={0.7} roughness={0.4} />
      </mesh>
    </group>
  );
}

// ============================================================
// КОМПОНЕНТ: БЛОК ЦИЛИНДРОВ
// ============================================================
function CylinderBlock() {
  return (
    <group>
      {/* Основной блок - полупрозрачный */}
      <mesh position={[0, BLOCK_HEIGHT / 2 - 1.5, 0]}>
        <boxGeometry args={[BLOCK_WIDTH, BLOCK_HEIGHT, BLOCK_LENGTH]} />
        <meshStandardMaterial 
          color="#2a4a6a" 
          transparent 
          opacity={0.12} 
          metalness={0.3} 
          roughness={0.5}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>
      
      {/* Рёбра жёсткости */}
      {Array.from({ length: 7 }).map((_, i) => (
        <mesh key={`rib-${i}`} position={[BLOCK_WIDTH / 2 + 0.02, BLOCK_HEIGHT / 2 - 1.5, -BLOCK_LENGTH / 2 + 0.5 + i * (BLOCK_LENGTH - 1) / 6]}>
          <boxGeometry args={[0.04, BLOCK_HEIGHT * 0.7, 0.06]} />
          <meshStandardMaterial color="#1a3a5a" transparent opacity={0.25} metalness={0.5} roughness={0.4} />
        </mesh>
      ))}
      
      {/* Гильзы цилиндров */}
      {Array.from({ length: NUM_CYLINDERS }).map((_, i) => {
        const x = -BLOCK_LENGTH / 2 + 1.0 + i * CYLINDER_SPACING;
        return (
          <group key={`bore-${i}`} position={[x, 1.5, 0]}>
            <mesh>
              <cylinderGeometry args={[BORE * 0.5, BORE * 0.5, BLOCK_HEIGHT - 1.5, 32, 1, true]} />
              <meshStandardMaterial 
                color="#3a6a9a" 
                transparent 
                opacity={0.08} 
                metalness={0.4} 
                roughness={0.3}
                side={THREE.DoubleSide}
                depthWrite={false}
              />
            </mesh>
            {/* Номер цилиндра */}
            <Text
              position={[0, BLOCK_HEIGHT / 2 - 0.2, BLOCK_WIDTH / 2 + 0.15]}
              fontSize={0.22}
              color="#ffffff"
              anchorX="center"
              anchorY="middle"
            >
              {`${i + 1}`}
            </Text>
          </group>
        );
      })}
      
      {/* Поддон картера */}
      <mesh position={[0, -2.2, 0]}>
        <boxGeometry args={[BLOCK_WIDTH * 0.9, 0.8, BLOCK_LENGTH * 0.95]} />
        <meshStandardMaterial color="#1a1a2a" transparent opacity={0.2} metalness={0.3} roughness={0.6} depthWrite={false} />
      </mesh>
      
      {/* Масло в поддоне */}
      <mesh position={[0, -2.4, 0]}>
        <boxGeometry args={[BLOCK_WIDTH * 0.8, 0.3, BLOCK_LENGTH * 0.9]} />
        <meshStandardMaterial color="#cc8800" transparent opacity={0.35} metalness={0.2} roughness={0.8} />
      </mesh>
    </group>
  );
}

// ============================================================
// КОМПОНЕНТ: ГОЛОВКА БЛОКА
// ============================================================
function CylinderHead() {
  return (
    <group position={[0, BLOCK_HEIGHT - 1.0, 0]}>
      <mesh>
        <boxGeometry args={[BLOCK_WIDTH * 1.05, 0.8, BLOCK_LENGTH * 1.02]} />
        <meshStandardMaterial color="#4a4a5a" transparent opacity={0.15} metalness={0.5} roughness={0.4} depthWrite={false} />
      </mesh>
      <mesh position={[0, 0.6, 0]}>
        <boxGeometry args={[BLOCK_WIDTH * 0.9, 0.4, BLOCK_LENGTH * 0.98]} />
        <meshStandardMaterial color="#222233" transparent opacity={0.25} metalness={0.6} roughness={0.3} depthWrite={false} />
      </mesh>
    </group>
  );
}

// ============================================================
// СЦЕНА ДВИГАТЕЛЯ (внутри Canvas)
// ============================================================
function EngineScene({ rpm, paused, onAngleUpdate }: { rpm: number; paused: boolean; onAngleUpdate: (angle: number) => void }) {
  const crankAngleRef = useRef(0);
  const [crankAngle, setCrankAngle] = useState(0);
  
  useFrame((_, delta) => {
    if (!paused) {
      const degreesPerSecond = rpm * 6;
      crankAngleRef.current += degreesPerSecond * delta;
      if (crankAngleRef.current >= 720) {
        crankAngleRef.current -= 720;
      }
      setCrankAngle(crankAngleRef.current);
      onAngleUpdate(crankAngleRef.current);
    }
  });

  const cylinderPositions = useMemo(() => {
    return Array.from({ length: NUM_CYLINDERS }).map((_, i) => 
      -BLOCK_LENGTH / 2 + 1.0 + i * CYLINDER_SPACING
    );
  }, []);

  return (
    <group>
      <CylinderBlock />
      <CylinderHead />
      <Crankshaft crankAngle={crankAngle} />
      
      {cylinderPositions.map((x, i) => (
        <group key={`cyl-${i}`}>
          <Piston index={i} crankAngle={crankAngle} x={x} />
          <ConnectingRod index={i} crankAngle={crankAngle} x={x} />
        </group>
      ))}
    </group>
  );
}

// ============================================================
// UI КОМПОНЕНТЫ
// ============================================================
function InfoPanel({ rpm, crankAngle }: { rpm: number; crankAngle: number }) {
  const phases = useMemo(() => {
    return Array.from({ length: NUM_CYLINDERS }).map((_, i) => {
      const effectiveAngle = crankAngle + CRANK_OFFSETS[i];
      const phase = getStrokePhase(effectiveAngle + FIRE_OFFSETS[i]);
      return { name: getStrokeName(phase), color: getStrokeColor(phase), cylinder: i + 1 };
    });
  }, [crankAngle]);

  return (
    <div className="absolute top-14 left-4 bg-black/80 backdrop-blur-sm rounded-xl p-4 text-white font-mono text-sm border border-gray-700/50" style={{maxWidth: '280px'}}>
      <h2 className="text-base font-bold mb-2 text-blue-400 flex items-center gap-2">
        <span className="text-xl">⚙️</span> BMW M20B25
      </h2>
      <div className="space-y-1 text-xs">
        <p>Тип: <span className="text-gray-300">Рядный 6-цил. (I6)</span></p>
        <p>Обороты: <span className="text-green-400 font-bold">{rpm} RPM</span></p>
        <p>Угол КВ: <span className="text-yellow-400">{Math.round(crankAngle)}°</span></p>
        <p>Порядок: <span className="text-orange-400">1-5-3-6-2-4</span></p>
      </div>
      <div className="mt-3 pt-2 border-t border-gray-700">
        <p className="text-xs text-gray-400 mb-2">Состояние цилиндров:</p>
        <div className="grid grid-cols-2 gap-x-3 gap-y-1">
          {phases.map((p) => (
            <div key={p.cylinder} className="flex items-center gap-1">
              <span className="text-xs text-gray-400">Ц{p.cylinder}:</span>
              <span className="text-xs font-bold" style={{ color: p.color }}>
                {p.name}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ControlPanel({ rpm, setRpm, paused, setPaused }: {
  rpm: number;
  setRpm: (v: number) => void;
  paused: boolean;
  setPaused: (v: boolean) => void;
}) {
  return (
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
        {[{label: 'ХХ', val: 800}, {label: '2K', val: 2000}, {label: '4K', val: 4000}, {label: '6K', val: 6000}].map((preset) => (
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
  );
}

function Legend() {
  return (
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
  );
}

// ============================================================
// ГЛАВНЫЙ КОМПОНЕНТ
// ============================================================
export default function App() {
  const [rpm, setRpm] = useState(1200);
  const [paused, setPaused] = useState(false);
  const [crankAngle, setCrankAngle] = useState(0);

  return (
    <div className="w-full h-screen bg-gradient-to-b from-gray-900 via-gray-800 to-black relative overflow-hidden">
      {/* Заголовок */}
      <div className="absolute top-0 left-0 right-0 text-center py-2 z-10 pointer-events-none">
        <h1 className="text-xl md:text-2xl font-bold text-white/90 tracking-wider">
          BMW M20 — Рядный 6-цилиндровый двигатель
        </h1>
        <p className="text-xs text-gray-400 mt-0.5">Интерактивная 3D-визуализация кривошипно-шатунного механизма</p>
      </div>

      {/* 3D Сцена */}
      <Canvas
        camera={{ position: [7, 5, 9], fov: 45 }}
        shadows
        gl={{ antialias: true, alpha: true }}
      >
        <color attach="background" args={['#0a0a14']} />
        <fog attach="fog" args={['#0a0a14', 15, 35]} />
        
        <ambientLight intensity={0.3} />
        <directionalLight position={[10, 10, 5]} intensity={1.2} castShadow />
        <directionalLight position={[-5, 5, -5]} intensity={0.4} color="#aaccff" />
        <pointLight position={[0, 6, 0]} intensity={0.6} color="#aaccff" />
        <pointLight position={[0, -2, 3]} intensity={0.3} color="#ffaa44" />
        
        <EngineScene rpm={rpm} paused={paused} onAngleUpdate={setCrankAngle} />
        
        <OrbitControls 
          enableDamping 
          dampingFactor={0.05}
          minDistance={4}
          maxDistance={25}
          target={[0, 1, 0]}
        />
        
        {/* Пол */}
        <gridHelper args={[30, 30, '#1a1a2a', '#111118']} position={[0, -3, 0]} />
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -3.01, 0]} receiveShadow>
          <planeGeometry args={[30, 30]} />
          <meshStandardMaterial color="#0a0a12" metalness={0.5} roughness={0.8} />
        </mesh>
        
        <Environment preset="night" />
      </Canvas>

      {/* UI Оверлеи */}
      <InfoPanel rpm={rpm} crankAngle={crankAngle} />
      <Legend />
      <ControlPanel rpm={rpm} setRpm={setRpm} paused={paused} setPaused={setPaused} />
    </div>
  );
}
