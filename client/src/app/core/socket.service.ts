import { Injectable, signal } from '@angular/core';
import { io, Socket } from 'socket.io-client';

/** The server answers every request with { ok: true, ...data } or { ok: false, error }. */
export interface Ack {
  ok: boolean;
  error?: string;
  [key: string]: unknown;
}

/** One shared Socket.IO connection to the Node server. */
@Injectable({ providedIn: 'root' })
export class SocketService {
  readonly socket: Socket = io();
  readonly connected = signal(false);

  constructor() {
    this.socket.on('connect', () => this.connected.set(true));
    this.socket.on('disconnect', () => this.connected.set(false));
  }

  /** Sends an event and resolves with the server's reply. Resolves with an error reply rather than rejecting. */
  request<T extends Ack = Ack>(event: string, payload: unknown = {}): Promise<T> {
    return new Promise((resolve) => {
      this.socket.emit(event, payload, (res?: T) => {
        resolve(res ?? ({ ok: false, error: 'No response from the server' } as T));
      });
    });
  }

  /** Fire and forget (the server's reply is ignored). */
  emit(event: string, payload: unknown = {}): void {
    this.socket.emit(event, payload, () => {});
  }

  on<T = unknown>(event: string, handler: (payload: T) => void): void {
    this.socket.on(event, handler as (...args: unknown[]) => void);
  }
}
