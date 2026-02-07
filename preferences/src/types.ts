/**
 * Preference domain contracts.
 */

export interface HexagonPreferencesValues {
  hexagonTheme: string;
  hexagonVariant: string;
  hexagonSize: number;
  hexagonCustomDepth: number | null;
  hexagonUseCustomDepth: boolean;
}

export interface HexagonPreferences extends HexagonPreferencesValues {
  userId: string;
  updatedAt: string;
  operationId: string | null;
}

export interface HexagonPreferencesPatch {
  hexagonTheme?: string;
  hexagonVariant?: string;
  hexagonSize?: number;
  hexagonCustomDepth?: number | null;
  hexagonUseCustomDepth?: boolean;
}

export interface PreferenceOutboxMutation {
  outboxId: string;
  userId: string;
  operationId: string;
  createdAt: string;
  updatedAt: string;
  attempts: number;
  preferences: HexagonPreferencesValues;
}

export interface PreferenceSyncState {
  userId: string;
  lastPulledAt: string | null;
  lastPushedAt: string | null;
  remoteCursor: string | null;
  lastSyncedOperationId: string | null;
  updatedAt: string;
}

export interface PreferenceSyncOperation {
  userId: string;
  operationId: string;
  updatedAt: string;
  preferences: HexagonPreferencesValues;
}

export interface PreferenceSyncPushResponse {
  appliedOperationIds: string[];
  latestOperationId: string | null;
  serverTimestamp: string;
}

export interface PreferenceSyncPullResponse {
  preference: HexagonPreferences | null;
  cursor: string | null;
}
