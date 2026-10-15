import type { Server } from 'node:http';

export const DEFAULT_PORT: number;
export const DEFAULT_ORIGINS: string[];
export function isLocalNetworkHost(host: string): boolean;
export function sendToPrinter(host: string, port: number, job: Uint8Array): Promise<void>;
export function createBridge(options?: { allowedOrigins?: string[] }): Server;
