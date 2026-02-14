
export type CarType = 'CONCEPT' | 'SPORT' | 'SUV';
export type ObjectType = 'MODEL' | 'BOX' | 'SPHERE' | 'CONE';

export interface PartConfig {
  id: string;
  name: string;
  desc: string;
}

export interface Hotspot {
  id: string;
  title: string;
  desc: string;
  position: [number, number, number];
}

export interface CustomOption {
  id: string;
  name: string;
  value: string;
}

export interface CustomCategory {
  id: string;
  name: string;
  type: 'MODEL' | 'COLOR' | 'GLASS';
  options: CustomOption[];
}

export interface SceneObject {
  id: string;
  name: string;
  url: string;
  assetId?: string; // Persistent ID
  position: [number, number, number];
  rotation: [number, number, number];
  scale: [number, number, number];
}

export interface CarConfig {
  id: string;
  name: string;
  year: string;
  type: CarType;
  color: string;
  underglowColor: string;
  roughness: number;
  metalness: number;
  parts: PartConfig[];
  interiorPoints: Hotspot[];
  techPoints: Hotspot[];
  
  modelUrl?: string;
  modelAssetId?: string; // Persistent ID
  modelFileName?: string;
  
  scale: [number, number, number];
  position: [number, number, number];
  rotation: [number, number, number];
  customization?: CustomCategory[];
  
  ignitionSoundUrl?: string;
  ignitionSoundAssetId?: string; // Persistent ID
  
  driveSoundUrl?: string;
  driveSoundAssetId?: string; // Persistent ID
}

export interface EnvironmentItem {
  id: string;
  name: string;
  url: string;
  assetId: string;
  scale: number;
  position: [number, number, number];
}

export interface SectionConfig {
  id: string;
  label: string;
}

export interface AppConfig {
  logoUrl: string;
  logoAssetId?: string; // Persistent ID

  pageTitle: string;
  renderQuality: 'ultra' | 'high' | 'low';
  
  floorTextureUrl: string;
  floorTextureAssetId?: string; // Persistent ID

  standTextureUrl: string;
  standTextureAssetId?: string; // Persistent ID
  
  gateTextureUrl: string; // New: For 3D Menu
  gateTextureAssetId?: string; 
  
  // Custom Styling
  styling: {
      fontFamily: string;
      textColor: string;
  };

  // Multiple Environments Support
  environments: EnvironmentItem[];
  activeEnvironmentId: string | null;
  
  // Custom Scene Objects
  sceneObjects: SceneObject[];

  wallTint: number; // 0.0 (Invisible) to 1.0 (Solid)

  lighting: { intensity: number; ambient: number; ledColor: string; accentColor: string };
  headlights: { on: boolean; intensity: number; color: string; };
  texts: { title: string; subtitle: string };
  sections: SectionConfig[];
  activeCarIndex: number;
  fleet: CarConfig[];
  character: { 
      outfitColor: string; 
      skinColor: string; 
      scale: number; 
      position: [number, number, number];
      modelUrl?: string; 
      modelAssetId?: string; // Persistent ID
      modelType?: 'glb' | 'fbx' | 'none'; 
  };
  audio: { masterVolume: number; muted: boolean; };
  
  uiOffsets: {
      buildBtn: { x: number, y: number };
      ignitionBtn: { x: number, y: number };
  };
}

export const DEFAULT_PARTS: PartConfig[] = [
  { id: 'BODY', name: 'CHASSIS', desc: 'Carbon-fiber monocoque structure.' },
  { id: 'COCKPIT', name: 'INTERIOR', desc: 'AI-integrated holographic interface.' },
  { id: 'WHEEL', name: 'WHEELS', desc: 'Forged magnesium center-lock wheels.' },
  { id: 'ENGINE', name: 'POWERTRAIN', desc: 'Solid-state battery dual-motor setup.' }
];

