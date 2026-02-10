
import { Injectable, signal, computed, effect, inject } from '@angular/core';
import { AppConfig, DEFAULT_CONFIG, CarConfig, Hotspot, EnvironmentItem } from './data.types';
import { DbService } from './db.service';

@Injectable({ providedIn: 'root' })
export class StoreService {
  db = inject(DbService);

  // Main State
  config = signal<AppConfig>(DEFAULT_CONFIG);
  
  // Computed Helpers
  activeCarIndex = computed(() => this.config().activeCarIndex);
  activeCar = computed(() => this.config().fleet[this.activeCarIndex()] || this.config().fleet[0]);
  sections = computed(() => this.config().sections);
  
  activeEnvironment = computed(() => 
    this.config().environments.find(e => e.id === this.config().activeEnvironmentId)
  );
  
  // Runtime State
  activeSectionIndex = signal(0);
  activeSection = computed(() => this.sections()[this.activeSectionIndex()]);
  
  isWalking = signal(false);
  isCustomizing = signal(false);
  isAdminOpen = signal(false);
  
  activeHotspotId = signal<string | null>(null);
  customizationState = signal<Record<string, string>>({});
  joystickState = signal<{x: number, y: number}>({ x: 0, y: 0 });

  constructor() {
      this.initializeData();

      // Auto-save Global Settings
      effect(() => {
          const current = this.config();
          const globalSettings = {
             lighting: current.lighting,
             audio: current.audio,
             texts: current.texts,
             character: current.character, 
             logoAssetId: current.logoAssetId,
             floorTextureAssetId: current.floorTextureAssetId,
             
             // Environment settings
             environments: current.environments.map(e => ({...e, url: undefined})), // Don't save blob URLs to localstorage
             activeEnvironmentId: current.activeEnvironmentId,

             activeCarIndex: current.activeCarIndex
          };
          try {
              localStorage.setItem('lexus_global_settings_v4', JSON.stringify(globalSettings));
          } catch (e) {
              console.warn('Failed to save settings', e);
          }
      });
  }

  private async initializeData() {
      // 1. Load Global Settings
      let loadedConfig = { ...DEFAULT_CONFIG };
      try {
          const savedSettings = localStorage.getItem('lexus_global_settings_v4');
          if (savedSettings) {
              const parsed = JSON.parse(savedSettings);
              loadedConfig = { ...loadedConfig, ...parsed };
              // Ensure default environments array if missing
              if (!loadedConfig.environments) loadedConfig.environments = [];
          }
      } catch (e) { console.warn('Settings load error', e); }

      // 2. Load Cars from DB
      const dbCars = await this.db.getAllCars();
      if (dbCars.length > 0) {
          loadedConfig.fleet = dbCars;
      } else {
          for (const car of DEFAULT_CONFIG.fleet) {
              await this.db.saveCar(car);
          }
      }

      // 3. Hydrate Blobs
      await this.hydrateGlobalAssets(loadedConfig);
      await this.hydrateFleetAssets(loadedConfig.fleet);

      // 4. Set State
      this.config.set(loadedConfig);
  }

  // --- Hydration Helpers ---

  private async hydrateGlobalAssets(conf: AppConfig) {
      if (conf.logoAssetId) {
          const blob = await this.db.getAsset(conf.logoAssetId);
          if (blob) conf.logoUrl = URL.createObjectURL(blob);
      }
      if (conf.floorTextureAssetId) {
          const blob = await this.db.getAsset(conf.floorTextureAssetId);
          if (blob) conf.floorTextureUrl = URL.createObjectURL(blob);
      }
      if (conf.character.modelAssetId) {
          const blob = await this.db.getAsset(conf.character.modelAssetId);
          if (blob) conf.character.modelUrl = URL.createObjectURL(blob);
      }
      
      // Hydrate Environments
      if (conf.environments) {
          for (const env of conf.environments) {
              if (env.assetId) {
                  const blob = await this.db.getAsset(env.assetId);
                  if (blob) env.url = URL.createObjectURL(blob);
              }
          }
      }
  }

