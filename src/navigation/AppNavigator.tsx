import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Text } from 'react-native';
import ChatScreen from '../screens/ChatScreen';
import MapScreen from '../screens/MapScreen';
import { Colors } from '../theme/colors';

export type RootTabParamList = {
  Chat: undefined;
  Map: undefined;
};

const Tab = createBottomTabNavigator<RootTabParamList>();

export default function AppNavigator() {
  return (
    <NavigationContainer>
      <Tab.Navigator
        screenOptions={{
          headerShown: true,
          headerStyle: { backgroundColor: Colors.surface },
          headerTitleStyle: { color: Colors.textPrimary, fontWeight: '700' },
          headerShadowVisible: false,
          tabBarActiveTintColor: Colors.tabActive,
          tabBarInactiveTintColor: Colors.tabInactive,
          tabBarStyle: {
            backgroundColor: Colors.tabBar,
            borderTopColor: Colors.border,
          },
          tabBarLabelStyle: { fontWeight: '600', fontSize: 11 },
        }}
      >
        <Tab.Screen
          name="Chat"
          component={ChatScreen}
          options={{
            title: 'Local Guide',
            tabBarLabel: 'Chat',
            tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 20 }}>💬</Text>,
          }}
        />
        <Tab.Screen
          name="Map"
          component={MapScreen}
          options={{
            title: 'Location',
            tabBarLabel: 'Map',
            tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 20 }}>🗺️</Text>,
          }}
        />
      </Tab.Navigator>
    </NavigationContainer>
  );
}
