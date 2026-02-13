
import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { AppConfig, CarConfig } from './data.types';

@Injectable({ providedIn: 'root' })
export class ApiService {
  private http = inject(HttpClient);
  private baseUrl = '/api'; 

  async getSettings(): Promise<Partial<AppConfig> | null> {
    try {
      return await firstValueFrom(this.http.get<Partial<AppConfig>>(`${this.baseUrl}/settings`));
    } catch { 
      return null; 
    }
  }

  async saveSettings(settings: any): Promise<void> {
    try {
      await firstValueFrom(this.http.post(`${this.baseUrl}/settings`, settings));
    } catch (e) { 
      console.warn('Server sync skipped (Settings)', e); 
    }
  }

  async getCars(): Promise<CarConfig[]> {
    try {
      return await firstValueFrom(this.http.get<CarConfig[]>(`${this.baseUrl}/cars`));
    } catch { 
      return []; 
    }
  }

  async saveCar(car: CarConfig): Promise<void> {
    try {
      await firstValueFrom(this.http.put(`${this.baseUrl}/cars/${car.id}`, car));
    } catch (e) { 
      console.warn('Server sync skipped (Car)', e); 
    }
  }

  async uploadAsset(file: File): Promise<{ id: string, url: string } | null> {
    try {
      const formData = new FormData();
      formData.append('file', file);
      return await firstValueFrom(this.http.post<{ id: string, url: string }>(`${this.baseUrl}/upload`, formData));
    } catch { 
      return null; 
    }
  }
}
