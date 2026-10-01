"use client";
import { Text } from "react-native";
import { useNavigation } from "@rshono/core/client";
export default function NavigationProbe() {
  const { url } = useNavigation();
  return <Text>Native navigation: {url.pathname}</Text>;
}
