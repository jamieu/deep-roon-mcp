// What a tool can say back when Roon can't do something: a message the model can act on, and what kind of trouble it is.
import type { CoreInfo } from './discover';

export class RoonError extends Error {
  constructor(message: string, readonly kind: 'not_found' | 'invalid' | 'unavailable' | 'roon' = 'roon') { super(message); }
}

export interface Target { host: string; port: number; info: CoreInfo }
