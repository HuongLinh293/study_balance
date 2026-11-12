/**
 * Event contracts shared by producers and consumers. Payloads are full
 * snapshots of the aggregate, so a consumer can drop any event whose
 * aggregateVersion is not newer than what it already stored.
 */
export interface EventEnvelope<TPayload = unknown, TType extends string = string> {
  eventId: string;
  eventType: TType;
  schemaVersion: number;
  occurredAt: string;
  producer: string;
  aggregateId: string;
  aggregateVersion: number;
  userId: string;
  correlationId: string;
  payload: TPayload;
}

/** Durable topic exchange; routing key = eventType. */
export const EVENTS_EXCHANGE = 'studybalance.events';
export const DEAD_LETTER_EXCHANGE = 'studybalance.dlx';

export interface PreferencesSnapshot {
  sessionMinutes: number;
  restMinutes: number;
  dailyLimitMinutes: number;
  reminders: boolean;
  timezone: string;
}
/** Weekly study windows plus one-off busy periods (days off are full-day busy periods). */
export interface AvailabilityWindow {
  /** 0 = Monday … 6 = Sunday */
  weekday: number;
  startMinute: number;
  endMinute: number;
}
export interface BusyPeriod {
  id: string;
  /** YYYY-MM-DD, in the user's timezone. */
  date: string;
  startMinute: number;
  endMinute: number;
  label: string;
}
export interface AvailabilitySnapshot {
  windows: AvailabilityWindow[];
  /** Busy periods from yesterday onwards; older ones no longer affect planning. */
  busy: BusyPeriod[];
}
export interface TaskSnapshot {
  subjectId: string | null;
  title: string;
  /** YYYY-MM-DD, in the user's timezone. */
  dueDate: string;
  remainingMinutes: number;
  priority: 'high' | 'normal';
  done: boolean;
}
export interface StudySessionSnapshot {
  taskId: string;
  /** YYYY-MM-DD, in the user's timezone. */
  date: string;
  startMinute: number;
  minutes: number;
  status: 'planned' | 'done';
  actualMinutes: number | null;
  deleted: boolean;
}
export interface StudySessionCompletedPayload {
  taskId: string;
  date: string;
  actualMinutes: number;
  /** Minutes the session was planned for (absent in events produced before it was added). */
  plannedMinutes?: number;
}

export interface EventPayloads {
  /** user-service */
  PreferencesUpdated: PreferencesSnapshot;
  AvailabilityUpdated: AvailabilitySnapshot;
  /** task-service */
  TaskCreated: TaskSnapshot;
  TaskUpdated: TaskSnapshot;
  TaskProgressUpdated: TaskSnapshot & { loggedMinutes: number; sessionId: string | null };
  TaskDeleted: { deleted: true };
  /** planning-service */
  StudySessionUpdated: StudySessionSnapshot;
  StudySessionCompleted: StudySessionCompletedPayload;
  PlanUpdated: { sessionIds: string[]; reason: 'simulation_applied' | 'plan_generated' };
}
export type EventType = keyof EventPayloads;
export type DomainEvent<T extends EventType = EventType> = EventEnvelope<EventPayloads[T], T>;
export const SCHEMA_VERSION = 1;
