import { Component, ElementRef, ViewChild, inject, output } from '@angular/core';
import { StoreService } from '../services/store.service';

@Component({
  selector: 'app-joystick',
  standalone: true,
  template: `
    <div class="joystick-zone"
      #zone
      (touchstart)="handleStart($event)"
      (touchmove)="handleMove($event)"
      (touchend)="handleEnd()"
      (mousedown)="handleStart($event)"
      (mousemove)="handleMove($event)"
      (mouseup)="handleEnd()"
      (mouseleave)="handleEnd()"
    >
      <div class="joystick-base">
        <div class="joystick-stick" [style.transform]="stickTransform"></div>
      </div>
    </div>
  `
})
export class JoystickComponent {
  store = inject(StoreService);
  
  @ViewChild('zone') zone!: ElementRef;
  
  stickTransform = 'translate(-50%, -50%)';
  active = false;
  touchId: number | null = null;
  
  handleStart(e: TouchEvent | MouseEvent) {
    if (this.touchId !== null) return;
    this.active = true;
    
    let clientX, clientY;
    if (e instanceof TouchEvent) {
      const touch = e.changedTouches[0];
      this.touchId = touch.identifier;
      clientX = touch.clientX;
      clientY = touch.clientY;
    } else {
      this.touchId = 1; // mouse
      clientX = e.clientX;
      clientY = e.clientY;
    }
    this.updatePosition(clientX, clientY);
  }
  
  handleMove(e: TouchEvent | MouseEvent) {
    if (!this.active) return;
    
    let clientX, clientY;
    if (e instanceof TouchEvent) {
      const touch = Array.from(e.changedTouches).find(t => t.identifier === this.touchId);
      if (!touch) return;
      clientX = touch.clientX;
      clientY = touch.clientY;
    } else {
      clientX = e.clientX;
      clientY = e.clientY;
    }
    this.updatePosition(clientX, clientY);
  }
  
  handleEnd() {
    this.active = false;
    this.touchId = null;
    this.stickTransform = 'translate(-50%, -50%)';
    this.store.joystickState.set({ x: 0, y: 0 });
  }
  
  updatePosition(clientX: number, clientY: number) {
    const rect = this.zone.nativeElement.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const maxDist = rect.width / 2;
    
    let deltaX = clientX - centerX;
    let deltaY = clientY - centerY;
    const dist = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
    
    if (dist > maxDist) {
      const angle = Math.atan2(deltaY, deltaX);
      deltaX = Math.cos(angle) * maxDist;
      deltaY = Math.sin(angle) * maxDist;
    }
    
    this.stickTransform = `translate(calc(-50% + ${deltaX}px), calc(-50% + ${deltaY}px))`;
    
    // Normalize -1 to 1 (Y inverted for 3D)
    this.store.joystickState.set({
      x: deltaX / maxDist,
      y: -(deltaY / maxDist)
    });
  }
}