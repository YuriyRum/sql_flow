import { RecurrenceSchedule, RecurrenceType } from '../types';

export interface RecurrenceOption {
  type: RecurrenceType;
  label: string;
  shortLabel: string;
  description: string;
  defaultCron: string;
  timeOfDay?: string;
  daysOfWeek?: number[];
  dayOfMonth?: number;
}

export const RECURRENCE_OPTIONS: RecurrenceOption[] = [
  {
    type: 'ALWAYS',
    label: 'Always (Real-time / On Arrival)',
    shortLabel: 'Always',
    description: 'Executes continuously whenever input table data updates',
    defaultCron: '* * * * *',
  },
  {
    type: 'EVERY_5_MIN',
    label: 'Every 5 Minutes',
    shortLabel: 'Every 5m',
    description: 'Runs every 5 minutes continuously',
    defaultCron: '*/5 * * * *',
  },
  {
    type: 'EVERY_HOUR',
    label: 'Every Hour',
    shortLabel: 'Hourly',
    description: 'Runs at the top of every hour (e.g. 01:00, 02:00...)',
    defaultCron: '0 * * * *',
  },
  {
    type: 'AT_6AM',
    label: 'Daily at 6:00 AM',
    shortLabel: 'At 6:00 AM',
    description: 'Runs once every day at 06:00 AM',
    defaultCron: '0 6 * * *',
    timeOfDay: '06:00',
  },
  {
    type: 'EVERY_MONDAY',
    label: 'Every Monday',
    shortLabel: 'Every Monday',
    description: 'Runs every Monday at midnight (00:00 AM)',
    defaultCron: '0 0 * * 1',
    timeOfDay: '00:00',
    daysOfWeek: [1],
  },
  {
    type: 'AT_6AM_MONDAY',
    label: 'At 6:00 AM on Monday',
    shortLabel: 'Mon @ 6 AM',
    description: 'Runs every week specifically on Mondays at 06:00 AM',
    defaultCron: '0 6 * * 1',
    timeOfDay: '06:00',
    daysOfWeek: [1],
  },
  {
    type: 'ONCE_PER_MONTH',
    label: 'Once per Month',
    shortLabel: 'Monthly',
    description: 'Runs on the 1st day of every month at 06:00 AM',
    defaultCron: '0 6 1 * *',
    timeOfDay: '06:00',
    dayOfMonth: 1,
  },
  {
    type: 'CUSTOM',
    label: 'Custom Schedule (Cron)',
    shortLabel: 'Custom',
    description: 'Configure custom cron expression, time of day, or specific days',
    defaultCron: '0 6 * * 1-5',
  },
];

export const INITIAL_INDEPENDENT_SCHEDULES: RecurrenceSchedule[] = [
  {
    id: 'SCHED-REALTIME',
    name: 'Real-Time Event Stream',
    description: 'Executes immediately whenever upstream source table updates',
    type: 'ALWAYS',
    customCron: '* * * * *',
    timezone: 'UTC',
    maxRetries: 3,
    timeoutSeconds: 300,
    concurrencyPolicy: 'SKIP',
    isSystemDefault: true,
  },
  {
    id: 'SCHED-EVERY-5M',
    name: '5-Minute Rapid Refresh',
    description: 'Continuous 5-minute interval ETL batching',
    type: 'EVERY_5_MIN',
    customCron: '*/5 * * * *',
    timezone: 'UTC',
    maxRetries: 3,
    timeoutSeconds: 300,
    concurrencyPolicy: 'SKIP',
    isSystemDefault: true,
  },
  {
    id: 'SCHED-HOURLY',
    name: 'Hourly Operational Refresh',
    description: 'Runs at the top of every hour (00:00, 01:00, 02:00...)',
    type: 'EVERY_HOUR',
    customCron: '0 * * * *',
    timeOfDay: '00:00',
    timezone: 'UTC',
    maxRetries: 3,
    timeoutSeconds: 300,
    concurrencyPolicy: 'SKIP',
    isSystemDefault: true,
  },
  {
    id: 'SCHED-DAILY-6AM',
    name: 'Daily Morning Shift Run (06:00 AM)',
    description: 'Executes once every day at 6:00 AM UTC',
    type: 'AT_6AM',
    customCron: '0 6 * * *',
    timeOfDay: '06:00',
    timezone: 'UTC',
    maxRetries: 3,
    timeoutSeconds: 300,
    concurrencyPolicy: 'SKIP',
    isSystemDefault: true,
  },
  {
    id: 'SCHED-MON-6AM',
    name: 'Weekly Monday Executive Brief (06:00 AM)',
    description: 'Executes weekly on Mondays at 06:00 AM UTC',
    type: 'AT_6AM_MONDAY',
    customCron: '0 6 * * 1',
    timeOfDay: '06:00',
    daysOfWeek: [1],
    timezone: 'UTC',
    maxRetries: 3,
    timeoutSeconds: 300,
    concurrencyPolicy: 'SKIP',
    isSystemDefault: true,
  },
  {
    id: 'SCHED-MONTHLY-1ST',
    name: 'Monthly Accounting Close (1st at 06:00 AM)',
    description: 'Executes on the 1st day of every month at 06:00 AM UTC',
    type: 'ONCE_PER_MONTH',
    customCron: '0 6 1 * *',
    timeOfDay: '06:00',
    dayOfMonth: 1,
    timezone: 'UTC',
    maxRetries: 3,
    timeoutSeconds: 300,
    concurrencyPolicy: 'SKIP',
    isSystemDefault: true,
  },
];

