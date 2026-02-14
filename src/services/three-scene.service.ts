
import { Injectable, effect, inject } from '@angular/core';
import * as THREE from 'three';
import { StoreService } from './store.service';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Reflector } from 'three/examples/jsm/objects/Reflector.js';
import { EnvironmentItem, CarConfig, SceneObject } from './data.types';
import { FontLoader } from 'three/examples/jsm/loaders/FontLoader.js';
import { TextGeometry } from 'three/examples/jsm/geometries/TextGeometry.js';

interface CarMaterials {
  paint: THREE.MeshPhysicalMaterial;
  glass: THREE.MeshPhysicalMaterial;
  rubber: THREE.MeshStandardMaterial;
  chrome: THREE.MeshStandardMaterial;
}

@Injectable({ providedIn: 'root' })
export class ThreeSceneService {
  store = inject(StoreService);

  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private renderer!: THREE.WebGLRenderer;
  private controls!: OrbitControls;
  private pmremGenerator!: THREE.PMREMGenerator; // High Fidelity Env Map Generator
  
  // Audio
  private audioListener!: THREE.AudioListener;
  private engineSound!: THREE.PositionalAudio;
  private ignitionSound!: THREE.PositionalAudio;
  private isEngineRunning = false;
  private currentEngineSoundId: string | null = null;
  
  // Loaders
  private gltfLoader = new GLTFLoader();
  private fbxLoader = new FBXLoader();
  private audioLoader = new THREE.AudioLoader();
  private textureLoader = new THREE.TextureLoader();
  private fontLoader = new FontLoader();
  
  // Scene Groups
  private fleetGroup = new THREE.Group(); 
  private showroomGroup = new THREE.Group(); 
  private wallModelGroup = new THREE.Group(); 
  private wallMesh!: THREE.Mesh; 
  private standMesh!: THREE.Mesh; 
  
  // 3D Menu Group
  private menuGroup = new THREE.Group();
  private menuGates: THREE.Mesh[] = [];
  
  // Scene Objects Group
  private sceneObjectsGroup = new THREE.Group();
  private sceneObjectMap = new Map<string, THREE.Object3D>();

  private lightsGroup = new THREE.Group();
  private dirLight!: THREE.DirectionalLight; 

  private hotspotGroup = new THREE.Group();
  private charGroup = new THREE.Group(); 
  
  private clock = new THREE.Clock();
  
  private isInitialized = false;

  private envObjectMap = new Map<string, THREE.Object3D>();
  private carMap = new Map<string, THREE.Group>(); 
  private materialsMap = new Map<string, CarMaterials>();

  private currentCarParams = {
      wheels: [] as THREE.Object3D[],
      bodyParts: [] as THREE.Object3D[],
      hoodParts: [] as THREE.Object3D[],
      chassisParts: [] as THREE.Object3D[],
      originalPositions: new Map<THREE.Object3D, THREE.Vector3>(),
      originalRotations: new Map<THREE.Object3D, THREE.Euler>()
  };

  private floorMaterial!: THREE.MeshBasicMaterial;
  private gateMaterial!: THREE.ShaderMaterial; 

  private underglowLight = new THREE.PointLight(0xffffff, 50, 10);

  private speed = 0;
  private steering = 0;
  private carAngle = 0;
  private mapBounds = 190;
  
  private charSpeed = 0;
  private charRotation = 0;
  private charMixer: THREE.AnimationMixer | null = null;
  private charActions: { [key: string]: THREE.AnimationAction } = {};
  private charMeshes: { [key: string]: THREE.Object3D } = {}; 
  
  // --- High Fidelity Materials ---
  private basePaint = new THREE.MeshPhysicalMaterial({ 
    color: 0xffffff, 
    metalness: 0.7, 
    roughness: 0.2, 
    clearcoat: 1.0, 
    clearcoatRoughness: 0.03,
    envMapIntensity: 1.5 // Enhanced reflections
  });
  
  private baseGlass = new THREE.MeshPhysicalMaterial({
    color: 0x111111, 
    metalness: 0.9, 
    roughness: 0.0, 
    transmission: 0.2, 
    transparent: true, 
    opacity: 0.7,
    envMapIntensity: 2.0
  });
  
  private baseRubber = new THREE.MeshStandardMaterial({ 
      color: 0x050505, 
      roughness: 0.9, 
      metalness: 0.1,
      envMapIntensity: 0.5
  });
  
  private baseChrome = new THREE.MeshStandardMaterial({ 
      color: 0xffffff, 
      metalness: 1.0, 
      roughness: 0.0,
      envMapIntensity: 3.0 // Mirror chrome
  });

  private animationId: number = 0;
  private explodeFactor = 0;
  
  // Raycaster
  private raycaster = new THREE.Raycaster();
  private mouse = new THREE.Vector2();

  constructor() {
    effect(() => {
      const config = this.store.config();
      if (this.isInitialized) this.updateLights(config);
    });
    
    effect(() => {
        const quality = this.store.config().renderQuality;
        if (this.isInitialized) this.updateRenderQuality(quality);
    });

    effect(() => {
       const url = this.store.config().floorTextureUrl;
       if (this.isInitialized) this.updateFloorTexture(url);
    });
    
    effect(() => {
       const url = this.store.config().standTextureUrl;
       if (this.isInitialized) this.updateStandTexture(url);
    });
    
    // Gate Texture Update
    effect(() => {
        const url = this.store.config().gateTextureUrl;
        if (this.isInitialized) this.updateGateTexture(url);
    });
    
    effect(() => {
        const envs = this.store.config().environments;
        const tint = this.store.config().wallTint;
        if (this.isInitialized) {
            this.syncEnvironments(envs);
            this.applyWallTint(tint);
        }
    });

    effect(() => {
        const objs = this.store.config().sceneObjects;
        if (this.isInitialized) {
            this.syncSceneObjects(objs);
        }
    });

    effect(() => {
      const fleet = this.store.config().fleet;
      if (this.isInitialized) this.syncFleet(fleet);
    });

    effect(() => {
        const charConfig = this.store.config().character;
        if (this.isInitialized) {
            if (this.charGroup.userData['modelUrl'] !== charConfig.modelUrl || 
                this.charGroup.userData['modelType'] !== charConfig.modelType) {
                this.updateCharacterModel(charConfig);
                this.charGroup.userData['modelUrl'] = charConfig.modelUrl;
                this.charGroup.userData['modelType'] = charConfig.modelType;
            }
            const s = charConfig.scale ?? 1;
            this.charGroup.scale.set(s, s, s);
        }
    });

    // Main View Effect
    effect(() => {
        const section = this.store.activeSection();
        const isMenuOpen = this.store.isMenuOpen();
        
        if (!this.isInitialized) return;
        
        if (isMenuOpen) {
            this.enterMenuMode();
        } else {
            this.exitMenuMode();
            // Handle regular section logic
            if (this.controls) {
                this.controls.enabled = true;
                this.controls.maxPolarAngle = Math.PI / 2 - 0.02; 
                this.controls.minDistance = 1;
                this.controls.maxDistance = 25;
                this.controls.enablePan = false;
            }

            if (section.id === 'showroom') {
                this.resetCameraToShowroom();
                this.charGroup.visible = false;
            } 
            else if (section.id === 'cockpit') {
                this.moveToInterior();
                this.charGroup.visible = false;
            }
            else if (section.id === 'engineering') {
                if (this.controls) this.controls.minDistance = 2; 
                this.charGroup.visible = false;
            }
            else if (section.id === 'walk') {
                this.enterWalkMode();
            }
            else if (section.id === 'drive') {
                this.charGroup.visible = false;
                this.speed = 0;
                this.steering = 0;
                this.carAngle = 0;
            }
            this.renderHotspots();
        }
    });
    
    // Watch Active Car for Audio Updates
    effect(() => {
       const car = this.store.activeCar(); 
       if (this.isInitialized) {
           this.renderHotspots(); 
           this.updateCarAudio(car);
       }
    });
    
    // Watch Mute State
    effect(() => {
        const muted = this.store.config().audio.muted;
        const vol = this.store.config().audio.masterVolume;
        if (this.isInitialized && this.audioListener) {
            this.audioListener.setMasterVolume(muted ? 0 : vol);
        }
    });
  }

