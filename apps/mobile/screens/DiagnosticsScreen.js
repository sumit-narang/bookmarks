/**
 * DiagnosticsScreen - Dev/e2e persistence observability and deterministic actions.
 */

import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../context/AuthContext';
import {
  createDiagnosticsCollectionForLatestPlace,
  createDiagnosticsPlace,
  createDiagnosticsRemotePlaceMutation,
  getDiagnosticsSnapshot,
  removeLatestPlaceFromAllCollections,
  runDiagnosticsSync,
  setDiagnosticsHexagonTheme,
  wipeDiagnosticsLocalData,
} from '../data/diagnostics';
import {
  e2ePrimaryUserId,
  e2eSecondaryUserId,
  e2eTertiaryUserId,
  e2eQuaternaryUserId,
  e2eQuinaryUserId,
  e2eSenaryUserId,
  e2eSeptenaryUserId,
  e2eOctonaryUserId,
} from '../config/e2e';
import { colors } from '../styles/colors';

const DiagnosticsScreen = ({ navigation, route }) => {
  const { signInWithTestUser, signOut } = useAuth();
  const [snapshot, setSnapshot] = useState(null);
  const [isLoadingSnapshot, setIsLoadingSnapshot] = useState(true);
  const [isRunningAction, setIsRunningAction] = useState(false);
  const lastHandledRouteActionRef = useRef(null);

  const loadSnapshot = async () => {
    setIsLoadingSnapshot(true);

    let lastError = null;

    try {
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        try {
          const nextSnapshot = await getDiagnosticsSnapshot();
          setSnapshot(nextSnapshot);
          return;
        } catch (error) {
          lastError = error;

          if (attempt < 3) {
            await new Promise((resolve) => {
              setTimeout(resolve, 300 * attempt);
            });
          }
        }
      }

      console.error('Error loading diagnostics snapshot:', lastError);
      Alert.alert('Diagnostics Error', 'Unable to load diagnostics snapshot.');
    } finally {
      setIsLoadingSnapshot(false);
    }
  };

  useEffect(() => {
    loadSnapshot();

    const unsubscribe = navigation.addListener('focus', () => {
      loadSnapshot();
    });

    return unsubscribe;
  }, [navigation]);

  const runAction = async (action) => {
    setIsRunningAction(true);

    try {
      await action();
      await loadSnapshot();
    } catch (error) {
      console.error('Diagnostics action failed:', error);
      Alert.alert('Diagnostics Action Failed', 'Check Metro logs for details.');
    } finally {
      setIsRunningAction(false);
    }
  };

  const runRouteAction = async (action) => {
    switch (action) {
      case 'set-theme-stone':
        await runAction(() => setDiagnosticsHexagonTheme('stone'));
        break;
      case 'set-theme-basalt':
        await runAction(() => setDiagnosticsHexagonTheme('basalt'));
        break;
      case 'run-sync':
        await runAction(runDiagnosticsSync);
        break;
      case 'refresh':
        await runAction(loadSnapshot);
        break;
      default:
        break;
    }
  };

  useEffect(() => {
    const action = route?.params?.action;

    if (!action || typeof action !== 'string') {
      return;
    }

    const nonce = route?.params?.nonce;
    const routeActionKey = `${action}:${typeof nonce === 'string' ? nonce : ''}`;

    if (lastHandledRouteActionRef.current === routeActionKey) {
      return;
    }

    lastHandledRouteActionRef.current = routeActionKey;
    void runRouteAction(action);
  }, [route?.params?.action, route?.params?.nonce]);

  const signInForDiagnostics = async (userId) => {
    await signInWithTestUser(userId);
  };

  const handleBack = () => {
    navigation.goBack();
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={handleBack}>
          <Ionicons name="chevron-back" size={24} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Diagnostics</Text>
        <View style={styles.headerPlaceholder} />
      </View>

      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
        {(isLoadingSnapshot || isRunningAction) && (
          <View style={styles.loadingRow}>
            <ActivityIndicator color={colors.primary} />
            <Text style={styles.loadingText}>Refreshing snapshot...</Text>
          </View>
        )}

        {snapshot && (
          <>
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Session</Text>
              <Text style={styles.valueText} testID="e2e-diagnostics-active-user-id">
                activeUserId: {snapshot.activeUserId}
              </Text>
              <Text style={styles.valueText} testID="e2e-diagnostics-has-auth-session">
                hasAuthSession: {String(snapshot.hasAuthSession)}
              </Text>
              <Text style={styles.valueText} testID="e2e-diagnostics-auth-session-user-id">
                authSessionUserId: {snapshot.authSessionUserId || 'null'}
              </Text>
            </View>

            <View style={styles.card}>
              <Text style={styles.cardTitle}>Table Counts</Text>
              <Text style={styles.valueText} testID="e2e-diagnostics-count-places">
                places: {snapshot.tableCounts.places}
              </Text>
              <Text style={styles.valueText} testID="e2e-diagnostics-count-saved-places">
                savedPlaces: {snapshot.tableCounts.savedPlaces}
              </Text>
              <Text style={styles.valueText} testID="e2e-diagnostics-count-collections">
                collections: {snapshot.tableCounts.collections}
              </Text>
              <Text style={styles.valueText} testID="e2e-diagnostics-count-collection-places">
                collection_places: {snapshot.tableCounts.collectionPlaces}
              </Text>
              <Text style={styles.valueText} testID="e2e-diagnostics-count-outbox">
                outbox: {snapshot.tableCounts.outbox}
              </Text>
              <Text style={styles.valueText} testID="e2e-diagnostics-count-outbox-pending">
                outboxPending: {snapshot.tableCounts.outboxPending}
              </Text>
              <Text style={styles.valueText} testID="e2e-diagnostics-count-sync-state">
                sync_state: {snapshot.tableCounts.syncState}
              </Text>
            </View>

            <View style={styles.card}>
              <Text style={styles.cardTitle}>Sync Timestamps</Text>
              <Text style={styles.valueText} testID="e2e-diagnostics-sync-places-last-pushed">
                places.lastPushedAt: {snapshot.syncState.places.lastPushedAt || 'null'}
              </Text>
              <Text style={styles.valueText} testID="e2e-diagnostics-sync-places-last-pulled">
                places.lastPulledAt: {snapshot.syncState.places.lastPulledAt || 'null'}
              </Text>
              <Text style={styles.valueText} testID="e2e-diagnostics-sync-collections-last-pushed">
                collections.lastPushedAt: {snapshot.syncState.collections.lastPushedAt || 'null'}
              </Text>
              <Text style={styles.valueText} testID="e2e-diagnostics-sync-collections-last-pulled">
                collections.lastPulledAt: {snapshot.syncState.collections.lastPulledAt || 'null'}
              </Text>
              <Text style={styles.valueText} testID="e2e-diagnostics-sync-preferences-last-pushed">
                preferences.lastPushedAt: {snapshot.syncState.preferences.lastPushedAt || 'null'}
              </Text>
              <Text style={styles.valueText} testID="e2e-diagnostics-sync-preferences-last-pulled">
                preferences.lastPulledAt: {snapshot.syncState.preferences.lastPulledAt || 'null'}
              </Text>
            </View>

            <View style={styles.card}>
              <Text style={styles.cardTitle}>Preferences</Text>
              <Text style={styles.valueText} testID="e2e-diagnostics-hexagon-theme">
                hexagonTheme: {snapshot.preferences.hexagonTheme || 'null'}
              </Text>
              <Text style={styles.valueText} testID="e2e-diagnostics-hexagon-variant">
                hexagonVariant: {snapshot.preferences.hexagonVariant || 'null'}
              </Text>
            </View>
          </>
        )}

        <View style={styles.actionsCard}>
          <Text style={styles.cardTitle}>Actions</Text>

          <TouchableOpacity
            style={styles.actionButton}
            onPress={() => runAction(loadSnapshot)}
            testID="e2e-diagnostics-action-refresh"
            disabled={isRunningAction}
          >
            <Text style={styles.actionText}>Refresh Snapshot</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.actionButton}
            onPress={() => runAction(() => signInForDiagnostics(e2ePrimaryUserId))}
            testID="e2e-diagnostics-action-signin-user-a"
            disabled={isRunningAction}
          >
            <Text style={styles.actionText}>Sign In User A</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.actionButton}
            onPress={() => runAction(() => signInForDiagnostics(e2eSecondaryUserId))}
            testID="e2e-diagnostics-action-signin-user-b"
            disabled={isRunningAction}
          >
            <Text style={styles.actionText}>Sign In User B</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.actionButton}
            onPress={() => runAction(() => signInForDiagnostics(e2eTertiaryUserId))}
            testID="e2e-diagnostics-action-signin-user-c"
            disabled={isRunningAction}
          >
            <Text style={styles.actionText}>Sign In User C</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.actionButton}
            onPress={() => runAction(() => signInForDiagnostics(e2eQuaternaryUserId))}
            testID="e2e-diagnostics-action-signin-user-d"
            disabled={isRunningAction}
          >
            <Text style={styles.actionText}>Sign In User D</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.actionButton}
            onPress={() => runAction(() => signInForDiagnostics(e2eQuinaryUserId))}
            testID="e2e-diagnostics-action-signin-user-e"
            disabled={isRunningAction}
          >
            <Text style={styles.actionText}>Sign In User E</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.actionButton}
            onPress={() => runAction(() => signInForDiagnostics(e2eSenaryUserId))}
            testID="e2e-diagnostics-action-signin-user-f"
            disabled={isRunningAction}
          >
            <Text style={styles.actionText}>Sign In User F</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.actionButton}
            onPress={() => runAction(() => signInForDiagnostics(e2eSeptenaryUserId))}
            testID="e2e-diagnostics-action-signin-user-g"
            disabled={isRunningAction}
          >
            <Text style={styles.actionText}>Sign In User G</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.actionButton}
            onPress={() => runAction(() => signInForDiagnostics(e2eOctonaryUserId))}
            testID="e2e-diagnostics-action-signin-user-h"
            disabled={isRunningAction}
          >
            <Text style={styles.actionText}>Sign In User H</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.actionButton}
            onPress={() => runAction(signOut)}
            testID="e2e-diagnostics-action-signout"
            disabled={isRunningAction}
          >
            <Text style={styles.actionText}>Sign Out</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.actionButton}
            onPress={() => runAction(createDiagnosticsPlace)}
            testID="e2e-diagnostics-action-create-place"
            disabled={isRunningAction}
          >
            <Text style={styles.actionText}>Create Local Place</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.actionButton}
            onPress={() => runAction(createDiagnosticsCollectionForLatestPlace)}
            testID="e2e-diagnostics-action-create-collection-with-place"
            disabled={isRunningAction}
          >
            <Text style={styles.actionText}>Create Collection + Add Latest Place</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.actionButton}
            onPress={() => runAction(removeLatestPlaceFromAllCollections)}
            testID="e2e-diagnostics-action-remove-latest-place-memberships"
            disabled={isRunningAction}
          >
            <Text style={styles.actionText}>Remove Latest Place From All Collections</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.actionButton}
            onPress={() => runAction(() => setDiagnosticsHexagonTheme('stone'))}
            testID="e2e-diagnostics-action-set-theme-stone"
            disabled={isRunningAction}
          >
            <Text style={styles.actionText}>Set Hexagon Theme: stone</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.actionButton}
            onPress={() => runAction(() => setDiagnosticsHexagonTheme('basalt'))}
            testID="e2e-diagnostics-action-set-theme-basalt"
            disabled={isRunningAction}
          >
            <Text style={styles.actionText}>Set Hexagon Theme: basalt</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.actionButton}
            onPress={() => runAction(createDiagnosticsRemotePlaceMutation)}
            testID="e2e-diagnostics-action-create-remote-place"
            disabled={isRunningAction}
          >
            <Text style={styles.actionText}>Create Remote Place Mutation</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.actionButton}
            onPress={() => runAction(runDiagnosticsSync)}
            testID="e2e-diagnostics-action-run-sync"
            disabled={isRunningAction}
          >
            <Text style={styles.actionText}>Run Sync</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.actionButton, styles.warningButton]}
            onPress={() => runAction(wipeDiagnosticsLocalData)}
            testID="e2e-diagnostics-action-wipe-local"
            disabled={isRunningAction}
          >
            <Text style={[styles.actionText, styles.warningActionText]}>Wipe Local Data</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
  },
  backButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    color: colors.textPrimary,
    fontSize: 20,
    fontWeight: '600',
  },
  headerPlaceholder: {
    width: 40,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    gap: 12,
    paddingBottom: 120,
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  loadingText: {
    color: colors.textSecondary,
    fontSize: 13,
  },
  card: {
    backgroundColor: '#262626',
    borderRadius: 12,
    padding: 14,
    gap: 6,
  },
  actionsCard: {
    backgroundColor: '#262626',
    borderRadius: 12,
    padding: 14,
    gap: 10,
  },
  cardTitle: {
    color: colors.textPrimary,
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 4,
  },
  valueText: {
    color: colors.textSecondary,
    fontSize: 13,
  },
  actionButton: {
    height: 44,
    borderRadius: 10,
    backgroundColor: '#393939',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  actionText: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '500',
    textAlign: 'center',
  },
  warningButton: {
    borderWidth: 1,
    borderColor: '#FE6B6B',
  },
  warningActionText: {
    color: '#FE6B6B',
  },
});

export default DiagnosticsScreen;
