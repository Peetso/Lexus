
import { Component, inject, OnInit, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CanvasViewerComponent } from './components/canvas-viewer.component';
import { JoystickComponent } from './components/joystick.component';
import { StoreService } from './services/store.service';
import { Hotspot } from './services/data.types';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, CanvasViewerComponent, JoystickComponent],
  templateUrl: './app.component.html',
  host: {
      '(window:keydown)': 'handleSecretCode($event)'
  }
})
export class AppComponent implements OnInit {
  store = inject(StoreService);
  activeCatId = 'color';
  showFsOverlay = false;
  private hasDismissedFs = false;
  
  private keyBuffer = '';

  ngOnInit() {
    this.checkMobileAndFullscreen();
  }

  @HostListener('window:resize')
  onResize() {
    this.checkMobileAndFullscreen();
  }

  checkMobileAndFullscreen() {
    if (this.hasDismissedFs) {
        this.showFsOverlay = false;
        return;
    }
    
    const isMobileWidth = window.innerWidth < 900;
    // Check standard and vendor-prefixed fullscreen elements
    const doc = document as any;
    const isFullscreen = !!(doc.fullscreenElement || doc.webkitFullscreenElement || doc.msFullscreenElement);
    
    // Only show if mobile width AND not currently in fullscreen
    this.showFsOverlay = isMobileWidth && !isFullscreen;
  }
  
  handleSecretCode(event: KeyboardEvent) {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
      
      if (event.key.length === 1) {
          this.keyBuffer += event.key.toLowerCase();
          if (this.keyBuffer.length > 20) this.keyBuffer = this.keyBuffer.slice(-20);
          
          if (this.keyBuffer.endsWith('adminpanel')) {
              this.store.isAdminOpen.set(true);
              this.keyBuffer = ''; 
          }
      }
  }

  enterFullScreen() {
    const elem = document.documentElement as any;
    const requestFs = elem.requestFullscreen || elem.webkitRequestFullscreen || elem.msRequestFullscreen;
    
    if (requestFs) {
      // Return type might be Promise or void depending on browser
      Promise.resolve(requestFs.call(elem)).catch(err => {
          console.warn('Fullscreen error:', err);
      });
    }
    
    // Always hide overlay on interaction
    this.showFsOverlay = false;
  }

  dismissFsOverlay() {
    this.hasDismissedFs = true;
    this.showFsOverlay = false;
  }

  // --- Confirmation Helpers ---
  confirmAction(message: string): boolean {
    return window.confirm(message);
  }

  onFileInputClick(event: MouseEvent) {
    if (!this.confirmAction("Changing this file will overwrite the existing asset for this car. Continue?")) {
        event.preventDefault();
    }
  }

  async saveCarData() {
      if (this.confirmAction(`Save changes for ${this.store.activeCar().name} to database?`)) {
          await this.store.saveCurrentCar();
          alert('Car data saved successfully!');
      }
  }

  // Audio Logic
  playIgnition() {
    const car = this.store.activeCar();
    if (car.ignitionSoundUrl && !this.store.config().audio.muted) {
        const audio = new Audio(car.ignitionSoundUrl);
        audio.volume = this.store.config().audio.masterVolume;
        audio.play().catch(e => console.warn('Audio play failed', e));
        
        if (car.driveSoundUrl) {
            audio.onended = () => {
                const drive = new Audio(car.driveSoundUrl);
                drive.loop = true;
                drive.volume = this.store.config().audio.masterVolume * 0.5;
                drive.play().catch(e => console.warn('Drive audio failed', e));
            };
        }
    }
  }

  selectOption(catId: string, optId: string) {
    const newState = { ...this.store.customizationState() };
    newState[catId] = optId;
    this.store.customizationState.set(newState);
    
    const cat = this.store.activeCar().customization?.find(c => c.id === catId);
    if (cat?.type === 'COLOR') {
        const opt = cat.options.find(o => o.id === optId);
        if (opt) {
            this.store.updateActiveCar({ color: opt.value });
        }
    }
  }

  // Admin Controls
  updateLightIntensity(e: Event) {
    const val = parseFloat((e.target as HTMLInputElement).value);
    const lighting = { ...this.store.config().lighting, intensity: val };
    this.store.updateConfig({ lighting });
  }

  updateAmbientIntensity(e: Event) {
    const val = parseFloat((e.target as HTMLInputElement).value);
    const lighting = { ...this.store.config().lighting, ambient: val };
    this.store.updateConfig({ lighting });
  }

