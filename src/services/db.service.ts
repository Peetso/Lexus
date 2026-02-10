
import { Injectable } from '@angular/core';
import { CarConfig } from './data.types';

@Injectable({ providedIn: 'root' })
export class DbService {
  private dbName = 'LexusAppDB';
  private assetStore = 'assets';
  private carStore = 'cars';
  private dbPromise: Promise<IDBDatabase> | null = null;

  private getDB(): Promise<IDBDatabase> {
    if (!this.dbPromise) {
      this.dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(this.dbName, 2); // Incremented version for schema change
        
        req.onupgradeneeded = (e: any) => {
          const db = e.target.result;
          if (!db.objectStoreNames.contains(this.assetStore)) {
            db.createObjectStore(this.assetStore);
          }
          if (!db.objectStoreNames.contains(this.carStore)) {
            db.createObjectStore(this.carStore, { keyPath: 'id' });
          }
        };
        req.onsuccess = (e: any) => resolve(e.target.result);
        req.onerror = (e: any) => reject(e.target.error);
      });
    }
    return this.dbPromise;
  }

  // --- Assets (Blobs) ---
  async saveAsset(id: string, blob: Blob): Promise<void> {
    try {
      const db = await this.getDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(this.assetStore, 'readwrite');
        tx.objectStore(this.assetStore).put(blob, id);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } catch (err) {
      console.error('IndexedDB Asset Save Failed', err);
      throw err;
    }
  }

  async getAsset(id: string): Promise<Blob | undefined> {
    try {
      const db = await this.getDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(this.assetStore, 'readonly');
        const req = tx.objectStore(this.assetStore).get(id);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    } catch (err) {
      console.warn('IndexedDB Asset Get Failed', err);
      return undefined;
    }
  }

  // --- Car Data (JSON) ---
  async saveCar(car: CarConfig): Promise<void> {
    try {
      const db = await this.getDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(this.carStore, 'readwrite');
        tx.objectStore(this.carStore).put(car);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } catch (err) {
      console.error('IndexedDB Car Save Failed', err);
      throw err;
    }
  }

  async getAllCars(): Promise<CarConfig[]> {
     try {
      const db = await this.getDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(this.carStore, 'readonly');
        const req = tx.objectStore(this.carStore).getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
      });
    } catch (err) {
      console.warn('IndexedDB Get Cars Failed', err);
      return [];
    }
  }
}
