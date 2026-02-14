export * from './contracts';
export * from './types';
export { migration0001Initial } from './migrations/0001_initial';
export { migration0002SyncStateEntityType } from './migrations/0002_sync_state_entity_type';
export { migration0003AuthSessions } from './migrations/0003_auth_sessions';

import { migration0001Initial } from './migrations/0001_initial';
import { migration0002SyncStateEntityType } from './migrations/0002_sync_state_entity_type';
import { migration0003AuthSessions } from './migrations/0003_auth_sessions';

export const schemaMigrations = [migration0001Initial, migration0002SyncStateEntityType, migration0003AuthSessions];
