
import { Injectable, signal, computed, effect, inject } from '@angular/core';
import { AppConfig, DEFAULT_CONFIG, CarConfig, Hotspot, EnvironmentItem, SceneObject } from './data.types';
import { DbService } from './db.service';
import { ApiService } from './api.service';

@Injectable({ providedIn: 'root' })
export class StoreService {
  db = inject(DbService);
  api = inject(ApiService);

  // Main State
  config = signal<AppConfig>(JSON.parse(JSON.stringify(DEFAULT_CONFIG))); // Deep copy to avoid mutating default
  
  // Loading State
  private loadingCount = signal(0);
  isLoading = computed(() => this.loadingCount() > 0);
  
  // Error Tracking
  private consecutiveErrors = 0;
  private pollingInterval: any;

  incrementLoading() {
    this.loadingCount.update(c => c + 1);
  }

  decrementLoading() {
    this.loadingCount.update(c => Math.max(0, c - 1));
  }
  
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
  isMenuOpen = signal(false); // New 3D Menu State
  
  activeHotspotId = signal<string | null>(null);
  customizationState = signal<Record<string, string>>({});
  joystickState = signal<{x: number, y: number}>({ x: 0, y: 0 });

  constructor() {
      this.initializeData();

      // Start Polling for updates (Every 3 seconds)
      this.startPolling();

      // Auto-save Global Settings Effect
      effect(() => {
          const current = this.config();
          
          // --- APPLY STYLING EFFECT ---
          // This ensures changes in Admin Panel immediately reflect in CSS
          const root = document.documentElement;
          // Guard against missing styling object just in case
          const safeStyling = current.styling || DEFAULT_CONFIG.styling;
          
          root.style.setProperty('--font-main', safeStyling.fontFamily || "'Space Grotesk', sans-serif");
          root.style.setProperty('--text-main', safeStyling.textColor || '#ffffff');
          root.style.setProperty('--gold', current.lighting.accentColor);

          // Trigger Auto-Save (Fire and forget)
          this.saveGlobalConfig(current, false);
      });
  }
  
  private startPolling() {
      if (this.pollingInterval) clearInterval(this.pollingInterval);
      
      this.pollingInterval = setInterval(async () => {
         if (!this.isAdminOpen() && !this.isCustomizing()) {
             // If we have too many errors, stop polling to save console/network
             if (this.consecutiveErrors > 5) {
                 console.warn('Backend appears offline. Polling paused.');
                 clearInterval(this.pollingInterval);
                 return;
             }
             await this.pollServerUpdates();
         }
      }, 3000);
  }

  // Explicitly Save Configuration (Public Method)
  async saveGlobalConfig(current: AppConfig = this.config(), isManual = true) {
      if (isManual) this.incrementLoading();
      
      const safeStyling = current.styling || DEFAULT_CONFIG.styling;

      const globalSettings = {
         lighting: current.lighting,
         audio: current.audio,
         texts: current.texts,
         styling: safeStyling, 
         character: current.character, 
         logoAssetId: current.logoAssetId,
         logoUrl: current.logoUrl,
         floorTextureAssetId: current.floorTextureAssetId,
         floorTextureUrl: current.floorTextureUrl, 
         standTextureAssetId: current.standTextureAssetId,
         standTextureUrl: current.standTextureUrl,
         gateTextureAssetId: current.gateTextureAssetId,
         gateTextureUrl: current.gateTextureUrl,
         
         // Environment settings
         environments: current.environments,
         activeEnvironmentId: current.activeEnvironmentId,
         
         // Scene Objects
         sceneObjects: current.sceneObjects,
         
         renderQuality: current.renderQuality,
         activeCarIndex: current.activeCarIndex
      };
      
      try {
          // 1. Server Persistence (Primary)
          await this.api.saveSettings(globalSettings);

          // 2. Local Persistence (Backup)
          localStorage.setItem('lexus_global_settings_v4', JSON.stringify(globalSettings));
          
          if (isManual) console.log('Settings Saved Successfully');
      } catch (e) {
          // Silent catch for auto-save
          if (isManual) console.error('Failed to save settings', e);
      } finally {
          if (isManual) this.decrementLoading();
      }
  }

  private async initializeData() {
      this.incrementLoading();
      try {
          // Deep copy default config to ensure we don't mutate const
          let loadedConfig = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
          let usedServerConfig = false;

          // 1. Load Global Settings (Server Priority)
          const serverSettings = await this.api.getSettings();
          if (serverSettings && Object.keys(serverSettings).length > 0) {
              loadedConfig = { ...loadedConfig, ...serverSettings };
              if (!loadedConfig.styling) {
                  loadedConfig.styling = { ...DEFAULT_CONFIG.styling };
              }
              usedServerConfig = true;
          } else {
              // Fallback to local if server is down
              try {
                  const savedSettings = localStorage.getItem('lexus_global_settings_v4');
                  if (savedSettings) {
                      const parsed = JSON.parse(savedSettings);
                      loadedConfig = { ...loadedConfig, ...parsed };
                      if (!loadedConfig.styling) {
                          loadedConfig.styling = { ...DEFAULT_CONFIG.styling };
                      }
                  }
              } catch (e) { console.warn('Settings load error', e); }
          }
          
          // Final safety check for styling
          if (!loadedConfig.styling) loadedConfig.styling = { ...DEFAULT_CONFIG.styling };
          
          if (!loadedConfig.environments) loadedConfig.environments = [];
          if (!loadedConfig.sceneObjects) loadedConfig.sceneObjects = [];

          // 2. Load Cars (Server Priority)
          const serverCars = await this.api.getCars();
          if (serverCars && serverCars.length > 0) {
              loadedConfig.fleet = serverCars;
          } else {
              // Fallback DB
              const dbCars = await this.db.getAllCars();
              if (dbCars.length > 0) {
                  loadedConfig.fleet = dbCars;
              } else {
                  // Initialize DB with Defaults
                  for (const car of DEFAULT_CONFIG.fleet) {
                      await this.db.saveCar(car);
                  }
              }
          }

          // 3. Hydrate Assets
          if (!usedServerConfig) {
             // Only attempt blob hydration if we are relying on local data
             await this.hydrateGlobalAssets(loadedConfig);
             await this.hydrateFleetAssets(loadedConfig.fleet);
          }

          // 4. Set State
          this.config.set(loadedConfig);
      } finally {
          this.decrementLoading();
      }
  }
  