  init(canvas: HTMLCanvasElement) {
    this.scene = new THREE.Scene();
    
    // High Fidelity Renderer Setup
    this.renderer = new THREE.WebGLRenderer({ 
        canvas, 
        antialias: true, 
        alpha: false,
        powerPreference: 'high-performance',
        stencil: false
    });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap; // Softer, realistic shadows
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    
    // PMREM Generator for realistic reflections
    this.pmremGenerator = new THREE.PMREMGenerator(this.renderer);
    this.pmremGenerator.compileEquirectangularShader();

    // Environment Texture
    // Use a high-quality night/studio environment if available, or this placeholder
    // Ideally, this should be an HDR file loaded via RGBELoader for true HDR lighting.
    // Since we are restricted to standard loaders here, we use a high-res JPG and PMREM it.
    const textureLoader = new THREE.TextureLoader();
    textureLoader.load('https://images.unsplash.com/photo-1493246507139-91e8fad9978e?q=80&w=2940&auto=format&fit=crop', (texture) => {
        texture.mapping = THREE.EquirectangularReflectionMapping;
        texture.colorSpace = THREE.SRGBColorSpace;
        
        // Generate high-quality radiance map
        const envMap = this.pmremGenerator.fromEquirectangular(texture).texture;
        
        this.scene.background = texture;
        this.scene.environment = envMap; // Apply to all standard materials automatically
        this.scene.backgroundBlurriness = 0.3; 
        
        texture.dispose();
    });

    this.camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 1000);
    this.camera.position.set(6, 2, 7); 
    
    // Audio Listener
    this.audioListener = new THREE.AudioListener();
    this.camera.add(this.audioListener);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.minDistance = 1;
    this.controls.maxDistance = 25;
    this.controls.maxPolarAngle = Math.PI / 2 - 0.02;
    this.controls.target.set(0, 0.5, 0);

    this.buildFuturisticShowroom();
    this.buildMenuWorld(); 

    this.scene.add(this.showroomGroup);
    this.scene.add(this.menuGroup); 
    this.menuGroup.visible = false;
    
    this.showroomGroup.add(this.sceneObjectsGroup);

    this.scene.add(this.lightsGroup);
    this.scene.add(this.fleetGroup);

    this.underglowLight.position.set(0, 0.1, 0);
    this.scene.add(this.hotspotGroup);

    this.scene.add(this.charGroup);
    this.charGroup.visible = false; 

    this.isInitialized = true;
    
    const config = this.store.config();
    this.updateLights(config);
    this.syncFleet(config.fleet);
    
    this.syncEnvironments(config.environments);
    this.syncSceneObjects(config.sceneObjects); 
    
    this.applyWallTint(config.wallTint);
    
    this.updateFloorTexture(config.floorTextureUrl);
    this.updateStandTexture(config.standTextureUrl);
    this.updateGateTexture(config.gateTextureUrl);
    
    this.updateRenderQuality(config.renderQuality); 
    
    // Audio Init
    this.engineSound = new THREE.PositionalAudio(this.audioListener);
    this.ignitionSound = new THREE.PositionalAudio(this.audioListener);
    this.engineSound.setRefDistance(5);
    this.engineSound.setRolloffFactor(1);
    this.ignitionSound.setRefDistance(5);
    this.updateCarAudio(this.store.activeCar());

    this.animate();
    
