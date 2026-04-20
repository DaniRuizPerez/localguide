import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Text, View, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import ChatScreen from '../screens/ChatScreen';
import MapScreen from '../screens/MapScreen';
import { Colors } from '../theme/colors';
import { Radii, Shadows } from '../theme/tokens';
import { Wordmark } from '../components/Wordmark';
import type { GuideTopic } from '../services/LocalGuideService';

export type RootTabParamList = {
  Chat: { initialTopic?: GuideTopic } | undefined;
  Map: undefined;
};

const Tab = createBottomTabNavigator<RootTabParamList>();

interface AppNavigatorProps {
  initialTopic?: GuideTopic;
}

function TabIcon({ focused, glyph }: { focused: boolean; glyph: string }) {
  return (
    <View style={[styles.tabIconWrap, focused && styles.tabIconWrapActive]}>
      <Text
        style={[
          styles.tabGlyph,
          { color: focused ? Colors.primary : Colors.textTertiary },
        ]}
      >
        {glyph}
      </Text>
    </View>
  );
}

export default function AppNavigator({ initialTopic }: AppNavigatorProps = {}) {
  const insets = useSafeAreaInsets();
  const tabBottomPad = Math.max(insets.bottom, 10);
  return (
    <NavigationContainer>
      <Tab.Navigator
        screenOptions={{
          headerShown: true,
          headerStyle: {
            backgroundColor: Colors.background,
            shadowColor: 'transparent',
            borderBottomWidth: 0,
          },
          headerTitleAlign: 'left',
          headerLeft: () => (
            <View style={{ paddingLeft: 14 }}>
              <Wordmark />
            </View>
          ),
          headerTitle: () => null,
          headerShadowVisible: false,
          tabBarActiveTintColor: Colors.primary,
          tabBarInactiveTintColor: Colors.textTertiary,
          tabBarStyle: {
            backgroundColor: Colors.surface,
            borderTopWidth: 0,
            paddingTop: 8,
            paddingBottom: tabBottomPad,
            height: 56 + tabBottomPad,
            ...Shadows.tabBar,
          },
          tabBarLabelStyle: {
            fontFamily: 'Nunito_700Bold',
            fontSize: 11,
            letterSpacing: 0.3,
            marginTop: 4,
            paddingBottom: 2,
          },
          tabBarIconStyle: {
            marginBottom: 0,
          },
        }}
      >
        <Tab.Screen
          name="Chat"
          component={ChatScreen}
          initialParams={initialTopic ? { initialTopic } : undefined}
          options={{
            tabBarLabel: 'Chat',
            tabBarIcon: ({ focused }) => <TabIcon focused={focused} glyph="💬" />,
          }}
        />
        <Tab.Screen
          name="Map"
          component={MapScreen}
          options={{
            tabBarLabel: 'Map',
            tabBarIcon: ({ focused }) => <TabIcon focused={focused} glyph="🗺" />,
          }}
        />
      </Tab.Navigator>
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  tabIconWrap: {
    width: 44,
    height: 26,
    borderRadius: Radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabIconWrapActive: {
    backgroundColor: 'rgba(232,132,92,0.15)',
  },
  tabGlyph: {
    fontSize: 16,
  },
});
