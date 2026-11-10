import type { Logger } from './log.js';
import { circuitRejections, circuitState } from './metrics.js';

export type CircuitStatus = 'closed' | 'open' | 'half_open';
const STATE_VALUE: Record<CircuitStatus, number> = { closed: 0, half_open: 1, open: 2 };

export class CircuitOpenError extends Error {
  constructor(readonly circuit: string) {
    super(`Circuit ${circuit} is open`);
  }
}

export interface CircuitBreakerOptions {
  /** Consecutive failures that open the circuit. */
  failureThreshold?: number;
  /** How long the circuit stays open before one trial call is let through. */
  resetTimeoutMs?: number;
  /** Errors that say nothing about the dependency's health (e.g. 4xx) do not count. */
  isFailure?: (error: unknown) => boolean;
  now?: () => number;
  log?: Logger;
}

/**
 * Closed → (N consecutive failures) → open: calls fail fast without touching the
 * dependency → (after resetTimeoutMs) → half-open: a single trial call; success
 * closes the circuit, failure opens it again.
 */
export class CircuitBreaker {
  private status: CircuitStatus = 'closed';
  private failures = 0;
  private openedAt = 0;
  private trialInFlight = false;
  private readonly failureThreshold: number;
  private readonly resetTimeoutMs: number;
  private readonly isFailure: (error: unknown) => boolean;
  private readonly now: () => number;

  constructor(
    readonly name: string,
    private readonly options: CircuitBreakerOptions = {},
  ) {
    this.failureThreshold = options.failureThreshold ?? 5;
    this.resetTimeoutMs = options.resetTimeoutMs ?? 30_000;
    this.isFailure = options.isFailure ?? (() => true);
    this.now = options.now ?? Date.now;
    circuitState.set({ circuit: name }, 0);
  }

  get state(): CircuitStatus {
    return this.status;
  }

  async exec<T>(call: () => Promise<T>): Promise<T> {
    if (this.status === 'open') {
      if (this.now() - this.openedAt < this.resetTimeoutMs) return this.reject();
      this.transition('half_open');
    }
    const trial = this.status === 'half_open';
    if (trial) {
      if (this.trialInFlight) return this.reject();
      this.trialInFlight = true;
    }
    try {
      const result = await call();
      this.failures = 0;
      if (this.status !== 'closed') this.transition('closed');
      return result;
    } catch (error) {
      if (this.isFailure(error)) {
        this.failures++;
        if (trial || this.failures >= this.failureThreshold) {
          this.openedAt = this.now();
          this.transition('open');
        }
      } else if (trial) {
        // The dependency answered; it is healthy even if the request was rejected.
        this.failures = 0;
        this.transition('closed');
      }
      throw error;
    } finally {
      if (trial) this.trialInFlight = false;
    }
  }

  private reject(): never {
    circuitRejections.inc({ circuit: this.name });
    throw new CircuitOpenError(this.name);
  }

  private transition(next: CircuitStatus) {
    if (next === this.status) return;
    this.options.log?.[next === 'open' ? 'warn' : 'info']('circuit_state_changed', {
      circuit: this.name,
      from: this.status,
      to: next,
      failures: this.failures,
    });
    this.status = next;
    circuitState.set({ circuit: this.name }, STATE_VALUE[next]);
  }
}