  updateAccentColor(e: Event) {
    const val = (e.target as HTMLInputElement).value;
    const lighting = { ...this.store.config().lighting, accentColor: val };
    this.store.updateConfig({ lighting });
  }
  
  updatePageTitle(e: Event) {
    const val = (e.target as HTMLInputElement).value;
    const texts = { ...this.store.config().texts, title: val };
    this.store.updateConfig({ texts });
  }

  updateCarName(e: Event) {
    const name = (e.target as HTMLInputElement).value;
    this.store.updateActiveCar({ name });
  }

  updateUnderglow(e: Event) {
    const underglowColor = (e.target as HTMLInputElement).value;
    this.store.updateActiveCar({ underglowColor });
  }

  // File Handlers using persistent storage
  async onLogoSelected(event: any) {
    const file = event.target.files[0];
    if (file) {
      const { id, url } = await this.store.uploadFile(file);
      this.store.updateConfig({ logoUrl: url, logoAssetId: id });
    }
  }
  
  async onIgnitionSoundSelected(event: any) {
      const file = event.target.files[0];
      if (file) {
          const { id, url } = await this.store.uploadFile(file);
          this.store.updateActiveCar({ ignitionSoundUrl: url, ignitionSoundAssetId: id });
      }
  }
  
  async onDriveSoundSelected(event: any) {
      const file = event.target.files[0];
      if (file) {
          const { id, url } = await this.store.uploadFile(file);
          this.store.updateActiveCar({ driveSoundUrl: url, driveSoundAssetId: id });
      }
  }

  async onFileSelected(event: any) {
    const file = event.target.files[0];
    if (file) {
      const { id, url } = await this.store.uploadFile(file);
      this.store.updateActiveCar({ 
        modelUrl: url,
        modelAssetId: id,
        modelFileName: file.name
      });
    }
  }

  async onCharacterFileSelected(event: any) {
      const file = event.target.files[0];
      if (file) {
          const { id, url } = await this.store.uploadFile(file);
          let type: 'glb' | 'fbx' = 'glb';
          if (file.name.toLowerCase().endsWith('.fbx')) {
              type = 'fbx';
          }
          this.store.updateCharacter({ 
            modelUrl: url, 
            modelAssetId: id,
            modelType: type 
          });
      }
  }

  async onFloorTextureSelected(event: any) {
    const file = event.target.files[0];
    if (file) {
      const { id, url } = await this.store.uploadFile(file);
      this.store.updateConfig({ 
        floorTextureUrl: url,
        floorTextureAssetId: id
      });
    }
  }

  // Hotspot Management
  addPoint() {
    const type = this.store.activeSection().id === 'cockpit' ? 'interiorPoints' : 'techPoints';
    this.store.addHotspot(type);
  }

  removePoint(id: string) {
    if (this.confirmAction('Are you sure you want to delete this hotspot?')) {
        const type = this.store.activeSection().id === 'cockpit' ? 'interiorPoints' : 'techPoints';
        this.store.removeHotspot(type, id);
    }
  }

  getPoint(id: string): Hotspot | undefined {
    const car = this.store.activeCar();
    const all = [...(car.interiorPoints || []), ...(car.techPoints || [])];
    return all.find(p => p.id === id);
  }

  updatePointTitle(e: Event) {
    const val = (e.target as HTMLInputElement).value;
    const id = this.store.activeHotspotId();
    if (id) {
       const type = this.store.activeSection().id === 'cockpit' ? 'interiorPoints' : 'techPoints';
       this.store.updateHotspot(type, id, { title: val });
    }
  }

  updatePointDesc(e: Event) {
    const val = (e.target as HTMLTextAreaElement).value;
    const id = this.store.activeHotspotId();
    if (id) {
       const type = this.store.activeSection().id === 'cockpit' ? 'interiorPoints' : 'techPoints';
       this.store.updateHotspot(type, id, { desc: val });
    }
  }

  updatePointPos(e: Event, axisIndex: number) {
    const val = parseFloat((e.target as HTMLInputElement).value);
    const id = this.store.activeHotspotId();
    if (id) {
       const pt = this.getPoint(id);
       if(pt) {
         const newPos: [number,number,number] = [...pt.position];
         newPos[axisIndex] = val;
         const type = this.store.activeSection().id === 'cockpit' ? 'interiorPoints' : 'techPoints';
         this.store.updateHotspot(type, id, { position: newPos });
       }
    }
  }
}
