
import { Component, ElementRef, AfterViewInit, ViewChild, inject, HostListener } from '@angular/core';
import { ThreeSceneService } from '../services/three-scene.service';

@Component({
  selector: 'app-canvas-viewer',
  standalone: true,
  template: `<canvas #canvasElement class="w-full h-full block outline-none"></canvas>`,
  styles: [':host { display: block; width: 100%; height: 100%; }']
})
export class CanvasViewerComponent implements AfterViewInit {
  @ViewChild('canvasElement') canvasRef!: ElementRef<HTMLCanvasElement>;
  threeService = inject(ThreeSceneService);

  ngAfterViewInit() {
    this.threeService.init(this.canvasRef.nativeElement);
  }

  @HostListener('window:keydown', ['$event'])
  onKeyDown(e: KeyboardEvent) {
    this.threeService.handleKeyDown(e.key);
  }

  @HostListener('window:keyup', ['$event'])
  onKeyUp(e: KeyboardEvent) {
    this.threeService.handleKeyUp(e.key);
  }
  
  @HostListener('mousedown', ['$event'])
  onMouseDown(e: MouseEvent) {
      this.threeService.handleClick(e);
  }
}