  // --- Polling Logic ---
  private async pollServerUpdates() {
      // Don't overwrite if user is actively interacting to avoid jumps
      if (this.isLoading()) return;

      try {
        const serverSettings = await this.api.getSettings();
        
        if (serverSettings === null) {
            this.consecutiveErrors++;
            return;
        }

        // Reset error count on success
        this.consecutiveErrors = 0;

        if (serverSettings && Object.keys(serverSettings).length > 0) {
            this.config.update(current => {
                // Defensive merge for styling
                const newStyling = serverSettings.styling || current.styling || DEFAULT_CONFIG.styling;
                
                return {
                    ...current,
                    ...serverSettings,
                    styling: newStyling
                };
            });
        }
        
        const serverCars = await this.api.getCars();
        if (serverCars && serverCars.length > 0) {
            this.config.update(current => ({
                ...current,
                fleet: serverCars
            }));
        }
      } catch (e) {
          this.consecutiveErrors++;
      }
  }

  // --- Hydration Helpers ---

  private async hydrateGlobalAssets(conf: AppConfig) {
      const hydrate = async (assetId?: string, currentUrl?: string): Promise<string | undefined> => {
          // Allow absolute HTTP URLs OR relative paths (e.g. /uploads/...)
          if (currentUrl && (currentUrl.startsWith('http') || currentUrl.startsWith('/'))) return currentUrl; 
          if (!assetId) return currentUrl;
          const blob = await this.db.getAsset(assetId);
          return blob ? URL.createObjectURL(blob) : currentUrl;
      };

      conf.logoUrl = (await hydrate(conf.logoAssetId, conf.logoUrl)) || conf.logoUrl;
      conf.floorTextureUrl = (await hydrate(conf.floorTextureAssetId, conf.floorTextureUrl)) || conf.floorTextureUrl;
      conf.standTextureUrl = (await hydrate(conf.standTextureAssetId, conf.standTextureUrl)) || conf.standTextureUrl;
      conf.gateTextureUrl = (await hydrate(conf.gateTextureAssetId, conf.gateTextureUrl)) || conf.gateTextureUrl;
      conf.character.modelUrl = (await hydrate(conf.character.modelAssetId, conf.character.modelUrl)) || conf.character.modelUrl;
      
      if (conf.environments) {
          for (const env of conf.environments) {
              env.url = (await hydrate(env.assetId, env.url)) || env.url;
          }
      }
      
      if (conf.sceneObjects) {
          for (const obj of conf.sceneObjects) {
              obj.url = (await hydrate(obj.assetId, obj.url)) || obj.url;
          }
      }
  }

  private async hydrateFleetAssets(fleet: CarConfig[]) {
      const hydrate = async (assetId?: string, currentUrl?: string): Promise<string | undefined> => {
          if (currentUrl && (currentUrl.startsWith('http') || currentUrl.startsWith('/'))) return currentUrl;
          if (!assetId) return currentUrl;
          const blob = await this.db.getAsset(assetId);
          return blob ? URL.createObjectURL(blob) : currentUrl;
      };

      for (const car of fleet) {
          car.modelUrl = (await hydrate(car.modelAssetId, car.modelUrl));
          car.ignitionSoundUrl = (await hydrate(car.ignitionSoundAssetId, car.ignitionSoundUrl));
          car.driveSoundUrl = (await hydrate(car.driveSoundAssetId, car.driveSoundUrl));
      }
  }

  // --- Actions ---

  async uploadFile(file: File): Promise<{ id: string, url: string }> {
      this.incrementLoading();
      try {
          // 1. Try Server Upload
          const serverResult = await this.api.uploadAsset(file);
          if (serverResult) {
              return serverResult;
          }

          // 2. Fallback to Local IndexedDB (Offline mode)
          const id = crypto.randomUUID();
          await this.db.saveAsset(id, file);
          const url = URL.createObjectURL(file);
          return { id, url };
      } finally {
          this.decrementLoading();
      }
  }

  // Manual Save for Car
  async saveCurrentCar() {
      this.incrementLoading();
      try {
          const car = this.activeCar();
          // Save Server
          await this.api.saveCar(car);
          // Save Local Backup
          await this.db.saveCar(car);
          console.log('Car Saved', car.name);
      } finally {
          this.decrementLoading();
      }
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
  
  // Scene Object Actions
  addSceneObject(obj: SceneObject) {
      this.config.update(c => ({
          ...c,
          sceneObjects: [...c.sceneObjects, obj]
      }));
  }

  updateSceneObject(id: string, updates: Partial<SceneObject>) {
      this.config.update(c => ({
          ...c,
          sceneObjects: c.sceneObjects.map(o => o.id === id ? { ...o, ...updates } : o)
      }));
  }

  removeSceneObject(id: string) {
      this.config.update(c => ({
          ...c,
          sceneObjects: c.sceneObjects.filter(o => o.id !== id)
      }));
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