export const DEFAULT_CUSTOMIZATION: CustomCategory[] = [
    { id: 'color', name: 'Exterior Paint', type: 'COLOR', options: [{ id: 'c1', name: 'Solar Flare', value: '#FF8800' }, { id: 'c2', name: 'Shadow Black', value: '#111111' }, { id: 'c3', name: 'Glacier White', value: '#eeeeee' }] },
    { id: 'glass', name: 'Glass Tint', type: 'GLASS', options: [{ id: 'g1', name: 'Clear', value: 'clear' }, { id: 'g2', name: 'Onyx', value: 'dark' }] },
];

export const DEFAULT_CONFIG: AppConfig = {
  logoUrl: 'https://upload.wikimedia.org/wikipedia/commons/d/df/Lexus_logo_and_wordmark.svg',
  pageTitle: 'LEXUS | FUTURE',
  renderQuality: 'high',
  // Replaced broken Unsplash links with reliable placeholders
  floorTextureUrl: 'https://images.unsplash.com/photo-1620641788427-b9a44e6952d3?q=80&w=2000&auto=format&fit=crop',
  standTextureUrl: '', 
  gateTextureUrl: 'https://images.unsplash.com/photo-1550684848-fac1c5b4e853?q=80&w=2000&auto=format&fit=crop', 
  
  styling: {
      fontFamily: "'Space Grotesk', sans-serif",
      textColor: '#ffffff'
  },

  environments: [],
  activeEnvironmentId: null,
  
  sceneObjects: [],

  wallTint: 0.95, // Darker default
  lighting: { intensity: 1.2, ambient: 0.2, ledColor: '#ffffff', accentColor: '#FF9900' }, // Orange Accent
  headlights: { on: true, intensity: 80, color: '#FFDDaa' },
  texts: { title: 'EXPERIENCE AMAZING', subtitle: 'FUTURE CONCEPT' },
  sections: [ 
      { id: 'showroom', label: 'DESIGN STUDIO' }, 
      { id: 'drive', label: 'TRACK MODE' }, 
      { id: 'cockpit', label: 'INTERIOR' }, 
      { id: 'engineering', label: 'TECH' },
      { id: 'walk', label: 'FREE ROAM' } 
  ],
  activeCarIndex: 0,
  fleet: [
    { id: 'lfa-next', name: 'LFA-X CONCEPT', year: '2028', type: 'SPORT', color: '#FF9900', underglowColor: '#FF8800', roughness: 0.1, metalness: 0.6, parts: DEFAULT_PARTS, interiorPoints: [], techPoints: [], scale: [1, 1, 1], position: [0, 0, 0], rotation: [0, 0, 0], customization: DEFAULT_CUSTOMIZATION },
    { id: 'lf-z', name: 'LF-Z ELECTRIFIED', year: '2025', type: 'CONCEPT', color: '#0055ff', underglowColor: '#0044cc', roughness: 0.2, metalness: 0.8, parts: DEFAULT_PARTS, interiorPoints: [], techPoints: [], scale: [1, 1, 1], position: [0, 0, 0], rotation: [0, 0, 0], customization: DEFAULT_CUSTOMIZATION },
    { id: 'rz-450', name: 'RZ 450e', year: '2024', type: 'SUV', color: '#d48c55', underglowColor: '#d48c55', roughness: 0.2, metalness: 0.7, parts: DEFAULT_PARTS, interiorPoints: [], techPoints: [], scale: [1, 1, 1], position: [0, 0, 0], rotation: [0, 0, 0], customization: DEFAULT_CUSTOMIZATION }
  ],
  character: { outfitColor: '#333', skinColor: '#aaa', scale: 1, position: [-5, 0, 5], modelType: 'none' },
  audio: { masterVolume: 0.5, muted: false },
  uiOffsets: {
      buildBtn: { x: 0, y: 0 },
      ignitionBtn: { x: 0, y: 0 }
  }
};