  private async hydrateFleetAssets(fleet: CarConfig[]) {
      for (const car of fleet) {
          if (car.modelAssetId) {
              const b = await this.db.getAsset(car.modelAssetId);
              if (b) car.modelUrl = URL.createObjectURL(b);
          }
          if (car.ignitionSoundAssetId) {
              const b = await this.db.getAsset(car.ignitionSoundAssetId);
              if (b) car.ignitionSoundUrl = URL.createObjectURL(b);
          }
          if (car.driveSoundAssetId) {
              const b = await this.db.getAsset(car.driveSoundAssetId);
              if (b) car.driveSoundUrl = URL.createObjectURL(b);
          }
      }
  }

  // --- Actions ---

  async uploadFile(file: File): Promise<{ id: string, url: string }> {
      const id = crypto.randomUUID();
      await this.db.saveAsset(id, file);
      const url = URL.createObjectURL(file);
      return { id, url };
  }

  // Manual Save for Car
  async saveCurrentCar() {
      const car = this.activeCar();
      await this.db.saveCar(car);
      console.log('Car Saved to DB:', car.name);
  }

  updateConfig(newConfig: Partial<AppConfig>) {
    this.config.update(current => ({ ...current, ...newConfig }));
  }
  
  updateCharacter(characterUpdates: Partial<AppConfig['character']>) {
      this.config.update(current => ({
          ...current,
          character: { ...current.character, ...characterUpdates }
      }));
  }

  setCarIndex(index: number) {
    this.updateConfig({ activeCarIndex: index });
  }

  updateActiveCar(updates: Partial<CarConfig>) {
    this.config.update(c => {
      const fleet = [...c.fleet];
      // Create a new object to ensure change detection
      fleet[c.activeCarIndex] = { ...fleet[c.activeCarIndex], ...updates };
      return { ...c, fleet };
    });
  }
  
  // Environment Actions
  addEnvironment(env: EnvironmentItem) {
      this.config.update(c => ({
          ...c,
          environments: [...c.environments, env],
          activeEnvironmentId: env.id
      }));
  }
  
  setActiveEnvironment(id: string) {
      this.updateConfig({ activeEnvironmentId: id });
  }
  
  updateEnvironment(id: string, updates: Partial<EnvironmentItem>) {
      this.config.update(c => ({
          ...c,
          environments: c.environments.map(e => e.id === id ? { ...e, ...updates } : e)
      }));
  }
  
  removeEnvironment(id: string) {
      this.config.update(c => {
          const newEnvs = c.environments.filter(e => e.id !== id);
          return {
              ...c,
              environments: newEnvs,
              activeEnvironmentId: c.activeEnvironmentId === id ? (newEnvs[0]?.id || null) : c.activeEnvironmentId
          };
      });
  }
  
  addHotspot(type: 'interiorPoints' | 'techPoints') {
    const newPoint: Hotspot = {
      id: crypto.randomUUID(),
      title: 'New Point',
      desc: 'Description here',
      position: [0, 1, 0]
    };
    
    this.updateActiveCar({
      [type]: [...(this.activeCar()[type] || []), newPoint]
    });
    this.activeHotspotId.set(newPoint.id);
  }
  
  updateHotspot(type: 'interiorPoints' | 'techPoints', pointId: string, updates: Partial<Hotspot>) {
    const currentPoints = this.activeCar()[type] || [];
    const newPoints = currentPoints.map(p => p.id === pointId ? { ...p, ...updates } : p);
    this.updateActiveCar({ [type]: newPoints });
  }
  
  removeHotspot(type: 'interiorPoints' | 'techPoints', pointId: string) {
    const currentPoints = this.activeCar()[type] || [];
    this.updateActiveCar({ [type]: currentPoints.filter(p => p.id !== pointId) });
    if (this.activeHotspotId() === pointId) this.activeHotspotId.set(null);
  }

  toggleMute() {
    this.updateConfig({ audio: { ...this.config().audio, muted: !this.config().audio.muted } });
  }
}