    window.addEventListener('resize', this.onResize.bind(this));
  }
  
  // --- 3D Menu Logic ---
  
  private buildMenuWorld() {
      this.menuGroup.clear();
      this.menuGates = [];
      
      const sections = this.store.config().sections;
      const spacing = 8;
      const startX = -((sections.length - 1) * spacing) / 2;
      
      this.gateMaterial = new THREE.ShaderMaterial({
          uniforms: {
              tDiffuse: { value: null },
              accentColor: { value: new THREE.Color(this.store.config().lighting.accentColor) }
          },
          vertexShader: `
            varying vec2 vUv;
            void main() {
                vUv = uv;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
          `,
          fragmentShader: `
            uniform sampler2D tDiffuse;
            uniform vec3 accentColor;
            varying vec2 vUv;
            void main() {
                vec4 texel = texture2D(tDiffuse, vUv);
                float gray = dot(texel.rgb, vec3(0.299, 0.587, 0.114)); 
                vec3 finalColor = vec3(gray);
                if (gray > 0.8) {
                    finalColor = mix(finalColor, accentColor, 0.5); 
                }
                gl_FragColor = vec4(finalColor, texel.a);
            }
          `,
          transparent: true,
          side: THREE.DoubleSide
      });

      sections.forEach((sec, idx) => {
          const group = new THREE.Group();
          group.position.x = startX + (idx * spacing);
          group.userData['sectionIndex'] = idx; 
          
          const gateGeo = new THREE.PlaneGeometry(5, 8);
          const gate = new THREE.Mesh(gateGeo, this.gateMaterial);
          gate.position.y = 4;
          group.add(gate);
          this.menuGates.push(gate); 
          gate.userData['parentGroup'] = group; 

          const frameGeo = new THREE.BoxGeometry(5.2, 8.2, 0.2);
          const frameMat = new THREE.MeshStandardMaterial({ 
              color: 0x111111, roughness: 0.2, metalness: 0.9 
          });
          const frame = new THREE.Mesh(frameGeo, frameMat);
          frame.position.y = 4;
          frame.position.z = -0.1;
          group.add(frame);
          
          const canvas = document.createElement('canvas');
          canvas.width = 512; canvas.height = 128;
          const ctx = canvas.getContext('2d')!;
          ctx.fillStyle = 'rgba(0,0,0,0)';
          ctx.fillRect(0,0,512,128);
          ctx.font = 'bold 60px "Space Grotesk", sans-serif';
          ctx.textAlign = 'center';
          ctx.fillStyle = 'white';
          ctx.fillText(sec.label, 256, 80);
          
          const labelTex = new THREE.CanvasTexture(canvas);
          const labelMat = new THREE.SpriteMaterial({ map: labelTex });
          const sprite = new THREE.Sprite(labelMat);
          sprite.position.y = 9;
          sprite.scale.set(5, 1.25, 1);
          group.add(sprite);

          this.menuGroup.add(group);
      });
      
      const grid = new THREE.GridHelper(100, 50, 0x333333, 0x111111);
      this.menuGroup.add(grid);
  }
  
  private updateGateTexture(url: string) {
      if (!this.gateMaterial) return;
      this.store.incrementLoading();
      this.textureLoader.load(url, (tex) => {
          this.gateMaterial.uniforms['tDiffuse'].value = tex;
          this.gateMaterial.needsUpdate = true;
          this.store.decrementLoading();
      }, undefined, () => this.store.decrementLoading());
  }
  
  private enterMenuMode() {
      this.menuGroup.visible = true;
      this.showroomGroup.visible = false;
      this.fleetGroup.visible = false;
      this.charGroup.visible = false;
      this.hotspotGroup.visible = false;
      if (this.controls) this.controls.enabled = false; 
  }
  
  private exitMenuMode() {
      this.menuGroup.visible = false;
      this.showroomGroup.visible = true;
      this.fleetGroup.visible = true;
  }
  
  handleClick(event: MouseEvent) {
      if (!this.store.isMenuOpen()) return;
      
      this.mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
      this.mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
      
      this.raycaster.setFromCamera(this.mouse, this.camera);
      
      const intersects = this.raycaster.intersectObjects(this.menuGates);
      if (intersects.length > 0) {
          const hit = intersects[0].object;
          const group = hit.userData['parentGroup'];
          if (group) {
              const idx = group.userData['sectionIndex'];
              this.store.activeSectionIndex.set(idx);
              this.store.isMenuOpen.set(false);
          }
      }
  }

  // --- Audio Logic ---
  
  private updateCarAudio(car: CarConfig) {
      if (!this.audioListener) return;
      
      const activeGroup = this.carMap.get(car.id);
      
      if (this.engineSound.parent) this.engineSound.parent.remove(this.engineSound);
      if (this.ignitionSound.parent) this.ignitionSound.parent.remove(this.ignitionSound);

      if (activeGroup) {
          activeGroup.add(this.engineSound);
          activeGroup.add(this.ignitionSound);
      }

      if (car.driveSoundUrl && this.currentEngineSoundId !== car.id) {
          const wasRunning = this.isEngineRunning;

          if (this.engineSound.isPlaying) this.engineSound.stop();
          this.store.incrementLoading();
          this.audioLoader.load(car.driveSoundUrl, (buffer) => {
              this.currentEngineSoundId = car.id; 
              this.engineSound.setBuffer(buffer);
              this.engineSound.setLoop(true);
              this.engineSound.setVolume(0.5);
              
              if (wasRunning && !this.engineSound.isPlaying) {
                  this.engineSound.play();
              }
              
              this.store.decrementLoading();
          }, undefined, () => this.store.decrementLoading());
      } else if (car.driveSoundUrl && this.currentEngineSoundId === car.id) {
          if (this.isEngineRunning && !this.engineSound.isPlaying && this.engineSound.buffer) {
               this.engineSound.play();
          }
      }
      
      if (car.ignitionSoundUrl) {
          this.store.incrementLoading();
          this.audioLoader.load(car.ignitionSoundUrl, (buffer) => {
              this.ignitionSound.setBuffer(buffer);
              this.ignitionSound.setLoop(false);
              this.ignitionSound.setVolume(1.0);
              this.store.decrementLoading();
          }, undefined, () => this.store.decrementLoading());
      }
  }

  public async toggleIgnition() {
      if (this.audioListener.context.state === 'suspended') {
          await this.audioListener.context.resume();
      }

      if (this.isEngineRunning) {
          this.stopEngine();
      } else {
          this.startEngine();
      }
  }

  private startEngine() {
      if (this.isEngineRunning) return;
      this.isEngineRunning = true;

      if (this.ignitionSound.buffer) {
          if (this.ignitionSound.isPlaying) this.ignitionSound.stop();
          this.ignitionSound.play();
          
          this.ignitionSound.onEnded = () => {
             if (this.engineSound.buffer && !this.engineSound.isPlaying && this.isEngineRunning) {
                 this.engineSound.play();
             }
          };
      } else if (this.engineSound.buffer) {
          this.engineSound.play();
      }
  }

  public stopEngine() {
      if (!this.isEngineRunning) return;
      
      if (this.engineSound.isPlaying) this.engineSound.stop();
      if (this.ignitionSound.isPlaying) this.ignitionSound.stop();
      this.isEngineRunning = false;
      this.speed = 0; 
  }

  // ---

  private onResize() {
    if (!this.camera || !this.renderer) return;
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }
  
  private updateRenderQuality(quality: 'ultra' | 'high' | 'low') {
      if (!this.renderer) return;
      
      if (quality === 'ultra') {
          this.renderer.setPixelRatio(window.devicePixelRatio); 
          this.renderer.shadowMap.enabled = true;
          this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
          if (this.dirLight) {
              this.dirLight.shadow.mapSize.width = 4096;
              this.dirLight.shadow.mapSize.height = 4096;
              this.dirLight.shadow.bias = -0.00005; // Refine shadow bias for high res
          }
      } else if (quality === 'high') {
          this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2.0)); 
          this.renderer.shadowMap.enabled = true;
          this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
          if (this.dirLight) {
              this.dirLight.shadow.mapSize.width = 2048;
              this.dirLight.shadow.mapSize.height = 2048;
              this.dirLight.shadow.bias = -0.0001;
          }
      } else {
          this.renderer.setPixelRatio(1.0); 
          this.renderer.shadowMap.enabled = false;
      }
      
      this.scene.traverse((obj) => {
          if ((obj as THREE.Mesh).isMesh) {
              const mesh = obj as THREE.Mesh;
              if (Array.isArray(mesh.material)) {
                  mesh.material.forEach(m => m.needsUpdate = true);
              } else if (mesh.material) {
                  (mesh.material as THREE.Material).needsUpdate = true;
              }
          }
      });
  }

  // --- Environment Logic ---
  
  private syncEnvironments(envs: EnvironmentItem[]) {
      const currentIds = new Set(this.envObjectMap.keys());
      const newIds = new Set(envs.map(e => e.id));

      for (const id of currentIds) {
          if (!newIds.has(id)) {
              const obj = this.envObjectMap.get(id);
              if (obj) {
                  this.wallModelGroup.remove(obj);
              }
              this.envObjectMap.delete(id);
          }
      }

      for (const env of envs) {
          if (this.envObjectMap.has(env.id)) {
              const anchor = this.envObjectMap.get(env.id)!;
              this.applyEnvironmentTransform(env, anchor);
          } else {
              this.loadEnvironmentModel(env);
          }
      }
  }

  private loadEnvironmentModel(env: EnvironmentItem) {
      if (!env.url) return;

      const anchor = new THREE.Group();
      anchor.name = env.id;
      this.applyEnvironmentTransform(env, anchor);
      
      this.envObjectMap.set(env.id, anchor);
      this.wallModelGroup.add(anchor);

      this.store.incrementLoading();
      this.gltfLoader.load(env.url, (gltf) => {
          if (this.envObjectMap.has(env.id)) {
              const model = gltf.scene;
              model.traverse((child: any) => {
                  if (child.isMesh) {
                      child.castShadow = true;
                      child.receiveShadow = true;
                  }
              });
              anchor.add(model);
          }
          this.store.decrementLoading();
      }, undefined, (err) => {
          console.error('Failed to load env', err);
          this.store.decrementLoading();
      });
  }
  
  private applyEnvironmentTransform(env: EnvironmentItem, obj: THREE.Object3D) {
      obj.scale.set(env.scale, env.scale, env.scale);
      obj.position.set(env.position[0], env.position[1], env.position[2]);
  }

  // --- Scene Objects Logic ---

  private syncSceneObjects(objects: SceneObject[]) {
      const currentIds = new Set(this.sceneObjectMap.keys());
      const newIds = new Set(objects.map(o => o.id));

      for (const id of currentIds) {
          if (!newIds.has(id)) {
              const obj = this.sceneObjectMap.get(id);
              if (obj) {
                  this.sceneObjectsGroup.remove(obj);
              }
              this.sceneObjectMap.delete(id);
          }
      }

      for (const objData of objects) {
          if (this.sceneObjectMap.has(objData.id)) {
              const group = this.sceneObjectMap.get(objData.id)!;
              if (group.userData['url'] !== objData.url) {
                  this.sceneObjectsGroup.remove(group);
                  this.sceneObjectMap.delete(objData.id);
                  this.loadSceneObject(objData);
              } else {
                  this.applySceneObjectTransform(objData, group);
              }
          } else {
              this.loadSceneObject(objData);
          }
      }
  }

  private loadSceneObject(objData: SceneObject) {
      const group = new THREE.Group();
      group.name = objData.id;
      group.userData['url'] = objData.url;
      
      this.applySceneObjectTransform(objData, group);
      this.sceneObjectsGroup.add(group);
      this.sceneObjectMap.set(objData.id, group);

      this.store.incrementLoading();
      this.gltfLoader.load(objData.url, (gltf) => {
          if (this.sceneObjectMap.has(objData.id)) {
              const model = gltf.scene;
              model.traverse((child: any) => {
                  if (child.isMesh) {
                      child.castShadow = true;
                      child.receiveShadow = true;
                  }
              });
              group.add(model);
          }
          this.store.decrementLoading();
      }, undefined, (err) => {
          console.error('Failed to load scene object', err);
          this.store.decrementLoading();
      });
  }

  private applySceneObjectTransform(data: SceneObject, group: THREE.Object3D) {
      group.position.set(data.position[0], data.position[1], data.position[2]);
      group.rotation.set(data.rotation[0], data.rotation[1], data.rotation[2]);
      group.scale.set(data.scale[0], data.scale[1], data.scale[2]);
  }

  // --- Fleet Logic ---

  private getOrCreateMaterials(carId: string): CarMaterials {
    if (this.materialsMap.has(carId)) {
        return this.materialsMap.get(carId)!;
    }
    const mats: CarMaterials = {
        paint: this.basePaint.clone(),
        glass: this.baseGlass.clone(),
        rubber: this.baseRubber.clone(),
        chrome: this.baseChrome.clone()
    };
    this.materialsMap.set(carId, mats);
    return mats;
  }

  private syncFleet(fleet: any[]) {
      const currentIds = Array.from(this.carMap.keys());
      currentIds.forEach(id => {
          const group = this.carMap.get(id);
          if (!group) return;
          const carConfig = fleet.find(c => c.id === id);
          let shouldRemove = false;
          if (!carConfig) shouldRemove = true;
          else if (group.userData['modelUrl'] !== carConfig.modelUrl) shouldRemove = true;

          if (shouldRemove) {
              this.fleetGroup.remove(group);
              this.carMap.delete(id);
              this.materialsMap.get(id)?.paint.dispose();
              this.materialsMap.get(id)?.glass.dispose();
              this.materialsMap.get(id)?.rubber.dispose();
              this.materialsMap.get(id)?.chrome.dispose();
              this.materialsMap.delete(id);
          }
      });

      fleet.forEach((carConfig, index) => {
          const mats = this.getOrCreateMaterials(carConfig.id);
          mats.paint.color.set(carConfig.color);
          mats.paint.metalness = carConfig.metalness;
          mats.paint.roughness = carConfig.roughness;
          if (!this.carMap.has(carConfig.id)) {
              this.createCarGroup(carConfig);
          }
      });
      
      const activeCar = this.store.activeCar();
      const activeGroup = this.carMap.get(activeCar.id);
      if (activeGroup) {
          this.analyzeCarStructure(activeGroup);
          if (this.underglowLight.parent !== activeGroup) {
             activeGroup.add(this.underglowLight);
          }
          this.underglowLight.color.set(activeCar.underglowColor || activeCar.color);
          
          if (this.engineSound && this.ignitionSound) {
             activeGroup.add(this.engineSound);
             activeGroup.add(this.ignitionSound);
          }
      }
  }

  private createCarGroup(carConfig: any) {
      const group = new THREE.Group();
      group.name = carConfig.id;
      group.userData['modelUrl'] = carConfig.modelUrl; 
      
      this.carMap.set(carConfig.id, group);
      this.fleetGroup.add(group);

      if (carConfig.modelUrl) {
          this.store.incrementLoading();
          this.gltfLoader.load(carConfig.modelUrl, (gltf) => {
              const model = gltf.scene;
              const box = new THREE.Box3().setFromObject(model);
              const size = box.getSize(new THREE.Vector3());
              const scaleFactor = 4.5 / (size.z || 4.5); 
              model.scale.set(scaleFactor, scaleFactor, scaleFactor);
              
              const center = box.getCenter(new THREE.Vector3());
              model.position.sub(center.multiplyScalar(scaleFactor));
              model.position.y += (size.y * scaleFactor * 0.5); 
              
              const mats = this.getOrCreateMaterials(carConfig.id);
              model.traverse((child: any) => {
                  if (child.isMesh) {
                      child.castShadow = true;
                      child.receiveShadow = true;
                      child.userData['origPos'] = child.position.clone();
                      this.applyAutoMaterials(child, mats);
                  }
              });
              group.add(model);
              if (this.store.activeCar().id === carConfig.id) {
                  this.analyzeCarStructure(group);
              }
              this.store.decrementLoading();
          }, undefined, (err) => {
             console.error('Car load failed', err);
             this.store.decrementLoading();
          });
      } else {
          this.buildProceduralCar(group, carConfig);
          if (this.store.activeCar().id === carConfig.id) {
              this.analyzeCarStructure(group);
          }
      }
  }

  private buildProceduralCar(group: THREE.Group, config: any) {
      const mats = this.getOrCreateMaterials(config.id);
      const bodyGeo = new THREE.BoxGeometry(2, 0.5, 4.6);
      const body = new THREE.Mesh(bodyGeo, mats.paint); 
      body.position.set(0, 0.5, 0);
      body.name = "procedural_body";
      body.castShadow = true;
      body.userData['origPos'] = body.position.clone();
      group.add(body);
      
      const cabinGeo = new THREE.SphereGeometry(1.2, 32, 16);
      const cabin = new THREE.Mesh(cabinGeo, mats.glass);
      cabin.scale.set(0.9, 0.4, 1.5); 
      cabin.position.set(0, 1.0, -0.2);
      cabin.name = "procedural_glass";
      cabin.castShadow = true;
      cabin.userData['origPos'] = cabin.position.clone();
      group.add(cabin);

      const wheelGeo = new THREE.CylinderGeometry(0.4, 0.4, 0.35, 32);
      const positions = [[-1.1, 0.4, 1.6], [1.1, 0.4, 1.6], [-1.2, 0.42, -1.6], [1.2, 0.42, -1.6]];
      positions.forEach(pos => {
          const wGroup = new THREE.Group();
          wGroup.position.set(pos[0], pos[1], pos[2]);
          const t = new THREE.Mesh(wheelGeo, mats.rubber); 
          t.rotation.z = Math.PI/2; 
          t.castShadow = true; 
          t.name = "procedural_wheel";
          wGroup.add(t);
          wGroup.userData['origPos'] = wGroup.position.clone();
          group.add(wGroup);
      });
  }

  private applyAutoMaterials(mesh: THREE.Mesh, mats: CarMaterials) {
      const lowerName = mesh.name.toLowerCase();
      if (lowerName.includes('body') || lowerName.includes('paint') || lowerName.includes('chassis')) {
           mesh.material = mats.paint;
      } else if (lowerName.includes('glass') || lowerName.includes('window')) {
           mesh.material = mats.glass;
      } else if (lowerName.includes('tire') || lowerName.includes('rubber')) {
           mesh.material = mats.rubber;
      } else if (lowerName.includes('rim') || lowerName.includes('chrome')) {
           mesh.material = mats.chrome;
      }
  }

  private analyzeCarStructure(group: THREE.Group) {
      this.currentCarParams.wheels = [];
      this.currentCarParams.bodyParts = [];
      this.currentCarParams.hoodParts = [];
      this.currentCarParams.chassisParts = [];
      this.currentCarParams.originalPositions.clear();
      this.currentCarParams.originalRotations.clear();

      const box = new THREE.Box3().setFromObject(group);
      const size = new THREE.Vector3();
      box.getSize(size);
      const center = new THREE.Vector3();
      box.getCenter(center);
      
      const thresholdY = box.min.y + (size.y * 0.35); 
      const frontZ = center.z + (size.z * 0.25); 

      group.traverse((obj) => {
          if (obj instanceof THREE.Mesh || obj instanceof THREE.Group) {
              if(obj === group) return;
              
              const hasGeo = obj instanceof THREE.Mesh;
              const isWheelGroup = obj.name.toLowerCase().includes('wheel') || obj.name.toLowerCase().includes('rim');
              
              if (!hasGeo && !isWheelGroup) return;

              if (!this.currentCarParams.originalPositions.has(obj)) {
                  this.currentCarParams.originalPositions.set(obj, obj.position.clone());
                  this.currentCarParams.originalRotations.set(obj, obj.rotation.clone());
              }

              const name = obj.name.toLowerCase();
              
              if (name.includes('wheel') || name.includes('tire') || name.includes('rim') || name.includes('brake')) {
                  if (obj.parent === group || (obj.parent && obj.parent.parent === group)) {
                      // Fix: Set rotation order to YXZ to correctly apply steering (Y) before rolling (X)
                      obj.rotation.order = 'YXZ';
                      
                      // Identify if this is a front wheel based on Z position relative to car center
                      // Assuming +Z is forward based on movement logic
                      const worldPos = new THREE.Vector3();
                      obj.getWorldPosition(worldPos);
                      // If Z is greater than center Z, it's forward
                      obj.userData['isFront'] = worldPos.z > center.z; 
                      
                      this.currentCarParams.wheels.push(obj);
                  }
                  return;
              }
              
              const worldPos = new THREE.Vector3();
              obj.getWorldPosition(worldPos);

              if (name.includes('hood') || name.includes('bonnet')) {
                  this.currentCarParams.hoodParts.push(obj);
                  return;
              }
              
              if (worldPos.y > thresholdY) {
                  if (worldPos.z > frontZ && worldPos.y > (center.y + size.y*0.1)) {
                       this.currentCarParams.hoodParts.push(obj);
                  } else {
                       this.currentCarParams.bodyParts.push(obj);
                  }
              } else {
                  this.currentCarParams.chassisParts.push(obj);
              }
          }
      });
      
      // Remove duplicates just in case
      this.currentCarParams.wheels = [...new Set(this.currentCarParams.wheels)];
  }

  private renderHotspots() {
      this.hotspotGroup.clear();
      const section = this.store.activeSection();
      const car = this.store.activeCar();
      
      let points = [];
      if (section.id === 'cockpit') points = car.interiorPoints || [];
      if (section.id === 'engineering') points = car.techPoints || [];
      
      const spriteMat = new THREE.SpriteMaterial({ 
          color: this.store.config().lighting.accentColor,
          depthTest: false, 
          depthWrite: false
      });

      points.forEach(p => {
          const sprite = new THREE.Sprite(spriteMat);
          sprite.position.set(p.position[0], p.position[1], p.position[2]);
          sprite.scale.set(0.15, 0.15, 0.15);
          this.hotspotGroup.add(sprite);
      });
      
      const activeGroup = this.carMap.get(car.id);
      if (activeGroup && this.hotspotGroup.parent !== activeGroup) {
          activeGroup.add(this.hotspotGroup);
      }
  }

  // --- View Resets ---

  private resetCameraToShowroom() {
      this.speed = 0;
      if (this.camera) {
        this.camera.position.set(6, 2, 7);
        if (this.controls) {
            this.controls.target.set(0, 0.5, 0);
            this.controls.enabled = true;
        }
      }
  }

  private moveToInterior() {
      if (!this.controls || !this.camera) return;
      const headHeight = 1.1; 
      const targetPos = new THREE.Vector3(0, headHeight, 0); 
      this.controls.target.copy(targetPos);
      this.camera.position.set(0.35, headHeight, 0.1); 
      this.controls.minDistance = 0.01; 
      this.controls.maxDistance = 1.5; 
      this.controls.maxPolarAngle = Math.PI; 
      this.controls.enablePan = true; 
      this.controls.update();
  }

  private enterWalkMode() {
      this.charGroup.visible = true;
      const charConfig = this.store.config().character;
      this.charGroup.position.set(charConfig.position[0], charConfig.position[1], charConfig.position[2]);
      
      if (this.controls) {
          this.controls.enabled = false; 
      }

      if (this.camera) {
          const idealOffset = new THREE.Vector3(0, 2.5, -4);
          idealOffset.applyAxisAngle(new THREE.Vector3(0, 1, 0), this.charRotation);
          this.camera.position.copy(this.charGroup.position).add(idealOffset);
          
          const lookAtPos = new THREE.Vector3(0, 1.5, 5);
          lookAtPos.applyAxisAngle(new THREE.Vector3(0, 1, 0), this.charRotation);
          lookAtPos.add(this.charGroup.position);
          this.camera.lookAt(lookAtPos);
      }
  }
  
  private updateCharacterModel(config: any) {
    if (config.modelUrl && config.modelType && config.modelType !== 'none') {
        this.loadCharacterModel(config.modelUrl, config.modelType);
    } else {
        this.buildProceduralCharacter();
    }
  }

  private loadCharacterModel(url: string, type: 'glb' | 'fbx') {
      this.charGroup.clear();
      this.charMeshes = {}; 
      this.charMixer = null;
      this.charActions = {};

      const onLoad = (object: THREE.Object3D) => {
          object.scale.set(0.01, 0.01, 0.01); 
          const box = new THREE.Box3().setFromObject(object);
          const size = box.getSize(new THREE.Vector3());
          const targetHeight = 1.8; 
          if (size.y > 0) {
              const scale = targetHeight / size.y;
              object.scale.set(scale, scale, scale);
          }
          object.traverse((child: any) => {
              if (child.isMesh) { child.castShadow = true; child.receiveShadow = true; }
          });
          const animations = (object as any).animations || [];
          if (animations && animations.length > 0) {
              this.charMixer = new THREE.AnimationMixer(object);
              animations.forEach((clip: THREE.AnimationClip) => {
                 const action = this.charMixer!.clipAction(clip);
                 action.setLoop(THREE.LoopRepeat, Infinity);
                 this.charActions[clip.name] = action;
                 if (clip.name.toLowerCase().includes('idle') || animations.length === 1) action.play();
              });
              if (animations.length > 0 && !Object.keys(this.charActions).some(k => k.toLowerCase().includes('idle'))) {
                  this.charActions[animations[0].name].play();
              }
          }
          this.charGroup.add(object);
          this.store.decrementLoading();
      };
      
      this.store.incrementLoading();

      if (type === 'glb') {
          this.gltfLoader.load(url, (gltf) => {
             // @ts-ignore
             gltf.scene.animations = gltf.animations; 
             onLoad(gltf.scene);
          }, undefined, () => this.store.decrementLoading());
      } else if (type === 'fbx') {
          this.fbxLoader.load(url, (fbx) => onLoad(fbx), undefined, () => this.store.decrementLoading());
      } else {
          this.store.decrementLoading();
      }
  }

  private buildProceduralCharacter() {
      this.charGroup.clear();
      this.charMixer = null;
      this.charMeshes = {}; 
      const mat = new THREE.MeshStandardMaterial({ 
          color: 0x333333, roughness: 0.5, metalness: 0.8, emissive: 0x00ffff, emissiveIntensity: 0.2 
      });
      const bodyGroup = new THREE.Group();
      bodyGroup.position.y = 1.0; 
      this.charGroup.add(bodyGroup);
      this.charMeshes['body'] = bodyGroup;
      const torsoGeo = new THREE.CylinderGeometry(0.25, 0.15, 0.7, 8);
      const torso = new THREE.Mesh(torsoGeo, mat);
      torso.position.y = 0.35; 
      bodyGroup.add(torso);
      const headGeo = new THREE.SphereGeometry(0.15, 16, 16);
      const head = new THREE.Mesh(headGeo, mat);
      head.position.y = 0.85; 
      bodyGroup.add(head);
      const visorGeo = new THREE.BoxGeometry(0.2, 0.05, 0.15);
      const visorMat = new THREE.MeshBasicMaterial({ color: 0x00ffff });
      const visor = new THREE.Mesh(visorGeo, visorMat);
      visor.position.set(0, 0.85, 0.08);
      bodyGroup.add(visor);
      const legGeo = new THREE.CapsuleGeometry(0.12, 0.9, 4, 8);
      const leftLegGroup = new THREE.Group();
      leftLegGroup.position.set(-0.15, 0, 0); 
      bodyGroup.add(leftLegGroup);
      this.charMeshes['leftLeg'] = leftLegGroup;
      const leftLegMesh = new THREE.Mesh(legGeo, mat);
      leftLegMesh.position.y = -0.45; 
      leftLegGroup.add(leftLegMesh);
      const rightLegGroup = new THREE.Group();
      rightLegGroup.position.set(0.15, 0, 0); 
      bodyGroup.add(rightLegGroup);
      this.charMeshes['rightLeg'] = rightLegGroup;
      const rightLegMesh = new THREE.Mesh(legGeo, mat);
      rightLegMesh.position.y = -0.45;
      rightLegGroup.add(rightLegMesh);
      const armGeo = new THREE.CapsuleGeometry(0.1, 0.7, 4, 8);
      const leftArmGroup = new THREE.Group();
      leftArmGroup.position.set(-0.35, 0.6, 0); 
      bodyGroup.add(leftArmGroup);
      this.charMeshes['leftArm'] = leftArmGroup;
      const leftArmMesh = new THREE.Mesh(armGeo, mat);
      leftArmMesh.position.y = -0.3;
      leftArmGroup.add(leftArmMesh);
      const rightArmGroup = new THREE.Group();
      rightArmGroup.position.set(0.35, 0.6, 0);
      bodyGroup.add(rightArmGroup);
      this.charMeshes['rightArm'] = rightArmGroup;
      const rightArmMesh = new THREE.Mesh(armGeo, mat);
      rightArmMesh.position.y = -0.3;
      rightArmGroup.add(rightArmMesh);
      this.charGroup.castShadow = true;
  }

  private animateCharacter(delta: number, moveSpeed: number) {
      if (this.charMixer) {
          this.charMixer.update(delta);
          const actions = Object.values(this.charActions);
          if (actions.length === 0) return;

          let idleAction = actions.find(a => a.getClip().name.toLowerCase().includes('idle'));
          let runAction = actions.find(a => a.getClip().name.toLowerCase().includes('run') || a.getClip().name.toLowerCase().includes('walk'));

          if (!idleAction && actions.length > 0) idleAction = actions[0];
          if (!runAction && actions.length > 1) runAction = actions[1];
          if (!runAction && idleAction) runAction = idleAction;

          if (idleAction && runAction) {
              const isMoving = moveSpeed > 0.1;
              const activeAction = isMoving ? runAction : idleAction;
              const otherAction = isMoving ? idleAction : runAction;

              if (activeAction !== otherAction) {
                  if (!activeAction.isRunning()) {
                      otherAction.fadeOut(0.2);
                      activeAction.reset().fadeIn(0.2).play();
                  }
              } else {
                  if (!activeAction.isRunning()) activeAction.play();
              }
              
              if (isMoving) {
                  const baseScale = (activeAction === idleAction && actions.length === 1) ? 2.0 : 1.0;
                  activeAction.setEffectiveTimeScale(baseScale + (moveSpeed * 0.5));
              } else {
                  activeAction.setEffectiveTimeScale(1.0);
              }
          }
          return;
      }

      const time = this.clock.getElapsedTime();
      
      if (Object.keys(this.charMeshes).length === 0 && this.charGroup.userData['modelType'] !== 'none') {
           if (moveSpeed > 0.1) {
               const freq = 15;
               const amp = 0.08;
               const baseY = this.store.config().character.position[1];
               this.charGroup.position.y = baseY + Math.abs(Math.sin(time * freq)) * amp;
               this.charGroup.rotation.x = 0.15;
           } else {
               const baseY = this.store.config().character.position[1];
               this.charGroup.position.y = THREE.MathUtils.lerp(this.charGroup.position.y, baseY, delta * 5);
               this.charGroup.rotation.x = THREE.MathUtils.lerp(this.charGroup.rotation.x, 0, delta * 5);
           }
           return;
      }

      if (moveSpeed > 0.1) {
          const freq = moveSpeed > 0.6 ? 15 : 8; 
          const amp = moveSpeed > 0.6 ? 0.8 : 0.5; 
          if (this.charMeshes['leftLeg']) this.charMeshes['leftLeg'].rotation.x = Math.sin(time * freq) * amp;
          if (this.charMeshes['rightLeg']) this.charMeshes['rightLeg'].rotation.x = Math.sin(time * freq + Math.PI) * amp;
          if (this.charMeshes['leftArm']) this.charMeshes['leftArm'].rotation.x = Math.sin(time * freq + Math.PI) * amp;
          if (this.charMeshes['rightArm']) this.charMeshes['rightArm'].rotation.x = Math.sin(time * freq) * amp;
          if (this.charMeshes['body']) {
              this.charMeshes['body'].position.y = 1.0 + Math.abs(Math.sin(time * freq * 2)) * 0.05;
              this.charMeshes['body'].rotation.y = 0; 
          }
      } else {
          const lerp = 5 * delta;
          if (this.charMeshes['leftLeg']) this.charMeshes['leftLeg'].rotation.x = THREE.MathUtils.lerp(this.charMeshes['leftLeg'].rotation.x, 0, lerp);
          if (this.charMeshes['rightLeg']) this.charMeshes['rightLeg'].rotation.x = THREE.MathUtils.lerp(this.charMeshes['rightLeg'].rotation.x, 0, lerp);
          if (this.charMeshes['leftArm']) this.charMeshes['leftArm'].rotation.x = THREE.MathUtils.lerp(this.charMeshes['leftArm'].rotation.x, 0, lerp);
          if (this.charMeshes['rightArm']) this.charMeshes['rightArm'].rotation.x = THREE.MathUtils.lerp(this.charMeshes['rightArm'].rotation.x, 0, lerp);
          if (this.charMeshes['body']) {
              this.charMeshes['body'].position.y = 1.0 + Math.sin(time * 2) * 0.02;
          }
      }
  }

  private updateFloorTexture(url: string) {
    if (!this.floorMaterial) return;
    this.store.incrementLoading();
    new THREE.TextureLoader().load(url, (map) => {
      map.wrapS = THREE.RepeatWrapping;
      map.wrapT = THREE.RepeatWrapping;
      map.repeat.set(6, 6);
      map.colorSpace = THREE.SRGBColorSpace;
      if (this.renderer) map.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
      map.minFilter = THREE.LinearMipmapLinearFilter;
      map.magFilter = THREE.LinearFilter;
      this.floorMaterial.map = map;
      this.floorMaterial.needsUpdate = true;
      this.store.decrementLoading();
    }, undefined, () => this.store.decrementLoading());
  }

  private updateStandTexture(url: string) {
    if (!this.standMesh) return;
    const mat = this.standMesh.material as THREE.MeshStandardMaterial;

    if (!url) {
        mat.map = null;
        mat.needsUpdate = true;
        return;
    }
    
    this.store.incrementLoading();
    new THREE.TextureLoader().load(url, (map) => {
      map.wrapS = THREE.RepeatWrapping;
      map.wrapT = THREE.RepeatWrapping;
      map.repeat.set(2, 2);
      map.colorSpace = THREE.SRGBColorSpace;
      if (this.renderer) map.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
      map.minFilter = THREE.LinearMipmapLinearFilter;
      map.magFilter = THREE.LinearFilter;
      
      mat.map = map;
      mat.needsUpdate = true;
      this.store.decrementLoading();
    }, undefined, () => this.store.decrementLoading());
  }
  
  private applyWallTint(tint: number) {
     if (!this.wallMesh) return;
     const mat = this.wallMesh.material as THREE.MeshPhysicalMaterial;
     mat.opacity = tint;
     mat.color.set(0x000000);
     mat.metalness = 1.0;
     mat.roughness = 0.0;
     mat.clearcoat = 1.0;
     mat.transparent = true;
     mat.needsUpdate = true;
  }

  private buildFuturisticShowroom() {
    this.showroomGroup.clear();
    const floorSize = 400;
    const floorGeo = new THREE.PlaneGeometry(floorSize, floorSize);
    
    // Enhanced Reflector for high quality floor reflections
    const reflector = new Reflector(floorGeo, {
      clipBias: 0.003, 
      textureWidth: window.innerWidth * 1.5, // Super-sampling for reflection
      textureHeight: window.innerHeight * 1.5,
      color: 0x555555, 
      multisample: 4 // Reduced aliasing
    });
    reflector.rotation.x = -Math.PI / 2;
    reflector.position.y = -0.02;
    this.showroomGroup.add(reflector);

    const texLoader = new THREE.TextureLoader();
    const marbleUrl = this.store.config().floorTextureUrl;
    const marbleMap = texLoader.load(marbleUrl);
    marbleMap.wrapS = THREE.RepeatWrapping; 
    marbleMap.wrapT = THREE.RepeatWrapping; 
    marbleMap.repeat.set(6, 6);
    marbleMap.colorSpace = THREE.SRGBColorSpace;
    if (this.renderer) marbleMap.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    marbleMap.minFilter = THREE.LinearMipmapLinearFilter;
    marbleMap.magFilter = THREE.LinearFilter;

    this.floorMaterial = new THREE.MeshBasicMaterial({
      map: marbleMap, transparent: true, opacity: 0.85, side: THREE.DoubleSide
    });
    const marbleFloor = new THREE.Mesh(floorGeo, this.floorMaterial);
    marbleFloor.rotation.x = -Math.PI / 2;
    this.showroomGroup.add(marbleFloor);

    const epoxyMat = new THREE.MeshPhysicalMaterial({
        color: 0xffffff, roughness: 0.0, metalness: 0.1, transmission: 0.0,
        transparent: true, opacity: 0.2, clearcoat: 1.0, clearcoatRoughness: 0.0,
        side: THREE.DoubleSide, depthWrite: false 
    });
    const epoxyFloor = new THREE.Mesh(floorGeo, epoxyMat);
    epoxyFloor.rotation.x = -Math.PI / 2;
    epoxyFloor.position.y = 0.01; 
    this.showroomGroup.add(epoxyFloor);

    this.buildNeonStand();

    const wallRadius = 80;
    const wallHeight = 40;
    const wallGeo = new THREE.CylinderGeometry(wallRadius, wallRadius, wallHeight, 64, 1, true);
    
    const wallMat = new THREE.MeshPhysicalMaterial({
      color: 0x000000, 
      metalness: 1.0, 
      roughness: 0.0, 
      transparent: true, 
      opacity: 0.95,
      side: THREE.DoubleSide,
      clearcoat: 1.0
    });
    
    this.wallMesh = new THREE.Mesh(wallGeo, wallMat);
    this.wallMesh.position.y = wallHeight / 2;
    this.showroomGroup.add(this.wallMesh);

    this.showroomGroup.add(this.wallModelGroup);
    
    const neonCount = 12;
    const neonRadius = wallRadius - 2; 
    const neonHeight = wallHeight;
    const neonGeo = new THREE.CylinderGeometry(0.3, 0.3, neonHeight, 16);
    const neonMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    
    for (let i = 0; i < neonCount; i++) {
        const theta = (i / neonCount) * Math.PI * 2;
        const x = Math.cos(theta) * neonRadius;
        const z = Math.sin(theta) * neonRadius;
        
        const pillar = new THREE.Mesh(neonGeo, neonMat);
        pillar.position.set(x, neonHeight / 2, z);
        this.showroomGroup.add(pillar);
    }

    const ceilingGeo = new THREE.IcosahedronGeometry(80, 1);
    const wireframeGeo = new THREE.WireframeGeometry(ceilingGeo);
    const ceilingMat = new THREE.LineBasicMaterial({ 
        color: 0xaaccff, transparent: true, opacity: 0.1, blending: THREE.AdditiveBlending 
    });
    const ceilingMesh = new THREE.LineSegments(wireframeGeo, ceilingMat);
    ceilingMesh.scale.set(1, 0.05, 1);
    ceilingMesh.position.y = 15;
    this.showroomGroup.add(ceilingMesh);
  }

  private buildNeonStand() {
      const standGeo = new THREE.CylinderGeometry(4, 4.5, 0.2, 64);
      const standMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.8, metalness: 0.5 });
      this.standMesh = new THREE.Mesh(standGeo, standMat);
      this.standMesh.position.y = 0.1;
      this.standMesh.receiveShadow = true;
      this.showroomGroup.add(this.standMesh);

      const rimGeo = new THREE.TorusGeometry(4.5, 0.05, 16, 100);
      const rimMat = new THREE.MeshBasicMaterial({ color: this.store.config().lighting.accentColor });
      const rim = new THREE.Mesh(rimGeo, rimMat);
      rim.rotation.x = Math.PI / 2;
      rim.position.y = 0.05;
      this.showroomGroup.add(rim);

      const glow = new THREE.PointLight(this.store.config().lighting.accentColor, 20, 10);
      glow.position.set(0, 0.5, 0);
      this.showroomGroup.add(glow);
  }

  private updateLights(config: any) {
    this.lightsGroup.clear();
    
    // Increased Ambient for global illumination approximation
    const ambient = new THREE.AmbientLight(0xffffff, config.lighting.ambient * 2.0);
    this.lightsGroup.add(ambient);

    // High intensity Key Light
    this.dirLight = new THREE.DirectionalLight(0xffffff, config.lighting.intensity * 2.5);
    this.dirLight.position.set(-50, 100, -50);
    this.dirLight.castShadow = true;
    
    // High-res shadow map properties for soft shadows
    this.dirLight.shadow.mapSize.width = 4096;
    this.dirLight.shadow.mapSize.height = 4096;
    this.dirLight.shadow.camera.near = 0.1;
    this.dirLight.shadow.camera.far = 500;
    this.dirLight.shadow.camera.left = -50;
    this.dirLight.shadow.camera.right = 50;
    this.dirLight.shadow.camera.top = 50;
    this.dirLight.shadow.camera.bottom = -50;
    this.dirLight.shadow.bias = -0.0001;
    this.dirLight.shadow.radius = 4; // Softens the shadow edges (PCFSoft)
    
    this.lightsGroup.add(this.dirLight);

    // Rim Light / Spot Light
    const spot = new THREE.SpotLight(0xffffff, config.lighting.intensity * 120);
    spot.position.set(0, 30, 20);
    spot.angle = 0.6; 
    spot.penumbra = 0.5; 
    spot.decay = 2; 
    spot.distance = 100;
    spot.castShadow = true;
    spot.shadow.bias = -0.0001;
    this.lightsGroup.add(spot);
    
    // Fill Light
    const fillLight = new THREE.DirectionalLight(0xaaccff, 0.5);
    fillLight.position.set(50, 20, 50);
    this.lightsGroup.add(fillLight);
  }

  handleKeyDown(key: string) { this.keys[key.toLowerCase()] = true; }
  handleKeyUp(key: string) { this.keys[key.toLowerCase()] = false; }
  keys: { [key: string]: boolean } = {};

  private animate() {
    this.animationId = requestAnimationFrame(this.animate.bind(this));
    
    const delta = this.clock.getDelta();
    const section = this.store.activeSection();
    const isMenuOpen = this.store.isMenuOpen();
    const joystick = this.store.joystickState();
    const activeCarConfig = this.store.activeCar();
    const activeGroup = this.carMap.get(activeCarConfig.id);
    
    if (isMenuOpen) {
        const targetPos = new THREE.Vector3(0, 5, 20);
        const lookAt = new THREE.Vector3(0, 4, 0);
        this.camera.position.lerp(targetPos, delta * 3);
        this.camera.lookAt(lookAt);
        this.renderer.render(this.scene, this.camera);
        return; 
    }
    
    if (this.isEngineRunning && this.engineSound && this.engineSound.isPlaying) {
        const normalizedSpeed = Math.abs(this.speed) / 80;
        const targetRate = 0.8 + (normalizedSpeed * 0.8);
        this.engineSound.setPlaybackRate(targetRate);
    }

    if (section.id !== 'drive' && section.id !== 'walk') {
        const fleet = this.store.config().fleet;
        const activeIndex = this.store.activeCarIndex();
        const spacing = 12;

        fleet.forEach((car, index) => {
            const group = this.carMap.get(car.id);
            if (!group) return;

            group.visible = true;
            const offsetIndex = index - activeIndex;
            const targetX = offsetIndex * spacing;
            const targetY = (offsetIndex === 0) ? 0.25 : 0; 
            const targetRotY = (offsetIndex === 0) ? (this.clock.getElapsedTime() * 0.1) : 0; 
            
            group.position.x = THREE.MathUtils.lerp(group.position.x, targetX, delta * 4);
            group.position.z = THREE.MathUtils.lerp(group.position.z, 0, delta * 4);
            group.position.y = THREE.MathUtils.lerp(group.position.y, targetY, delta * 4);
            
            if (offsetIndex === 0) {
                 group.rotation.y = targetRotY;
            } else {
                 group.rotation.y = THREE.MathUtils.lerp(group.rotation.y, targetRotY, delta * 4);
            }
            
            group.rotation.x = 0;
            group.rotation.z = 0;
        });

        if (activeGroup) {
            const isTechMode = section.id === 'engineering';
            const targetExplode = isTechMode ? 1 : 0;
            this.explodeFactor = THREE.MathUtils.lerp(this.explodeFactor, targetExplode, delta * 3);

            if (this.explodeFactor > 0.01) {
                const val = this.explodeFactor;
                this.currentCarParams.bodyParts.forEach(obj => {
                    const orig = this.currentCarParams.originalPositions.get(obj);
                    if (orig) obj.position.copy(orig).add(new THREE.Vector3(0, 1.5 * val, 0));
                });
                this.currentCarParams.hoodParts.forEach(obj => {
                    const orig = this.currentCarParams.originalPositions.get(obj);
                    const origRot = this.currentCarParams.originalRotations.get(obj);
                    if (orig && origRot) {
                        obj.position.copy(orig).add(new THREE.Vector3(0, 1.2 * val, 0.5 * val));
                        obj.rotation.x = origRot.x - (0.5 * val); 
                    }
                });
                this.currentCarParams.wheels.forEach(obj => {
                    const orig = this.currentCarParams.originalPositions.get(obj);
                    if (orig) {
                        const sign = orig.x > 0 ? 1 : -1;
                        obj.position.copy(orig).add(new THREE.Vector3(sign * 0.8 * val, 0, 0));
                    }
                });
                this.currentCarParams.chassisParts.forEach(obj => {
                     const orig = this.currentCarParams.originalPositions.get(obj);
                     if (orig) obj.position.copy(orig); 
                });
            } else if (this.explodeFactor <= 0.01 && !isTechMode) {
                 this.currentCarParams.originalPositions.forEach((pos, obj) => {
                     obj.position.copy(pos);
                 });
                 this.currentCarParams.originalRotations.forEach((rot, obj) => {
                     obj.rotation.copy(rot);
                 });
            }
        }
        
        if (this.controls) this.controls.update();
    }

    if (section.id === 'drive' && activeGroup) {
        this.carMap.forEach((g) => {
            if (g !== activeGroup) g.visible = false;
        });
        activeGroup.visible = true;

        const isUp = this.keys['w'] || this.keys['arrowup'];
        const isDown = this.keys['s'] || this.keys['arrowdown'];
        const isLeft = this.keys['a'] || this.keys['arrowleft'];
        const isRight = this.keys['d'] || this.keys['arrowright'];
        const isBrake = this.keys[' '];

        let throttle = (isUp ? 1 : isDown ? -1 : 0) + joystick.y;
        throttle = Math.max(-1, Math.min(1, throttle));

        if (isBrake) {
            this.speed = THREE.MathUtils.lerp(this.speed, 0, delta * 2);
        } else {
            this.speed += throttle * 30 * delta;
            this.speed = Math.max(-20, Math.min(80, this.speed));
            this.speed *= 0.98; 
        }

        let steerInput = (isLeft ? 0.6 : isRight ? -0.6 : 0) + (joystick.x * -0.6);
        steerInput = Math.max(-0.6, Math.min(0.6, steerInput));
        this.steering = THREE.MathUtils.lerp(this.steering, steerInput, delta * 5);

        if (Math.abs(this.speed) > 0.1) {
            this.carAngle += this.speed * this.steering * 0.05 * delta;
        }

        let nextX = activeGroup.position.x + Math.sin(this.carAngle) * this.speed * delta;
        let nextZ = activeGroup.position.z + Math.cos(this.carAngle) * this.speed * delta;
        
        if (Math.abs(nextX) > this.mapBounds || Math.abs(nextZ) > this.mapBounds) this.speed *= -0.5;
        else {
             activeGroup.position.x = nextX;
             activeGroup.position.z = nextZ;
        }
        
        activeGroup.position.y = 0;
        activeGroup.rotation.y = this.carAngle;

        const idealOffset = new THREE.Vector3(0, 3.5, -9); 
        idealOffset.applyAxisAngle(new THREE.Vector3(0, 1, 0), this.carAngle);
        idealOffset.add(activeGroup.position);
        this.camera.position.lerp(idealOffset, delta * 3.0);
        
        const lookAtPos = new THREE.Vector3(0, 1.0, 5);
        lookAtPos.applyAxisAngle(new THREE.Vector3(0, 1, 0), this.carAngle);
        lookAtPos.add(activeGroup.position);
        this.camera.lookAt(lookAtPos);
        
        const rotSpeed = this.speed * delta * 2.0; 
        this.currentCarParams.wheels.forEach((w) => {
            w.rotation.x += rotSpeed;
            // Apply steering only to wheels identified as front
            if (w.userData['isFront']) {
                w.rotation.y = this.steering; 
            } else {
                w.rotation.y = 0;
            }
        });
    }

    if (section.id === 'walk') {
        if (activeGroup) activeGroup.visible = true;
        
        const isUp = this.keys['w'] || this.keys['arrowup'];
        const isDown = this.keys['s'] || this.keys['arrowdown'];
        const isLeft = this.keys['a'] || this.keys['arrowleft'];
        const isRight = this.keys['d'] || this.keys['arrowright'];

        let moveFwd = (isUp ? 1 : isDown ? -1 : 0) + joystick.y;
        let rotate = (isLeft ? 1 : isRight ? -1 : 0) + (-joystick.x);

        this.charRotation += rotate * 3 * delta;
        this.charGroup.rotation.y = this.charRotation;
        
        const moveSpeed = 5 * delta;
        const actualSpeed = Math.abs(moveFwd);
        
        if (actualSpeed > 0.1) {
            this.charGroup.position.x += Math.sin(this.charRotation) * moveFwd * moveSpeed;
            this.charGroup.position.z += Math.cos(this.charRotation) * moveFwd * moveSpeed;
        }
        
        this.animateCharacter(delta, actualSpeed);
        
        const idealOffset = new THREE.Vector3(0, 2.5, -4); 
        idealOffset.applyAxisAngle(new THREE.Vector3(0, 1, 0), this.charRotation);
        idealOffset.add(this.charGroup.position);
        
        this.camera.position.lerp(idealOffset, delta * 3.0);
        
        const lookAtPos = new THREE.Vector3(0, 1.4, 5); 
        lookAtPos.applyAxisAngle(new THREE.Vector3(0, 1, 0), this.charRotation);
        lookAtPos.add(this.charGroup.position);
        
        this.camera.lookAt(lookAtPos);
    }

    this.renderer.render(this.scene, this.camera);
  }
}
