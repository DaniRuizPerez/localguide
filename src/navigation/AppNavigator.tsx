import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import ChatScreen from '../screens/ChatScreen';
import MapScreen from '../screens/MapScreen';
import { Colors } from '../theme/colors';
import type { GuideTopic } from '../services/LocalGuideService';

export type RootStackParamList = {
  Chat: { initialTopic?: GuideTopic } | undefined;
  Map: undefined;
};

// Kept so older imports (e.g. test fixtures) that reference `RootTabParamList`
// still compile. Same shape, just a deprecated alias.
export type RootTabParamList = RootStackParamList;

const Stack = createNativeStackNavigator<RootStackParamList>();

interface AppNavigatorProps {
  initialTopic?: GuideTopic;
}

/**
 * App navigation — a single-screen stack. Chat is the root; Map is pushed
 * on top when the user taps the Map card on the Home state, and the native
 * back gesture (or our own in-app back arrow) pops it.
 *
 * The old bottom-tab bar was removed — `Map` is now a regular destination
 * that sits alongside `Plan my day` and `Quiz me` on the Home CTA row,
 * which removes ~56 px of permanent chrome from every screen.
 */
export default function AppNavigator({ initialTopic }: AppNavigatorProps = {}) {
  return (
    <NavigationContainer>
      <Stack.Navigator
        screenOptions={{
          // Both screens draw their own headers (ChatHeader / Map back FAB),
          // so the nav header is off everywhere.
          headerShown: false,
          contentStyle: { backgroundColor: Colors.background },
          // iOS-style push animation on both platforms for a consistent feel.
          animation: 'slide_from_right',
        }}
      >
        <Stack.Screen
          name="Chat"
          component={ChatScreen}
          initialParams={initialTopic ? { initialTopic } : undefined}
        />
        <Stack.Screen name="Map" component={MapScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
