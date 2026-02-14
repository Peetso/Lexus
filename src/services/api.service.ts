
import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { AppConfig, CarConfig } from './data.types';

@Injectable({ providedIn: 'root' })
export class ApiService {
  private http = inject(HttpClient);
  
  // Use relative path. The Angular CLI proxy (proxy.conf.json) will forward this 
  // to http://localhost:3001 automatically.
  private baseUrl = '/api'; 

  async getSettings(): Promise<Partial<AppConfig> | null> {
    try {
      const data = await firstValueFrom(this.http.get<Partial<AppConfig>>(`${this.baseUrl}/settings`));
      return data;
    } catch (e) {
      console.warn(`API: Failed to fetch settings. Ensure server is running and proxy is configured.`, e);
      return null; 
    }
  }

  async saveSettings(settings: any): Promise<void> {
    try {
      await firstValueFrom(this.http.post(`${this.baseUrl}/settings`, settings));
    } catch (e) { 
      console.warn('API: Failed to save settings.', e); 
    }
  }

  async getCars(): Promise<CarConfig[]> {
    try {
      const data = await firstValueFrom(this.http.get<CarConfig[]>(`${this.baseUrl}/cars`));
      return data;
    } catch { 
      return []; 
    }
  }

  async saveCar(car: CarConfig): Promise<void> {
    try {
      await firstValueFrom(this.http.put(`${this.baseUrl}/cars/${car.id}`, car));
    } catch (e) { 
      console.warn('API: Failed to save car.', e); 
    }
  }

  async uploadAsset(file: File): Promise<{ id: string, url: string } | null> {
    try {
      const formData = new FormData();
      formData.append('file', file);
      const result = await firstValueFrom(this.http.post<{ id: string, url: string }>(`${this.baseUrl}/upload`, formData));
      return result;
    } catch (e) { 
      console.warn('API: Upload failed.', e);
      return null; 
    }
  }
}
