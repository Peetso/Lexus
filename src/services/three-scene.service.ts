
import { Injectable, effect, inject } from '@angular/core';
import * as THREE from 'three';
import { StoreService } from './store.service';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Reflector } from 'three/examples/jsm/objects/Reflector.js';
import { EnvironmentItem } from './data.types';

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
  
  // Loaders
  private gltfLoader = new GLTFLoader();
  private fbxLoader = new FBXLoader();
  
  // Scene Groups
  private fleetGroup = new THREE.Group(); 
  private showroomGroup = new THREE.Group(); 
  private wallModelGroup = new THREE.Group(); 
  private wallMesh!: THREE.Mesh; 

  private lightsGroup = new THREE.Group();
  private hotspotGroup = new THREE.Group();
  private charGroup = new THREE.Group(); 
  
  private clock = new THREE.Clock();
  
  // Initialization Flag
  private isInitialized = false;

  // Environment State
  private currentEnvId: string | null = null;

  // Fleet Management
  private carMap = new Map<string, THREE.Group>(); 
  private materialsMap = new Map<string, CarMaterials>();

  private currentCarParams = {
      wheels: [] as THREE.Object3D[],
      originalPositions: new Map<THREE.Object3D, THREE.Vector3>()
  };

  private floorMaterial!: THREE.MeshBasicMaterial;

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
  
  private basePaint = new THREE.MeshPhysicalMaterial({ 
    color: 0xffffff, metalness: 0.6, roughness: 0.1, clearcoat: 1.0, clearcoatRoughness: 0.05
  });
  private baseGlass = new THREE.MeshPhysicalMaterial({
    color: 0x000000, metalness: 0.9, roughness: 0.0, transmission: 0.1, transparent: true, opacity: 0.8
  });
  private baseRubber = new THREE.MeshStandardMaterial({ 
      color: 0x111111, roughness: 0.9, metalness: 0.1 
  });
  private baseChrome = new THREE.MeshStandardMaterial({ 
      color: 0xffffff, metalness: 0.95, roughness: 0.05 
  });

  private animationId: number = 0;
  private explodeFactor = 0;

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
    
    // Watch Active Environment (Model Load & Transform)
    effect(() => {
        const activeEnv = this.store.activeEnvironment();
        const tint = this.store.config().wallTint;
        if (this.isInitialized) {
            this.updateEnvironment(activeEnv, tint);
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

    effect(() => {
        const section = this.store.activeSection();
        if (!this.isInitialized) return;
        
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
    });
    
    effect(() => {
       const car = this.store.activeCar(); 
       if (this.isInitialized) this.renderHotspots(); 
    });
  }

  init(canvas: HTMLCanvasElement) {
    this.scene = new THREE.Scene();
    
    const textureLoader = new THREE.TextureLoader();
    const cityTexture = textureLoader.load('https://picsum.photos/seed/cyberpunk/3000/1500'); 
    cityTexture.mapping = THREE.EquirectangularReflectionMapping;
    this.scene.background = cityTexture;
    this.scene.environment = cityTexture;
    this.scene.backgroundBlurriness = 0.2; 

    this.camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 1000);
    this.camera.position.set(6, 2, 7); 

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.minDistance = 1;
    this.controls.maxDistance = 25;
    this.controls.maxPolarAngle = Math.PI / 2 - 0.02;
    this.controls.target.set(0, 0.5, 0);

    this.buildFuturisticShowroom();
    this.scene.add(this.showroomGroup);
    this.scene.add(this.lightsGroup);
    this.scene.add(this.fleetGroup);

    this.underglowLight.position.set(0, 0.1, 0);
    this.scene.add(this.hotspotGroup);

    this.scene.add(this.charGroup);
    this.charGroup.visible = false; 

    // Initialize state from config immediately to catch up
    this.isInitialized = true;
    
    const config = this.store.config();
    this.updateLights(config);
    this.syncFleet(config.fleet);
    
    // Initial Environment Load
    this.updateEnvironment(this.store.activeEnvironment(), config.wallTint);
    
    this.updateFloorTexture(config.floorTextureUrl);

    this.animate();
    
    window.addEventListener('resize', this.onResize.bind(this));
  }

  private onResize() {
    if (!this.camera || !this.renderer) return;
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }
  
  private updateRenderQuality(quality: 'high' | 'low') {
      if (!this.renderer) return;
      if (quality === 'high') {
          this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2.0)); 
          this.renderer.shadowMap.enabled = true;
          this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      } else {
          this.renderer.setPixelRatio(1.0); 
          this.renderer.shadowMap.enabled = false;
      }
  }

  // --- Environment Logic ---
  
  private updateEnvironment(env: EnvironmentItem | undefined, tint: number) {
      // 1. Update Tint (Always apply)
      this.applyWallTint(tint);

      // 2. Check if we need to load a new model
      if (env?.id !== this.currentEnvId) {
          this.currentEnvId = env?.id || null;
          this.wallModelGroup.clear();

          if (env && env.url) {
              this.gltfLoader.load(env.url, (gltf) => {
                  const model = gltf.scene;
                  // Store reference for transforms
                  this.wallModelGroup.add(model);
                  this.applyEnvironmentTransform(env, model);
              });
          }
      } else if (env && this.wallModelGroup.children.length > 0) {
          // 3. Just update transform if model exists
          this.applyEnvironmentTransform(env, this.wallModelGroup.children[0]);
      }
  }
  
  private applyEnvironmentTransform(env: EnvironmentItem, model: THREE.Object3D) {
      model.scale.set(env.scale, env.scale, env.scale);
      model.position.set(env.position[0], env.position[1], env.position[2]);
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
          this.setupActiveCarPhysics(activeGroup);
          if (this.underglowLight.parent !== activeGroup) {
             activeGroup.add(this.underglowLight);
          }
          this.underglowLight.color.set(activeCar.underglowColor || activeCar.color);
      }
  }

  private createCarGroup(carConfig: any) {
      const group = new THREE.Group();
      group.name = carConfig.id;
      group.userData['modelUrl'] = carConfig.modelUrl; 
      
      this.carMap.set(carConfig.id, group);
      this.fleetGroup.add(group);

      if (carConfig.modelUrl) {
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
                  this.setupActiveCarPhysics(group);
              }
          });
      } else {
          this.buildProceduralCar(group, carConfig);
          if (this.store.activeCar().id === carConfig.id) {
              this.setupActiveCarPhysics(group);
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

  private setupActiveCarPhysics(group: THREE.Group) {
      this.currentCarParams.wheels = [];
      this.currentCarParams.originalPositions.clear();
      group.traverse((obj) => {
          if (obj instanceof THREE.Mesh || obj instanceof THREE.Group) {
              if (obj.userData['origPos']) {
                  this.currentCarParams.originalPositions.set(obj, obj.userData['origPos']);
              }
              const lower = obj.name.toLowerCase();
              if (lower.includes('wheel') || lower.includes('rim') || lower.includes('tire')) {
                  if (obj.parent === group) {
                       this.currentCarParams.wheels.push(obj);
                  }
              }
          }
      });
      this.currentCarParams.wheels.sort((a, b) => b.position.z - a.position.z);
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
      if (this.camera && this.controls) {
          const offset = new THREE.Vector3(0, 3, 4);
          this.camera.position.copy(this.charGroup.position).add(offset);
          this.controls.target.copy(this.charGroup.position);
          this.controls.maxDistance = 10;
          this.controls.minDistance = 2;
          this.controls.enablePan = true; 
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
          // @ts-ignore
          const animations = object.animations || [];
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
      };

      if (type === 'glb') {
          this.gltfLoader.load(url, (gltf) => {
             // @ts-ignore 
             gltf.scene.animations = gltf.animations; 
             onLoad(gltf.scene);
          });
      } else if (type === 'fbx') {
          this.fbxLoader.load(url, (fbx) => onLoad(fbx));
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
          const idleAction = Object.values(this.charActions).find(a => a.getClip().name.toLowerCase().includes('idle'));
          const runAction = Object.values(this.charActions).find(a => a.getClip().name.toLowerCase().includes('run') || a.getClip().name.toLowerCase().includes('walk'));
          if (idleAction && runAction) {
              if (moveSpeed > 0.1) {
                  if (!runAction.isRunning()) { idleAction.fadeOut(0.2); runAction.reset().fadeIn(0.2).play(); }
              } else {
                  if (!idleAction.isRunning()) { runAction.fadeOut(0.2); idleAction.reset().fadeIn(0.2).play(); }
              }
          }
          return;
      }
      const time = this.clock.getElapsedTime();
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

  // --- Environment ---

  private updateFloorTexture(url: string) {
    if (!this.floorMaterial) return;
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
    });
  }
  
  private applyWallTint(tint: number) {
     if (!this.wallMesh) return;
     
     // The wall is now a Black Mirror with adjustable opacity
     const mat = this.wallMesh.material as THREE.MeshPhysicalMaterial;
     mat.opacity = tint;
     
     // Hardcoded Black Mirror Look
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
    const reflector = new Reflector(floorGeo, {
      clipBias: 0.003, textureWidth: window.innerWidth, textureHeight: window.innerHeight,
      color: 0x444444, multisample: 2
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

    // WALLS - Cylinder (Black Mirror)
    const wallRadius = 80;
    const wallHeight = 40;
    const wallGeo = new THREE.CylinderGeometry(wallRadius, wallRadius, wallHeight, 64, 1, true);
    
    // Initial Material (Will be updated by applyWallTint)
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

    // 3D MODEL CONTAINER (OUTSIDE)
    // We add it to showroomGroup, but because we scale it HUGE, it acts as background
    this.showroomGroup.add(this.wallModelGroup);
    
    // Initial Sync handled in init()

    // VERTICAL NEONS (White)
    const neonCount = 12;
    const neonRadius = wallRadius - 2; 
    const neonHeight = wallHeight;
    const neonGeo = new THREE.CylinderGeometry(0.3, 0.3, neonHeight, 16);
    const neonMat = new THREE.MeshBasicMaterial({ color: 0xffffff }); // WHITE NEON
    
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
      const stand = new THREE.Mesh(standGeo, standMat);
      stand.position.y = 0.1;
      stand.receiveShadow = true;
      this.showroomGroup.add(stand);

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
    const ambient = new THREE.AmbientLight(0xffffff, config.lighting.ambient);
    this.lightsGroup.add(ambient);

    const dirLight = new THREE.DirectionalLight(0xffffff, config.lighting.intensity);
    dirLight.position.set(-50, 100, -50);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.width = 2048;
    dirLight.shadow.mapSize.height = 2048;
    this.lightsGroup.add(dirLight);

    const spot = new THREE.SpotLight(0xffffff, config.lighting.intensity * 80);
    spot.position.set(0, 20, 10);
    spot.angle = 0.5; spot.penumbra = 0.5; spot.decay = 2; spot.distance = 60;
    spot.castShadow = true;
    this.lightsGroup.add(spot);
  }

  handleKeyDown(key: string) { this.keys[key.toLowerCase()] = true; }
  handleKeyUp(key: string) { this.keys[key.toLowerCase()] = false; }
  keys: { [key: string]: boolean } = {};

  private animate() {
    this.animationId = requestAnimationFrame(this.animate.bind(this));
    
    const delta = this.clock.getDelta();
    const section = this.store.activeSection();
    const joystick = this.store.joystickState();
    const activeCarConfig = this.store.activeCar();
    const activeGroup = this.carMap.get(activeCarConfig.id);

    // --- LINEUP LOGIC ---
    if (section.id !== 'drive' && section.id !== 'walk') {
        const fleet = this.store.config().fleet;
        const activeIndex = this.store.activeCarIndex();
        const spacing = 12; // Gap between cars

        fleet.forEach((car, index) => {
            const group = this.carMap.get(car.id);
            if (!group) return;

            group.visible = true;
            
            // Calculate target positions
            const offsetIndex = index - activeIndex;
            const targetX = offsetIndex * spacing;
            const targetY = (offsetIndex === 0) ? 0.25 : 0; // Active car on stand
            
            // Continuous Loop for active car
            const targetRotY = (offsetIndex === 0) ? (this.clock.getElapsedTime() * 0.1) : 0; 
            
            // Lerp
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

        // Explode Tech Mode
        if (activeGroup) {
            const targetExplode = section.id === 'engineering' ? 1 : 0;
            this.explodeFactor = THREE.MathUtils.lerp(this.explodeFactor, targetExplode, delta * 2);
            if (this.explodeFactor > 0.01) {
                this.currentCarParams.originalPositions.forEach((origPos, obj) => {
                     const dir = origPos.clone().normalize();
                     const offset = dir.multiplyScalar(this.explodeFactor * 1.5); 
                     obj.position.copy(origPos).add(offset);
                });
            } else if (this.explodeFactor < 0.01 && targetExplode === 0) {
                 // Snap back
                 this.currentCarParams.originalPositions.forEach((origPos, obj) => {
                     obj.position.copy(origPos);
                 });
            }
        }
        
        if (this.controls) this.controls.update();
    }

    // --- DRIVE MODE ---
    if (section.id === 'drive' && activeGroup) {
        // Hide others
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
        this.currentCarParams.wheels.forEach((w, i) => {
            w.rotateX(rotSpeed);
            if (i < 2) w.rotation.y = this.steering; 
        });
    }

    // --- WALK MODE ---
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
        
        if (this.controls) {
            const targetVec = this.charGroup.position.clone().add(new THREE.Vector3(0, 1.2, 0));
            this.controls.target.lerp(targetVec, delta * 10);
            this.controls.update();
        }
    }

    this.renderer.render(this.scene, this.camera);
  }
}