export function getPresetConfig(type: RecurrenceType): RecurrenceSchedule {
  const option = RECURRENCE_OPTIONS.find((o) => o.type === type) || RECURRENCE_OPTIONS[3];
  const uniqueId = `SCHED-${Math.random().toString(36).substring(2, 7).toUpperCase()}`;

  return {
    id: uniqueId,
    name: option.label,
    type: option.type,
    customCron: option.defaultCron,
    timeOfDay: option.timeOfDay || '06:00',
    daysOfWeek: option.daysOfWeek || [1],
    dayOfMonth: option.dayOfMonth || 1,
    timezone: 'UTC',
    maxRetries: 3,
    timeoutSeconds: 300,
    concurrencyPolicy: 'SKIP',
  };
}

export function findScheduleById(
  scheduleId?: string,
  customSchedules: RecurrenceSchedule[] = []
): RecurrenceSchedule | undefined {
  if (!scheduleId) return undefined;
  const all = [...INITIAL_INDEPENDENT_SCHEDULES, ...customSchedules];
  return all.find((s) => s.id === scheduleId);
}

export function getScheduleLabel(schedule?: RecurrenceSchedule): string {
  if (!schedule) return 'Daily at 6:00 AM';
  if (schedule.name) return schedule.name;

  const opt = RECURRENCE_OPTIONS.find((o) => o.type === schedule.type);
  if (opt && schedule.type !== 'CUSTOM') {
    return opt.label;
  }

  if (schedule.type === 'CUSTOM') {
    return `Custom (${schedule.customCron || '0 6 * * *'})`;
  }

  return 'Daily at 6:00 AM';
}

export function getShortScheduleLabel(schedule?: RecurrenceSchedule): string {
  if (!schedule) return 'Daily 6 AM';
  if (schedule.name) {
    if (schedule.name.length > 18) return schedule.name.substring(0, 16) + '...';
    return schedule.name;
  }
  const opt = RECURRENCE_OPTIONS.find((o) => o.type === schedule.type);
  if (opt) return opt.shortLabel;
  if (schedule.type === 'CUSTOM') return 'Custom';
  return 'Daily 6 AM';
}

export function getNextExecutions(schedule?: RecurrenceSchedule, count = 5): string[] {
  const dates: string[] = [];
  const now = new Date();

  const type = schedule?.type || 'AT_6AM';
  const time = schedule?.timeOfDay || '06:00';
  const [targetHours, targetMinutes] = time.split(':').map((v) => parseInt(v, 10) || 0);

  let current = new Date(now);

  for (let i = 0; i < count; i++) {
    const next = new Date(current);

    if (type === 'ALWAYS') {
      next.setMinutes(next.getMinutes() + (i + 1));
      dates.push(`${next.toISOString().replace('T', ' ').substring(0, 19)} UTC (On Event Trigger)`);
      current = next;
      continue;
    }

    if (type === 'EVERY_5_MIN') {
      next.setMinutes(next.getMinutes() + 5 * (i + 1));
      dates.push(`${next.toISOString().replace('T', ' ').substring(0, 16)} UTC`);
      current = next;
      continue;
    }

    if (type === 'EVERY_HOUR') {
      next.setHours(next.getHours() + (i + 1), 0, 0, 0);
      dates.push(`${next.toISOString().replace('T', ' ').substring(0, 16)} UTC`);
      current = next;
      continue;
    }

    if (type === 'AT_6AM' || type === 'CUSTOM') {
      next.setDate(next.getDate() + (i + 1));
      next.setHours(targetHours, targetMinutes, 0, 0);
      dates.push(`${next.toISOString().replace('T', ' ').substring(0, 16)} UTC`);
      current = next;
      continue;
    }

    if (type === 'EVERY_MONDAY' || type === 'AT_6AM_MONDAY') {
      const day = next.getDay();
      const distanceToMonday = (1 + 7 - day) % 7 || 7;
      next.setDate(next.getDate() + distanceToMonday + i * 7);
      next.setHours(targetHours, targetMinutes, 0, 0);
      dates.push(`${next.toISOString().replace('T', ' ').substring(0, 16)} UTC`);
      current = next;
      continue;
    }

    if (type === 'ONCE_PER_MONTH') {
      next.setMonth(next.getMonth() + (i + 1), schedule?.dayOfMonth || 1);
      next.setHours(targetHours, targetMinutes, 0, 0);
      dates.push(`${next.toISOString().replace('T', ' ').substring(0, 16)} UTC`);
      current = next;
      continue;
    }

    next.setDate(next.getDate() + (i + 1));
    dates.push(`${next.toISOString().replace('T', ' ').substring(0, 16)} UTC`);
    current = next;
  }

  return dates;
}
